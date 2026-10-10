import { api } from "@/lib/server/http.ts"
import { optUuid } from "@/lib/server/params.ts"
import { createMeter } from "@/lib/services/assets.ts"
import { meterInputFromBody } from "@/lib/server/meter-input.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => {
    const siteId = optUuid(ctx.url, "siteId")
    const status = ctx.url.searchParams.get("status") || "active"
    const r = await c.query(
      `SELECT m.meter_id, m.site_id, s.name AS site_name, m.node_id, n.name AS node_name, m.resource, m.name, m.serial_number, m.manufacturer, m.model,
              m.connection, m.gateway_id, g.name AS gateway_name, m.poll_interval_sec, m.telemetry_timeout_min, m.status, m.installed_at, m.removed_at, m.verification_due,
              COALESCE(json_agg(json_build_object('channelId', ch.channel_id, 'code', ch.code, 'name', ch.name, 'quantity', ch.quantity, 'measureKind', ch.measure_kind,
                 'unit', ch.unit, 'tariffZone', ch.tariff_zone, 'isBilling', ch.is_billing, 'lastValue', ch.last_value, 'lastAt', ch.last_at, 'decimals', ch.decimals)
                 ORDER BY ch.channel_id) FILTER (WHERE ch.channel_id IS NOT NULL), '[]') AS channels,
              (SELECT count(*) FROM ems_events e WHERE e.meter_id = m.meter_id AND e.status = 'open')::int AS open_events
         FROM ems_meters m JOIN ems_sites s ON s.site_id = m.site_id
         LEFT JOIN ems_nodes n ON n.node_id = m.node_id LEFT JOIN ems_gateways g ON g.gateway_id = m.gateway_id
         LEFT JOIN ems_channels ch ON ch.meter_id = m.meter_id AND ch.archived_at IS NULL
        WHERE m.org_id = $1 AND ($2::uuid IS NULL OR m.site_id = $2) AND ($3 = 'all' OR m.status = $3)
        GROUP BY m.meter_id, s.name, n.name, g.name ORDER BY s.name, m.resource, m.name`,
      [ctx.orgId, siteId, status],
    )
    return { meters: r.rows }
  }),
)

export const POST = api({ perm: "devices.write" }, async (ctx) => ctx.tx((c) => createMeter(c, ctx.orgId, ctx.actor, meterInputFromBody(ctx.body))))
