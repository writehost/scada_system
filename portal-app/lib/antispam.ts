import type { PoolClient } from "pg"
import { hmac, sign, unsign } from "./crypto"
import { HttpError } from "./errors"

const FORM_PURPOSE = "form"

export function issueFormToken(now = Date.now()): string {
  return sign({ t: now }, FORM_PURPOSE)
}

function minFillMs(): number {
  const v = Number(process.env.PORTAL_FORM_MIN_FILL_MS)
  return Number.isFinite(v) && v >= 0 ? v : 4000
}

/**
 * Токен формы: подписанное время открытия. Слишком быстрая отправка —
 * признак бота, слишком старая — устаревшая вкладка.
 */
export function checkFormToken(token: string, now = Date.now(), minMs = minFillMs()): void {
  const payload = unsign<{ t: number }>(token, FORM_PURPOSE)
  if (!payload || typeof payload.t !== "number") {
    throw new HttpError(400, "Форма устарела. Обновите страницу и отправьте ещё раз.", "bad_form_token")
  }
  const age = now - payload.t
  if (age < minMs) {
    throw new HttpError(429, "Слишком быстро. Проверьте данные и отправьте ещё раз.", "too_fast")
  }
  if (age > 6 * 60 * 60 * 1000) {
    throw new HttpError(400, "Форма устарела. Обновите страницу и отправьте ещё раз.", "stale_form_token")
  }
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")
  if (fwd) return fwd.split(",")[0].trim()
  return req.headers.get("x-real-ip")?.trim() || "unknown"
}

export function ipHash(ip: string): string {
  return hmac(ip, "ip").slice(0, 32)
}

type Limit = { bucket: string; max: number; windowSec: number; message: string }

export function requestLimits(ipH: string, email: string): Limit[] {
  const perIp = Number(process.env.PORTAL_RATE_PER_IP_HOUR) || 5
  const perEmail = Number(process.env.PORTAL_RATE_PER_EMAIL_DAY) || 3
  return [
    {
      bucket: `req:ip:${ipH}`,
      max: perIp,
      windowSec: 3600,
      message: "Слишком много заявок с вашего адреса. Попробуйте через час.",
    },
    {
      bucket: `req:email:${hmac(email, "email").slice(0, 32)}`,
      max: perEmail,
      windowSec: 86400,
      message: "С этого email уже отправлено несколько заявок за сутки. Мы рассмотрим их.",
    },
  ]
}

/** Считает попытки в БД, чтобы лимит работал на всех экземплярах приложения. */
export async function enforceRateLimits(client: PoolClient, limits: Limit[]): Promise<void> {
  for (const l of limits) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [l.bucket])
    const r = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM portal_rate_hits
       WHERE bucket = $1 AND hit_at > now() - make_interval(secs => $2)`,
      [l.bucket, l.windowSec]
    )
    if (Number(r.rows[0]?.n || 0) >= l.max) throw new HttpError(429, l.message, "rate_limited")
  }
  for (const l of limits) {
    await client.query(`INSERT INTO portal_rate_hits (bucket) VALUES ($1)`, [l.bucket])
  }
  await client.query(`DELETE FROM portal_rate_hits WHERE hit_at < now() - interval '2 days'`)
}
