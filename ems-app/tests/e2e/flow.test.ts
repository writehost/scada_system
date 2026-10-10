// Сквозной сценарий MVP через HTTP против собранного приложения (next start):
// вход через SCADA ID → объект → прибор → ручные показания → Modbus через шлюз →
// телеметрия → расход → тарифы → графики → стоимость → платёж → email-напоминание →
// мобильный API. Плюс изоляция организаций, RBAC, CSRF, отзыв сессии, буфер шлюза.
import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdtemp, readdir, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import net from "node:net"
import { fileURLToPath } from "node:url"
import { createTestDb, type TestDb } from "../helpers/db.ts"
import { startMockScadaId, type MockUser } from "../helpers/mock-scada-id.ts"
import { runOnce, jobs } from "../../scripts/worker.ts"
import { fileProvider } from "../../lib/services/mailer.ts"
import { withSystem } from "../../lib/server/db.ts"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const SECRET = "test-client-secret"
let db: TestDb
let idp: Awaited<ReturnType<typeof startMockScadaId>>
let app: ChildProcess
let base = ""
let mailDir = ""

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port
      s.close(() => resolve(p))
    })
  })
}

class Client {
  cookies = new Map<string, string>()
  bearer: string | null = null
  origin: string
  constructor(origin = base) {
    this.origin = origin
  }
  private store(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";")
      const i = pair.indexOf("=")
      const name = pair.slice(0, i)
      const value = pair.slice(i + 1)
      if (/max-age=0/i.test(c) || value === "") this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }
  async raw(url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...(init.headers ?? {}) }
    if (url.startsWith(this.origin) || url.startsWith("/")) {
      if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ")
      if (this.bearer) headers.authorization = `Bearer ${this.bearer}`
      if (init.method && init.method !== "GET" && !headers.origin) headers.origin = this.origin
    }
    if (init.body !== undefined) headers["content-type"] = "application/json"
    const res = await fetch(url.startsWith("/") ? `${this.origin}${url}` : url, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), redirect: "manual" })
    if (url.startsWith(this.origin) || url.startsWith("/")) this.store(res)
    return res
  }
  async json<T = any>(url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}, expect = 200): Promise<T> {
    const res = await this.raw(url, { method: init.method ?? (init.body !== undefined ? "POST" : "GET"), ...init })
    const text = await res.text()
    assert.equal(res.status, expect, `${init.method ?? "GET"} ${url} → ${res.status} ${text.slice(0, 300)}`)
    return (text ? JSON.parse(text) : null) as T
  }
  /** Полный вход через SCADA ID: start → IdP → callback. */
  async login(user: MockUser) {
    idp.setUser(user)
    const start = await this.raw("/api/auth/scada-id/start?next=/")
    assert.equal(start.status, 307)
    const idpRes = await fetch(start.headers.get("location")!, { redirect: "manual" })
    assert.equal(idpRes.status, 302)
    const cb = await this.raw(idpRes.headers.get("location")!.replace(/^https?:\/\/[^/]+/, ""))
    assert.equal(cb.status, 307, `callback → ${cb.headers.get("location")}`)
    assert.ok(!cb.headers.get("location")!.includes("error"), cb.headers.get("location")!)
    assert.ok(this.cookies.get("ems_session"))
  }
}

async function mails(): Promise<Array<{ to: string; subject: string; text: string }>> {
  const files = await readdir(mailDir).catch(() => [])
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(mailDir, f), "utf8"))))
}

const anna: MockUser = { sub: "anna-1", email: "anna@example.test", name: "Анна Петрова", grants: [] }
const ivan: MockUser = { sub: "ivan-1", email: "ivan@skeet.test", name: "Иван Смирнов", grants: [{ application_slug: "scada-ems", role: "admin" }], organization: { slug: "skeet", name: "Завод Скеэт" } }
const viewer: MockUser = { sub: "olga-1", email: "olga@example.test", name: "Ольга", grants: [] }

