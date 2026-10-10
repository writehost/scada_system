// Разбор параметров запроса рядов и построение ответа (общий для графиков и экспорта).
import type { Db } from "./db.ts"
import { badRequest, notFound } from "./errors.ts"
import { optUuid, timeParam } from "./params.ts"
import { autoResolution, billingChannels, channelMeta, consumptionSeries, instantSeries, powerChannels, type Resolution, type Series } from "../services/analytics.ts"
import { accountTariffs, accountUsage, listAccounts } from "../services/billing.ts"
import { calculateCost } from "../domain/tariffs.ts"
import { RESOURCE_LABELS, unitLabel, type Resource } from "../domain/units.ts"
import { eachDay, localDateKey } from "../domain/time.ts"
import { getSubscription } from "../services/subscription.ts"

const RESOLUTIONS = ["auto", "raw", "hour", "day", "month"]

export async function buildSeries(c: Db, orgId: string, url: URL): Promise<{ series: Series[]; resolution: Resolution; from: number; to: number; tz: string; notes: string[] }> {
  const now = Date.now()
  const to = timeParam(url, "to", now)
  const from = timeParam(url, "from", to - 30 * 86400000)
  if (!(to > from)) throw badRequest("Период: дата окончания должна быть позже начала")
  if (to - from > 5 * 366 * 86400000) throw badRequest("Период не длиннее пяти лет")
  const resParam = url.searchParams.get("resolution") || "auto"
  if (!RESOLUTIONS.includes(resParam)) throw badRequest("Неизвестное разрешение")
  let resolution: Resolution = resParam === "auto" ? autoResolution(from, to) : (resParam as Resolution)
  if (resolution === "hour" && to - from > 93 * 86400000) throw badRequest("Почасовые данные — за период до 93 дней")
  const notes: string[] = []
  const sub = await getSubscription(c, orgId)
  const retention = sub.limits.raw_retention_days

  const channelParam = url.searchParams.get("channelIds")
  if (channelParam) {
    const ids = channelParam.split(",").map(Number).filter((x) => Number.isInteger(x) && x > 0).slice(0, 12)
    const meta = await channelMeta(c, orgId, ids)
    if (!meta.length) throw notFound("Канал")
    const tz = meta[0].tz
    if (resolution === "raw") {
      if (to - from > 7 * 86400000) throw badRequest("Сырые значения — за период до 7 дней")
      if (retention != null && from < now - retention * 86400000) throw badRequest(`Детальная история по тарифу хранится ${retention} дн.`)
    }
    const series: Series[] = []
    for (const m of meta) {
      const kind = m.measure_kind === "cumulative" ? "consumption" : "instant"
      const r: Resolution = kind === "consumption" && resolution === "raw" ? "hour" : resolution
      const points = kind === "consumption" ? await consumptionSeries(c, [m.channel_id], tz, from, to, r) : await instantSeries(c, [m.channel_id], tz, from, to, r)
      series.push({ key: `ch:${m.channel_id}`, label: `${m.meter_name} · ${m.name}`, unit: m.unit, kind, resolution: r, points })
    }
    return { series, resolution, from, to, tz, notes }
  }

  const siteId = optUuid(url, "siteId")
  if (!siteId) throw badRequest("Укажите объект")
  const site = (await c.query("SELECT timezone FROM ems_sites WHERE site_id = $1 AND org_id = $2", [siteId, orgId])).rows[0]
  if (!site) throw notFound("Объект")
  const tz = site.timezone
  const nodeId = optUuid(url, "nodeId")
  const metric = url.searchParams.get("metric") || "consumption"
  if (resolution === "raw") resolution = "hour"
  const resources = (url.searchParams.get("resources") || url.searchParams.get("resource") || "electricity").split(",").filter(Boolean) as Resource[]
  const series: Series[] = []

  if (metric === "power") {
    const ids = await powerChannels(c, orgId, siteId, nodeId)
    if (!ids.length) notes.push("На объекте нет каналов мощности")
    else series.push({ key: "power", label: "Активная мощность", unit: "kW", kind: "instant", resolution, points: await instantSeries(c, ids, tz, from, to, resolution === "month" ? "day" : resolution) })
    return { series, resolution, from, to, tz, notes }
  }

  for (const resource of resources) {
    if (!(resource in RESOURCE_LABELS)) throw badRequest("Неизвестный ресурс")
    const ids = (await billingChannels(c, orgId, siteId, resource, nodeId)).map((x) => x.channel_id)
    if (!ids.length) continue
    const unit = resource === "electricity" ? "kWh" : resource === "heat" ? "Gcal" : "m3"
    if (metric === "cost") {
      const service = resource === "heat" ? "heating" : resource
      const account = (await listAccounts(c, orgId, siteId)).find((a) => a.service === service && a.calc_method === "meter")
      if (!account) {
        notes.push(`${RESOURCE_LABELS[resource]}: нет лицевого счёта с тарифом`)
        continue
      }
      const tariffs = await accountTariffs(c, account.account_id)
      const fromDay = localDateKey(from, tz)
      const toDay = localDateKey(to - 1, tz)
      const usage = await accountUsage(c, orgId, account, tz, fromDay, toDay, tariffs)
      const byDay = new Map(usage.days.map((d) => [d.day, d]))
      const daily = eachDay(fromDay, toDay).map((day) => {
        const d = byDay.get(day)
        if (!d) return { t: day, v: null as number | null }
        const zoneDays = usage.zoneDays ? Object.fromEntries(Object.entries(usage.zoneDays).map(([z, list]) => [z, list.filter((x) => x.day === day)])) : undefined
        const r = calculateCost(account.service, tariffs, { tz, days: [d], hours: usage.hours, zoneDays })
        return { t: day, v: r.amount == null ? null : r.variableAmount, allocated: d.allocated > 0 ? r.variableAmount * (d.allocated / Math.max(d.qty, 1e-9)) : 0 }
      })
      const points = resolution === "month" ? groupMonths(daily) : daily
      series.push({ key: `cost:${resource}`, label: `${RESOURCE_LABELS[resource]}, ₽`, unit: "RUB", kind: "consumption", resolution: resolution === "month" ? "month" : "day", points })
      if (resolution === "hour") notes.push("Стоимость показывается по суткам")
      continue
    }
    series.push({ key: resource, label: `${RESOURCE_LABELS[resource]}, ${unitLabel(unit)}`, unit, kind: "consumption", resolution, points: await consumptionSeries(c, ids, tz, from, to, resolution) })
  }
  if (!series.length && !notes.length) notes.push("Нет приборов учёта для выбранных ресурсов")
  return { series, resolution, from, to, tz, notes }
}

function groupMonths(points: Array<{ t: string; v: number | null; allocated?: number }>) {
  const m = new Map<string, { v: number | null; allocated: number }>()
  for (const p of points) {
    const key = `${p.t.slice(0, 7)}-01`
    const cur = m.get(key) ?? { v: null, allocated: 0 }
    if (p.v != null) cur.v = (cur.v ?? 0) + p.v
    cur.allocated += p.allocated ?? 0
    m.set(key, cur)
  }
  return [...m.entries()].map(([t, x]) => ({ t, v: x.v, allocated: x.allocated }))
}
