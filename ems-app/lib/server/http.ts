// Обёртка обработчиков API: аутентификация (сессия SCADA ID / Bearer / API-токен),
// выбор организации с проверкой членства, RBAC, защита от CSRF, лимиты, ошибки.

import { NextResponse } from "next/server"
import type pg from "pg"
import { DbUnavailableError, isUuid, withOrg, withSystem } from "./db.ts"
import { HttpError } from "./errors.ts"
import { rateLimit } from "./ratelimit.ts"
import { hashSecret, loadSession, SESSION_COOKIE, type SessionUser } from "./session.ts"
import { can, type Permission, type Role } from "../services/org.ts"
import type { Actor } from "../services/audit.ts"
import type { Body } from "./validate.ts"

export type Ctx = {
  req: Request
  url: URL
  body: Body
  ip: string
  user: SessionUser | null
  orgId: string
  role: Role
  via: "cookie" | "bearer" | "api_token"
  scopes: string[] | null
  actor: Actor
  tx: <T>(fn: (c: pg.PoolClient) => Promise<T>) => Promise<T>
}

export type PublicCtx = { req: Request; url: URL; body: Body; ip: string }

type Params = Record<string, string>

/** Лимит запросов пользователя/токена в минуту по умолчанию (EMS_RATE_LIMIT_PER_MIN). */
function defaultRate(): number {
  const n = Number(process.env.EMS_RATE_LIMIT_PER_MIN)
  return Number.isFinite(n) && n > 0 ? n : 600
}

const TOKEN_SCOPE: Partial<Record<Permission, string>> = {
  read: "read",
  "readings.write": "readings:write",
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || "local").trim()
}

export function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") || ""
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=")
    if (k === name) {
      try {
        return decodeURIComponent(rest.join("="))
      } catch {
        return rest.join("=")
      }
    }
  }
  return null
}

export function bearer(req: Request): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") || "")
  return m ? m[1].trim() : null
}

async function readBody(req: Request, maxBytes: number): Promise<Body> {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "DELETE") return {}
  const text = await req.text()
  if (text.length > maxBytes) throw new HttpError(413, "payload_too_large", "Слишком большой запрос")
  if (!text.trim()) return {}
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Body
  } catch {
    /* ниже */
  }
  throw new HttpError(400, "invalid_json", "Некорректный JSON")
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin")
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").split(",")[0].trim()
  if (origin) {
    try {
      return new URL(origin).host === host
    } catch {
      return false
    }
  }
  const site = req.headers.get("sec-fetch-site")
  return site == null || site === "same-origin" || site === "none"
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    const headers: Record<string, string> = {}
    if (err.status === 429 && err.details && typeof err.details === "object") headers["Retry-After"] = String((err.details as { retryAfterSec?: number }).retryAfterSec ?? 60)
    return NextResponse.json({ error: err.message, code: err.code, ...(err.details !== undefined ? { details: err.details } : {}) }, { status: err.status, headers })
  }
  if (err instanceof DbUnavailableError) return NextResponse.json({ error: err.message, code: "db_unavailable" }, { status: 503 })
  const pgErr = err as { code?: string; message?: string; constraint?: string }
  if (pgErr?.code === "23505") return NextResponse.json({ error: "Такая запись уже существует", code: "duplicate" }, { status: 409 })
  if (pgErr?.code === "23503") return NextResponse.json({ error: "Связанная запись не найдена или используется", code: "reference" }, { status: 409 })
  if (pgErr?.code === "22P02" || pgErr?.code === "22007" || pgErr?.code === "22008") return NextResponse.json({ error: "Неверный формат данных", code: "invalid_input" }, { status: 400 })
  if (pgErr?.code === "42501") return NextResponse.json({ error: "Доступ запрещён", code: "forbidden" }, { status: 403 })
  if (pgErr?.code === "ECONNREFUSED" || pgErr?.code === "57P01") return NextResponse.json({ error: "База данных недоступна", code: "db_unavailable" }, { status: 503 })
  console.error("[ems] unhandled", err)
  return NextResponse.json({ error: "Внутренняя ошибка сервера", code: "internal" }, { status: 500 })
}

function toResponse(result: unknown): Response {
  if (result instanceof Response) return result
  return NextResponse.json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } })
}

/** Аутентифицированный пользователь без выбора организации (список организаций, выход). */
export async function resolveUser(req: Request): Promise<{ user: SessionUser; via: "cookie" | "bearer" } | null> {
  const b = bearer(req)
  const token = b && b.startsWith("ems1.") ? b : cookieValue(req, SESSION_COOKIE)
  if (!token) return null
  const user = await withSystem((c) => loadSession(c, token))
  return user ? { user, via: b && b.startsWith("ems1.") ? "bearer" : "cookie" } : null
}

async function resolveApiToken(token: string): Promise<{ orgId: string; tokenId: string; scopes: string[] } | null> {
  return withSystem(async (c) => {
    const r = await c.query("SELECT token_id, org_id, scopes FROM ems_api_tokens WHERE token_hash = $1 AND revoked_at IS NULL", [hashSecret(token)])
    if (!r.rows[0]) return null
    await c.query("UPDATE ems_api_tokens SET last_used_at = now() WHERE token_id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')", [r.rows[0].token_id])
    return { orgId: r.rows[0].org_id, tokenId: r.rows[0].token_id, scopes: r.rows[0].scopes }
  })
}