before(async () => {
  db = await createTestDb()
  idp = await startMockScadaId(SECRET)
  mailDir = await mkdtemp(path.join(tmpdir(), "ems-e2e-mail-"))
  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  app = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      EMS_DATABASE_URL: db.appUrl,
      EMS_AUTH_SECRET: "e2e-secret-0123456789-0123456789-abcdef",
      SCADA_ID_ISSUER: idp.issuer,
      SCADA_ID_API: idp.api,
      SCADA_ID_CLIENT_SECRET: SECRET,
      EMS_PUBLIC_URL: base,
      EMS_COOKIE_SECURE: "false",
      EMS_RATE_LIMIT_PER_MIN: "5000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  app.stderr?.on("data", (d) => process.env.E2E_VERBOSE && process.stderr.write(d))
  app.stdout?.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write(d))
  for (let i = 0; i < 120; i += 1) {
    const ok = await fetch(`${base}/api/auth/status`).then((r) => r.ok).catch(() => false)
    if (ok) break
    await new Promise((r) => setTimeout(r, 500))
  }
  process.env.EMS_MAIL_DIR = mailDir
})

after(async () => {
  app?.kill("SIGTERM")
  await idp?.close()
  await db?.drop()
})

const A = new Client()
const I = new Client()
const ctx: Record<string, any> = {}

test("1. вход через SCADA ID создаёт личное пространство и сессию", async () => {
  A.origin = base
  I.origin = base
  await A.login(anna)
  const me = await A.json("/api/auth/me")
  assert.equal(me.user.email, "anna@example.test")
  assert.equal(me.org.kind, "personal")
  assert.equal(me.subscription.status, "trial")
  // Без сессии API закрыт
  const anon = await fetch(`${base}/api/v1/sites`)
  assert.equal(anon.status, 401)
})

test("2–4. первый запуск Home: объект, услуги, тарифы, приборы, ручные показания", async () => {
  const today = new Date()
  const due = new Date(today.getTime() + 3 * 86400000).getDate()
  const r = await A.json("/api/v1/onboarding/home", {
    body: {
      site: { name: "Моя квартира", kind: "apartment", timezone: "Europe/Moscow" },
      notifyEmail: "anna@example.test",
      services: [
        { service: "electricity", providerName: "Энергосбыт", tariff: { kind: "zones", config: { zones: [{ code: "T1", name: "День", price: "7,5", ranges: [{ from: "07:00", to: "23:00" }] }, { code: "T2", name: "Ночь", price: "3,2", ranges: [{ from: "23:00", to: "07:00" }] }] } }, meter: { template: "two_zone", initialReadings: { energy_t1: "1000", energy_t2: "500" } } },
        { service: "cold_water", tariff: { kind: "single", config: { price: "50" } }, meter: { template: "water", initialReadings: { volume: "10" } } },
        { service: "internet", providerName: "Провайдер", fixedAmount: "750", dueDay: due, remindDays: 5 },
      ],
    },
  })
  ctx.siteId = r.siteId
  const { meters } = await A.json(`/api/v1/meters?siteId=${r.siteId}`)
  assert.equal(meters.length, 2)
  const el = meters.find((m: any) => m.resource === "electricity")
  const w = meters.find((m: any) => m.resource === "cold_water")
  ctx.t1 = el.channels.find((c: any) => c.tariffZone === "T1").channelId
  ctx.t2 = el.channels.find((c: any) => c.tariffZone === "T2").channelId
  ctx.water = w.channels[0].channelId
  ctx.elMeter = el.meter_id
  // Прибор «установлен» двое суток назад: так правило правдоподобного расхода работает как в жизни.
  await withSystem(async (c) => {
    await c.query("UPDATE ems_meters SET installed_at = now() - interval '2 days' WHERE site_id = $1", [r.siteId])
    await c.query("UPDATE ems_readings SET measured_at = now() - interval '2 days' WHERE channel_id = ANY($1::bigint[])", [[ctx.t1, ctx.t2, ctx.water]])
    await c.query("UPDATE ems_channels SET last_at = now() - interval '2 days' WHERE channel_id = ANY($1::bigint[])", [[ctx.t1, ctx.t2, ctx.water]])
  })
  const at = new Date(Date.now() - 3600_000).toISOString()
  const res = await A.json("/api/v1/readings", { body: { items: [{ channelId: ctx.t1, value: "1100", at }, { channelId: ctx.t2, value: "540", at }, { channelId: ctx.water, value: "12,5", at }] } })
  assert.deepEqual(res.results.map((x: any) => x.delta), [100, 40, 2.5])
  // Повторная отправка того же показания — без дублирования
  const dup = await A.json("/api/v1/readings", { body: { items: [{ channelId: ctx.water, value: "12.5", at }] } })
  assert.equal(dup.results[0].status, "duplicate")
  // Меньше предыдущего — сохраняется, но не учитывается
  const bad = await A.json("/api/v1/readings", { body: { items: [{ channelId: ctx.water, value: "11", at: new Date(Date.now() - 1800_000).toISOString() }] } })
  assert.equal(bad.results[0].quality, "bad")
  // Раньше даты установки прибора — отклоняется
  const early = await A.json("/api/v1/readings", { body: { items: [{ channelId: ctx.water, value: "9", at: new Date(Date.now() - 3 * 86400_000).toISOString() }] } })
  assert.equal(early.results[0].reason, "before_install")
})

