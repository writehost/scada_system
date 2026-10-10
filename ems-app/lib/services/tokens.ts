// Токены интеграций (emsk_…) и токены приборов HTTP push (emsd_…).
import type { Db } from "../server/db.ts"
import { badRequest, notFound } from "../server/errors.ts"
import { hashSecret, newSecret } from "../server/session.ts"
import { assertWritable } from "./subscription.ts"
import { audit, type Actor } from "./audit.ts"

export const API_SCOPES = ["read", "readings:write", "production:write"] as const

export async function createApiToken(c: Db, orgId: string, actor: Actor, input: { name: string; scopes: string[] }): Promise<{ tokenId: string; token: string }> {
  await assertWritable(c, orgId)
  const scopes = [...new Set(input.scopes)]
  if (!scopes.length || scopes.some((s) => !(API_SCOPES as readonly string[]).includes(s))) throw badRequest("Выберите разрешения токена")
  const token = newSecret("emsk", 30)
  const r = await c.query<{ token_id: string }>(
    "INSERT INTO ems_api_tokens (org_id, name, token_hash, prefix, scopes, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING token_id",
    [orgId, input.name, hashSecret(token), token.slice(0, 10), scopes, actor.id],
  )
  await audit(c, orgId, actor, "api_token.create", { type: "api_token", id: r.rows[0].token_id }, { scopes })
  return { tokenId: r.rows[0].token_id, token }
}

export async function createMeterToken(c: Db, orgId: string, actor: Actor, meterId: string): Promise<{ token: string }> {
  await assertWritable(c, orgId)
  const m = await c.query("SELECT connection FROM ems_meters WHERE meter_id = $1 AND org_id = $2", [meterId, orgId])
  if (!m.rows[0]) throw notFound("Прибор")
  if (m.rows[0].connection !== "http_push") throw badRequest("Токен выдаётся только приборам с HTTP push")
  // Новый токен отзывает прежние: ротация учётных данных прибора.
  await c.query("UPDATE ems_meter_tokens SET revoked_at = now() WHERE meter_id = $1 AND revoked_at IS NULL", [meterId])
  const token = newSecret("emsd", 30)
  await c.query("INSERT INTO ems_meter_tokens (org_id, meter_id, token_hash, prefix, created_by) VALUES ($1, $2, $3, $4, $5)", [orgId, meterId, hashSecret(token), token.slice(0, 10), actor.id])
  await audit(c, orgId, actor, "meter.token_issued", { type: "meter", id: meterId })
  return { token }
}

/** Системная область: определить прибор по токену. */
export async function meterByToken(c: Db, token: string): Promise<{ meterId: string; orgId: string } | null> {
  if (!/^emsd_[A-Za-z0-9_-]{20,80}$/.test(token)) return null
  const r = await c.query(
    `UPDATE ems_meter_tokens SET last_used_at = now() WHERE token_hash = $1 AND revoked_at IS NULL RETURNING meter_id, org_id`,
    [hashSecret(token)],
  )
  return r.rows[0] ? { meterId: r.rows[0].meter_id, orgId: r.rows[0].org_id } : null
}
