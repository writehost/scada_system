import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { conflict, notFound } from "@/lib/server/errors.ts"
import { dateKey, num, str, uuid } from "@/lib/server/validate.ts"
import { validateConnectionParams } from "@/lib/services/assets.ts"
import { assertLimit, assertWritable, getSubscription } from "@/lib/services/subscription.ts"
import { audit } from "@/lib/services/audit.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const id = idParam(p.id)
    const meter = (await c.query(
      `SELECT m.*, s.name AS site_name, s.timezone, g.name AS gateway_name, g.status AS gateway_status, g.last_seen_at AS gateway_seen
         FROM ems_meters m JOIN ems_sites s ON s.site_id = m.site_id LEFT JOIN ems_gateways g ON g.gateway_id = m.gateway_id
        WHERE m.meter_id = $1 AND m.org_id = $2`,
      [id, ctx.orgId],
    )).rows[0]
    if (!meter) throw notFound("Прибор")
    const channels = await c.query(
      `SELECT ch.channel_id, ch.code, ch.name, ch.quantity, ch.measure_kind, ch.unit, ch.tariff_zone, ch.is_billing, ch.register, ch.multiplier, ch.value_offset,
              ch.rollover_at, ch.max_rate_per_hour, ch.decimals, ch.last_value, ch.last_at, ch.last_received_at,
              (SELECT json_agg(json_build_object('effectiveFrom', k.effective_from, 'multiplier', k.multiplier, 'offset', k.value_offset, 'boundaryRaw', k.boundary_raw, 'reason', k.reason) ORDER BY k.effective_from)
                 FROM ems_channel_coefficients k WHERE k.channel_id = ch.channel_id) AS coefficients
         FROM ems_channels ch WHERE ch.meter_id = $1 AND ch.archived_at IS NULL ORDER BY ch.channel_id`,
      [id],
    )
    const tokens = await c.query("SELECT prefix, created_at, last_used_at FROM ems_meter_tokens WHERE meter_id = $1 AND revoked_at IS NULL", [id])
    const replaced = meter.replaces_meter_id ? (await c.query("SELECT meter_id, name, removed_at FROM ems_meters WHERE meter_id = $1", [meter.replaces_meter_id])).rows[0] : null
    const replacedBy = (await c.query("SELECT meter_id, name, installed_at FROM ems_meters WHERE replaces_meter_id = $1", [id])).rows[0] ?? null
    return { meter, channels: channels.rows, tokens: tokens.rows, replaced, replacedBy }
  }),
)

export const PATCH = api({ perm: "devices.write" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const id = idParam(p.id)
    const sub = await assertWritable(c, ctx.orgId)
    const cur = (await c.query("SELECT * FROM ems_meters WHERE meter_id = $1 AND org_id = $2", [id, ctx.orgId])).rows[0]
    if (!cur) throw notFound("Прибор")
    const nodeId = ctx.body.nodeId !== undefined ? uuid(ctx.body, "nodeId", "Узел") : cur.node_id
    if (nodeId && nodeId !== cur.node_id) {
      const n = await c.query("SELECT site_id FROM ems_nodes WHERE node_id = $1 AND org_id = $2", [nodeId, ctx.orgId])
      if (!n.rows[0] || n.rows[0].site_id !== cur.site_id) throw notFound("Узел")
    }
    if (ctx.body.status === "active" && cur.status === "draft") await assertLimit(c, ctx.orgId, "meters")
    const params = ctx.body.connectionParams !== undefined ? validateConnectionParams(cur.connection, ctx.body.connectionParams) : cur.connection_params
    const poll = num(ctx.body, "pollIntervalSec", "Интервал опроса", { min: 5, max: 86400, integer: true })
    await c.query(
      `UPDATE ems_meters SET name = COALESCE($3, name), serial_number = COALESCE($4, serial_number), node_id = $5, connection_params = $6::jsonb,
              poll_interval_sec = COALESCE($7, poll_interval_sec), telemetry_timeout_min = COALESCE($8, telemetry_timeout_min),
              verification_due = COALESCE($9, verification_due), status = CASE WHEN $10::text = 'active' AND status = 'draft' THEN 'active' ELSE status END, updated_at = now()
        WHERE meter_id = $1 AND org_id = $2`,
      [
        id, ctx.orgId, str(ctx.body, "name", "Название", { max: 120 }), str(ctx.body, "serialNumber", "Заводской номер", { max: 60 }), nodeId, JSON.stringify(params),
        poll == null ? null : Math.max(poll, sub.limits.min_poll_sec ?? 1), num(ctx.body, "telemetryTimeoutMin", "Нет данных дольше", { min: 15, max: 100000, integer: true }),
        dateKey(ctx.body, "verificationDue", "Дата поверки"), ctx.body.status ?? null,
      ],
    )
    await audit(c, ctx.orgId, ctx.actor, "meter.update", { type: "meter", id })
    return { ok: true }
  }),
)

/** Вывод из эксплуатации. История показаний не удаляется. */
export const DELETE = api({ perm: "devices.write" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const id = idParam(p.id)
    const m = (await c.query("SELECT name, status FROM ems_meters WHERE meter_id = $1 AND org_id = $2", [id, ctx.orgId])).rows[0]
    if (!m) throw notFound("Прибор")
    if (ctx.url.searchParams.get("confirm") !== m.name) throw conflict("Для вывода прибора из эксплуатации введите его название", "confirmation_required")
    await c.query("UPDATE ems_meters SET status = 'archived', removed_at = COALESCE(removed_at, now()), updated_at = now() WHERE meter_id = $1", [id])
    await c.query("UPDATE ems_meter_tokens SET revoked_at = now() WHERE meter_id = $1 AND revoked_at IS NULL", [id])
    await audit(c, ctx.orgId, ctx.actor, "meter.archive", { type: "meter", id }, { name: m.name })
    return { ok: true }
  }),
)
