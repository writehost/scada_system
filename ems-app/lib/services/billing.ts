// Стоимость услуг объекта: фактическое начисление (из квитанции), расчёт по
// показаниям и тарифу, прогноз. Источник каждой суммы указывается явно.

import type { Db } from "../server/db.ts"
import { calculateCost, SERVICE_LABELS, type CostResult, type DayUsage, type HourUsage, type Service, type Tariff, type TariffConfig } from "../domain/tariffs.ts"
import { forecastPeriod, percentChange, type Forecast } from "../domain/forecast.ts"
import { addDays, addMonths, dayStartUtc, diffDays, eachDay, monthEndKey, monthStartKey } from "../domain/time.ts"
import type { Resource } from "../domain/units.ts"
import { billingChannels, dailySum, hourlySum } from "./analytics.ts"

export type Account = {
  account_id: string
  site_id: string
  service: Service
  title: string
  provider_id: string | null
  provider_name: string | null
  account_number: string | null
  calc_method: "meter" | "fixed" | "manual"
  budget_month: number | null
}

export const SERVICE_RESOURCES: Partial<Record<Service, Resource[]>> = {
  electricity: ["electricity"],
  cold_water: ["cold_water"],
  hot_water: ["hot_water"],
  gas: ["gas"],
  heating: ["heat"],
}

export async function listAccounts(c: Db, orgId: string, siteId?: string | null): Promise<Account[]> {
  const r = await c.query(
    `SELECT a.account_id, a.site_id, a.service, a.title, a.provider_id, p.name AS provider_name, a.account_number, a.calc_method, a.budget_month
       FROM ems_accounts a LEFT JOIN ems_providers p ON p.provider_id = a.provider_id
      WHERE a.org_id = $1 AND a.archived_at IS NULL AND ($2::uuid IS NULL OR a.site_id = $2)
      ORDER BY array_position(ARRAY['electricity','cold_water','hot_water','wastewater','heating','gas','internet','other'], a.service), a.title`,
    [orgId, siteId ?? null],
  )
  return r.rows
}

export async function accountTariffs(c: Db, accountId: string): Promise<Tariff[]> {
  const r = await c.query(`SELECT tariff_id, name, kind, valid_from, valid_to, config FROM ems_tariffs WHERE account_id = $1 ORDER BY valid_from`, [accountId])
  return r.rows.map((t) => ({ tariffId: t.tariff_id, name: t.name, validFrom: t.valid_from, validTo: t.valid_to, config: t.config as TariffConfig }))
}

type Usage = { days: DayUsage[]; hours?: HourUsage[]; zoneDays?: Record<string, DayUsage[]>; channelCount: number }

/** Количества для расчёта стоимости услуги за период [fromDay..toDay]. */
export async function accountUsage(c: Db, orgId: string, account: Account, tz: string, fromDay: string, toDay: string, tariffs: Tariff[]): Promise<Usage> {
  const days = eachDay(fromDay, toDay)
  const toDays = (m: Map<string, { qty: number; allocated: number }>) => days.filter((d) => m.has(d)).map((d) => ({ day: d, qty: m.get(d)!.qty, allocated: m.get(d)!.allocated }))
  if (account.calc_method !== "meter") return { days: days.map((d) => ({ day: d, qty: 0, allocated: 0 })), channelCount: 0 }

  let resources = SERVICE_RESOURCES[account.service]
  if (account.service === "wastewater") {
    const ww = tariffs.find((t) => t.config.kind === "wastewater")?.config
    resources = ww && ww.kind === "wastewater" && ww.basis === "own_meter" ? ["other"] : ["cold_water", "hot_water"]
  }
  if (!resources) return { days: days.map((d) => ({ day: d, qty: 0, allocated: 0 })), channelCount: 0 }
  const chans = await billingChannels(c, orgId, account.site_id, resources)
  const ids = chans.map((x) => x.channel_id)
  const total = await dailySum(c, ids, fromDay, toDay)
  const usage: Usage = { days: toDays(total), channelCount: ids.length }

  const zones = new Map<string, number[]>()
  for (const ch of chans) if (ch.tariff_zone) zones.set(ch.tariff_zone, [...(zones.get(ch.tariff_zone) ?? []), ch.channel_id])
  if (zones.size) {
    usage.zoneDays = {}
    for (const [zone, zids] of zones) usage.zoneDays[zone] = toDays(await dailySum(c, zids, fromDay, toDay))
  }
  const needsHours = account.service === "electricity" && tariffs.some((t) => t.config.kind === "zones" || ("capacity" in t.config && t.config.capacity))
  if (needsHours) {
    const from = dayStartUtc(fromDay, tz)
    const to = dayStartUtc(addDays(toDay, 1), tz)
    const h = await hourlySum(c, ids.filter((id) => !chans.find((x) => x.channel_id === id)?.tariff_zone), from, to)
    usage.hours = [...h.entries()].map(([ts, s]) => ({ ts, qty: s.qty, allocated: s.allocated }))
  }
  return usage
}

export type ServiceCost = {
  accountId: string
  service: Service
  serviceLabel: string
  title: string
  providerName: string | null
  accountNumber: string | null
  calcMethod: Account["calc_method"]
  unit: string | null
  hasTariff: boolean
  qty: number
  actualToDate: { amount: number | null; basis: "calculated"; result: CostResult }
  forecast: { qty: number | null; amount: number | null; basis: "forecast"; confidence: Forecast["confidence"] }
  charged: { amount: number; basis: "actual"; note: string | null } | null
  previous: { amount: number | null; qty: number; basis: "actual" | "calculated" }
  changePct: number | null
  budget: number | null
}

