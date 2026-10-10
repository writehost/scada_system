// Фоновый обработчик SCADA EMS. Запуск: node scripts/worker.ts [--once]
// Каждая задача защищена advisory lock: несколько экземпляров не выполняют её одновременно.
// Ошибка в одной организации не останавливает обработку остальных.

import path from "node:path"
import { fileURLToPath } from "node:url"
import { closePool, getPool, withOrg, withSystem } from "../lib/server/db.ts"
import { checkTelemetry, evaluateRules, refreshSubscription, sendReminders, type MonitorStats } from "../lib/services/monitor.ts"
import { configuredProvider, deliverQueued, type MailProvider } from "../lib/services/mailer.ts"

type Job = { name: string; everySec: number; run: () => Promise<Record<string, unknown>> }

async function orgIds(): Promise<string[]> {
  return withSystem(async (c) => (await c.query<{ org_id: string }>("SELECT org_id FROM ems_organizations WHERE archived_at IS NULL")).rows.map((r) => r.org_id))
}

async function perOrg(fn: (orgId: string) => Promise<void>): Promise<{ orgs: number; errors: number }> {
  let errors = 0
  const ids = await orgIds()
  for (const id of ids) {
    try {
      await fn(id)
    } catch (err) {
      errors += 1
      console.error(`[ems-worker] org ${id}:`, (err as Error).message)
    }
  }
  return { orgs: ids.length, errors }
}

export function jobs(provider: MailProvider | null = configuredProvider()): Job[] {
  return [
    {
      name: "monitor",
      everySec: 60,
      run: async () => {
        const stats: MonitorStats = { rules: 0, raised: 0, resolved: 0 }
        const r = await perOrg(async (orgId) => {
          await withOrg(orgId, async (c) => {
            await checkTelemetry(c, orgId, stats)
            await evaluateRules(c, orgId, stats)
          })
        })
        return { ...r, ...stats }
      },
    },
    {
      name: "reminders",
      everySec: 600,
      run: async () => {
        let sent = 0
        const r = await perOrg(async (orgId) => {
          sent += await withOrg(orgId, (c) => sendReminders(c, orgId))
        })
        return { ...r, reminders: sent }
      },
    },
    { name: "mail", everySec: 30, run: async () => (provider ? deliverQueued(provider) : { provider: "not_configured" }) },
    {
      name: "maintenance",
      everySec: 3600,
      run: async () =>
        withSystem(async (c) => {
          await c.query(`SELECT ems_ensure_month_partition(t, (date_trunc('month', now()) + make_interval(months => m))::date)
                           FROM unnest(ARRAY['ems_readings','ems_agg_hourly']) t, generate_series(0, 3) m`)
          const sessions = await c.query("DELETE FROM ems_sessions WHERE expires_at < now() - interval '30 days' OR revoked_at < now() - interval '30 days'")
          const logs = await c.query("DELETE FROM ems_connection_log WHERE created_at < now() - interval '90 days'")
          const jobs = await c.query("UPDATE ems_gateway_jobs SET status = 'expired', finished_at = now() WHERE status IN ('queued','running') AND created_at < now() - interval '15 minutes'")
          const enroll = await c.query("DELETE FROM ems_gateway_enrollments WHERE used_at IS NULL AND expires_at < now() - interval '7 days'")
          const subs = await orgIds()
          for (const id of subs) await withOrg(id, (o) => refreshSubscription(o, id)).catch((e) => console.error("[ems-worker] subscription", e.message))
          return { sessions: sessions.rowCount, logs: logs.rowCount, jobsExpired: jobs.rowCount, enrollments: enroll.rowCount }
        }),
    },
  ]
}

const LOCK_BASE = 74_350_000

async function runJob(job: Job, index: number): Promise<void> {
  const client = await getPool().connect()
  try {
    const lock = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_BASE + index])
    if (!lock.rows[0].ok) return
    const started = Date.now()
    await client.query(
      `INSERT INTO ems_worker_runs (job, last_started_at, runs) VALUES ($1, now(), 1) ON CONFLICT (job) DO UPDATE SET last_started_at = now(), runs = ems_worker_runs.runs + 1`,
      [job.name],
    )
    try {
      const stats = await job.run()
      await client.query(
        "UPDATE ems_worker_runs SET last_finished_at = now(), last_ok_at = now(), last_error = NULL, last_duration_ms = $2, last_stats = $3::jsonb WHERE job = $1",
        [job.name, Date.now() - started, JSON.stringify(stats)],
      )
    } catch (err) {
      console.error(`[ems-worker] ${job.name}:`, err)
      await client.query("UPDATE ems_worker_runs SET last_finished_at = now(), last_error = $2, last_duration_ms = $3, failures = failures + 1 WHERE job = $1", [job.name, String((err as Error).message).slice(0, 500), Date.now() - started])
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK_BASE + index])
    }
  } finally {
    client.release()
  }
}

export async function runOnce(list = jobs()): Promise<void> {
  for (let i = 0; i < list.length; i += 1) await runJob(list[i], i)
}

async function main() {
  const once = process.argv.includes("--once")
  const list = jobs()
  if (!configuredProvider()) console.warn("[ems-worker] почта не настроена (EMS_MAIL_PROVIDER): письма остаются в очереди")
  if (once) {
    await runOnce(list)
    await closePool()
    return
  }
  const last = new Map<string, number>()
  let stopping = false
  const stop = () => {
    stopping = true
  }
  process.on("SIGTERM", stop)
  process.on("SIGINT", stop)
  console.log("[ems-worker] started")
  while (!stopping) {
    for (let i = 0; i < list.length && !stopping; i += 1) {
      const j = list[i]
      if (Date.now() - (last.get(j.name) ?? 0) >= j.everySec * 1000) {
        last.set(j.name, Date.now())
        await runJob(j, i).catch((e) => console.error("[ems-worker]", e))
      }
    }
    await new Promise((r) => setTimeout(r, 5000))
  }
  await closePool()
  console.log("[ems-worker] stopped")
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
