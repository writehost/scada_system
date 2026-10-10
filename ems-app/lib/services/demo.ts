// Демо-режим: отдельная организация с пометкой is_demo и синтетическими данными.
// В реальные организации демо-данные не попадают никогда.

import type { Db } from "../server/db.ts"
import { enterOrg } from "../server/db.ts"
import { createOrganization } from "./org.ts"
import { createMeter, createNode, createSite } from "./assets.ts"
import { createAccount, createObligation, createTariff } from "./finance.ts"
import { ingestReadings, type IngestItem } from "./ingest.ts"
import { createRule } from "./rules.ts"
import { addDays, dayStartUtc, HOUR_MS, localDateKey, localParts, monthStartKey } from "../domain/time.ts"

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const TZ = "Europe/Moscow"

export async function createDemoOrg(c: Db, userId: string, segment: "home" | "industrial"): Promise<string> {
  const orgId = await createOrganization(c, { name: segment === "home" ? "Демо: квартира" : "Демо: завод", kind: "personal", segment, ownerUserId: userId, isDemo: true })
  await enterOrg(c, orgId)
  await c.query("UPDATE ems_organizations SET onboarding_done = true WHERE org_id = $1", [orgId])
  const actor = { kind: "system" as const, id: null }
  if (segment === "home") await seedHome(c, orgId, actor)
  else await seedIndustrial(c, orgId, actor)
  await c.query("SELECT set_config('ems.scope', 'system', true), set_config('ems.org_id', '', true)")
  return orgId
}

