import assert from "node:assert/strict"
import test from "node:test"
import { calculateCost, parseTariffConfig, TariffValidationError, type Tariff } from "../../lib/domain/tariffs.ts"
import { zonedTimeToUtc } from "../../lib/domain/time.ts"

const tz = "Europe/Moscow"
const t = (config: unknown, kind: string, validFrom = "2026-01-01", validTo: string | null = null, id = "t1"): Tariff => ({
  tariffId: id, name: "Тариф", validFrom, validTo, config: parseTariffConfig(kind, config),
})
const days = (from: number, to: number, qty: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ day: `2026-09-${String(from + i).padStart(2, "0")}`, qty, allocated: 0 }))

test("single-rate electricity", () => {
  const r = calculateCost("electricity", [t({ price: 6.43 }, "single")], { tz, days: days(1, 30, 10) })
  assert.equal(r.amount, 1929)
  assert.equal(r.qty, 300)
})

test("two-zone tariff from meter registers", () => {
  const tariff = t({ zones: [
    { code: "T1", name: "День", price: 7.2, ranges: [{ from: "07:00", to: "23:00" }] },
    { code: "T2", name: "Ночь", price: 3.1, ranges: [{ from: "23:00", to: "07:00" }] },
  ] }, "zones")
  const r = calculateCost("electricity", [tariff], {
    tz, days: days(1, 2, 15),
    zoneDays: { T1: days(1, 2, 10), T2: days(1, 2, 5) },
  })
  assert.equal(r.amount, 20 * 7.2 + 10 * 3.1)
})

test("zone tariff from hourly data classifies hours in local time", () => {
  const tariff = t({ zones: [
    { code: "T1", name: "День", price: 10, ranges: [{ from: "07:00", to: "23:00" }] },
    { code: "T2", name: "Ночь", price: 1, ranges: [{ from: "23:00", to: "07:00" }] },
  ] }, "zones")
  const hours = Array.from({ length: 24 }, (_, h) => ({ ts: zonedTimeToUtc(2026, 9, 1, h, tz), qty: 1, allocated: 0 }))
  const r = calculateCost("electricity", [tariff], { tz, days: days(1, 1, 24), hours })
  assert.equal(r.amount, 16 * 10 + 8 * 1)
})

test("zone tariff without zone data refuses to guess", () => {
  const tariff = t({ zones: [
    { code: "T1", name: "День", price: 10, ranges: [{ from: "07:00", to: "23:00" }] },
    { code: "T2", name: "Ночь", price: 1, ranges: [{ from: "23:00", to: "07:00" }] },
  ] }, "zones")
  const r = calculateCost("electricity", [tariff], { tz, days: days(1, 1, 24) })
  assert.equal(r.amount, null)
  assert.ok(r.warnings.length > 0)
})

test("three-zone tariff must cover the day without overlap", () => {
  assert.throws(() => parseTariffConfig("zones", { zones: [
    { code: "T1", price: 1, ranges: [{ from: "07:00", to: "10:00" }] },
    { code: "T2", price: 1, ranges: [{ from: "23:00", to: "07:00" }] },
    { code: "T3", price: 1, ranges: [{ from: "10:00", to: "22:00" }] },
  ] }), TariffValidationError)
  assert.doesNotThrow(() => parseTariffConfig("zones", { zones: [
    { code: "T1", price: 9, ranges: [{ from: "07:00", to: "10:00" }, { from: "17:00", to: "21:00" }] },
    { code: "T2", price: 2, ranges: [{ from: "23:00", to: "07:00" }] },
    { code: "T3", price: 5, ranges: [{ from: "10:00", to: "17:00" }, { from: "21:00", to: "23:00" }] },
  ] }))
})

test("hot water two-component scheme", () => {
  const r = calculateCost("hot_water", [t({ mode: "two_component", coldPrice: 50, heatPerM3: 0.06, heatPrice: 2500 }, "hot_water")], { tz, days: days(1, 1, 3) })
  assert.equal(r.lines.length, 2)
  assert.equal(r.amount, 3 * 50 + 3 * 0.06 * 2500)
})

test("tariff change mid-month splits days", () => {
  const tariffs = [t({ price: 5 }, "single", "2026-01-01", "2026-09-15", "a"), t({ price: 6 }, "single", "2026-09-16", null, "b")]
  const r = calculateCost("electricity", tariffs, { tz, days: days(1, 30, 1) })
  assert.equal(r.amount, 15 * 5 + 15 * 6)
})

test("missing tariff yields no amount instead of zero", () => {
  const r = calculateCost("cold_water", [t({ price: 50 }, "single", "2026-09-10")], { tz, days: days(1, 30, 1) })
  assert.equal(r.amount, null)
  assert.match(r.warnings[0], /Нет тарифа/)
})

test("fixed service is charged once per month", () => {
  const r = calculateCost("internet", [t({ amount: 750 }, "fixed")], { tz, days: days(1, 30, 0) }, null)
  assert.equal(r.amount, 750)
  assert.equal(r.fixedAmount, 750)
})

test("industrial capacity by peak hours averages workday maxima", () => {
  const cfg = { price: 5, capacity: { basis: "peak_hours", pricePerKw: 1000, ranges: [{ from: "08:00", to: "11:00" }], workdaysOnly: true } }
  // 2026-09-01 вторник, 2026-09-05 суббота
  const hours = [
    { ts: zonedTimeToUtc(2026, 9, 1, 9, tz), qty: 100, allocated: 0 },
    { ts: zonedTimeToUtc(2026, 9, 1, 10, tz), qty: 120, allocated: 0 },
    { ts: zonedTimeToUtc(2026, 9, 2, 9, tz), qty: 80, allocated: 0 },
    { ts: zonedTimeToUtc(2026, 9, 5, 9, tz), qty: 500, allocated: 0 },
    { ts: zonedTimeToUtc(2026, 9, 1, 14, tz), qty: 900, allocated: 0 },
  ]
  const r = calculateCost("electricity", [t(cfg, "single")], { tz, days: days(1, 5, 10), hours })
  const cap = r.lines.find((l) => l.unit === "kW")!
  assert.equal(cap.qty, 100)
  assert.equal(cap.amount, 100000)
})

test("validation rejects nonsense", () => {
  assert.throws(() => parseTariffConfig("single", { price: "abc" }), TariffValidationError)
  assert.throws(() => parseTariffConfig("single", { price: -1 }), TariffValidationError)
  assert.throws(() => parseTariffConfig("unknown", {}), TariffValidationError)
})
