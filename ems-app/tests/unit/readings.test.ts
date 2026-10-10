import assert from "node:assert/strict"
import test from "node:test"
import { evaluateReading, prepareTimestamp, type ChannelRules, type StoredReading } from "../../lib/domain/readings.ts"

const H = 3_600_000
const T0 = Date.UTC(2026, 8, 1, 0, 0)
const cum: ChannelRules = { measureKind: "cumulative", rolloverAt: null, maxRatePerHour: null }
const stored = (at: number, raw: number, extra: Partial<StoredReading> = {}): StoredReading => ({
  at, raw, value: raw, coef: 1, quality: "good", flags: [], deltaKind: "normal", ...extra,
})
const inc = (at: number, raw: number, coef = 1) => ({ at, raw, coef, offset: 0, receivedAt: at })

test("first reading is a baseline without consumption", () => {
  const e = evaluateReading(cum, null, inc(T0, 1000))
  assert.equal(e.quality, "good")
  assert.equal(e.delta, null)
  assert.equal(e.deltaKind, "baseline")
})

test("consumption is the difference of correct readings", () => {
  const e = evaluateReading(cum, stored(T0, 1000), inc(T0 + H, 1012.5))
  assert.equal(e.delta, 12.5)
  assert.equal(e.prevAt, T0)
  assert.equal(e.quality, "good")
})

test("negative increment is rejected, not counted", () => {
  const e = evaluateReading(cum, stored(T0, 1000), inc(T0 + H, 990))
  assert.equal(e.quality, "bad")
  assert.ok(e.flags.includes("negative_delta"))
  assert.equal(e.delta, null)
})

test("register overflow uses the modulus", () => {
  const rules = { ...cum, rolloverAt: 65536 }
  const e = evaluateReading(rules, stored(T0, 65500, { coef: 0.01, value: 655 }), { at: T0 + H, raw: 30, coef: 0.01, offset: 0, receivedAt: T0 + H })
  assert.equal(e.deltaKind, "rollover")
  assert.ok(Math.abs((e.delta ?? 0) - 0.66) < 1e-9)
})

test("counter reset keeps baseline but does not invent consumption", () => {
  const e = evaluateReading(cum, stored(T0, 15234), inc(T0 + H, 3))
  assert.equal(e.quality, "good")
  assert.equal(e.deltaKind, "reset")
  assert.equal(e.delta, null)
  assert.ok(e.flags.includes("counter_reset"))
})

test("implausible rate is flagged suspect but kept for review", () => {
  const e = evaluateReading({ ...cum, maxRatePerHour: 30 }, stored(T0, 100), inc(T0 + H, 200))
  assert.equal(e.quality, "suspect")
  assert.ok(e.flags.includes("rate_exceeded"))
  assert.equal(e.delta, 100)
})

test("late reading greater than the next one is inconsistent", () => {
  const e = evaluateReading(cum, stored(T0, 100), inc(T0 + H, 150), stored(T0 + 2 * H, 120))
  assert.equal(e.quality, "bad")
  assert.ok(e.flags.includes("inconsistent_late"))
})

test("late reading between neighbours is accepted", () => {
  const e = evaluateReading(cum, stored(T0, 100), inc(T0 + H, 110), stored(T0 + 2 * H, 120))
  assert.equal(e.quality, "good")
  assert.equal(e.delta, 10)
})

test("coefficient change with boundary reading uses the new coefficient", () => {
  const prev = stored(T0, 500, { coef: 10, value: 5000, flags: ["coef_boundary"] })
  const e = evaluateReading(cum, prev, { at: T0 + H, raw: 510, coef: 20, offset: 0, receivedAt: T0 + H })
  assert.equal(e.deltaKind, "coef_change")
  assert.equal(e.delta, 200)
})

test("coefficient change without boundary leaves consumption unknown", () => {
  const e = evaluateReading(cum, stored(T0, 500, { coef: 10, value: 5000 }), { at: T0 + H, raw: 510, coef: 20, offset: 0, receivedAt: T0 + H })
  assert.equal(e.delta, null)
  assert.equal(e.quality, "suspect")
})

test("non-numeric and negative cumulative values are bad", () => {
  assert.equal(evaluateReading(cum, null, inc(T0, Number.NaN)).quality, "bad")
  assert.equal(evaluateReading(cum, null, inc(T0, -5)).quality, "bad")
})

test("instant values never produce consumption", () => {
  const e = evaluateReading({ ...cum, measureKind: "instant" }, stored(T0, 5), inc(T0 + H, 2.5))
  assert.equal(e.quality, "good")
  assert.equal(e.delta, null)
})

test("device clock ahead is replaced by receive time and marked", () => {
  const p = prepareTimestamp({ at: T0 + 2 * H, receivedAt: T0 }, {})
  assert.equal(p.at, T0)
  assert.deepEqual(p.flags, ["clock_ahead"])
  assert.equal(prepareTimestamp({ at: T0 - 10 * 366 * 86400000, receivedAt: T0 }, {}).reject, "too_old")
  assert.equal(prepareTimestamp({ at: T0 - 86400000, receivedAt: T0 }, { installedAt: T0 }).reject, "before_install")
})
