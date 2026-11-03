import { NextResponse } from "next/server"
import type { Pool, PoolClient } from "pg"
import { wmsErrorResponse, WmsHttpError } from "@/lib/wms/errors"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { canonicalSiteCode } from "@/lib/wms/site-code"
import {
  ensureRoutePermissionRows,
  requirePermission,
  resolveRouteActor,
  type RouteActor,
  type RoutePermission,
} from "@/lib/route/auth"
import { ensureRouteSchema } from "@/lib/route/schema"

export type RouteCtx = {
  client: PoolClient
  pool: Pool
  siteId: number
  siteCode: string
  actor: RouteActor
  body: Record<string, unknown>
  url: URL
  req: Request
}

async function readBody(req: Request): Promise<Record<string, unknown> | NextResponse> {
  if (req.method === "GET" || req.method === "HEAD") return {}
  const text = await req.text()
  if (!text.trim()) return {}
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    return NextResponse.json({ error: "тело запроса должно быть JSON-объектом", code: "invalid_json" }, { status: 400 })
  } catch {
    return NextResponse.json({ error: "invalid json", code: "invalid_json" }, { status: 400 })
  }
}

async function open(
  req: Request,
  permission: RoutePermission | null
): Promise<{ ctx: RouteCtx } | { error: NextResponse }> {
  const pool = tryGetPool()
  if (!pool) {
    return { error: NextResponse.json({ error: "database not configured", code: "db_missing" }, { status: 503 }) }
  }
  const body = await readBody(req)
  if (body instanceof NextResponse) return { error: body }
  const url = new URL(req.url)
  const siteCode = canonicalSiteCode(
    url.searchParams.get("siteCode") || (typeof body.siteCode === "string" ? body.siteCode : "") || req.headers.get("x-site-code")
  )
  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) {
      client.release()
      return { error: NextResponse.json({ error: "unknown siteCode", code: "unknown_site" }, { status: 404 }) }
    }
    await ensureRouteSchema(client)
    await client.query("BEGIN")
    await ensureRoutePermissionRows(client)
    await client.query("COMMIT")
    const actor = await resolveRouteActor(req, client, siteId)
    if (permission) requirePermission(actor, permission)
    return { ctx: { client, pool, siteId, siteCode, actor, body, url, req } }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined)
    client.release()
    return { error: wmsErrorResponse(error) }
  }
}

/** Чтение без транзакции. */
export async function withRoute(
  req: Request,
  permission: RoutePermission | null,
  work: (ctx: RouteCtx) => Promise<unknown>
): Promise<NextResponse> {
  const opened = await open(req, permission)
  if ("error" in opened) return opened.error
  try {
    const data = await work(opened.ctx)
    if (data instanceof Response) return data as NextResponse
    return NextResponse.json(data)
  } catch (error) {
    return wmsErrorResponse(error)
  } finally {
    opened.ctx.client.release()
  }
}

/** Команда в одной транзакции: либо всё, либо ничего. */
export async function withRouteTx(
  req: Request,
  permission: RoutePermission | null,
  work: (ctx: RouteCtx) => Promise<unknown>
): Promise<NextResponse> {
  const opened = await open(req, permission)
  if ("error" in opened) return opened.error
  const { client } = opened.ctx
  try {
    await client.query("BEGIN")
    const data = await work(opened.ctx)
    await client.query("COMMIT")
    if (data instanceof Response) return data as NextResponse
    return NextResponse.json(data)
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined)
    return wmsErrorResponse(error)
  } finally {
    client.release()
  }
}

export function fail(status: number, message: string, code: string, details?: unknown): never {
  throw new WmsHttpError(status, message, code, details)
}

export function str(body: Record<string, unknown>, key: string, max = 200): string {
  const v = body[key]
  if (typeof v === "number" && Number.isFinite(v)) return String(v)
  return typeof v === "string" ? v.trim().slice(0, max) : ""
}

export function num(body: Record<string, unknown>, key: string): number | null {
  const v = body[key]
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/** UUID/строка идемпотентности клиента. Обязателен для всех команд водителя. */
export function requestId(body: Record<string, unknown>, required = true): string | null {
  const v = str(body, "clientRequestId", 80) || str(body, "requestId", 80)
  if (!v && required) fail(400, "нужен clientRequestId (уникальный ID запроса)", "request_id_required")
  if (v && !/^[A-Za-z0-9._:-]{8,80}$/.test(v)) fail(400, "некорректный clientRequestId", "request_id_invalid")
  return v || null
}