const UNIT: Partial<Record<Service, string>> = { electricity: "kWh", cold_water: "m3", hot_water: "m3", wastewater: "m3", gas: "m3", heating: "Gcal" }

async function actualCharge(c: Db, accountId: string, monthKey: string) {
  const r = await c.query("SELECT amount, note FROM ems_charges WHERE account_id = $1 AND period = $2::date AND source = 'actual'", [accountId, monthKey])
  return r.rows[0] ? { amount: Number(r.rows[0].amount), note: r.rows[0].note as string | null } : null
}

/** Стоимость по всем услугам объекта за месяц с прогнозом и сравнением. */
export async function monthCosts(c: Db, orgId: string, siteId: string, tz: string, monthKey: string, today: string): Promise<{ services: ServiceCost[]; totals: { actualToDate: number; forecast: number | null; previous: number | null; changePct: number | null; incomplete: boolean } }> {
  const month = monthStartKey(monthKey)
  const monthEnd = monthEndKey(month)
  const cutoff = today < month ? month : today > monthEnd ? monthEnd : today
  const prevMonth = addMonths(month, -1, 1)
  const prevEnd = monthEndKey(prevMonth)
  const accounts = await listAccounts(c, orgId, siteId)
  const services: ServiceCost[] = []
  for (const a of accounts) {
    const tariffs = await accountTariffs(c, a.account_id)
    const usage = await accountUsage(c, orgId, a, tz, month, cutoff, tariffs)
    const unit = UNIT[a.service] ?? null
    const result = calculateCost(a.service, tariffs, { tz, ...usage }, unit)

    const prevUsage = await accountUsage(c, orgId, a, tz, prevMonth, prevEnd, tariffs)
    const prevResult = calculateCost(a.service, tariffs, { tz, ...prevUsage }, unit)
    const prevCharge = await actualCharge(c, a.account_id, prevMonth)

    const history = a.calc_method === "meter" ? (await accountUsage(c, orgId, a, tz, addDays(month, -21), addDays(month, -1), tariffs)).days : []
    const fc = forecastPeriod({
      periodStart: month,
      periodEnd: monthEnd,
      today: cutoff,
      days: usage.days,
      history,
      previousPeriodTotal: prevUsage.days.length ? prevResult.qty : null,
    })
    let forecastAmount: number | null = null
    if (a.calc_method === "fixed" || a.calc_method === "manual") {
      forecastAmount = result.amount
    } else if (fc.forecastQty != null && result.amount != null) {
      forecastAmount = result.qty > 0 ? Math.round((result.variableAmount * (fc.forecastQty / result.qty) + result.fixedAmount) * 100) / 100 : prevResult.amount
    }
    const charged = await actualCharge(c, a.account_id, month)
    const prevAmount = prevCharge?.amount ?? prevResult.amount
    services.push({
      accountId: a.account_id,
      service: a.service,
      serviceLabel: SERVICE_LABELS[a.service],
      title: a.title,
      providerName: a.provider_name,
      accountNumber: a.account_number,
      calcMethod: a.calc_method,
      unit,
      hasTariff: tariffs.length > 0,
      qty: result.qty,
      actualToDate: { amount: result.amount, basis: "calculated", result },
      forecast: { qty: fc.forecastQty, amount: forecastAmount, basis: "forecast", confidence: a.calc_method === "meter" ? fc.confidence : "high" },
      charged: charged ? { ...charged, basis: "actual" } : null,
      previous: { amount: prevAmount, qty: prevResult.qty, basis: prevCharge ? "actual" : "calculated" },
      changePct: percentChange(charged?.amount ?? forecastAmount, prevAmount),
      budget: a.budget_month,
    })
  }
  const pick = (s: ServiceCost) => s.charged?.amount ?? s.forecast.amount
  const incomplete = services.some((s) => pick(s) == null)
  const forecast = services.length ? services.reduce((sum, s) => sum + (pick(s) ?? 0), 0) : null
  const previous = services.some((s) => s.previous.amount != null) ? services.reduce((sum, s) => sum + (s.previous.amount ?? 0), 0) : null
  return {
    services,
    totals: {
      actualToDate: services.reduce((sum, s) => sum + (s.charged?.amount ?? s.actualToDate.amount ?? 0), 0),
      forecast,
      previous,
      changePct: percentChange(forecast, previous),
      incomplete,
    },
  }
}

/** Потребление ресурса за период и такой же отрезок предыдущего месяца. */
export async function resourcePeriod(c: Db, orgId: string, siteId: string, resource: Resource, month: string, cutoff: string): Promise<{ qty: number; prevSamePeriod: number | null; avgDaily: number | null; coveredDays: number }> {
  const ids = (await billingChannels(c, orgId, siteId, resource)).map((x) => x.channel_id)
  if (!ids.length) return { qty: 0, prevSamePeriod: null, avgDaily: null, coveredDays: 0 }
  const cur = await dailySum(c, ids, month, cutoff)
  const prevStart = addMonths(month, -1, 1)
  const offset = diffDays(month, cutoff)
  const prevCut = addDays(prevStart, Math.min(offset, diffDays(prevStart, monthEndKey(prevStart))))
  const prev = await dailySum(c, ids, prevStart, prevCut)
  const qty = [...cur.values()].reduce((s, x) => s + x.qty, 0)
  return {
    qty,
    prevSamePeriod: prev.size ? [...prev.values()].reduce((s, x) => s + x.qty, 0) : null,
    avgDaily: cur.size ? qty / cur.size : null,
    coveredDays: cur.size,
  }
}
