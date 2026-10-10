import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { createTestDb, makeOrg, type TestDb } from "../helpers/db.ts"
import { withOrg } from "../../lib/server/db.ts"
import { createMeter, createSite, changeCoefficient, replaceMeter } from "../../lib/services/assets.ts"
import { correctReading, ingestReadings } from "../../lib/services/ingest.ts"

let db: TestDb
let orgId: string
let userId: string
let siteId: string
let channelId: number
const actor = () => ({ kind: "user" as const, id: userId })
const H = 3_600_000
const T0 = Date.UTC(2026, 8, 1, 0, 0) // 03:00 по Москве

before(async () => {
  db = await createTestDb()
  ;({ orgId, userId } = await makeOrg())
  siteId = await withOrg(orgId, (c) => createSite(c, orgId, actor(), { name: "Квартира", kind: "apartment" }))
  const m = await withOrg(orgId, (c) =>
    createMeter(c, orgId, actor(), {
      siteId, resource: "electricity", name: "Электросчётчик", connection: "manual",
      installedAt: T0 - 86400000,
      channels: [{ code: "energy", name: "Энергия", quantity: "energy_active", measure_kind: "cumulative", unit: "kWh" }],
    }),
  )
  channelId = m.channels[0].channelId
})
after(async () => db?.drop())

const ingest = (items: Array<[number, number]>, source: "gateway" | "manual" = "gateway") =>
  withOrg(orgId, (c) => ingestReadings(c, orgId, items.map(([at, raw]) => ({ channelId, at, raw, source })), { receivedAt: T0 + 60 * 24 * H }))

const hourly = () => withOrg(orgId, async (c) => (await c.query("SELECT bucket, delta, allocated FROM ems_agg_hourly WHERE channel_id = $1 ORDER BY bucket", [channelId])).rows)
const daily = () => withOrg(orgId, async (c) => (await c.query("SELECT day, delta, allocated FROM ems_agg_daily WHERE channel_id = $1 ORDER BY day", [channelId])).rows)

test("hourly readings produce measured hourly consumption", async () => {
  const r = await ingest([[T0, 1000], [T0 + H, 1001.5], [T0 + 2 * H, 1003.5]])
  assert.deepEqual(r.map((x) => x.status), ["accepted", "accepted", "accepted"])
  const h = await hourly()
  assert.equal(h.length, 2)
  assert.equal(h[0].delta, 1.5)
  assert.equal(h[1].delta, 2)
  assert.equal(h[0].allocated, 0)
})

test("redelivery of the same batch is idempotent", async () => {
  const r = await ingest([[T0 + H, 1001.5], [T0 + 2 * H, 1003.5]])
  assert.deepEqual(r.map((x) => x.status), ["duplicate", "duplicate"])
  const conflict = await ingest([[T0 + H, 1001.7]])
  assert.equal(conflict[0].status, "conflict")
  const h = await hourly()
  assert.equal(h.reduce((s, x) => s + x.delta, 0), 3.5)
})

test("late reading is inserted and neighbours recalculated", async () => {
  await ingest([[T0 + 4 * H, 1007.5]])
  // интервал 2→4 ч распределён по двум часам
  let h = await hourly()
  assert.equal(h.find((x) => x.bucket.getTime() === T0 + 2 * H).allocated, 2)
  const r = await ingest([[T0 + 3 * H, 1005]])
  assert.equal(r[0].status, "accepted")
  h = await hourly()
  const b2 = h.find((x) => x.bucket.getTime() === T0 + 2 * H)
  const b3 = h.find((x) => x.bucket.getTime() === T0 + 3 * H)
  assert.equal(b2.delta, 1.5)
  assert.equal(b2.allocated, 0)
  assert.equal(b3.delta, 2.5)
})

test("spike is auto-rejected when the next value returns to trend", async () => {
  const r = await ingest([[T0 + 5 * H, 99999], [T0 + 6 * H, 1009]])
  assert.equal(r[0].quality, "suspect")
  assert.equal(r[1].quality, "good")
  assert.equal(r[1].delta, 1.5)
  const spike = await withOrg(orgId, async (c) => (await c.query("SELECT quality, flags FROM ems_readings WHERE channel_id = $1 AND measured_at = $2", [channelId, new Date(T0 + 5 * H)])).rows[0])
  assert.equal(spike.quality, "bad")
  assert.ok(spike.flags.includes("spike"))
  const total = (await hourly()).reduce((s, x) => s + x.delta, 0)
  assert.ok(Math.abs(total - 9) < 1e-9, `total ${total}`)
})

