import { api } from "@/lib/server/http.ts"
import { oneOf, reqStr, str } from "@/lib/server/validate.ts"
import { createSite, SITE_KINDS } from "@/lib/services/assets.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => {
    const r = await c.query(
      `SELECT s.site_id, s.name, s.kind, s.address, s.timezone, s.shifts, s.created_at,
              (SELECT count(*) FROM ems_meters m WHERE m.site_id = s.site_id AND m.status = 'active')::int AS meters,
              (SELECT count(*) FROM ems_events e WHERE e.site_id = s.site_id AND e.status = 'open' AND e.category <> 'data_quality')::int AS open_events
         FROM ems_sites s WHERE s.org_id = $1 AND s.archived_at IS NULL ORDER BY s.created_at`,
      [ctx.orgId],
    )
    return { sites: r.rows }
  }),
)

export const POST = api({ perm: "sites.write" }, async (ctx) =>
  ctx.tx(async (c) => {
    const siteId = await createSite(c, ctx.orgId, ctx.actor, {
      name: reqStr(ctx.body, "name", "Название объекта", 120),
      kind: oneOf(ctx.body, "kind", "Тип объекта", SITE_KINDS),
      address: str(ctx.body, "address", "Адрес", { max: 300 }),
      timezone: str(ctx.body, "timezone", "Часовой пояс", { max: 60 }) ?? undefined,
      shifts: ctx.body.shifts as never,
    })
    return { siteId }
  }),
)
