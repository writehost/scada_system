// Сессии EMS. Токен — подписанный идентификатор строки ems_sessions, поэтому
// выход и отзыв действуют сразу (в отличие от самодостаточного токена без БД).

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import type { Db } from "./db.ts"

export const SESSION_COOKIE = "ems_session"
export const WEB_TTL_SEC = 12 * 60 * 60
export const MOBILE_TTL_SEC = 30 * 24 * 60 * 60

export function authSecret(): string {
  const s = process.env.EMS_AUTH_SECRET?.trim()
  if (s && s.length >= 32) return s
  if (process.env.NODE_ENV === "production") throw new Error("EMS_AUTH_SECRET is not set (min 32 chars)")
  return "dev-only-ems-auth-secret-change-me-0123456789"
}

function sign(data: string): string {
  return createHmac("sha256", authSecret()).update(data).digest("base64url")
}

export function sessionToken(sessionId: string): string {
  return `ems1.${sessionId}.${sign(`ems1.${sessionId}`)}`
}

export function parseSessionToken(token: string): string | null {
  const m = /^ems1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]+)$/.exec(token.trim())
  if (!m) return null
  const expected = Buffer.from(sign(`ems1.${m[1]}`))
  const got = Buffer.from(m[2])
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null
  return m[1]
}

export type SessionUser = {
  sessionId: string
  userId: string
  displayName: string
  email: string | null
  isPlatformAdmin: boolean
  activeOrgId: string | null
  kind: "web" | "mobile"
  expiresAt: Date
}

export async function createSession(c: Db, input: { userId: string; activeOrgId: string | null; kind: "web" | "mobile"; userAgent?: string | null; ip?: string | null }): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const ttl = input.kind === "mobile" ? MOBILE_TTL_SEC : WEB_TTL_SEC
  const r = await c.query<{ session_id: string; expires_at: Date }>(
    `INSERT INTO ems_sessions (user_id, active_org_id, kind, expires_at, user_agent, ip) VALUES ($1, $2, $3, now() + make_interval(secs => $4), $5, $6)
     RETURNING session_id, expires_at`,
    [input.userId, input.activeOrgId, input.kind, ttl, input.userAgent?.slice(0, 300) ?? null, input.ip ?? null],
  )
  return { token: sessionToken(r.rows[0].session_id), sessionId: r.rows[0].session_id, expiresAt: r.rows[0].expires_at }
}

/** Проверка токена по БД: подпись, срок, отзыв. Выполняется в системной области. */
export async function loadSession(c: Db, token: string): Promise<SessionUser | null> {
  const id = parseSessionToken(token)
  if (!id) return null
  const r = await c.query(
    `SELECT s.session_id, s.user_id, s.active_org_id, s.kind, s.expires_at, s.last_seen_at, u.display_name, u.email, u.is_platform_admin
       FROM ems_sessions s JOIN ems_users u ON u.user_id = s.user_id
      WHERE s.session_id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [id],
  )
  const row = r.rows[0]
  if (!row) return null
  if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
    await c.query("UPDATE ems_sessions SET last_seen_at = now() WHERE session_id = $1", [id])
  }
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    displayName: row.display_name,
    email: row.email,
    isPlatformAdmin: row.is_platform_admin,
    activeOrgId: row.active_org_id,
    kind: row.kind,
    expiresAt: row.expires_at,
  }
}

export async function revokeSession(c: Db, sessionId: string): Promise<void> {
  await c.query("UPDATE ems_sessions SET revoked_at = now() WHERE session_id = $1 AND revoked_at IS NULL", [sessionId])
}

export function cookieOptions(maxAge: number) {
  const secureEnv = process.env.EMS_COOKIE_SECURE?.trim().toLowerCase()
  const secure = secureEnv === "true" ? true : secureEnv === "false" ? false : process.env.NODE_ENV === "production"
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge }
}

// ── Секреты устройств и интеграций ──────────────────────────────────
// Хранится только HMAC секрета (с серверным «перцем»), исходное значение
// показывается один раз при выдаче.

export function newSecret(prefix: string, bytes = 24): string {
  return `${prefix}_${randomBytes(bytes).toString("base64url")}`
}

export function hashSecret(secret: string): string {
  return createHmac("sha256", authSecret()).update(`secret:${secret}`).digest("hex")
}

export function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}
