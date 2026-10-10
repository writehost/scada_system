import assert from "node:assert/strict"
import test from "node:test"
import { allocateSpans, dayBucketFactory, hourBucket } from "../../lib/domain/allocate.ts"

const H = 3_600_000
const T0 = Date.UTC(2026, 8, 1, 10, 0)

test("span inside one hour is measured, not allocated", () => {
  const m = allocateSpans([{ start: T0 + 60000, end: T0 + 30 * 60000, delta: 2 }], hourBucket)
  assert.deepEqual([...m.entries()], [[T0, { delta: 2, allocated: 0 }]])
})

test("reading exactly on the hour closes the previous bucket", () => {
  const m = allocateSpans([{ start: T0, end: T0 + H, delta: 3 }], hourBucket)
  assert.deepEqual([...m.keys()], [T0])
})

test("long span is split by time and marked allocated; total preserved", () => {
  const m = allocateSpans([{ start: T0 + 30 * 60000, end: T0 + 2 * H + 30 * 60000, delta: 4 }], hourBucket)
  assert.equal(m.size, 3)
  assert.equal(m.get(T0)!.delta, 1)
  assert.equal(m.get(T0 + H)!.delta, 2)
  assert.equal(m.get(T0 + 2 * H)!.allocated, 1)
  const total = [...m.values()].reduce((s, b) => s + b.delta, 0)
  assert.ok(Math.abs(total - 4) < 1e-12)
})

test("unknown consumption (null delta) creates no buckets", () => {
  assert.equal(allocateSpans([{ start: T0, end: T0 + 5 * H, delta: null }], hourBucket).size, 0)
})

test("daily buckets follow the site time zone", () => {
  // 20:00 UTC = 23:00 Москва, 22:00 UTC = 01:00 следующего дня в Москве
  const start = Date.UTC(2026, 8, 1, 20, 0)
  const m = allocateSpans([{ start, end: start + 2 * H, delta: 2 }], dayBucketFactory("Europe/Moscow"))
  assert.deepEqual([...m.keys()].sort(), ["2026-09-01", "2026-09-02"])
  assert.equal(m.get("2026-09-01")!.delta, 1)
})
