import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { createTestDb, makeOrg, type TestDb } from "../helpers/db.ts"
import { withOrg } from "../../lib/server/db.ts"
import { createMeter, createSite } from "../../lib/services/assets.ts"
import { ingestReadings } from "../../lib/services/ingest.ts"
import { createAccount, createObligation, createTariff, listObligations, markPaid, upsertActualCharge } from "../../lib/services/finance.ts"
import { monthCosts } from "../../lib/services/billing.ts"
import { homeDashboard } from "../../lib/services/dashboard.ts"
import { zonedTimeToUtc } from "../../lib/domain/time.ts"

let db: TestDb
let orgId: string
let userId: string
let siteId: string
const tz = "Europe/Moscow"
const actor = () => ({ kind: "user" as const, id: userId })
const at = (m: number, d: number, h = 12) => zonedTimeToUtc(2026, m, d, h, tz)

before(async () => {
  db = await createTestDb()
  ;({ orgId, userId } = await makeOrg())
  siteId = await withOrg(orgId, (c) => createSite(c, orgId, actor(), { name: "Квартира", kind: "apartment" }))
  await withOrg(orgId, async (c) => {
    const e = await createMeter(c, orgId, actor(), {
      siteId, resource: "electricity", name: "Электросчётчик Т1/Т2", connection: "manual", installedAt: at(7, 1, 0),
      channels: [
        { code: "energy_t1", name: "Т1", quantity: "energy_active", measure_kind: "cumulative", unit: "kWh", tariff_zone: "T1" },
        { code: "energy_t2", name: "Т2", quantity: "energy_active", measure_kind: "cumulative", unit: "kWh", tariff_zone: "T2" },
      ],
    })
    const w = await createMeter(c, orgId, actor(), {
      siteId, resource: "cold_water", name: "ХВС", connection: "manual", installedAt: at(7, 1, 0),
      channels: [{ code: "volume", name: "Объём", quantity: "volume", measure_kind: "cumulative", unit: "m3" }],
    })
    const [t1, t2] = e.channels.map((x) => x.channelId)
    const v = w.channels[0].channelId
    const rd = (ch: number, t: number, raw: number) => ({ channelId: ch, at: t, raw, source: "manual" as const })
    // Ежедневные показания с 1 августа по 10 сентября: Т1 +6, Т2 +3 кВт·ч, вода +0,2 м³ в сутки
    const items = []
    for (let i = 0; i <= 40; i += 1) {
      const t = at(8, 1) + i * 86400000
      items.push(rd(t1, t, 1000 + 6 * i), rd(t2, t, 500 + 3 * i), rd(v, t, 10 + 0.2 * i))
    }
    await ingestReadings(c, orgId, items, { receivedAt: at(9, 11) })
  })
})
after(async () => db?.drop())

test("costs per service with zone registers, forecast and comparison", async () => {
  await withOrg(orgId, async (c) => {
    const ea = await createAccount(c, orgId, actor(), { siteId, service: "electricity", providerName: "Энергосбыт", calcMethod: "meter" })
    await createTariff(c, orgId, actor(), { accountId: ea, name: "Двухтарифный", kind: "zones", validFrom: "2026-01-01", config: { zones: [
      { code: "T1", name: "День", price: 8, ranges: [{ from: "07:00", to: "23:00" }] },
      { code: "T2", name: "Ночь", price: 4, ranges: [{ from: "23:00", to: "07:00" }] },
    ] } })
    const wa = await createAccount(c, orgId, actor(), { siteId, service: "cold_water", calcMethod: "meter" })
    await createTariff(c, orgId, actor(), { accountId: wa, name: "ХВС", kind: "single", validFrom: "2026-01-01", config: { price: 50 } })
    const net = await createAccount(c, orgId, actor(), { siteId, service: "internet", providerName: "Провайдер", calcMethod: "fixed" })
    await createTariff(c, orgId, actor(), { accountId: net, name: "Интернет", kind: "fixed", validFrom: "2026-01-01", config: { amount: 750 } })
  })
  const r = await withOrg(orgId, (c) => monthCosts(c, orgId, siteId, tz, "2026-09-01", "2026-09-10"))
  const el = r.services.find((s) => s.service === "electricity")!
  // 1–10 сентября: 9 полных суток данных (последнее показание 10.09 12:00) → Т1 ≈ 6·9.5…
  assert.ok(el.actualToDate.amount! > 0)
  assert.equal(el.actualToDate.result.lines.length, 2)
  assert.ok(Math.abs(el.forecast.qty! - 9 * 30) < 1, `forecast ${el.forecast.qty}`)
  const water = r.services.find((s) => s.service === "cold_water")!
  assert.ok(Math.abs(water.forecast.amount! - 0.2 * 30 * 50) < 2, `water ${water.forecast.amount}`)
  const net = r.services.find((s) => s.service === "internet")!
  assert.equal(net.forecast.amount, 750)
  assert.ok(el.previous.amount! > 0, "previous month calculated")
  assert.equal(r.totals.incomplete, false)
})

