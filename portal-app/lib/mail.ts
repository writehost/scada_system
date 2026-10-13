import { spawn } from "node:child_process"
import { access, unlink, writeFile } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PoolClient } from "pg"
import { withClient } from "./db"

/**
 * Почта уходит тем же помощником, что и уведомления WMS
 * (`/usr/local/bin/wms-send-mail.py`, SMTP-настройки — на сервере).
 * Письма сначала пишутся в outbox в той же транзакции, что и заявка, затем
 * отправляются; неудачные видны администратору и отправляются повторно.
 */
const DEFAULT_MAIL_HELPER = "/usr/local/bin/wms-send-mail.py"

export type MailDraft = {
  requestId: number | null
  kind: string
  recipients: string[]
  subject: string
  text: string
  html: string
}

export async function enqueueMail(client: PoolClient, draft: MailDraft): Promise<number | null> {
  if (draft.recipients.length === 0) return null
  const r = await client.query<{ id: string }>(
    `INSERT INTO portal_mail_outbox (request_id, kind, recipients, subject, body_text, body_html)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text`,
    [draft.requestId, draft.kind, draft.recipients, draft.subject, draft.text, draft.html]
  )
  return Number(r.rows[0]!.id)
}

function runHelper(helper: string, payloadPath: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [helper, payloadPath], { stdio: ["ignore", "pipe", "pipe"], env: process.env })
    let out = ""
    child.stdout.on("data", (c) => (out += String(c)))
    child.stderr.on("data", (c) => (out += String(c)))
    child.on("error", reject)
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000)
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, out })
    })
  })
}

async function deliver(msg: { recipients: string[]; subject: string; text: string; html: string }) {
  const helper = (process.env.PORTAL_SEND_MAIL_BIN || process.env.WMS_SEND_MAIL_BIN || DEFAULT_MAIL_HELPER).trim()
  try {
    await access(helper, fsConstants.R_OK)
  } catch {
    throw new Error(`Почтовый помощник не установлен: ${helper}`)
  }
  const payloadPath = join(tmpdir(), `portal-mail-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  await writeFile(
    payloadPath,
    JSON.stringify({ ...msg, fromName: process.env.PORTAL_MAIL_FROM_NAME?.trim() || "SCADA SYSTEM" }),
    { encoding: "utf8", mode: 0o600 }
  )
  try {
    const r = await runHelper(helper, payloadPath)
    if (r.code !== 0) throw new Error((r.out || `mail helper exit ${r.code}`).trim().slice(0, 500))
  } finally {
    await unlink(payloadPath).catch(() => undefined)
  }
}

export type DeliveryResult = { id: number; kind: string; status: "sent" | "failed"; error?: string }

/** Отправляет письма из outbox по id. Ошибки не бросает — пишет их в outbox. */
export async function flushOutbox(ids: Array<number | null>): Promise<DeliveryResult[]> {
  const list = ids.filter((x): x is number => typeof x === "number")
  if (!list.length) return []
  return withClient(async (client) => {
    const rows = await client.query<{
      id: string
      kind: string
      recipients: string[]
      subject: string
      body_text: string
      body_html: string
    }>(
      `SELECT id::text, kind, recipients, subject, body_text, body_html
       FROM portal_mail_outbox WHERE id = ANY($1::bigint[]) AND status <> 'sent' ORDER BY id`,
      [list]
    )
    const results: DeliveryResult[] = []
    for (const m of rows.rows) {
      try {
        await deliver({ recipients: m.recipients, subject: m.subject, text: m.body_text, html: m.body_html })
        await client.query(
          `UPDATE portal_mail_outbox SET status='sent', attempts=attempts+1, sent_at=now(), last_error=NULL WHERE id=$1`,
          [m.id]
        )
        results.push({ id: Number(m.id), kind: m.kind, status: "sent" })
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        console.error("[portal] mail failed", m.kind, error)
        await client.query(
          `UPDATE portal_mail_outbox SET status='failed', attempts=attempts+1, last_error=$2 WHERE id=$1`,
          [m.id, error]
        )
        results.push({ id: Number(m.id), kind: m.kind, status: "failed", error })
      }
    }
    return results
  })
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
}

/** Простое письмо в фирменном стиле: заголовок, абзацы, необязательная кнопка. */
export function renderMail(opts: {
  title: string
  paragraphs: string[]
  rows?: Array<[string, string]>
  action?: { label: string; url: string }
  footer?: string
}): { text: string; html: string } {
  const text = [
    opts.title,
    "",
    ...opts.paragraphs,
    ...(opts.rows?.length ? ["", ...opts.rows.map(([k, v]) => `${k}: ${v}`)] : []),
    ...(opts.action ? ["", `${opts.action.label}: ${opts.action.url}`] : []),
    "",
    opts.footer || "SCADA SYSTEM",
  ].join("\n")
  const rows = opts.rows?.length
    ? `<table role="presentation" style="border-collapse:collapse;margin:16px 0;width:100%">${opts.rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:6px 12px 6px 0;color:#5b6577;font-size:14px;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;color:#0b1830;font-size:14px">${esc(v)}</td></tr>`
        )
        .join("")}</table>`
    : ""
  const button = opts.action
    ? `<p style="margin:24px 0"><a href="${esc(opts.action.url)}" style="display:inline-block;background:#1f6bff;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${esc(opts.action.label)}</a></p>`
    : ""
  const html = `<!doctype html><html lang="ru"><body style="margin:0;background:#f3f6fb;font-family:Manrope,Segoe UI,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:32px 16px">
<div style="font-weight:800;letter-spacing:.08em;color:#0b1830;font-size:13px;margin-bottom:16px">SCADA SYSTEM</div>
<div style="background:#fff;border:1px solid #e3e9f3;border-radius:16px;padding:28px">
<h1 style="margin:0 0 12px;font-size:20px;color:#0b1830">${esc(opts.title)}</h1>
${opts.paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#28344a">${esc(p)}</p>`).join("")}
${rows}${button}
</div>
<p style="color:#7a8599;font-size:12px;margin-top:16px">${esc(opts.footer || "Это автоматическое письмо экосистемы SCADA SYSTEM.")}</p>
</div></body></html>`
  return { text, html }
}