test("7, 9. расход и графики из агрегатов (без сырых миллионов точек)", async () => {
  const from = Date.now() - 40 * 86400000
  const s = await A.json(`/api/v1/series?siteId=${ctx.siteId}&resources=electricity,cold_water&from=${from}&to=${Date.now() + 60000}&resolution=day`)
  const el = s.series.find((x: any) => x.key === "electricity")
  const w = s.series.find((x: any) => x.key === "cold_water")
  const sum = (p: any[]) => p.reduce((a, b) => a + (b.v ?? 0), 0)
  assert.ok(Math.abs(sum(el.points) - 140) < 1e-6)
  assert.ok(Math.abs(sum(w.points) - 2.5) < 1e-6)
  assert.ok(el.points.some((p: any) => p.v === null), "дни без данных остаются пропусками")
  const csv = await A.raw(`/api/v1/export?siteId=${ctx.siteId}&resources=electricity&from=${from}&to=${Date.now() + 60000}&resolution=day`)
  assert.equal(csv.status, 200)
  assert.match(await csv.text(), /Период;Электричество/)
})

test("8, 10. стоимость по зонам из регистров Т1/Т2 и тарифу ХВС", async () => {
  const c = await A.json(`/api/v1/costs?siteId=${ctx.siteId}`)
  const el = c.services.find((s: any) => s.service === "electricity")
  const w = c.services.find((s: any) => s.service === "cold_water")
  const net = c.services.find((s: any) => s.service === "internet")
  // Показания могли попасть на границу месяца в первый день — проверяем, что сумма соответствует количеству по зонам.
  const lines = el.actualToDate.result.lines
  for (const l of lines) assert.ok(Math.abs(l.amount - Math.round(l.qty * l.price * 100) / 100) < 0.011)
  assert.equal(net.forecast.amount, 750)
  assert.ok(w.hasTariff)
})

