// Компактная сводка для SCADA Mobile: расход, стоимость, ближайшие платежи, проблемы.
import { api } from "@/lib/server/http.ts"
import { optUuid } from "@/lib/server/params.ts"
import { homeDashboard } from "@/lib/services/dashboard.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => {
    const sites = (await c.query("SELECT site_id, name, kind FROM ems_sites WHERE org_id = $1 AND archived_at IS NULL ORDER BY created_at", [ctx.orgId])).rows
    const siteId = optUuid(ctx.url, "siteId") ?? sites[0]?.site_id
    if (!siteId) return { sites, summary: null }
    const d = await homeDashboard(c, ctx.orgId, siteId)
    const feedSeq = (await c.query("SELECT COALESCE(max(seq), 0) AS seq FROM ems_feed WHERE org_id = $1", [ctx.orgId])).rows[0].seq
    return {
      sites,
      summary: {
        siteId,
        siteName: d.site.name,
        period: d.period,
        totals: d.totals,
        resources: d.resources.map((r) => ({ resource: r.resource, unit: r.unit, monthQty: r.monthQty, changePct: r.changePct, readings: r.readings, costToDate: r.cost?.toDate ?? null, costForecast: r.cost?.forecast ?? null })),
        obligations: d.obligations,
        alerts: d.events.filter((e) => e.status === "open").map((e) => ({ eventId: e.event_id, severity: e.severity, title: e.title, message: e.message, openedAt: e.opened_at })),
        meters: d.meters,
      },
      feedCursor: feedSeq,
    }
  }),
)
