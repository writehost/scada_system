// Данные главных панелей. Home отвечает на пять вопросов (расход, стоимость,
// прогноз, ближайшие платежи, проблемы), Industrial — эксплуатационная картина.

import type { Db } from "../server/db.ts"
import { addDays, dayStartUtc, diffDays, floorHour, HOUR_MS, inClockRange, localDateKey, localParts, monthEndKey, monthStartKey, parseClock } from "../domain/time.ts"
import { obligationStatus } from "../domain/obligations.ts"
import { percentChange } from "../domain/forecast.ts"
import { recommend, type Recommendation } from "../domain/anomalies.ts"
import type { Resource } from "../domain/units.ts"
import { billingChannels, dailySum, hourlySum, powerChannels } from "./analytics.ts"
import { monthCosts, resourcePeriod, type ServiceCost } from "./billing.ts"
import { notFound } from "../server/errors.ts"
import { obligationAmount } from "./finance.ts"

async function site(c: Db, orgId: string, siteId: string) {
  const r = await c.query("SELECT site_id, name, kind, timezone, shifts, address FROM ems_sites WHERE site_id = $1 AND org_id = $2 AND archived_at IS NULL", [siteId, orgId])
  if (!r.rows[0]) throw notFound("Объект")
  return r.rows[0] as { site_id: string; name: string; kind: string; timezone: string; shifts: Array<{ name: string; from: string; to: string }>; address: string | null }
}

export async function meterHealth(c: Db, orgId: string, siteId: string | null) {
  const r = await c.query(
    `SELECT m.meter_id, m.name, m.resource, m.connection, m.telemetry_timeout_min, m.status,
            max(ch.last_at) AS last_at, max(ch.last_value) FILTER (WHERE ch.is_billing) AS last_value,
            (SELECT count(*) FROM ems_events e WHERE e.meter_id = m.meter_id AND e.status = 'open')::int AS open_events
       FROM ems_meters m LEFT JOIN ems_channels ch ON ch.meter_id = m.meter_id AND ch.archived_at IS NULL
      WHERE m.org_id = $1 AND ($2::uuid IS NULL OR m.site_id = $2) AND m.status = 'active'
      GROUP BY m.meter_id ORDER BY m.resource, m.name`,
    [orgId, siteId],
  )
  const now = Date.now()
  return r.rows.map((m) => {
    const last = m.last_at ? new Date(m.last_at).getTime() : null
    const stale = m.connection !== "manual" && (last == null || now - last > m.telemetry_timeout_min * 60_000)
    const state = last == null ? "no_data" : stale ? "stale" : m.open_events > 0 ? "attention" : "ok"
    return { meterId: m.meter_id, name: m.name, resource: m.resource as Resource, connection: m.connection, lastAt: m.last_at ? new Date(m.last_at).toISOString() : null, lastValue: m.last_value, state }
  })
}

export async function upcomingObligations(c: Db, orgId: string, siteId: string | null, today: string, limit = 6) {
  const r = await c.query(
    `SELECT obligation_id, title, service, provider_name, amount_mode, amount, due_date, readings_due_date, remind_days, status, site_id, account_id
       FROM ems_obligations WHERE org_id = $1 AND status = 'pending' AND ($2::uuid IS NULL OR site_id = $2 OR site_id IS NULL)
      ORDER BY due_date LIMIT $3`,
    [orgId, siteId, limit],
  )
  const out = []
  for (const o of r.rows) {
    const amount = o.amount_mode === "calculated" ? await obligationAmount(c, orgId, o) : { amount: o.amount, basis: o.amount_mode }
    out.push({
    obligationId: o.obligation_id,
    title: o.title,
    service: o.service,
    providerName: o.provider_name,
    amountMode: o.amount_mode,
    amount: o.amount,
    dueDate: o.due_date,
    readingsDueDate: o.readings_due_date,
    status: obligationStatus(o, today),
    daysLeft: diffDays(today, o.due_date),
    amountBasis: amount.basis,
  })
    out[out.length - 1].amount = amount.amount
  }
  return out
}

export async function recentEvents(c: Db, orgId: string, siteId: string | null, limit = 8) {
  const r = await c.query(
    `SELECT event_id, kind, category, severity, title, message, status, opened_at, last_seen_at, occurrences
       FROM ems_events WHERE org_id = $1 AND ($2::uuid IS NULL OR site_id = $2 OR site_id IS NULL)
        AND (category <> 'data_quality' OR status = 'open')
      ORDER BY (status = 'open') DESC, opened_at DESC LIMIT $3`,
    [orgId, siteId, limit],
  )
  return r.rows.map((e) => ({ ...e, opened_at: new Date(e.opened_at).toISOString(), last_seen_at: new Date(e.last_seen_at).toISOString() }))
}