test("negative increment is stored as bad and raises a data-quality event", async () => {
  const r = await ingest([[T0 + 7 * H, 900]])
  assert.equal(r[0].quality, "bad")
  const ev = await withOrg(orgId, async (c) => (await c.query("SELECT kind, category FROM ems_events WHERE channel_id = $1", [channelId])).rows)
  assert.ok(ev.some((e) => e.kind === "reading_negative_delta" && e.category === "data_quality"))
  const total = (await hourly()).reduce((s, x) => s + x.delta, 0)
  assert.ok(Math.abs(total - 9) < 1e-9)
})

test("manual correction of a bad reading recalculates consumption", async () => {
  await withOrg(orgId, (c) => correctReading(c, orgId, channelId, T0 + 7 * H, "edit", { newRaw: 1010, reason: "опечатка", actorId: userId }))
  const total = (await hourly()).reduce((s, x) => s + x.delta, 0)
  assert.ok(Math.abs(total - 10) < 1e-9)
  const log = await withOrg(orgId, async (c) => (await c.query("SELECT action, reason FROM ems_reading_corrections WHERE channel_id = $1 AND action = 'edit'", [channelId])).rows)
  assert.equal(log[0].reason, "опечатка")
})

test("daily aggregates use the site time zone and match hourly total", async () => {
  const d = await daily()
  assert.equal(d.length, 1)
  assert.equal(d[0].day, "2026-09-01")
  assert.ok(Math.abs(d[0].delta - 10) < 1e-9)
})

test("monthly manual readings are allocated across days, total preserved", async () => {
  const r = await ingest([[T0 + 30 * 24 * H - H, 1310]], "manual")
  assert.equal(r[0].status, "accepted")
  const d = await daily()
  const total = d.reduce((s, x) => s + x.delta, 0)
  assert.ok(Math.abs(total - 310) < 1e-6)
  assert.ok(d.length >= 29)
  assert.ok(d.at(-1).allocated > 0)
})

test("coefficient change with boundary reading keeps consumption exact", async () => {
  const at = T0 + 30 * 24 * H
  await withOrg(orgId, (c) => changeCoefficient(c, orgId, actor(), channelId, { effectiveFrom: at, multiplier: 2, boundaryRaw: 1311, reason: "ТТ" }))
  const r = await ingest([[at + H, 1312]])
  assert.equal(r[0].delta, 2)
  assert.equal(r[0].quality, "good")
})

test("meter replacement keeps both intervals", async () => {
  const at = T0 + 31 * 24 * H
  const meter = await withOrg(orgId, async (c) => (await c.query("SELECT meter_id FROM ems_channels WHERE channel_id = $1", [channelId])).rows[0].meter_id)
  const res = await withOrg(orgId, (c) =>
    replaceMeter(c, orgId, actor(), meter, { at, finalReadings: { energy: 1320 }, newMeter: { name: "Новый счётчик", connection: "manual" }, initialReadings: { energy: 5 } }),
  )
  const status = await withOrg(orgId, async (c) => (await c.query("SELECT status FROM ems_meters WHERE meter_id = $1", [meter])).rows[0].status)
  assert.equal(status, "replaced")
  const late = await ingest([[at + 2 * H, 1400]])
  assert.equal(late[0].status, "rejected")
  const newCh = await withOrg(orgId, async (c) => (await c.query("SELECT channel_id FROM ems_channels WHERE meter_id = $1", [res.newMeterId])).rows[0].channel_id)
  const r = await withOrg(orgId, (c) => ingestReadings(c, orgId, [{ channelId: newCh, at: at + 3 * H, raw: 8, source: "manual" }], { receivedAt: at + 4 * H }))
  // Новый счётчик наследует коэффициент трансформации канала (×2): трансформаторы тока остаются на месте.
  assert.equal(r[0].delta, 6)
})

