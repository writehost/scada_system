import assert from "node:assert/strict"
import test from "node:test"
import { forecastPeriod, percentChange } from "../../lib/domain/forecast.ts"
import { nextDueDate, obligationStatus, parseRecurrence, reminderDue, shiftWithDue } from "../../lib/domain/obligations.ts"
import { continuousFlow, growth, nightUsage } from "../../lib/domain/anomalies.ts"
import { canIngest, canWrite, effectiveLimits, resolveStatus } from "../../lib/domain/plans.ts"

test("forecast extrapolates the recent daily average", () => {
  const days = Array.from({ length: 10 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, "0")}`, qty: 10 }))
  const f = forecastPeriod({ periodStart: "2026-09-01", periodEnd: "2026-09-30", today: "2026-09-10", days })
  assert.equal(f.actualQty, 100)
  assert.equal(f.forecastQty, 300)
  assert.equal(f.confidence, "high")
})

test("forecast without any data is absent, not zero", () => {
  const f = forecastPeriod({ periodStart: "2026-09-01", periodEnd: "2026-09-30", today: "2026-09-10", days: [] })
  assert.equal(f.forecastQty, null)
  assert.equal(f.confidence, "none")
})

test("forecast counts remaining days from last data, not from today", () => {
  const days = [{ day: "2026-09-01", qty: 5 }, { day: "2026-09-02", qty: 5 }, { day: "2026-09-03", qty: 5 }]
  const f = forecastPeriod({ periodStart: "2026-09-01", periodEnd: "2026-09-30", today: "2026-09-10", days })
  assert.equal(f.remainingDays, 27)
  assert.equal(f.forecastQty, 150)
})

test("percent change", () => {
  assert.equal(percentChange(135, 100), 35)
  assert.equal(percentChange(10, 0), null)
})

test("monthly recurrence clamps day 31 and keeps preferred day", () => {
  const rec = parseRecurrence({ freq: "monthly", interval: 1, day: 31 })
  assert.equal(nextDueDate("2026-01-31", rec), "2026-02-28")
  assert.equal(nextDueDate("2026-02-28", rec), "2026-03-31")
  assert.equal(nextDueDate("2026-12-10", parseRecurrence({ freq: "monthly", interval: 1, day: 10 })), "2027-01-10")
  assert.equal(nextDueDate("2026-03-01", { freq: "none" }), null)
})

test("statuses: pending, due soon, overdue, paid", () => {
  const o = { status: "pending", due_date: "2026-09-10", remind_days: 3 }
  assert.equal(obligationStatus(o, "2026-09-01"), "pending")
  assert.equal(obligationStatus(o, "2026-09-07"), "due_soon")
  assert.equal(obligationStatus(o, "2026-09-11"), "overdue")
  assert.equal(obligationStatus({ ...o, status: "paid" }, "2026-09-11"), "paid")
  assert.equal(reminderDue("2026-09-10", 3, "2026-09-07"), true)
  assert.equal(reminderDue("2026-09-10", 3, "2026-09-06"), false)
  assert.equal(shiftWithDue("2026-09-10", "2026-10-10", "2026-09-05"), "2026-10-05")
})

test("continuous flow needs consecutive measured hours", () => {
  const H = 3_600_000
  const hours = Array.from({ length: 7 }, (_, i) => ({ ts: i * H, qty: 0.02, localHour: i }))
  assert.equal(continuousFlow(hours, 0.005, 6).triggered, true)
  const gap = hours.filter((_, i) => i !== 3)
  assert.equal(continuousFlow(gap, 0.005, 6).triggered, false)
  const allocated = hours.map((h) => ({ ...h, allocated: 0.02 }))
  assert.equal(continuousFlow(allocated, 0.005, 6).triggered, false)
})

test("night usage compares with median of previous nights", () => {
  const nights = Array.from({ length: 10 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, "0")}`, avgPerHour: 0.2 }))
  nights.push({ day: "2026-09-11", avgPerHour: 0.4 })
  const r = nightUsage(nights, { thresholdPct: 50, minAbsPerHour: 0.1 })
  assert.equal(r.triggered, true)
  assert.equal(Math.round(r.increasePct!), 100)
  assert.equal(growth(135, 100, 35).triggered, true)
})

test("expired subscription keeps history readable but stops writes", () => {
  const now = Date.UTC(2026, 9, 10)
  assert.equal(resolveStatus({ status: "trial", trial_ends_at: new Date(now - 1000), current_period_end: null }, now), "expired")
  assert.equal(resolveStatus({ status: "active", trial_ends_at: null, current_period_end: new Date(now - 86400000) }, now), "past_due")
  assert.equal(canWrite("expired"), false)
  assert.equal(canIngest("past_due"), true)
  assert.deepEqual(effectiveLimits({ sites: 1, meters: 6 }, { meters: 10 }).meters, 10)
})