async function resourceRecommendations(c: Db, orgId: string, siteId: string, tz: string, resource: "electricity" | "cold_water" | "hot_water"): Promise<Recommendation[]> {
  const ids = (await billingChannels(c, orgId, siteId, resource)).map((x) => x.channel_id)
  if (!ids.length) return []
  const now = floorHour(Date.now())
  const hours = await hourlySum(c, ids, now - 35 * 24 * HOUR_MS, now)
  const measured = [...hours.entries()].filter(([, s]) => s.allocated === 0)
  const isNight = (ts: number) => localParts(ts, tz).hour < 5
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
  const last7 = measured.filter(([ts]) => ts >= now - 7 * 24 * HOUR_MS)
  const prev28 = measured.filter(([ts]) => ts < now - 7 * 24 * HOUR_MS)
  return recommend({
    resource,
    unit: resource === "electricity" ? "kWh" : "m3",
    night7: avg(last7.filter(([ts]) => isNight(ts)).map(([, s]) => s.qty)),
    night28: avg(prev28.filter(([ts]) => isNight(ts)).map(([, s]) => s.qty)),
    minHour7: last7.length ? Math.min(...last7.map(([, s]) => s.qty)) : null,
    avgHour7: avg(last7.map(([, s]) => s.qty)),
    measuredHours7: last7.length,
  })
}

const HOME_RESOURCES: Array<"electricity" | "cold_water" | "hot_water"> = ["electricity", "cold_water", "hot_water"]

export async function homeDashboard(c: Db, orgId: string, siteId: string, now = Date.now()) {
  const s = await site(c, orgId, siteId)
  const today = localDateKey(now, s.timezone)
  const month = monthStartKey(today)
  const costs = await monthCosts(c, orgId, siteId, s.timezone, month, today)
  const resources = []
  for (const resource of HOME_RESOURCES) {
    const chans = await billingChannels(c, orgId, siteId, resource)
    if (!chans.length) continue
    const period = await resourcePeriod(c, orgId, siteId, resource, month, today)
    const cost: ServiceCost | undefined = costs.services.find((x) => x.service === resource)
    const reading = await c.query(
      `SELECT ch.name, ch.last_value, ch.last_at, ch.unit, ch.tariff_zone FROM ems_channels ch JOIN ems_meters m ON m.meter_id = ch.meter_id
        WHERE ch.channel_id = ANY($1::bigint[]) ORDER BY ch.tariff_zone NULLS FIRST`,
      [chans.map((x) => x.channel_id)],
    )
    resources.push({
      resource,
      unit: resource === "electricity" ? "kWh" : "m3",
      monthQty: period.qty,
      coveredDays: period.coveredDays,
      avgDaily: period.avgDaily,
      changePct: percentChange(period.qty, period.prevSamePeriod),
      prevSamePeriod: period.prevSamePeriod,
      readings: reading.rows.map((r) => ({ name: r.name, value: r.last_value, at: r.last_at ? new Date(r.last_at).toISOString() : null, zone: r.tariff_zone })),
      cost: cost
        ? { toDate: cost.actualToDate.amount, forecast: cost.forecast.amount, forecastQty: cost.forecast.qty, confidence: cost.forecast.confidence, charged: cost.charged?.amount ?? null, hasTariff: cost.hasTariff, warnings: cost.actualToDate.result.warnings }
        : null,
    })
  }
  const recommendations: Recommendation[] = []
  for (const r of HOME_RESOURCES) recommendations.push(...(await resourceRecommendations(c, orgId, siteId, s.timezone, r)))
  const otherServices = costs.services.filter((x) => !["electricity", "cold_water", "hot_water"].includes(x.service))
  const obligations = await upcomingObligations(c, orgId, siteId, today)
  return {
    site: { siteId: s.site_id, name: s.name, kind: s.kind, timezone: s.timezone },
    period: { month, monthEnd: monthEndKey(month), today },
    totals: costs.totals,
    services: costs.services.map((x) => ({ ...x, actualToDate: { ...x.actualToDate, result: { lines: x.actualToDate.result.lines, warnings: x.actualToDate.result.warnings } } })),
    resources,
    otherServices: otherServices.map((x) => ({
      accountId: x.accountId,
      service: x.service,
      title: x.title,
      providerName: x.providerName,
      amount: x.charged?.amount ?? x.forecast.amount,
      basis: x.charged ? "actual" : "forecast",
      nextObligation: obligations.find((o) => o.service === x.service) ?? null,
    })),
    obligations,
    meters: await meterHealth(c, orgId, siteId),
    events: await recentEvents(c, orgId, siteId),
    recommendations,
  }
}

