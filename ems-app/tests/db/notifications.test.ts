import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { mkdtemp, readdir, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createTestDb, makeOrg, type TestDb } from "../helpers/db.ts"
import { withOrg, withSystem } from "../../lib/server/db.ts"
import { createMeter, createSite } from "../../lib/services/assets.ts"
import { ingestReadings } from "../../lib/services/ingest.ts"
import { addRecipient, verifyEmailToken } from "../../lib/services/recipients.ts"
import { createObligation } from "../../lib/services/finance.ts"
import { createRule } from "../../lib/services/rules.ts"
import { checkTelemetry, evaluateRules, sendReminders } from "../../lib/services/monitor.ts"
import { deliverQueued, fileProvider, type MailProvider } from "../../lib/services/mailer.ts"
import { localDateKey, addDays, floorHour } from "../../lib/domain/time.ts"

let db: TestDb
let orgId: string
let userId: string
let siteId: string
let mailDir: string
const actor = () => ({ kind: "user" as const, id: userId })
const H = 3_600_000

before(async () => {
  db = await createTestDb()
  ;({ orgId, userId } = await makeOrg())
  siteId = await withOrg(orgId, (c) => createSite(c, orgId, actor(), { name: "Дом", kind: "house" }))
  mailDir = await mkdtemp(path.join(tmpdir(), "ems-mail-"))
})
after(async () => db?.drop())

async function mails(): Promise<Array<{ to: string; subject: string; text: string }>> {
  const files = await readdir(mailDir)
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(mailDir, f), "utf8"))))
}

test("unverified address gets only the verification letter; link is single-use", async () => {
  const rid = await withOrg(orgId, (c) => addRecipient(c, orgId, actor(), { email: "owner@example.test" }))
  await deliverQueued(fileProvider(mailDir))
  const m = await mails()
  assert.equal(m.length, 1)
  assert.match(m[0].subject, /Подтвердите адрес/)
  const token = /token=([A-Za-z0-9_-]+)/.exec(m[0].text)![1]
  assert.deepEqual(await withSystem((c) => verifyEmailToken(c, token)), { email: "owner@example.test" })
  assert.equal(await withSystem((c) => verifyEmailToken(c, token)), null)
  const row = await withOrg(orgId, async (c) => (await c.query("SELECT verified_at FROM ems_email_recipients WHERE recipient_id = $1", [rid])).rows[0])
  assert.ok(row.verified_at)
})

test("payment reminder: 3 days before due, amount in text, sent once", async () => {
  const today = localDateKey(Date.now(), "Europe/Moscow")
  await withOrg(orgId, (c) => createObligation(c, orgId, actor(), { siteId, title: "Электричество", service: "electricity", amountMode: "fixed", amount: 1450, dueDate: addDays(today, 3), recurrence: { freq: "monthly", interval: 1, day: 10 }, remindDays: 3 }))
  const n1 = await withOrg(orgId, (c) => sendReminders(c, orgId))
  const n2 = await withOrg(orgId, (c) => sendReminders(c, orgId))
  assert.equal(n1, 1)
  assert.equal(n2, 0)
  // Письмо ждёт часа отправки получателя (9:00) — переносим время для проверки доставки.
  await withSystem((c) => c.query("UPDATE ems_notifications SET next_attempt_at = now() WHERE status = 'queued'"))
  await deliverQueued(fileProvider(mailDir))
  const m = (await mails()).find((x) => /оплата/i.test(x.subject))!
  assert.ok(m, "reminder delivered")
  assert.match(m.text, /Через 3 дня необходимо оплатить электричество\. Сумма — 1\s450 ₽/)
  const log = await withOrg(orgId, async (c) => (await c.query("SELECT reason, status, sent_at, ref_type FROM ems_notifications WHERE kind = 'payment_due'")).rows[0])
  assert.equal(log.status, "sent")
  assert.equal(log.ref_type, "obligation")
  assert.equal(log.reason, "напоминание о сроке оплаты")
})

test("failed delivery is retried with backoff and keeps the error", async () => {
  let calls = 0
  const flaky: MailProvider = { name: "flaky", send: async () => { calls += 1; throw new Error("SMTP 451 temporary") } }
  await withOrg(orgId, (c) => c.query(
    `INSERT INTO ems_notifications (org_id, recipient, kind, subject, body_text, reason, dedup_key) VALUES ($1, 'owner@example.test', 'anomaly', 'Тест', 'Тест', 'тест', 'retry-test')`, [orgId]))
  const r = await deliverQueued(flaky)
  assert.equal(r.failed, 1)
  const row = await withOrg(orgId, async (c) => (await c.query("SELECT status, attempts, last_error, next_attempt_at FROM ems_notifications WHERE dedup_key = 'retry-test'")).rows[0])
  assert.equal(row.status, "failed")
  assert.equal(row.attempts, 1)
  assert.match(row.last_error, /451/)
  assert.ok(new Date(row.next_attempt_at).getTime() > Date.now() + 30_000)
  await withSystem((c) => c.query("UPDATE ems_notifications SET next_attempt_at = now() WHERE dedup_key = 'retry-test'"))
  await deliverQueued(fileProvider(mailDir))
  const ok = await withOrg(orgId, async (c) => (await c.query("SELECT status, attempts FROM ems_notifications WHERE dedup_key = 'retry-test'")).rows[0])
  assert.deepEqual(ok, { status: "sent", attempts: 2 })
  assert.equal(calls, 1)
})

