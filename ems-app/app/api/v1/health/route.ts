// Состояние оборудования: приборы и шлюзы.
import { api } from "@/lib/server/http.ts"
import { optUuid } from "@/lib/server/params.ts"
import { meterHealth } from "@/lib/services/dashboard.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => {
    const siteId = optUuid(ctx.url, "siteId")
    const gateways = await c.query(
      `SELECT g.gateway_id, g.name, g.status, g.last_seen_at, g.agent_version, g.diagnostics, g.site_id, s.name AS site_name,
              (SELECT count(*) FROM ems_meters m WHERE m.gateway_id = g.gateway_id AND m.status = 'active')::int AS meters
         FROM ems_gateways g JOIN ems_sites s ON s.site_id = g.site_id WHERE g.org_id = $1 AND g.archived_at IS NULL AND ($2::uuid IS NULL OR g.site_id = $2) ORDER BY g.name`,
      [ctx.orgId, siteId],
    )
    return { meters: await meterHealth(c, ctx.orgId, siteId), gateways: gateways.rows }
  }),
)
