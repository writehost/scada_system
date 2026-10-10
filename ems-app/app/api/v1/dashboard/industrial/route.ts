import { api } from "@/lib/server/http.ts"
import { optUuid } from "@/lib/server/params.ts"
import { industrialDashboard } from "@/lib/services/dashboard.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => {
    let siteId = optUuid(ctx.url, "siteId")
    if (!siteId) siteId = (await c.query("SELECT site_id FROM ems_sites WHERE org_id = $1 AND archived_at IS NULL ORDER BY created_at LIMIT 1", [ctx.orgId])).rows[0]?.site_id ?? null
    if (!siteId) return { empty: true }
    return industrialDashboard(c, ctx.orgId, siteId, optUuid(ctx.url, "nodeId"))
  }),
)