test("continuous water flow raises a leak event once and notifies; resolves when flow stops", async () => {
  const meter = await withOrg(orgId, (c) => createMeter(c, orgId, actor(), {
    siteId, resource: "cold_water", name: "Водосчётчик с импульсным выходом", connection: "http_push", installedAt: Date.now() - 3 * 86400000,
    channels: [{ code: "volume", name: "Объём", quantity: "volume", measure_kind: "cumulative", unit: "m3" }],
  }))
  const ch = meter.channels[0].channelId
  await withOrg(orgId, (c) => createRule(c, orgId, actor(), { kind: "continuous_flow", siteId, params: { resource: "cold_water", minPerHour: 0.005, hours: 6 } }))
  const now = floorHour(Date.now())
  const items: Array<{ channelId: number; at: number; raw: number; source: "http_push" }> = []
  for (let i = 10; i >= 0; i -= 1) items.push({ channelId: ch, at: now - i * H, raw: 100 + (10 - i) * 0.02, source: "http_push" as const })
  await withOrg(orgId, (c) => ingestReadings(c, orgId, items))
  const stats = { rules: 0, raised: 0, resolved: 0 }
  await withOrg(orgId, (c) => evaluateRules(c, orgId, stats))
  assert.equal(stats.raised, 1)
  const ev = await withOrg(orgId, async (c) => (await c.query("SELECT category, severity, message, notified_at FROM ems_events WHERE kind = 'continuous_flow'")).rows[0])
  assert.equal(ev.category, "leak")
  assert.equal(ev.severity, "critical")
  assert.match(ev.message, /непрерывный расход воды в течение 10 ч/)
  assert.ok(ev.notified_at)
  const queued = await withOrg(orgId, async (c) => (await c.query("SELECT count(*)::int AS n FROM ems_notifications WHERE kind = 'leak'")).rows[0].n)
  assert.equal(queued, 1)
  const feed = await withOrg(orgId, async (c) => (await c.query("SELECT count(*)::int AS n FROM ems_feed WHERE kind = 'leak'")).rows[0].n)
  assert.equal(feed, 1)
  // Повторная проверка: событие не дублируется, письмо не повторяется (подавление).
  await withOrg(orgId, (c) => c.query("UPDATE ems_alert_rules SET last_evaluated_at = NULL"))
  await withOrg(orgId, (c) => evaluateRules(c, orgId, stats))
  const again = await withOrg(orgId, async (c) => (await c.query("SELECT count(*)::int AS n, max(occurrences) AS occ FROM ems_events WHERE kind = 'continuous_flow'")).rows[0])
  assert.equal(again.n, 1)
  assert.equal(again.occ, 2)
  // Расход прекратился: два часа без расхода
  await withOrg(orgId, (c) => ingestReadings(c, orgId, [{ channelId: ch, at: now + H, raw: 100.2, source: "http_push" }, { channelId: ch, at: now + 2 * H - 1000, raw: 100.2, source: "http_push" }]))
  await withOrg(orgId, (c) => c.query("UPDATE ems_alert_rules SET last_evaluated_at = NULL"))
  // continuous_flow смотрит на завершённые часы до текущего; сдвигаем «сейчас» вперёд
  await withOrg(orgId, (c) => evaluateRules(c, orgId, stats, now + 3 * H))
  const st = await withOrg(orgId, async (c) => (await c.query("SELECT status FROM ems_events WHERE kind = 'continuous_flow'")).rows[0].status)
  assert.equal(st, "resolved")
})

test("telemetry loss is detected for automatic meters only", async () => {
  await withOrg(orgId, (c) => c.query("UPDATE ems_channels SET last_at = now() - interval '5 hours'"))
  const stats = { rules: 0, raised: 0, resolved: 0 }
  await withOrg(orgId, (c) => checkTelemetry(c, orgId, stats))
  const ev = await withOrg(orgId, async (c) => (await c.query("SELECT title, message FROM ems_events WHERE kind = 'telemetry_lost'")).rows)
  assert.equal(ev.length, 1)
  assert.match(ev[0].message, /более 5 ч/)
})
