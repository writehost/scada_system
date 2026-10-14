import { NextResponse } from "next/server"
import type { PoolClient } from "pg"
import { sessionFromWmsApiToken } from "./auth/identity.ts"
import { EDI_SESSION_COOKIE, readCookie, verifySessionToken, type EdiSession } from "./auth/session.ts"
import { HttpError, withClient } from "./db.ts"
import { actorFromSession, type Actor } from "./edi/actor.ts"
import { ensureOnce } from "./edi/schema.ts"
import { seedReference } from "./edi/seed.ts"

export type Ctx = { req: Request; client: PoolClient; actor: Actor; params: Record<string, string> }

type Handler = (ctx: Ctx) => Promise<unknown>

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json(
      { error: error.message, code: error.code, ...(error.details !== undefined ? { details: error.details } : {}) },
      { status: error.status }
    )
  }
  const pgErr = error as { code?: string; message?: string } | null
  if (pgErr?.code === "23505") {
    return NextResponse.json({ error: "Такая запись уже существует", code: "duplicate" }, { status: 409 })
  }
  if (pgErr?.code === "42P01" || pgErr?.code === "42703") {
    return NextResponse.json({ error: "Схема базы данных устарела", code: "db_schema_outdated" }, { status: 503 })
  }
  console.error("[edi]", error)
  return NextResponse.json({ error: "Внутренняя ошибка", code: "internal" }, { status: 500 })
}

export async function prepare(client: PoolClient) {
  await ensureOnce(client, seedReference)
}

/** Обёртка маршрута API: сессия → актор (роли из БД на каждый запрос) → обработчик. */
export function route(handler: Handler, opts: { tx?: boolean } = {}) {
  return async (req: Request, segment?: { params?: Promise<Record<string, string>> }) => {
    try {
      const token = readCookie(req, EDI_SESSION_COOKIE) || bearer(req)
      const apiToken = token.startsWith("wmsu_")
      let session: EdiSession | null = token && !apiToken ? await verifySessionToken(token) : null
      if (!session && !apiToken) {
        return NextResponse.json({ error: "Нужен вход в SCADA EDI", code: "auth_required" }, { status: 401 })
      }
      const params = (await segment?.params) ?? {}
      const result = await withClient(async (client) => {
        await prepare(client)
        if (apiToken) session = await sessionFromWmsApiToken(client, token)
        if (!session) throw new HttpError(401, "Токен недействителен", "auth_required")
        const actor = await actorFromSession(client, session)
        if (!opts.tx) return handler({ req, client, actor, params })
        await client.query("BEGIN")
        try {
          const out = await handler({ req, client, actor, params })
          await client.query("COMMIT")
          return out
        } catch (e) {
          await client.query("ROLLBACK").catch(() => undefined)
          throw e
        }
      })
      if (result instanceof Response) return result
      return NextResponse.json(result ?? { ok: true })
    } catch (error) {
      return errorResponse(error)
    }
  }
}

function bearer(req: Request): string {
  const h = req.headers.get("authorization") || ""
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : ""
}

export async function jsonBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  const len = Number(req.headers.get("content-length") || 0)
  if (len > 2 * 1024 * 1024) throw new HttpError(413, "Слишком большой запрос", "too_large")
  try {
    return (await req.json()) as T
  } catch {
    throw new HttpError(400, "Некорректный JSON", "bad_json")
  }
}

export function clientIp(req: Request): string | null {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null
}