test("actual charge from a receipt overrides the calculation", async () => {
  const accId = await withOrg(orgId, async (c) => (await c.query("SELECT account_id FROM ems_accounts WHERE service = 'cold_water'")).rows[0].account_id)
  await withOrg(orgId, (c) => upsertActualCharge(c, orgId, actor(), { accountId: accId, period: "2026-08-01", amount: 333.33, note: "квитанция" }))
  const r = await withOrg(orgId, (c) => monthCosts(c, orgId, siteId, tz, "2026-09-01", "2026-09-10"))
  const water = r.services.find((s) => s.service === "cold_water")!
  assert.equal(water.previous.amount, 333.33)
  assert.equal(water.previous.basis, "actual")
})

test("obligation lifecycle: calculated amount, paid by user, next generated", async () => {
  const ids = await withOrg(orgId, async (c) => {
    const acc = (await c.query("SELECT account_id FROM ems_accounts WHERE service = 'electricity'")).rows[0].account_id
    const calc = await createObligation(c, orgId, actor(), { accountId: acc, title: "Электричество", service: "electricity", amountMode: "calculated", dueDate: "2026-09-10", readingsDueDate: "2026-09-05", recurrence: { freq: "monthly", interval: 1, day: 10 }, remindDays: 3 })
    const fixed = await createObligation(c, orgId, actor(), { siteId, title: "Интернет", service: "internet", amountMode: "fixed", amount: 750, dueDate: "2026-09-20", recurrence: { freq: "monthly", interval: 1, day: 20 }, remindDays: 5 })
    return { calc, fixed }
  })
  const list = await withOrg(orgId, (c) => listObligations(c, orgId, {}, "2026-09-08"))
  const calc = list.find((o) => o.obligationId === ids.calc)!
  assert.equal(calc.status, "due_soon")
  assert.equal(calc.amountBasis, "calculated") // август завершён — расчёт по показаниям
  assert.ok(calc.amount! > 0)
  const res = await withOrg(orgId, (c) => markPaid(c, orgId, actor(), ids.fixed, { amount: 750, paidOn: "2026-09-18" }))
  assert.ok(res.nextId)
  const after = await withOrg(orgId, (c) => listObligations(c, orgId, {}, "2026-09-25"))
  const next = after.find((o) => o.obligationId === res.nextId)!
  assert.equal(next.dueDate, "2026-10-20")
  assert.equal(next.amount, 750)
  assert.equal(after.find((o) => o.obligationId === ids.fixed)!.status, "paid")
  assert.equal(after.find((o) => o.obligationId === ids.calc)!.status, "overdue")
})

test("home dashboard answers the five questions", async () => {
  const d = await withOrg(orgId, (c) => homeDashboard(c, orgId, siteId, at(9, 10, 18)))
  assert.equal(d.period.month, "2026-09-01")
  assert.ok(d.resources.find((r) => r.resource === "electricity")!.monthQty > 0)
  assert.ok(d.totals.forecast! > 0)
  assert.ok(d.obligations.length >= 1)
  assert.equal(d.meters.length, 2)
  assert.ok(d.otherServices.some((s) => s.service === "internet"))
})