async function seedHome(c: Db, orgId: string, actor: { kind: "system"; id: null }) {
  const now = Date.now()
  const siteId = await createSite(c, orgId, actor, { name: "Демо-квартира", kind: "apartment", address: "Демонстрационные данные", timezone: TZ })
  const start = dayStartUtc(addDays(localDateKey(now, TZ), -62), TZ)
  const el = await createMeter(c, orgId, actor, {
    siteId, resource: "electricity", name: "Электросчётчик (демо)", connection: "manual", installedAt: start - HOUR_MS,
    channels: [
      { code: "energy_t1", name: "Т1 день", quantity: "energy_active", measure_kind: "cumulative", unit: "kWh", tariff_zone: "T1" },
      { code: "energy_t2", name: "Т2 ночь", quantity: "energy_active", measure_kind: "cumulative", unit: "kWh", tariff_zone: "T2" },
    ],
  })
  const cw = await createMeter(c, orgId, actor, { siteId, resource: "cold_water", name: "ХВС кухня (демо)", connection: "manual", installedAt: start - HOUR_MS, channels: [{ code: "volume", name: "Объём", quantity: "volume", measure_kind: "cumulative", unit: "m3" }] })
  const hw = await createMeter(c, orgId, actor, { siteId, resource: "hot_water", name: "ГВС кухня (демо)", connection: "manual", installedAt: start - HOUR_MS, channels: [{ code: "volume", name: "Объём", quantity: "volume", measure_kind: "cumulative", unit: "m3" }] })
  const rand = rng(42)
  const items: IngestItem[] = []
  let t1 = 12000, t2 = 5400, v1 = 230, v2 = 140
  const [c1, c2] = el.channels.map((x) => x.channelId)
  for (let t = start; t <= now; t += HOUR_MS) {
    const h = localParts(t, TZ).hour
    const day = h >= 7 && h < 23
    const base = day ? 0.35 + (h >= 18 && h < 22 ? 0.6 : 0) + rand() * 0.25 : 0.18 + rand() * 0.08
    if (day) t1 += base
    else t2 += base
    const w = h >= 7 && h <= 9 ? 0.03 : h >= 19 && h <= 22 ? 0.025 : h < 6 ? 0 : 0.006
    v1 += w * (0.7 + rand() * 0.6)
    v2 += w * 0.6 * (0.7 + rand() * 0.6)
    items.push({ channelId: c1, at: t, raw: +t1.toFixed(3), source: "demo" }, { channelId: c2, at: t, raw: +t2.toFixed(3), source: "demo" })
    items.push({ channelId: cw.channels[0].channelId, at: t, raw: +v1.toFixed(4), source: "demo" }, { channelId: hw.channels[0].channelId, at: t, raw: +v2.toFixed(4), source: "demo" })
  }
  for (let i = 0; i < items.length; i += 2000) await ingestReadings(c, orgId, items.slice(i, i + 2000))
  const from = `${new Date(now).getUTCFullYear() - 1}-01-01`
  const ea = await createAccount(c, orgId, actor, { siteId, service: "electricity", providerName: "Демо-энергосбыт", accountNumber: "0000000001", calcMethod: "meter", budgetMonth: 2500 })
  await createTariff(c, orgId, actor, { accountId: ea, name: "Демо: двухзонный (пример, не действующий)", kind: "zones", validFrom: from, config: { zones: [{ code: "T1", name: "День", price: 7.5, ranges: [{ from: "07:00", to: "23:00" }] }, { code: "T2", name: "Ночь", price: 3.2, ranges: [{ from: "23:00", to: "07:00" }] }] }, sourceNote: "демо" })
  const ca = await createAccount(c, orgId, actor, { siteId, service: "cold_water", providerName: "Демо-водоканал", calcMethod: "meter" })
  await createTariff(c, orgId, actor, { accountId: ca, name: "Демо: ХВС (пример)", kind: "single", validFrom: from, config: { price: 52 } })
  const ha = await createAccount(c, orgId, actor, { siteId, service: "hot_water", providerName: "Демо-теплосеть", calcMethod: "meter" })
  await createTariff(c, orgId, actor, { accountId: ha, name: "Демо: ГВС двухкомпонентный (пример)", kind: "hot_water", validFrom: from, config: { mode: "two_component", coldPrice: 52, heatPerM3: 0.06, heatPrice: 2900 } })
  const wa = await createAccount(c, orgId, actor, { siteId, service: "wastewater", providerName: "Демо-водоканал", calcMethod: "meter" })
  await createTariff(c, orgId, actor, { accountId: wa, name: "Демо: водоотведение (пример)", kind: "wastewater", validFrom: from, config: { price: 38, basis: "cold_plus_hot" } })
  const na = await createAccount(c, orgId, actor, { siteId, service: "internet", providerName: "Демо-провайдер", calcMethod: "fixed" })
  await createTariff(c, orgId, actor, { accountId: na, name: "Интернет 500 Мбит/с (демо)", kind: "fixed", validFrom: from, config: { amount: 750 } })
  const thisMonth = monthStartKey(localDateKey(now, TZ))
  const nextMonth10 = addDays(thisMonth, 40).slice(0, 8) + "10"
  const due = localDateKey(now, TZ).slice(8) <= "10" ? thisMonth.slice(0, 8) + "10" : nextMonth10
  await createObligation(c, orgId, actor, { siteId, accountId: ea, title: "Электричество", service: "electricity", providerName: "Демо-энергосбыт", amountMode: "calculated", dueDate: due, readingsDueDate: addDays(due, -5), recurrence: { freq: "monthly", interval: 1, day: 10 }, remindDays: 3 })
  await createObligation(c, orgId, actor, { siteId, accountId: ca, title: "Холодная вода", service: "cold_water", amountMode: "calculated", dueDate: due, readingsDueDate: addDays(due, -5), recurrence: { freq: "monthly", interval: 1, day: 10 }, remindDays: 3 })
  await createObligation(c, orgId, actor, { siteId, accountId: na, title: "Интернет", service: "internet", providerName: "Демо-провайдер", amountMode: "fixed", amount: 750, dueDate: addDays(localDateKey(now, TZ), 4), recurrence: { freq: "monthly", interval: 1, day: Number(addDays(localDateKey(now, TZ), 4).slice(8)) }, remindDays: 5 })
  await createRule(c, orgId, actor, { kind: "consumption_growth", siteId, params: { resource: "cold_water", thresholdPct: 35 } })
}