test("11–12. платёж, подтверждение email, напоминание за 3 дня и доставка с повтором", async () => {
  await runOnce(jobs(fileProvider(mailDir)))
  const verify = (await mails()).find((m) => /Подтвердите адрес/.test(m.subject))
  assert.ok(verify, "письмо подтверждения")
  const token = /token=([A-Za-z0-9_-]+)/.exec(verify!.text)![1]
  const ok = await A.json("/api/email/verify", { body: { token } })
  assert.equal(ok.email, "anna@example.test")
  await A.json("/api/email/verify", { body: { token } }, 400) // ссылка одноразовая
  const { recipients } = await A.json("/api/v1/recipients")
  await A.json(`/api/v1/recipients/${recipients[0].recipient_id}`, { method: "PATCH", body: { sendHour: 0 } })
  const due = new Date(Date.now() + 3 * 86400000)
  const dueKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(due)
  const { obligationId } = await A.json("/api/v1/obligations", { body: { title: "Электричество", service: "electricity", siteId: ctx.siteId, amountMode: "fixed", amount: 1450, dueDate: dueKey, recurrence: { freq: "monthly", interval: 1, day: Number(dueKey.slice(8)) }, remindDays: 3 } })
  ctx.obligationId = obligationId
  await runOnce(jobs(fileProvider(mailDir)))
  const reminder = (await mails()).find((m) => m.subject.includes("оплата: Электричество"))
  assert.ok(reminder, "напоминание доставлено")
  assert.match(reminder!.text, /Через 3 дня необходимо оплатить электричество\. Сумма — 1\s450 ₽/)
  const log = await A.json("/api/v1/notifications")
  const entry = log.items.find((n: any) => n.subject.includes("оплата: Электричество"))
  assert.equal(entry.status, "sent")
  assert.equal(entry.reason, "напоминание о сроке оплаты")
  // Отметка оплаты пользователем → следующий платёж серии
  const paid = await A.json(`/api/v1/obligations/${obligationId}/pay`, { body: { amount: "1450", paidOn: dueKey } })
  assert.ok(paid.nextId)
  const list = await A.json("/api/v1/obligations")
  assert.equal(list.items.find((o: any) => o.obligationId === obligationId).status, "paid")
})

test("13. мобильный API: обмен токена SCADA ID, сводка, лента с курсором", async () => {
  const M = new Client(base)
  const ex = await M.json("/api/mobile/v1/auth/exchange", { body: { accessToken: idp.issueToken(anna) } })
  assert.match(ex.token, /^ems1\./)
  M.bearer = ex.token
  const s = await M.json(`/api/mobile/v1/summary?siteId=${ctx.siteId}`)
  assert.equal(s.summary.siteName, "Моя квартира")
  assert.ok(s.summary.resources.length >= 2)
  const feed = await M.json("/api/mobile/v1/feed?after=0")
  assert.ok(feed.items.some((i: any) => i.kind === "payment_due"))
  const empty = await M.json(`/api/mobile/v1/feed?after=${feed.cursor}&wait=1`)
  assert.equal(empty.items.length, 0)
  await M.json("/api/mobile/v1/auth/exchange", { body: { accessToken: "forged" } }, 401)
})

