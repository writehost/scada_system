import { api } from "@/lib/server/http.ts"
import { FLAG_LABELS } from "@/lib/domain/readings.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => {
    const r = await c.query(
      `SELECT r.channel_id, r.measured_at, r.raw_value, r.value, r.quality, r.flags, r.source, ch.name AS channel_name, ch.unit, m.meter_id, m.name AS meter_name, s.name AS site_name
         FROM ems_readings r JOIN ems_channels ch ON ch.channel_id = r.channel_id JOIN ems_meters m ON m.meter_id = ch.meter_id JOIN ems_sites s ON s.site_id = m.site_id
        WHERE r.org_id = $1 AND r.quality <> 'good' AND r.measured_at > now() - interval '60 days' AND NOT ('manual_override' = ANY(r.flags))
        ORDER BY r.measured_at DESC LIMIT 100`,
      [ctx.orgId],
    )
    return { items: r.rows, flagLabels: FLAG_LABELS }
  }),
)
