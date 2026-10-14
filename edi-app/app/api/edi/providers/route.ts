import { jsonBody, route } from "@/lib/http.ts"
import { HttpError } from "@/lib/db.ts"
import { requirePermission } from "@/lib/edi/actor.ts"
import { actorEvent, recordEvent } from "@/lib/edi/audit.ts"
import { providerCatalog } from "@/lib/edi/gateway/registry.ts"

export const GET = route(async ({ client, actor }) => {
  requirePermission(actor, "edi.admin")
  const connections = await client.query(`SELECT connection_id::text AS "connectionId", provider, name,
    external_org_id AS "externalOrgId", participant_id AS "participantId", status, capabilities,
    verified_at AS "verifiedAt", last_sync_at AS "lastSyncAt", last_error AS "lastError"
    FROM edi_provider_connections WHERE site_id = $1 ORDER BY provider, connection_id`, [actor.siteId])
  return { catalog: providerCatalog, connections: connections.rows }
})

export const POST = route(async ({ client, actor, req }) => {
  requirePermission(actor, "edi.admin")
  const body = await jsonBody<{ connectionId?: string; provider?: string; name?: string; externalOrgId?: string; participantId?: string; action?: string }>(req)
  if (body.action === "disable") {
    if (!/^\d{1,18}$/.test(body.connectionId || "")) throw new HttpError(400, "Некорректное подключение")
    const disabled = await client.query(`UPDATE edi_provider_connections SET status = 'disabled', updated_at = now(), updated_by = $3::bigint
      WHERE site_id = $1 AND connection_id = $2::bigint RETURNING connection_id`, [actor.siteId, body.connectionId, actor.userId])
    if (!disabled.rowCount) throw new HttpError(404, "Подключение не найдено")
    await recordEvent(client, actorEvent(actor, "provider.disabled", null, { connectionId: body.connectionId }))
    return { ok: true }
  }
  if (body.action && body.action !== "draft") throw new HttpError(409, "Адаптер ещё не прошёл испытания; доступно сохранение черновика", "provider_unavailable")
  if (!providerCatalog.some((p) => p.code === body.provider)) throw new HttpError(400, "Неизвестный провайдер")
  const name = String(body.name || "").trim()
  if (!name || name.length > 160 || String(body.externalOrgId || "").length > 200 || String(body.participantId || "").length > 200) throw new HttpError(400, "Проверьте название и идентификаторы подключения")
  const created = await client.query<{ id: string }>(`INSERT INTO edi_provider_connections
    (site_id, provider, name, external_org_id, participant_id, updated_by)
    VALUES ($1, $2, $3, $4, $5, $6::bigint) RETURNING connection_id::text AS id`,
    [actor.siteId, body.provider, name, body.externalOrgId?.trim() || null, body.participantId?.trim() || null, actor.userId])
  await recordEvent(client, actorEvent(actor, "provider.draft_created", null, { connectionId: created.rows[0].id, provider: body.provider }))
  return { connectionId: created.rows[0].id, status: "unconfigured" }
}, { tx: true })
