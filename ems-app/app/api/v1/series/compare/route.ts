// Сравнение периодов одного объекта или нескольких объектов за один период.
import { api } from "@/lib/server/http.ts"
import { optUuid, timeParam } from "@/lib/server/params.ts"
import { badRequest, notFound } from "@/lib/server/errors.ts"
import { billingChannels, consumptionSeries } from "@/lib/services/analytics.ts"
import { isUuid } from "@/lib/server/db.ts"
import type { Resource } from "@/lib/domain/units.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => {
    const resource = (ctx.url.searchParams.get("resource") || "electricity") as Resource
    const mode = ctx.url.searchParams.get("mode") || "periods"
    const site = async (id: string) => {
      const s = (await c.query("SELECT site_id, name, timezone FROM ems_sites WHERE site_id = $1 AND org_id = $2 AND archived_at IS NULL", [id, ctx.orgId])).rows[0]
      if (!s) throw notFound("Объект")
      return s
    }
    if (mode === "sites") {
      const ids = (ctx.url.searchParams.get("siteIds") || "").split(",").filter(isUuid).slice(0, 8)
      if (ids.length < 1) throw badRequest("Выберите объекты для сравнения")
      const to = timeParam(ctx.url, "to", Date.now())
      const from = timeParam(ctx.url, "from", to - 30 * 86400000)
      const items = []
      for (const id of ids) {
        const s = await site(id)
        const chans = (await billingChannels(c, ctx.orgId, id, resource)).map((x) => x.channel_id)
        const points = await consumptionSeries(c, chans, s.timezone, from, to, "day")
        const total = points.reduce((sum, p) => sum + (p.v ?? 0), 0)
        items.push({ siteId: id, name: s.name, total, days: points.filter((p) => p.v != null).length, points })
      }
      return { mode, resource, items }
    }
    const siteId = optUuid(ctx.url, "siteId")
    if (!siteId) throw badRequest("Укажите объект")
    const s = await site(siteId)
    const chans = (await billingChannels(c, ctx.orgId, siteId, resource, optUuid(ctx.url, "nodeId"))).map((x) => x.channel_id)
    const aFrom = timeParam(ctx.url, "aFrom", 0)
    const aTo = timeParam(ctx.url, "aTo", 0)
    const bFrom = timeParam(ctx.url, "bFrom", 0)
    const bTo = timeParam(ctx.url, "bTo", 0)
    if (!(aTo > aFrom && bTo > bFrom)) throw badRequest("Укажите два периода")
    if (aTo - aFrom > 400 * 86400000 || bTo - bFrom > 400 * 86400000) throw badRequest("Период сравнения не длиннее 400 дней")
    const a = await consumptionSeries(c, chans, s.timezone, aFrom, aTo, "day")
    const b = await consumptionSeries(c, chans, s.timezone, bFrom, bTo, "day")
    const sum = (p: typeof a) => p.reduce((x, y) => x + (y.v ?? 0), 0)
    return { mode, resource, a: { points: a, total: sum(a) }, b: { points: b, total: sum(b) } }
  }),
)
