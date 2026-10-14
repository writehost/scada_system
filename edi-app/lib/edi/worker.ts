import { createHmac } from "node:crypto"
import type { Pool, PoolClient } from "pg"
import { ensureEdiSchema } from "./schema.ts"
import { seedReference } from "./seed.ts"
import { wmsClientFor } from "./integrations/wms.ts"
import { mailConfigured, sendMail } from "./mailer.ts"
import { NOTIFY_EVENTS } from "./notify.ts"
import { decryptSecret } from "./secrets.ts"
import { processDeadlines } from "./workflow.ts"
import { syncPendingReceipts } from "./wms-receipt.ts"

/**
 * Фоновые задачи без Redis/Celery (их нет в экосистеме): очередь в PostgreSQL.
 * Один исполнитель на такт — pg_try_advisory_lock, поэтому несколько процессов EDI не дублируют работу.
 *  - сроки согласований и эскалация;
 *  - сверка приёмки с WMS;
 *  - доставка уведомлений (WMS-колокольчик, email, вебхуки) с повторами и журналом.
 */

const BACKOFF_MIN = [1, 5, 30, 120, 360]

export function webhookSignature(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")
}

async function deliver(client: PoolClient): Promise<number> {
  const r = await client.query<{
    delivery_id: string
    site_id: number
    channel: string
    target: string | null
    attempts: number
    payload: Record<string, unknown>
    title: string | null
    body: string | null
    document_id: string | null
    user_id: string | null
    event: string | null
  }>(
    `SELECT d.delivery_id::text, d.site_id, d.channel, d.target, d.attempts, d.payload,
            n.title, n.body, n.document_id::text, n.user_id::text, n.event
     FROM edi_deliveries d LEFT JOIN edi_notifications n ON n.notification_id = d.notification_id
     WHERE d.status IN ('queued','retry') AND d.next_attempt_at <= now()
     ORDER BY d.delivery_id LIMIT 50 FOR UPDATE OF d SKIP LOCKED`
  )
  let done = 0
  for (const d of r.rows) {
    const origin = (process.env.EDI_PUBLIC_ORIGIN || "").replace(/\/$/, "")
    const link = d.document_id && origin ? `${origin}/documents?id=${d.document_id}` : ""
    try {
      if (d.channel === "wms") {
        const site = await client.query<{ site_code: string }>(`SELECT site_code FROM wms_sites WHERE site_id = $1`, [d.site_id])
        const wms = await wmsClientFor(client, d.site_id, site.rows[0]?.site_code ?? "")
        if (!wms) throw new Error("Интеграция с WMS не настроена")
        await wms.notify({ title: `EDI: ${d.title ?? ""}`, body: [d.body, link].filter(Boolean).join("\n"), userIds: [d.user_id!] })
      } else if (d.channel === "email") {
        if (!mailConfigured()) throw new Error("SMTP не настроен")
        await sendMail(d.target!, `SCADA EDI: ${d.title ?? ""}`, [NOTIFY_EVENTS[d.event ?? ""] ?? "", d.title, d.body, link].filter(Boolean).join("\n\n"))
      } else if (d.channel === "webhook") {
        const h = await client.query<{ url: string; secret_enc: string; is_active: boolean }>(`SELECT url, secret_enc, is_active FROM edi_webhooks WHERE webhook_id = $1::bigint`, [d.target])
        const hook = h.rows[0]
        if (!hook?.is_active) throw new Error("Вебхук отключён")
        const body = JSON.stringify(d.payload)
        const ts = String(Math.floor(Date.now() / 1000))
        const res = await fetch(hook.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-EDI-Timestamp": ts, "X-EDI-Signature": `v1=${webhookSignature(decryptSecret(hook.secret_enc), ts, body)}` },
          body,
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      }
      await client.query(`UPDATE edi_deliveries SET status = 'delivered', delivered_at = now(), attempts = attempts + 1, last_error = NULL WHERE delivery_id = $1::bigint`, [d.delivery_id])
      done++
    } catch (e) {
      const attempts = d.attempts + 1
      const final = attempts >= BACKOFF_MIN.length
      await client.query(
        `UPDATE edi_deliveries SET status = $2, attempts = $3, last_error = $4, next_attempt_at = now() + make_interval(mins => $5) WHERE delivery_id = $1::bigint`,
        [d.delivery_id, final ? "failed" : "retry", attempts, (e instanceof Error ? e.message : String(e)).slice(0, 500), BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length - 1)]]
      )
    }
  }
  return done
}

export async function runTick(pool: Pool): Promise<Record<string, unknown>> {
  const client = await pool.connect()
  try {
    const lock = await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock(hashtext('edi_worker')) AS ok`)
    if (!lock.rows[0].ok) return { skipped: true }
    try {
      await ensureEdiSchema(client)
      await seedReference(client)
      await client.query("BEGIN")
      const deadlines = await processDeadlines(client)
      await client.query("COMMIT")
      const sites = await client.query<{ site_id: number; site_code: string }>(
        `SELECT DISTINCT d.site_id, s.site_code FROM edi_documents d JOIN wms_sites s ON s.site_id = d.site_id
         WHERE d.wms_status IN ('draft_created','receiving','link_error') AND d.deleted_at IS NULL`
      )
      const receipts: Record<string, unknown> = {}
      for (const s of sites.rows) {
        await client.query("BEGIN")
        try {
          receipts[s.site_code] = await syncPendingReceipts(client, s.site_id, s.site_code)
          await client.query("COMMIT")
        } catch (e) {
          await client.query("ROLLBACK")
          receipts[s.site_code] = { error: e instanceof Error ? e.message : String(e) }
        }
      }
      await client.query("BEGIN")
      const delivered = await deliver(client)
      await client.query("COMMIT")
      return { deadlines, receipts, delivered }
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext('edi_worker'))`)
    }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined)
    throw e
  } finally {
    client.release()
  }
}

let timer: ReturnType<typeof setInterval> | null = null

export function startWorker(pool: Pool, intervalMs = 60_000) {
  if (timer) return
  const tick = () => runTick(pool).catch((e) => console.error("[edi-worker]", e))
  timer = setInterval(tick, intervalMs)
  setTimeout(tick, 5_000)
}
