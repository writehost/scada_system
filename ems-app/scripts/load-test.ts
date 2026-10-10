// Нагрузочный тест приёма телеметрии и запросов графиков.
// Запуск: EMS_DATABASE_URL=… node scripts/load-test.ts [каналов] [показаний на канал] [размер пакета]
// Моделирует шлюзы: пакеты по N показаний, интервал 15 мин, через тот же сервис, что и API.
import { performance } from "node:perf_hooks"
import { closePool, withOrg, withSystem } from "../lib/server/db.ts"
import { createOrganization, upsertUser } from "../lib/services/org.ts"
import { createMeter, createSite } from "../lib/services/assets.ts"
import { ingestReadings, type IngestItem } from "../lib/services/ingest.ts"
import { consumptionSeries } from "../lib/services/analytics.ts"

const channelsN = Number(process.argv[2] ?? 200)
const perChannel = Number(process.argv[3] ?? 96 * 30)
const batch = Number(process.argv[4] ?? 500)
const STEP = 15 * 60_000

const { orgId, userId } = await withSystem(async (c) => {
  const { userId } = await upsertUser(c, { subject: `load-${Date.now()}`, email: "load@example.test", name: "Нагрузка", isPlatformAdmin: false })
  const orgId = await createOrganization(c, { name: "Нагрузочный тест", kind: "corporate", segment: "industrial", ownerUserId: userId })
  await c.query("UPDATE ems_subscriptions SET plan_code = 'ind_enterprise' WHERE org_id = $1", [orgId])
  return { orgId, userId }
})
const actor = { kind: "user" as const, id: userId }
const start = Date.now() - perChannel * STEP
const siteId = await withOrg(orgId, (c) => createSite(c, orgId, actor, { name: "Площадка", kind: "plant" }))
const channels: number[] = []
for (let i = 0; i < channelsN; i += 1) {
  const m = await withOrg(orgId, (c) =>
    createMeter(c, orgId, actor, { siteId, resource: "electricity", name: `Счётчик ${i}`, connection: "manual", installedAt: start - STEP, channels: [{ code: "energy", name: "E", quantity: "energy_active", measure_kind: "cumulative", unit: "kWh" }] }),
  )
  channels.push(m.channels[0].channelId)
}
console.log(`каналов: ${channelsN}, показаний на канал: ${perChannel}, всего: ${channelsN * perChannel}, пакет: ${batch}`)

// Поток как от шлюзов: в каждый момент времени — показания всех каналов.
const values = new Map(channels.map((c) => [c, 10000]))
let pending: IngestItem[] = []
let total = 0
const batchTimes: number[] = []
const t0 = performance.now()
const flush = async () => {
  if (!pending.length) return
  const b = pending
  pending = []
  const s = performance.now()
  await withOrg(orgId, (c) => ingestReadings(c, orgId, b, { receivedAt: Date.now() }))
  batchTimes.push(performance.now() - s)
  total += b.length
}
for (let k = 0; k < perChannel; k += 1) {
  const at = start + k * STEP
  for (const ch of channels) {
    const v = values.get(ch)! + Math.random() * 2
    values.set(ch, v)
    pending.push({ channelId: ch, at, raw: v, source: "gateway" })
    if (pending.length >= batch) await flush()
  }
}
await flush()
const sec = (performance.now() - t0) / 1000
batchTimes.sort((a, b) => a - b)
const p = (q: number) => batchTimes[Math.min(batchTimes.length - 1, Math.floor(q * batchTimes.length))].toFixed(0)
console.log(`приём: ${total} показаний за ${sec.toFixed(1)} с → ${(total / sec).toFixed(0)} показаний/с; пакет p50 ${p(0.5)} мс, p95 ${p(0.95)} мс, max ${p(0.999)} мс`)

// Повторная доставка (идемпотентность): те же значения ещё раз и другое значение на то же время.
const sameRows = await withOrg(orgId, async (c) =>
  (await c.query("SELECT channel_id, raw_value FROM ems_readings WHERE channel_id = ANY($1) AND measured_at = $2", [channels.slice(0, 50), new Date(start + 5 * STEP)])).rows,
)
const dupStart = performance.now()
const dup = await withOrg(orgId, (c) => ingestReadings(c, orgId, sameRows.map((r) => ({ channelId: r.channel_id, at: start + 5 * STEP, raw: r.raw_value, source: "gateway" as const }))))
console.log(`повторная доставка 50 показаний: ${(performance.now() - dupStart).toFixed(0)} мс, статусы: ${[...new Set(dup.map((d) => d.status))].join(",")}`)
const conflict = await withOrg(orgId, (c) => ingestReadings(c, orgId, [{ channelId: channels[0], at: start + 5 * STEP, raw: 1, source: "gateway" }]))
console.log(`другое значение на то же время: ${conflict[0].status}`)

// Сверка: приращения агрегатов совпадают с суммой интервалов показаний.
const check = await withOrg(orgId, async (c) =>
  (await c.query(`SELECT (SELECT sum(delta) FROM ems_readings WHERE org_id = $1 AND quality <> 'bad' AND delta IS NOT NULL) AS readings,
                         (SELECT sum(delta) FROM ems_agg_hourly WHERE org_id = $1) AS hourly,
                         (SELECT sum(delta) FROM ems_agg_daily WHERE org_id = $1) AS daily`, [orgId])).rows[0],
)
console.log(`сверка потребления: показания ${check.readings.toFixed(3)}, часовые ${check.hourly.toFixed(3)}, суточные ${check.daily.toFixed(3)}`)

// Запросы графиков
const end = start + perChannel * STEP
for (const [label, ids, res, from] of [
  ["1 канал, месяц по дням", channels.slice(0, 1), "day", end - 30 * 86400_000],
  ["1 канал, неделя по часам", channels.slice(0, 1), "hour", end - 7 * 86400_000],
  ["все каналы площадки, месяц по дням", channels, "day", end - 30 * 86400_000],
  ["все каналы площадки, 2 суток по часам", channels, "hour", end - 2 * 86400_000],
] as const) {
  const runs: number[] = []
  for (let i = 0; i < 5; i += 1) {
    const s = performance.now()
    await withOrg(orgId, (c) => consumptionSeries(c, [...ids], "Europe/Moscow", from, end, res))
    runs.push(performance.now() - s)
  }
  runs.sort((a, b) => a - b)
  console.log(`график «${label}»: медиана ${runs[2].toFixed(0)} мс`)
}

const size = await withSystem(async (c) =>
  (await c.query(`SELECT (SELECT COALESCE(sum(pg_total_relation_size(inhrelid)),0) FROM pg_inherits WHERE inhparent = 'ems_readings'::regclass) AS readings,
                        (SELECT COALESCE(sum(pg_total_relation_size(inhrelid)),0) FROM pg_inherits WHERE inhparent = 'ems_agg_hourly'::regclass) AS hourly,
                        pg_total_relation_size('ems_agg_daily') AS daily`)).rows[0],
)
const perReading = Number(size.readings) / total
console.log(`хранение: показания ${(Number(size.readings) / 1048576).toFixed(1)} МБ (${perReading.toFixed(0)} байт/показание), часовые ${(Number(size.hourly) / 1048576).toFixed(1)} МБ, суточные ${(Number(size.daily) / 1048576).toFixed(1)} МБ`)
console.log(`оценка на прибор Home (1 канал, раз в 15 мин, год): ${((perReading * 96 * 365) / 1048576).toFixed(1)} МБ`)
await closePool()