export type ApiOptions = {
  perm: Permission
  /** Разрешить API-токены интеграций (emsk_) с указанным scope. */
  tokenScope?: string
  rate?: number
  maxBody?: number
}

export function api(opts: ApiOptions, handler: (ctx: Ctx, params: Params) => Promise<unknown>) {
  return async (req: Request, routeCtx: { params: Promise<Params> }) => {
    try {
      const url = new URL(req.url)
      const ip = clientIp(req)
      const params = (await routeCtx?.params) ?? {}
      const b = bearer(req)
      let ctx: Ctx

      if (b && b.startsWith("emsk_")) {
        const scope = opts.tokenScope ?? TOKEN_SCOPE[opts.perm]
        const tok = await resolveApiToken(b)
        if (!tok) throw new HttpError(401, "auth_required", "Неверный API-токен")
        if (!scope || !tok.scopes.includes(scope)) throw new HttpError(403, "forbidden", "У токена нет нужного разрешения")
        const rl = rateLimit(`tok:${tok.tokenId}:${opts.rate ? url.pathname : "*"}`, opts.rate ?? defaultRate())
        if (!rl.ok) throw new HttpError(429, "rate_limited", "Слишком много запросов", { retryAfterSec: rl.retryAfterSec })
        const body = await readBody(req, opts.maxBody ?? 1_000_000)
        ctx = {
          req, url, body, ip, user: null, orgId: tok.orgId, role: "viewer", via: "api_token", scopes: tok.scopes,
          actor: { kind: "api_token", id: tok.tokenId, ip },
          tx: (fn) => withOrg(tok.orgId, fn),
        }
        return toResponse(await handler(ctx, params))
      }

      const auth = await resolveUser(req)
      if (!auth) throw new HttpError(401, "auth_required", "Нужен вход через SCADA ID")
      if (auth.via === "cookie" && req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) {
        throw new HttpError(403, "csrf", "Запрос с чужого сайта отклонён")
      }
      // Общий лимит пользователя и отдельный, более строгий лимит маршрута (если задан).
      for (const [key, limit] of [[`user:${auth.user.userId}`, defaultRate()], ...(opts.rate ? [[`user:${auth.user.userId}:${req.method}:${url.pathname}`, opts.rate]] : [])] as Array<[string, number]>) {
        const rl = rateLimit(key, limit)
        if (!rl.ok) throw new HttpError(429, "rate_limited", "Слишком много запросов", { retryAfterSec: rl.retryAfterSec })
      }
      const requested = req.headers.get("x-ems-org") || url.searchParams.get("org")
      const orgId = requested && isUuid(requested) ? requested : auth.user.activeOrgId
      if (!orgId) throw new HttpError(409, "no_org", "Выберите организацию")
      const role = await withSystem(async (c) => {
        const r = await c.query<{ role: Role }>(
          "SELECT m.role FROM ems_memberships m JOIN ems_organizations o ON o.org_id = m.org_id WHERE m.org_id = $1 AND m.user_id = $2 AND o.archived_at IS NULL",
          [orgId, auth.user.userId],
        )
        return r.rows[0]?.role ?? null
      })
      if (!role) throw new HttpError(403, "not_member", "Нет доступа к этой организации")
      if (!can(role, opts.perm)) throw new HttpError(403, "forbidden", "Недостаточно прав для этого действия")
      const body = await readBody(req, opts.maxBody ?? 1_000_000)
      ctx = {
        req, url, body, ip, user: auth.user, orgId, role, via: auth.via, scopes: null,
        actor: { kind: "user", id: auth.user.userId, ip },
        tx: (fn) => withOrg(orgId, fn),
      }
      return toResponse(await handler(ctx, params))
    } catch (err) {
      return errorResponse(err)
    }
  }
}

/** Публичный обработчик (вход, приём от шлюзов со своей аутентификацией). */
export function publicApi(opts: { rate?: number; rateKey?: string; maxBody?: number }, handler: (ctx: PublicCtx, params: Params) => Promise<unknown>) {
  return async (req: Request, routeCtx: { params: Promise<Params> }) => {
    try {
      const ip = clientIp(req)
      if (opts.rate) {
        const rl = rateLimit(`${opts.rateKey ?? new URL(req.url).pathname}:${ip}`, opts.rate)
        if (!rl.ok) throw new HttpError(429, "rate_limited", "Слишком много запросов", { retryAfterSec: rl.retryAfterSec })
      }
      const params = (await routeCtx?.params) ?? {}
      const body = await readBody(req, opts.maxBody ?? 100_000)
      return toResponse(await handler({ req, url: new URL(req.url), body, ip }, params))
    } catch (err) {
      return errorResponse(err)
    }
  }
}

export function publicOrigin(req: Request): string {
  const configured = process.env.EMS_PUBLIC_URL?.trim()
  if (configured) return configured.replace(/\/$/, "")
  const proto = (req.headers.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "")).split(",")[0].trim()
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3016").split(",")[0].trim()
  return `${proto}://${host}`
}