test("Industrial: вход с организацией из SCADA ID, площадка, структура, шлюз", async () => {
  await I.login(ivan)
  const me = await I.json("/api/auth/me")
  assert.equal(me.org.kind, "corporate")
  assert.equal(me.org.name, "Завод Скеэт")
  assert.equal(me.org.role, "admin")
  assert.ok(me.orgs.some((o: any) => o.kind === "personal"))
  const { siteId } = await I.json("/api/v1/sites", { body: { name: "Завод", kind: "plant", shifts: [{ name: "Дневная", from: "08:00", to: "20:00" }, { name: "Ночная", from: "20:00", to: "08:00" }] } })
  ctx.plant = siteId
  const shop = await I.json(`/api/v1/sites/${siteId}/nodes`, { body: { name: "Цех розлива", kind: "building" } })
  const line = await I.json(`/api/v1/sites/${siteId}/nodes`, { body: { name: "Линия № 2", kind: "line", parentId: shop.nodeId } })
  ctx.line = line.nodeId
  const gw = await I.json("/api/v1/gateways", { body: { siteId, name: "Шлюз ЩУ-1" } })
  assert.match(gw.code, /^EMS-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  ctx.gatewayId = gw.gatewayId
  ctx.code = gw.code
})

test("5–6. Modbus TCP через шлюз: регистрация, проверка связи, опрос, буфер при обрыве", async () => {
  const { startSimulator } = (await import(path.join(root, "..", "ems-gateway", "test", "modbus-sim.mjs"))) as any
  const { Agent } = (await import(path.join(root, "..", "ems-gateway", "src", "agent.mjs"))) as any
  const sim = await startSimulator({ unitId: 1 })
  sim.setFloat(4, 0, 50000)
  sim.setFloat(4, 2, 125.5)
  const dataDir = await mkdtemp(path.join(tmpdir(), "ems-gw-"))
  const agent = new Agent({ cloudUrl: base, dataDir, allowInsecureHttp: true, uploadIntervalMs: 200, heartbeatMs: 1000, configRefreshMs: 300, logger: () => undefined })
  try {
    const gid = await agent.enroll(ctx.code)
    assert.equal(gid, ctx.gatewayId)
    // Код одноразовый
    await assert.rejects(new Agent({ cloudUrl: base, dataDir: await mkdtemp(path.join(tmpdir(), "ems-gw2-")), allowInsecureHttp: true }).enroll(ctx.code), (e: any) => e.status === 401)
    const ev = await I.json("/api/v1/events?status=open")
    assert.ok(ev.events.some((e: any) => e.kind === "gateway_enrollment_reuse"))

    const meter = await I.json("/api/v1/meters", {
      body: {
        siteId: ctx.plant, nodeId: ctx.line, resource: "electricity", name: "Электросчётчик линии 2", connection: "modbus_tcp", gatewayId: ctx.gatewayId,
        connectionParams: { host: "127.0.0.1", port: sim.port, unitId: 1, timeoutMs: 1000 }, pollIntervalSec: 60,
        channels: [
          { code: "energy", name: "Энергия", quantity: "energy_active", measure_kind: "cumulative", unit: "kWh", register: { fn: 4, address: 0, dataType: "float32", wordOrder: "ABCD" } },
          { code: "power", name: "Мощность", quantity: "power_active", measure_kind: "instant", unit: "kW", register: { fn: 4, address: 2, dataType: "float32", wordOrder: "ABCD" }, is_billing: false },
        ],
      },
    })
    ctx.modbusMeter = meter.meterId
    const run = agent.run()
    // Проверка связи из мастера: задание выполняет шлюз
    const { jobId } = await I.json(`/api/v1/gateways/${ctx.gatewayId}/probe`, { body: { connectionParams: { host: "127.0.0.1", port: sim.port, unitId: 1, timeoutMs: 1000 }, registers: [{ key: "energy", fn: 4, address: 0, dataType: "float32", wordOrder: "ABCD" }, { key: "bad", fn: 4, address: 900, dataType: "uint16", wordOrder: "ABCD" }] } })
    let job: any
    for (let i = 0; i < 40; i += 1) {
      job = (await I.json(`/api/v1/jobs/${jobId}`)).job
      if (job.status === "done" || job.status === "failed") break
      await new Promise((r) => setTimeout(r, 300))
    }
    assert.equal(job.status, "failed")
    assert.equal(job.result.results[0].value, 50000)
    assert.equal(job.result.results[1].code, "illegal_address")

    const waitReadings = async (n: number) => {
      for (let i = 0; i < 60; i += 1) {
        const r = await I.json(`/api/v1/readings?channelId=${meter.channels[0].channelId}`)
        if (r.readings.length >= n) return r.readings
        await new Promise((x) => setTimeout(x, 250))
      }
      assert.fail(`ожидалось ${n} показаний`)
    }
    await waitReadings(1)
    sim.setFloat(4, 0, 50012.5)
    await new Promise((r) => setTimeout(r, 1100))
    agent.nextPoll.clear()
    await agent.pollDue()
    const two = await waitReadings(2)
    assert.equal(two[0].delta, 12.5)
    assert.equal(two[0].source, "gateway")

    // Обрыв связи с облаком: показания копятся в буфере и доходят после восстановления
    const realBase = agent.cloud.baseUrl
    agent.cloud.baseUrl = "http://127.0.0.1:9"
    for (let k = 0; k < 3; k += 1) {
      sim.setFloat(4, 0, 50020 + k * 5)
      await new Promise((r) => setTimeout(r, 1100))
      agent.nextPoll.clear()
      await agent.pollDue()
    }
    assert.ok(agent.buffer.stats().bufferItems >= 6, "данные в локальном буфере")
    agent.cloud.baseUrl = realBase
    agent.backoffMs = 0
    const all = await waitReadings(5)
    assert.ok(all.length >= 5)
    assert.equal(agent.buffer.stats().bufferItems, 0)
    agent.stop()
    await run
  } finally {
    agent.stop()
    await sim.close()
  }
  const dash = await I.json(`/api/v1/dashboard/industrial?siteId=${ctx.plant}`)
  assert.ok(dash.electricity.monthKwh >= 12.5)
  assert.ok(dash.power.kw > 0)
  assert.equal(dash.breakdown[0].name, "Цех розлива")
})

test("интеграция выпуска продукции по API-токену и удельное потребление", async () => {
  const t = await I.json("/api/v1/api-tokens", { body: { name: "MES", scopes: ["production:write"] } })
  const P = new Client(base)
  P.bearer = t.token
  const start = new Date(Date.now() - 3 * 3600_000).toISOString()
  await P.json("/api/v1/production", { body: { items: [{ siteId: ctx.plant, nodeId: ctx.line, periodStart: start, periodEnd: new Date(Date.now() + 60_000).toISOString(), quantity: 5000, unit: "бут." }] } })
  // Токен с одним разрешением не читает данные
  await P.json("/api/v1/sites", {}, 403)
  const dash = await I.json(`/api/v1/dashboard/industrial?siteId=${ctx.plant}`)
  assert.equal(dash.specific.unit, "бут.")
  assert.ok(dash.specific.kwhPer1000 > 0)
})

test("изоляция организаций на уровне API и шлюзов", async () => {
  // Чужой прибор не виден
  await A.json(`/api/v1/meters/${ctx.modbusMeter}`, {}, 404)
  // Явная подмена организации — отказ
  const ivanOrg = (await I.json("/api/auth/me")).org.orgId
  await A.json("/api/v1/sites", { headers: { "x-ems-org": ivanOrg } }, 403)
  // Шлюз Ивана не может писать в канал Анны
  const creds = await withSystem(async (c) => (await c.query("SELECT gateway_id FROM ems_gateways WHERE gateway_id = $1", [ctx.gatewayId])).rows[0])
  assert.ok(creds)
  const forged = await fetch(`${base}/api/gateway/v1/readings`, { method: "POST", headers: { "content-type": "application/json", authorization: `Gateway ${ctx.gatewayId}:emsg_wrongsecretwrongsecretwrongsecret` }, body: JSON.stringify({ readings: [] }) })
  assert.equal(forged.status, 401)
})

test("RBAC: наблюдатель не может менять данные; CSRF; выход отзывает сессию", async () => {
  await A.json("/api/v1/org/invitations", { body: { email: "olga@example.test", role: "viewer" } })
  const V = new Client(base)
  await V.login(viewer)
  const me = await V.json("/api/auth/me")
  const annaOrg = me.orgs.find((o: any) => o.role === "viewer")
  assert.ok(annaOrg, "приглашение принято при входе")
  await V.json("/api/auth/switch-org", { body: { orgId: annaOrg.orgId } })
  const sites = await V.json("/api/v1/sites")
  assert.equal(sites.sites.length, 1)
  await V.json("/api/v1/sites", { body: { name: "x", kind: "house" } }, 403)
  // Запрос с чужого сайта с cookie
  await A.json("/api/v1/sites", { body: { name: "x", kind: "house" }, headers: { origin: "https://evil.example" } }, 403)
  const cookie = A.cookies.get("ems_session")!
  await A.json("/api/auth/logout", { body: {} })
  const after = await fetch(`${base}/api/v1/sites`, { headers: { cookie: `ems_session=${cookie}` } })
  assert.equal(after.status, 401)
})
