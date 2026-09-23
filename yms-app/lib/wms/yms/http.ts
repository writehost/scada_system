import { NextResponse } from "next/server"
import { wmsErrorResponse, WmsHttpError } from "@/lib/wms/errors"
import { tryGetPool } from "@/lib/wms/pool"
import { requireWmsActor, type WmsActor } from "@/lib/wms/require-actor"
import { getSiteId } from "@/lib/wms/resolve"
import { assertYmsPermission } from "@/lib/wms/yms/permissions"
import { ensureYardSeed, ensureYmsSchema } from "@/lib/wms/yms/schema"
import type { Pool, PoolClient } from "pg"

export type YmsCtx = {
  client: PoolClient
  pool: Pool
  siteId: number
  siteCode: string
  actor: WmsActor
  roleCodes: string[]
  body: Record<string, unknown>
  url: URL
}

async function open(
  req: Request,
  permission: string
): Promise<{ ctx: YmsCtx; client: PoolClient } | { error: NextResponse }> {
  const actorGate = await requireWmsActor(req)
  if ("error" in actorGate) return { error: actorGate.error }
  const pool = tryGetPool()
  if (!pool) {
    return {
      error: NextResponse.json(
        { error: "database not configured (set DATABASE_URL or PG_URL)" },
        { status: 503 }
      ),
    }
  }
  const url = new URL(req.url)
  let body: Record<string, unknown> = {}
  if (req.method !== "GET" && req.method !== "HEAD") {
    const text = await req.text()
    if (text.trim()) {
      try {
        const parsed = JSON.parse(text) as unknown
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          body = parsed as Record<string, unknown>
        }
      } catch {
        return { error: NextResponse.json({ error: "invalid json" }, { status: 400 }) }
      }
    }
  }
  const siteCode = (
    url.searchParams.get("siteCode") ||
    (typeof body.siteCode === "string" ? body.siteCode : "")
  ).trim()
  if (!siteCode) {
    return { error: NextResponse.json({ error: "siteCode is required" }, { status: 400 }) }
  }
  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) {
      client.release()
      return { error: NextResponse.json({ error: "unknown siteCode" }, { status: 404 }) }
    }
    await ensureYmsSchema(client)
    await ensureYardSeed(client, siteId)
    const roleCodes = await assertYmsPermission(client, siteId, actorGate.actor, permission)
    return {
      client,
      ctx: { client, pool, siteId, siteCode, actor: actorGate.actor, roleCodes, body, url },
    }
  } catch (error) {
    client.release()
    return { error: wmsErrorResponse(error) }
  }
}

export async function withYms(
  req: Request,
  permission: string,
  work: (ctx: YmsCtx) => Promise<unknown>
): Promise<NextResponse> {
  const opened = await open(req, permission)
  if ("error" in opened) return opened.error
  try {
    const data = await work(opened.ctx)
    if (data instanceof NextResponse) return data
    return NextResponse.json(data)
  } catch (error) {
    return wmsErrorResponse(error)
  } finally {
    opened.client.release()
  }
}

export async function withYmsTx(
  req: Request,
  permission: string,
  work: (ctx: YmsCtx) => Promise<unknown>
): Promise<NextResponse> {
  const opened = await open(req, permission)
  if ("error" in opened) return opened.error
  try {
    await opened.client.query("BEGIN")
    const data = await work(opened.ctx)
    await opened.client.query("COMMIT")
    if (data instanceof NextResponse) return data
    return NextResponse.json(data)
  } catch (error) {
    try {
      await opened.client.query("ROLLBACK")
    } catch {
      /* уже откатили */
    }
    return wmsErrorResponse(error)
  } finally {
    opened.client.release()
  }
}

export function actorLogin(actor: WmsActor): string {
  return actor.session?.login?.trim() || actor.userId || "system"
}

export function actorUserId(actor: WmsActor): string | null {
  const id = actor.userId?.trim() || actor.session?.userId?.trim() || ""
  return id || null
}

export function bad(message: string, code: string, status = 400): never {
  throw new WmsHttpError(status, message, code)
}
