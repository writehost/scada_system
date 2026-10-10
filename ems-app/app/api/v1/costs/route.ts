import { api } from "@/lib/server/http.ts"
import { optUuid } from "@/lib/server/params.ts"
import { badRequest, notFound } from "@/lib/server/errors.ts"
import { monthCosts } from "@/lib/services/billing.ts"
import { isDateKey, localDateKey, monthStartKey } from "@/lib/domain/time.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => {
    const siteId = optUuid(ctx.url, "siteId")
    if (!siteId) throw badRequest("Укажите объект")
    const site = (await c.query("SELECT timezone FROM ems_sites WHERE site_id = $1 AND org_id = $2", [siteId, ctx.orgId])).rows[0]
    if (!site) throw notFound("Объект")
    const today = localDateKey(Date.now(), site.timezone)
    const month = ctx.url.searchParams.get("month") || today
    if (!isDateKey(month)) throw badRequest("Месяц в формате ГГГГ-ММ-ДД")
    return { month: monthStartKey(month), today, ...(await monthCosts(c, ctx.orgId, siteId, site.timezone, month, today)) }
  }),
)
