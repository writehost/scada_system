import { api } from "@/lib/server/http.ts"
import { reqStr, uuid } from "@/lib/server/validate.ts"
import { createGateway } from "@/lib/services/gateways.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => {
    const r = await c.query(
      `SELECT g.gateway_id, g.name, g.status, g.site_id, s.name AS site_name, g.enrolled_at, g.last_seen_at, g.last_ip, g.agent_version, g.diagnostics, g.secret_rotated_at,
              (SELECT count(*) FROM ems_meters m WHERE m.gateway_id = g.gateway_id AND m.status = 'active')::int AS meters,
              (SELECT max(expires_at) FROM ems_gateway_enrollments e WHERE e.gateway_id = g.gateway_id AND e.used_at IS NULL AND e.expires_at > now()) AS enrollment_expires_at
         FROM ems_gateways g JOIN ems_sites s ON s.site_id = g.site_id WHERE g.org_id = $1 AND g.archived_at IS NULL ORDER BY g.created_at`,
      [ctx.orgId],
    )
    return { gateways: r.rows }
  }),
)

export const POST = api({ perm: "devices.write" }, async (ctx) =>
  ctx.tx((c) => createGateway(c, ctx.orgId, ctx.actor, { siteId: uuid(ctx.body, "siteId", "Объект", true)!, name: reqStr(ctx.body, "name", "Название шлюза", 120) })),
)
