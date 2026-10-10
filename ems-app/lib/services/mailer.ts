// Доставка писем из очереди ems_notifications.
// Провайдер по умолчанию — существующий почтовый помощник WMS (/usr/local/bin/wms-send-mail.py,
// переменная WMS_SEND_MAIL_BIN): тот же формат JSON, что у писем о просрочке на складе.
// Для разработки и тестов — провайдер file (письма пишутся в каталог).

import { spawn } from "node:child_process"
import { access, mkdir, unlink, writeFile } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Db } from "../server/db.ts"
import { enterOrg, withSystem } from "../server/db.ts"
import { raiseEvent } from "./events.ts"

export type Mail = { to: string; subject: string; text: string; html: string | null }

export type MailProvider = { name: string; send: (mail: Mail) => Promise<void> }

const DEFAULT_HELPER = "/usr/local/bin/wms-send-mail.py"

function runHelper(helper: string, payloadPath: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [helper, payloadPath], { stdio: ["ignore", "pipe", "pipe"], env: process.env })
    let out = ""
    child.stdout.on("data", (d) => (out += String(d)))
    child.stderr.on("data", (d) => (out += String(d)))
    child.on("error", reject)
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000)
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, out })
    })
  })
}

export function helperProvider(helper = process.env.EMS_SEND_MAIL_BIN || process.env.WMS_SEND_MAIL_BIN || DEFAULT_HELPER): MailProvider {
  return {
    name: "helper",
    async send(mail) {
      await access(helper, fsConstants.R_OK).catch(() => {
        throw new Error(`Почтовый помощник не установлен: ${helper}`)
      })
      const file = path.join(tmpdir(), `ems-mail-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
      await writeFile(file, JSON.stringify({ subject: mail.subject, text: mail.text, html: mail.html, recipients: [mail.to], fromName: "SCADA EMS" }), { encoding: "utf8", mode: 0o600 })
      try {
        const r = await runHelper(helper, file)
        if (r.code !== 0) throw new Error((r.out || `mail helper exit ${r.code}`).trim().slice(0, 500))
      } finally {
        await unlink(file).catch(() => undefined)
      }
    },
  }
}

export function fileProvider(dir = process.env.EMS_MAIL_DIR || path.join(process.cwd(), "var", "mail")): MailProvider {
  return {
    name: "file",
    async send(mail) {
      await mkdir(dir, { recursive: true })
      if (/fail/i.test(mail.to) && process.env.EMS_MAIL_FILE_FAIL_PATTERN === "1") throw new Error("simulated delivery failure")
      const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.json`
      await writeFile(path.join(dir, name), JSON.stringify(mail, null, 2), "utf8")
    },
  }
}

export function configuredProvider(): MailProvider | null {
  const p = (process.env.EMS_MAIL_PROVIDER || "helper").trim()
  if (p === "file") return fileProvider()
  if (p === "helper") return helperProvider()
  return null
}

/** Паузы между попытками: 1, 5, 15 минут, 1 и 3 часа; после шестой — окончательная ошибка. */
export const RETRY_MINUTES = [1, 5, 15, 60, 180]
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1

export async function deliverQueued(provider: MailProvider | null, opts: { batch?: number } = {}): Promise<{ sent: number; failed: number; skipped: number }> {
  const stats = { sent: 0, failed: 0, skipped: 0 }
  if (!provider) return stats
  // Восстановление после сбоя: «зависшие» в отправке возвращаются в очередь.
  await withSystem((c) => c.query("UPDATE ems_notifications SET status = 'queued' WHERE status = 'sending' AND next_attempt_at < now() - interval '10 minutes'"))
  const claimed = await withSystem(async (c) =>
    (await c.query(
      `UPDATE ems_notifications SET status = 'sending', attempts = attempts + 1, next_attempt_at = now()
        WHERE notification_id IN (SELECT notification_id FROM ems_notifications WHERE status IN ('queued','failed') AND next_attempt_at <= now() AND attempts < $1
                                  ORDER BY next_attempt_at LIMIT $2 FOR UPDATE SKIP LOCKED)
        RETURNING notification_id, org_id, recipient, subject, body_text, body_html, attempts, kind`,
      [MAX_ATTEMPTS, opts.batch ?? 50],
    )).rows,
  )
  for (const n of claimed) {
    const allowed = await withSystem(async (c) => checkQuota(c, n.org_id, n.kind))
    if (!allowed) {
      await withSystem((c) => c.query("UPDATE ems_notifications SET status = 'skipped', last_error = 'лимит писем по тарифу исчерпан' WHERE notification_id = $1", [n.notification_id]))
      stats.skipped += 1
      continue
    }
    try {
      await provider.send({ to: n.recipient, subject: n.subject, text: n.body_text, html: n.body_html })
      await withSystem(async (c) => {
        await c.query("UPDATE ems_notifications SET status = 'sent', sent_at = now(), last_error = NULL WHERE notification_id = $1", [n.notification_id])
        await c.query(
          `INSERT INTO ems_usage_counters (org_id, month, emails_sent) VALUES ($1, date_trunc('month', now())::date, 1)
           ON CONFLICT (org_id, month) DO UPDATE SET emails_sent = ems_usage_counters.emails_sent + 1`,
          [n.org_id],
        )
      })
      stats.sent += 1
    } catch (err) {
      const retry = RETRY_MINUTES[n.attempts - 1]
      await withSystem((c) =>
        c.query(
          `UPDATE ems_notifications SET status = 'failed', last_error = $2, next_attempt_at = CASE WHEN $3::int IS NULL THEN 'infinity'::timestamptz ELSE now() + make_interval(mins => $3::int) END WHERE notification_id = $1`,
          [n.notification_id, (err as Error).message.slice(0, 500), retry ?? null],
        ),
      )
      stats.failed += 1
    }
  }
  return stats
}

/** Письма подтверждения и приглашения не ограничиваются тарифом; уведомления — лимитом emails_month. */
async function checkQuota(c: Db, orgId: string, kind: string): Promise<boolean> {
  if (kind === "verify" || kind === "invite") return true
  const r = await c.query(
    `SELECT COALESCE((s.limits_override->>'emails_month')::int, (p.limits->>'emails_month')::int) AS lim,
            s.limits_override ? 'emails_month' AS has_override, p.limits->'emails_month' = 'null'::jsonb AS unlimited,
            COALESCE((SELECT emails_sent FROM ems_usage_counters u WHERE u.org_id = s.org_id AND u.month = date_trunc('month', now())::date), 0) AS used
       FROM ems_subscriptions s JOIN ems_plans p ON p.plan_code = s.plan_code WHERE s.org_id = $1`,
    [orgId],
  )
  const row = r.rows[0]
  if (!row) return false
  if (row.lim == null) return true
  if (row.used < row.lim) return true
  await enterOrg(c, orgId)
  await raiseEvent(c, {
    orgId,
    kind: "email_quota",
    category: "billing",
    severity: "warning",
    title: "Исчерпан лимит писем по тарифу",
    message: `В этом месяце отправлено ${row.used} писем из ${row.lim}. Новые письма не отправляются до начала следующего месяца или смены тарифа; события по-прежнему видны в приложении.`,
    dedupKey: `quota:emails:${new Date().toISOString().slice(0, 7)}`,
    notify: false,
  })
  await c.query("SELECT set_config('ems.scope', 'system', true), set_config('ems.org_id', '', true)")
  return false
}