test("fast append path gives the same aggregates as a full recompute", async () => {
  const { recomputeRange } = await import("../../lib/services/aggregate.ts")
  const start = T0 + 40 * 24 * H
  const m = await withOrg(orgId, (c) =>
    createMeter(c, orgId, actor(), {
      siteId, resource: "electricity", name: "Вводной щит", connection: "manual", installedAt: start - H,
      channels: [
        { code: "energy", name: "Энергия", quantity: "energy_active", measure_kind: "cumulative", unit: "kWh" },
        { code: "power", name: "Мощность", quantity: "power_active", measure_kind: "instant", unit: "kW" },
      ],
    }),
  )
  const [energy, power] = m.channels.map((x) => x.channelId)
  // Нерегулярные интервалы: 15 мин, обрывы на несколько часов и через полночь, сброс счётчика.
  const steps = [15, 15, 15, 47, 15, 190, 15, 15, 1500, 15, 30, 15]
  let at = start
  let e = 500
  const batches: Array<Array<{ channelId: number; at: number; raw: number; source: "gateway" }>> = []
  for (let b = 0; b < 4; b += 1) {
    const batch = []
    for (const s of steps) {
      at += s * 60_000
      e = b === 2 && s === 1500 ? 3 : e + s * 0.07
      batch.push({ channelId: energy, at, raw: Math.round(e * 1000) / 1000, source: "gateway" as const })
      batch.push({ channelId: power, at, raw: 2 + ((at / 60_000) % 7), source: "gateway" as const })
    }
    batches.push(batch)
  }
  for (const batch of batches) {
    const r = await withOrg(orgId, (c) => ingestReadings(c, orgId, batch, { receivedAt: at + H }))
    assert.ok(r.every((x) => x.status === "accepted"))
  }
  const snapshot = () =>
    withOrg(orgId, async (c) => ({
      h: (await c.query("SELECT channel_id, bucket, delta, allocated, n, v_avg, v_min, v_max FROM ems_agg_hourly WHERE channel_id = ANY($1) ORDER BY 1, 2", [[energy, power]])).rows,
      d: (await c.query("SELECT channel_id, day, delta, allocated, n, v_avg, v_min, v_max FROM ems_agg_daily WHERE channel_id = ANY($1) ORDER BY 1, 2", [[energy, power]])).rows,
    }))
  const incremental = await snapshot()
  await withOrg(orgId, async (c) => {
    for (const [channelId, kind] of [[energy, "cumulative"], [power, "instant"]] as const) {
      await recomputeRange(c, { channelId, orgId, tz: "Europe/Moscow", measureKind: kind }, start - H, at + H)
    }
  })
  const full = await snapshot()
  assert.ok(incremental.h.length > 20 && incremental.d.length >= 3)
  const close = (a: Record<string, unknown>[], b: Record<string, unknown>[]) => {
    assert.equal(a.length, b.length)
    a.forEach((row, i) => {
      for (const k of Object.keys(row)) {
        const x = row[k], y = b[i][k]
        if (typeof x === "number" && typeof y === "number") assert.ok(Math.abs(x - y) < 1e-6, `${k}: ${x} ≠ ${y}`)
        else if (k === "n" && (x === 0 || y === 0)) continue
        else assert.deepEqual(x, y, k)
      }
    })
  }
  // У накопительных каналов полный пересчёт пишет n = 0; сравниваем потребление и статистику мгновенных.
  close(incremental.h.map(({ n, ...r }) => ({ ...r, n: r.v_avg == null ? 0 : n })), full.h.map(({ n, ...r }) => ({ ...r, n: r.v_avg == null ? 0 : n })))
  close(incremental.d.map(({ n, ...r }) => ({ ...r, n: r.v_avg == null ? 0 : n })), full.d.map(({ n, ...r }) => ({ ...r, n: r.v_avg == null ? 0 : n })))
  const reset = await withOrg(orgId, async (c) => (await c.query("SELECT count(*)::int AS n FROM ems_readings WHERE channel_id = $1 AND delta_kind = 'reset'", [energy])).rows[0].n)
  assert.equal(reset, 1)
})
