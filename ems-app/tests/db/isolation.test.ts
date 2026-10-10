// Изоляция организаций на уровне БД: даже запрос без фильтра по org_id
// не видит и не может изменить данные другой организации.
import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { createTestDb, makeOrg, type TestDb } from "../helpers/db.ts"
import { withOrg, withSystem } from "../../lib/server/db.ts"
import { createMeter, createSite } from "../../lib/services/assets.ts"
import { ingestReadings } from "../../lib/services/ingest.ts"
import { createObligation } from "../../lib/services/finance.ts"

let db: TestDb
let a: { orgId: string; userId: string }
let b: { orgId: string; userId: string }
let bChannel: number

before(async () => {
  db = await createTestDb()
  a = await makeOrg({ name: "A" })
  b = await makeOrg({ name: "B" })
  for (const o of [a, b]) {
    const siteId = await withOrg(o.orgId, (c) => createSite(c, o.orgId, { kind: "user", id: o.userId }, { name: `Объект ${o.orgId.slice(0, 4)}`, kind: "apartment" }))
    const m = await withOrg(o.orgId, (c) => createMeter(c, o.orgId, { kind: "user", id: o.userId }, { siteId, resource: "electricity", name: "Счётчик", connection: "manual", installedAt: Date.now() - 86400000, channels: [{ code: "energy", name: "E", quantity: "energy_active", measure_kind: "cumulative", unit: "kWh" }] }))
    await withOrg(o.orgId, (c) => ingestReadings(c, o.orgId, [{ channelId: m.channels[0].channelId, at: Date.now() - 3600000, raw: 100, source: "manual" }]))
    await withOrg(o.orgId, (c) => createObligation(c, o.orgId, { kind: "user", id: o.userId }, { siteId, title: "Интернет", service: "internet", amountMode: "fixed", amount: 500, dueDate: "2026-12-01" }))
    if (o === b) bChannel = m.channels[0].channelId
  }
})
after(async () => db?.drop())

const TABLES = ["ems_sites", "ems_meters", "ems_channels", "ems_readings", "ems_agg_daily", "ems_obligations", "ems_subscriptions", "ems_memberships", "ems_audit_log"]

test("unfiltered SELECT returns only own rows for every tenant table", async () => {
  for (const t of TABLES.filter((x) => x !== "ems_audit_log")) {
    const rows = await withOrg(a.orgId, async (c) => (await c.query(`SELECT DISTINCT org_id FROM ${t}`)).rows)
    assert.ok(rows.every((r) => r.org_id === a.orgId), `${t} leaks`)
    if (t !== "ems_agg_daily") assert.equal(rows.length, 1, `${t} has own rows`)
  }
})

test("cannot insert or update rows of another organization", async () => {
  await assert.rejects(withOrg(a.orgId, (c) => c.query("INSERT INTO ems_sites (org_id, name, kind) VALUES ($1, 'чужой', 'house')", [b.orgId])), /row-level security/)
  const upd = await withOrg(a.orgId, (c) => c.query("UPDATE ems_obligations SET amount = 1 WHERE org_id = $1", [b.orgId]))
  assert.equal(upd.rowCount, 0)
  const del = await withOrg(a.orgId, (c) => c.query("DELETE FROM ems_readings WHERE channel_id = $1", [bChannel]))
  assert.equal(del.rowCount, 0)
})

test("ingest into a foreign channel is rejected as unknown", async () => {
  const r = await withOrg(a.orgId, (c) => ingestReadings(c, a.orgId, [{ channelId: bChannel, at: Date.now(), raw: 200, source: "manual" }]))
  assert.equal(r[0].status, "rejected")
  assert.equal(r[0].reason, "unknown_channel")
  const count = await withSystem(async (c) => (await c.query("SELECT count(*)::int AS n FROM ems_readings WHERE channel_id = $1", [bChannel])).rows[0].n)
  assert.equal(count, 1)
})

test("without org context nothing is visible", async () => {
  const pool = (await import("../../lib/server/db.ts")).getPool()
  const r = await pool.query("SELECT count(*)::int AS n FROM ems_sites")
  assert.equal(r.rows[0].n, 0)
})

test("system scope (auth, background jobs) sees all tenants explicitly", async () => {
  const n = await withSystem(async (c) => (await c.query("SELECT count(DISTINCT org_id)::int AS n FROM ems_sites")).rows[0].n)
  assert.equal(n, 2)
})
