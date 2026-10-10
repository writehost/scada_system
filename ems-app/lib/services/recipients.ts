// Адреса для уведомлений. Письма уходят только на подтверждённые адреса:
// ссылка подтверждения одноразовая, хранится хэш, срок 48 часов.

import { createHash, randomBytes } from "node:crypto"
import type { Db } from "../server/db.ts"
import { badRequest, conflict, HttpError, notFound } from "../server/errors.ts"
import { assertLimit, assertWritable } from "./subscription.ts"
import { audit, type Actor } from "./audit.ts"
import { enqueueDirect, publicUrl, SUBSCRIBABLE_KINDS } from "./notify.ts"

const tokenHash = (t: string) => createHash("sha256").update(`verify:${t}`).digest("hex")

export function validateKinds(raw: unknown): string[] {
  if (raw == null) return SUBSCRIBABLE_KINDS
  if (!Array.isArray(raw)) throw badRequest("Типы уведомлений: нужен список")
  const kinds = [...new Set(raw.map(String))]
  for (const k of kinds) if (!SUBSCRIBABLE_KINDS.includes(k)) throw badRequest(`Неизвестный тип уведомлений: ${k}`)
  return kinds
}

async function sendVerification(c: Db, orgId: string, recipientId: string, email: string): Promise<void> {
  const token = randomBytes(32).toString("base64url")
  await c.query(
    "UPDATE ems_email_recipients SET verify_token_hash = $2, verify_expires_at = now() + interval '48 hours', verify_sent_at = now() WHERE recipient_id = $1",
    [recipientId, tokenHash(token)],
  )
  await enqueueDirect(c, {
    orgId,
    email,
    recipientId,
    kind: "verify",
    subject: "Подтвердите адрес для уведомлений SCADA EMS",
    lead: "Этот адрес добавлен для уведомлений о платежах, расходе и состоянии приборов. Подтвердите, что он ваш. Если вы не ждали письма — просто проигнорируйте его.",
    link: `${publicUrl()}/email/verify?token=${token}`,
    ctaLabel: "Подтвердить адрес",
    reason: "добавление адреса в SCADA EMS",
    dedupKey: `verify:${recipientId}:${Date.now()}`,
  })
}

export async function addRecipient(c: Db, orgId: string, actor: Actor, input: { email: string; label?: string | null; kinds?: unknown; siteIds?: string[] | null; sendHour?: number | null }): Promise<string> {
  await assertLimit(c, orgId, "recipients")
  if (input.siteIds?.length) {
    const s = await c.query("SELECT count(*)::int AS n FROM ems_sites WHERE org_id = $1 AND site_id = ANY($2::uuid[])", [orgId, input.siteIds])
    if (s.rows[0].n !== new Set(input.siteIds).size) throw badRequest("Объект не найден")
  }
  const exists = await c.query("SELECT 1 FROM ems_email_recipients WHERE org_id = $1 AND lower(email) = lower($2)", [orgId, input.email])
  if (exists.rows[0]) throw conflict("Этот адрес уже добавлен", "recipient_exists")
  const r = await c.query<{ recipient_id: string }>(
    `INSERT INTO ems_email_recipients (org_id, email, label, kinds, site_ids, send_hour, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING recipient_id`,
    [orgId, input.email, input.label ?? null, validateKinds(input.kinds), input.siteIds?.length ? input.siteIds : null, input.sendHour ?? 9, actor.id],
  )
  await sendVerification(c, orgId, r.rows[0].recipient_id, input.email)
  await audit(c, orgId, actor, "recipient.add", { type: "recipient", id: r.rows[0].recipient_id }, { email: input.email })
  return r.rows[0].recipient_id
}

export async function resendVerification(c: Db, orgId: string, actor: Actor, id: string): Promise<void> {
  await assertWritable(c, orgId)
  const r = await c.query("SELECT email, verified_at, verify_sent_at FROM ems_email_recipients WHERE recipient_id = $1 AND org_id = $2", [id, orgId])
  const row = r.rows[0]
  if (!row) throw notFound("Адрес")
  if (row.verified_at) throw conflict("Адрес уже подтверждён")
  if (row.verify_sent_at && Date.now() - new Date(row.verify_sent_at).getTime() < 5 * 60_000) throw new HttpError(429, "rate_limited", "Письмо уже отправлено, повторить можно через 5 минут", { retryAfterSec: 300 })
  await sendVerification(c, orgId, id, row.email)
  await audit(c, orgId, actor, "recipient.resend", { type: "recipient", id })
}

/** Подтверждение по ссылке. Системная область: токен сам определяет организацию. */
export async function verifyEmailToken(c: Db, token: string): Promise<{ email: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null
  const r = await c.query<{ email: string; org_id: string; recipient_id: string }>(
    `UPDATE ems_email_recipients SET verified_at = now(), verify_token_hash = NULL, verify_expires_at = NULL
      WHERE verify_token_hash = $1 AND verify_expires_at > now() RETURNING email, org_id, recipient_id`,
    [tokenHash(token)],
  )
  if (!r.rows[0]) return null
  await audit(c, r.rows[0].org_id, { kind: "system", id: null }, "recipient.verified", { type: "recipient", id: r.rows[0].recipient_id })
  return { email: r.rows[0].email }
}

export async function updateRecipient(c: Db, orgId: string, actor: Actor, id: string, patch: { label?: string | null; kinds?: unknown; siteIds?: string[] | null; enabled?: boolean; pausedUntil?: string | null; sendHour?: number | null }): Promise<void> {
  await assertWritable(c, orgId)
  const cur = (await c.query("SELECT * FROM ems_email_recipients WHERE recipient_id = $1 AND org_id = $2", [id, orgId])).rows[0]
  if (!cur) throw notFound("Адрес")
  await c.query(
    `UPDATE ems_email_recipients SET label = $3, kinds = $4, site_ids = $5, enabled = $6, paused_until = $7, send_hour = $8 WHERE recipient_id = $1 AND org_id = $2`,
    [
      id, orgId, patch.label !== undefined ? patch.label : cur.label, patch.kinds !== undefined ? validateKinds(patch.kinds) : cur.kinds,
      patch.siteIds !== undefined ? (patch.siteIds?.length ? patch.siteIds : null) : cur.site_ids, patch.enabled ?? cur.enabled,
      patch.pausedUntil !== undefined ? patch.pausedUntil : cur.paused_until, patch.sendHour ?? cur.send_hour,
    ],
  )
  await audit(c, orgId, actor, "recipient.update", { type: "recipient", id })
}

export async function listRecipients(c: Db, orgId: string) {
  const r = await c.query(
    `SELECT recipient_id, email, label, verified_at, verify_sent_at, enabled, paused_until, kinds, site_ids, send_hour, created_at
       FROM ems_email_recipients WHERE org_id = $1 ORDER BY created_at`,
    [orgId],
  )
  return r.rows
}