async function seedIndustrial(c: Db, orgId: string, actor: { kind: "system"; id: null }) {
  const now = Date.now()
  const siteId = await createSite(c, orgId, actor, { name: "Демо-завод", kind: "plant", address: "Демонстрационные данные", timezone: TZ, shifts: [{ name: "Дневная", from: "08:00", to: "20:00" }, { name: "Ночная", from: "20:00", to: "08:00" }] })
  const shop = await createNode(c, orgId, actor, { siteId, kind: "building", name: "Цех розлива" })
  const line1 = await createNode(c, orgId, actor, { siteId, parentId: shop, kind: "line", name: "Линия № 1" })
  const line2 = await createNode(c, orgId, actor, { siteId, parentId: shop, kind: "line", name: "Линия № 2" })
  const util = await createNode(c, orgId, actor, { siteId, kind: "zone", name: "Компрессорная" })
  const start = dayStartUtc(addDays(localDateKey(now, TZ), -35), TZ)
  const mk = async (name: string, nodeId: string, kw: number) =>
    createMeter(c, orgId, actor, {
      siteId, nodeId, resource: "electricity", name, connection: "manual", installedAt: start - HOUR_MS,
      channels: [
        { code: "energy", name: "Активная энергия", quantity: "energy_active", measure_kind: "cumulative", unit: "kWh" },
        { code: "power", name: "Активная мощность", quantity: "power_active", measure_kind: "instant", unit: "kW", is_billing: false },
      ],
    }).then((m) => ({ ...m, kw }))
  const meters = [await mk("Шкаф ВРУ-1 · Линия 1 (демо)", line1, 180), await mk("Шкаф ВРУ-2 · Линия 2 (демо)", line2, 240), await mk("Компрессоры (демо)", util, 90)]
  const water = await createMeter(c, orgId, actor, { siteId, nodeId: shop, resource: "cold_water", name: "Расходомер ХВС цеха (демо)", connection: "manual", installedAt: start - HOUR_MS, channels: [{ code: "volume", name: "Объём", quantity: "volume", measure_kind: "cumulative", unit: "m3" }] })
  const rand = rng(7)
  const items: IngestItem[] = []
  const acc = meters.map(() => 50000)
  let vol = 8000
  for (let t = start; t <= now; t += HOUR_MS) {
    const p = localParts(t, TZ)
    const workday = p.weekday <= 5
    meters.forEach((m, i) => {
      const load = workday ? (p.hour >= 8 && p.hour < 20 ? 0.85 : 0.55) : 0.2
      const kw = m.kw * load * (0.9 + rand() * 0.2)
      acc[i] += kw
      items.push({ channelId: m.channels[0].channelId, at: t, raw: +acc[i].toFixed(2), source: "demo" }, { channelId: m.channels[1].channelId, at: t, raw: +kw.toFixed(2), source: "demo" })
    })
    vol += (workday ? 4 : 0.6) * (0.85 + rand() * 0.3)
    items.push({ channelId: water.channels[0].channelId, at: t, raw: +vol.toFixed(3), source: "demo" })
  }
  for (let i = 0; i < items.length; i += 2000) await ingestReadings(c, orgId, items.slice(i, i + 2000))
  for (let d = 35; d >= 0; d -= 1) {
    const day = addDays(localDateKey(now, TZ), -d)
    for (const [node, rate] of [[line1, 9000], [line2, 11000]] as const) {
      await c.query(
        `INSERT INTO ems_production (org_id, site_id, node_id, period_start, period_end, quantity, unit, source) VALUES ($1, $2, $3, $4, $5, $6, 'бут.', 'demo') ON CONFLICT DO NOTHING`,
        [orgId, siteId, node, new Date(dayStartUtc(day, TZ)), new Date(dayStartUtc(addDays(day, 1), TZ)), Math.round(rate * (0.85 + rand() * 0.3))],
      )
    }
  }
  const ea = await createAccount(c, orgId, actor, { siteId, service: "electricity", providerName: "Демо-энергосбыт", calcMethod: "meter" })
  await createTariff(c, orgId, actor, { accountId: ea, name: "Демо: одноставочный + мощность (пример, условия договора)", kind: "single", validFrom: "2025-01-01", config: { price: 6.1, capacity: { basis: "peak_hours", pricePerKw: 850, ranges: [{ from: "08:00", to: "11:00" }, { from: "16:00", to: "21:00" }], workdaysOnly: true } } })
  const wa = await createAccount(c, orgId, actor, { siteId, service: "cold_water", providerName: "Демо-водоканал", calcMethod: "meter" })
  await createTariff(c, orgId, actor, { accountId: wa, name: "Демо: ХВС (пример)", kind: "single", validFrom: "2025-01-01", config: { price: 61 } })
  await createRule(c, orgId, actor, { kind: "power_over", siteId, params: { limitKw: 520, minutes: 10 }, severity: "critical" })
  await createRule(c, orgId, actor, { kind: "night_usage", siteId, params: { resource: "electricity", thresholdPct: 40, minAbsPerHour: 50 } })
}
