import { api } from "@/lib/server/http.ts"
import { optUuid, timeParam } from "@/lib/server/params.ts"
import { badRequest, forbidden, notFound } from "@/lib/server/errors.ts"
import { billingChannels, heatmap } from "@/lib/services/analytics.ts"
import { getSubscription, hasFeature } from "@/lib/services/subscription.ts"
import type { Resource } from "@/lib/domain/units.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => {
    const sub = await getSubscription(c, ctx.orgId)
    if (!hasFeature(sub, "analytics_advanced")) throw forbidden("Тепловая карта доступна в тарифе с расширенной аналитикой")
    const siteId = optUuid(ctx.url, "siteId")
    if (!siteId) throw badRequest("Укажите объект")
    const site = (await c.query("SELECT timezone FROM ems_sites WHERE site_id = $1 AND org_id = $2", [siteId, ctx.orgId])).rows[0]
    if (!site) throw notFound("Объект")
    const to = timeParam(ctx.url, "to", Date.now())
    const from = timeParam(ctx.url, "from", to - 28 * 86400000)
    if (to - from > 93 * 86400000) throw badRequest("Тепловая карта — за период до 93 дней")
    const resource = (ctx.url.searchParams.get("resource") || "electricity") as Resource
    const ids = (await billingChannels(c, ctx.orgId, siteId, resource, optUuid(ctx.url, "nodeId"))).map((x) => x.channel_id)
    return { ...(await heatmap(c, ids, site.timezone, from, to)), unit: resource === "electricity" ? "kWh" : "m3", tz: site.timezone }
  }),
)