/** Потребление по сменам за сутки (локальное время). */
function shiftOf(shifts: Array<{ name: string; from: string; to: string }>, minute: number) {
  return shifts.find((sh) => inClockRange(minute, parseClock(sh.from), parseClock(sh.to))) ?? null
}

export async function industrialDashboard(c: Db, orgId: string, siteId: string, nodeId: string | null, now = Date.now()) {
  const s = await site(c, orgId, siteId)
  const tz = s.timezone
  const today = localDateKey(now, tz)
  const month = monthStartKey(today)
  const shifts = Array.isArray(s.shifts) && s.shifts.length ? s.shifts : [{ name: "Сутки", from: "00:00", to: "00:00" }]
  const elec = (await billingChannels(c, orgId, siteId, "electricity", nodeId, { includeZones: true })).map((x) => x.channel_id)
  const cold = (await billingChannels(c, orgId, siteId, "cold_water", nodeId)).map((x) => x.channel_id)
  const hot = (await billingChannels(c, orgId, siteId, "hot_water", nodeId)).map((x) => x.channel_id)
  const power = await powerChannels(c, orgId, siteId, nodeId)

  const powerNow = power.length
    ? (
        await c.query(
          `SELECT sum(last_value) AS kw, count(*) FILTER (WHERE last_at > now() - interval '15 minutes')::int AS fresh, count(*)::int AS total, max(last_at) AS at
             FROM ems_channels WHERE channel_id = ANY($1::bigint[])`,
          [power],
        )
      ).rows[0]
    : null

  const dayStart = dayStartUtc(today, tz)
  const monthStart = dayStartUtc(month, tz)
  const hoursToday = await hourlySum(c, elec, dayStart, now + 1)
  const hoursMonth = await hourlySum(c, elec, monthStart, now + 1)
  const peakToday = maxEntry(hoursToday)
  const peakMonth = maxEntry(hoursMonth)

  // Текущая смена и расход по сменам за 7 суток
  const nowParts = localParts(now, tz)
  const currentShift = shiftOf(shifts, nowParts.hour * 60 + nowParts.minute)
  const week = await hourlySum(c, elec, dayStartUtc(addDays(today, -6), tz), now + 1)
  const byShift: Record<string, Record<string, number>> = {}
  let currentShiftQty = 0
  const shiftStart = currentShift ? findShiftStart(now, tz, currentShift) : dayStart
  for (const [ts, v] of week) {
    const p = localParts(ts, tz)
    const sh = shiftOf(shifts, p.hour * 60)
    if (!sh) continue
    // Ночная смена, начавшаяся вчера, относится к дате начала смены.
    const startsYesterday = parseClock(sh.from) > parseClock(sh.to) && p.hour * 60 < parseClock(sh.to)
    const day = startsYesterday ? addDays(localDateKey(ts, tz), -1) : localDateKey(ts, tz)
    byShift[day] = byShift[day] ?? {}
    byShift[day][sh.name] = (byShift[day][sh.name] ?? 0) + v.qty
    if (ts >= shiftStart) currentShiftQty += v.qty
  }

  const sumMap = (m: Map<unknown, { qty: number }>) => [...m.values()].reduce((sum, x) => sum + x.qty, 0)
  const elecToday = sumMap(hoursToday)
  const elecMonth = sumMap(await dailySum(c, elec, month, today))
  const coldMonth = sumMap(await dailySum(c, cold, month, today))
  const hotMonth = sumMap(await dailySum(c, hot, month, today))
  const coldToday = sumMap(await dailySum(c, cold, today, today))
  const hotToday = sumMap(await dailySum(c, hot, today, today))

  // Отклонение: расход сегодня до текущего часа против среднего за те же часы прошлых 7 суток.
  const hourNow = floorHour(now)
  const hoursElapsed = Math.max(1, Math.round((hourNow - dayStart) / HOUR_MS))
  let baselineSum = 0
  let baselineDays = 0
  for (let d = 1; d <= 7; d += 1) {
    const ds = dayStartUtc(addDays(today, -d), tz)
    let sum = 0
    let any = false
    for (let h = 0; h < hoursElapsed; h += 1) {
      const v = week.get(ds + h * HOUR_MS)
      if (v) {
        sum += v.qty
        any = true
      }
    }
    if (any) {
      baselineSum += sum
      baselineDays += 1
    }
  }
  const elecTodayToHour = [...hoursToday.entries()].filter(([ts]) => ts < hourNow).reduce((sum, [, v]) => sum + v.qty, 0)
  const deviationPct = baselineDays ? percentChange(elecTodayToHour, baselineSum / baselineDays) : null

  // Удельное потребление по выпуску продукции
  const prod = await c.query(
    `WITH RECURSIVE tree AS (
       SELECT node_id FROM ems_nodes WHERE node_id = $3::uuid AND org_id = $1
       UNION ALL SELECT n.node_id FROM ems_nodes n JOIN tree t ON n.parent_id = t.node_id)
     SELECT unit, sum(quantity) AS qty, min(period_start) AS from_at, max(period_end) AS to_at FROM ems_production
      WHERE org_id = $1 AND site_id = $2 AND period_start >= $4 AND period_start < $5
        AND ($3::uuid IS NULL OR node_id IN (SELECT node_id FROM tree))
      GROUP BY unit ORDER BY sum(quantity) DESC LIMIT 1`,
    [orgId, siteId, nodeId, new Date(monthStart), new Date(now + 1)],
  )
  let specific: null | { unit: string; produced: number; kwhPer1000: number | null; energyKwh: number } = null
  if (prod.rows[0]) {
    const p = prod.rows[0]
    const energy = sumMap(await hourlySum(c, elec, floorHour(new Date(p.from_at).getTime()), Math.min(new Date(p.to_at).getTime(), now + 1)))
    specific = { unit: p.unit, produced: p.qty, energyKwh: energy, kwhPer1000: p.qty > 0 ? (energy / p.qty) * 1000 : null }
  }

  // Разбивка по дочерним узлам
  const children = await c.query(
    `SELECT n.node_id, n.name, n.kind FROM ems_nodes n WHERE n.org_id = $1 AND n.site_id = $2 AND n.archived_at IS NULL
        AND (($3::uuid IS NULL AND n.parent_id IS NULL) OR n.parent_id = $3::uuid) ORDER BY n.sort, n.name`,
    [orgId, siteId, nodeId],
  )
  const breakdown = []
  for (const ch of children.rows) {
    const ids = (await billingChannels(c, orgId, siteId, "electricity", ch.node_id)).map((x) => x.channel_id)
    const w = (await billingChannels(c, orgId, siteId, ["cold_water", "hot_water"], ch.node_id)).map((x) => x.channel_id)
    breakdown.push({ nodeId: ch.node_id, name: ch.name, kind: ch.kind, electricityKwh: sumMap(await dailySum(c, ids, month, today)), waterM3: sumMap(await dailySum(c, w, month, today)), meters: ids.length + w.length })
  }

  const costs = await monthCosts(c, orgId, siteId, tz, month, today)
  return {
    site: { siteId: s.site_id, name: s.name, timezone: tz, shifts },
    nodeId,
    period: { month, today },
    power: powerNow && powerNow.total > 0 ? { kw: powerNow.fresh > 0 ? powerNow.kw : null, freshChannels: powerNow.fresh, channels: powerNow.total, at: powerNow.at ? new Date(powerNow.at).toISOString() : null } : null,
    peak: { todayKw: peakToday?.qty ?? null, todayAt: peakToday ? new Date(peakToday.ts).toISOString() : null, monthKw: peakMonth?.qty ?? null, monthAt: peakMonth ? new Date(peakMonth.ts).toISOString() : null },
    electricity: { shiftName: currentShift?.name ?? null, shiftKwh: currentShiftQty, todayKwh: elecToday, monthKwh: elecMonth, deviationPct },
    water: { coldTodayM3: coldToday, coldMonthM3: coldMonth, hotTodayM3: hotToday, hotMonthM3: hotMonth },
    costs: costs.totals,
    costServices: costs.services.map((x) => ({ service: x.service, title: x.title, forecast: x.forecast.amount, toDate: x.actualToDate.amount, hasTariff: x.hasTariff })),
    specific,
    shifts: Object.entries(byShift).sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, v]) => ({ day, ...v })),
    shiftNames: shifts.map((x) => x.name),
    breakdown,
    meters: await meterHealth(c, orgId, siteId),
    events: await recentEvents(c, orgId, siteId, 10),
    hasData: elec.length + cold.length + hot.length > 0,
  }
}

function maxEntry(m: Map<number, { qty: number; allocated: number }>): { ts: number; qty: number } | null {
  let best: { ts: number; qty: number } | null = null
  for (const [ts, v] of m) if (v.allocated === 0 && (!best || v.qty > best.qty)) best = { ts, qty: v.qty }
  return best
}

function findShiftStart(now: number, tz: string, sh: { from: string; to: string }): number {
  const today = localDateKey(now, tz)
  const fromMin = parseClock(sh.from)
  const p = localParts(now, tz)
  const minute = p.hour * 60 + p.minute
  const day = fromMin > minute ? addDays(today, -1) : today
  return dayStartUtc(day, tz) + fromMin * 60_000
}
