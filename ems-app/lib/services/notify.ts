// Постановка уведомлений в очередь. Доставку выполняет фоновый обработчик
// (scripts/worker.ts) с повторными попытками. Для каждого письма хранится
// причина, получатель, время, статус и ссылка на объект.

import type { Db } from "../server/db.ts"
import { localDateKey, localParts, parseDateKey, zonedTimeToUtc } from "../domain/time.ts"

export type NotificationKind = "payment_due" | "readings_due" | "anomaly" | "telemetry_lost" | "leak" | "limit" | "equipment" | "data_quality" | "billing" | "verify" | "invite"

export const KIND_LABELS: Record<string, string> = {
  payment_due: "Сроки оплаты",
  readings_due: "Передача показаний",
  anomaly: "Перерасход и аномалии",
  telemetry_lost: "Потеря связи с приборами",
  leak: "Подозрение на утечку",
  limit: "Превышение лимитов",
  equipment: "Состояние оборудования",
}

export const SUBSCRIBABLE_KINDS = Object.keys(KIND_LABELS)

export function publicUrl(): string {
  return (process.env.EMS_PUBLIC_URL || "http://localhost:3016").replace(/\/+$/, "")
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/** Письмо в стиле уведомлений SCADA System (как у почты WMS). */
export function renderEmail(input: { kicker?: string; title: string; lead: string; facts?: Array<[string, string]>; ctaUrl?: string; ctaLabel?: string; reason: string }): { html: string; text: string } {
  const facts = (input.facts ?? [])
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#71717a;font-size:13px;">${esc(k)}</td><td style="padding:4px 0;font-size:13px;color:#18181b;font-weight:600;">${esc(v)}</td></tr>`)
    .join("")
  const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${esc(input.title)}</title></head>
<body style="margin:0;padding:0;background:#f4f1ec;color:#18181b;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ec;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#fffcf7;border:1px solid #e4ddd0;border-radius:14px;">
<tr><td style="padding:22px 24px;font-family:Arial,Helvetica,sans-serif;">
<div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5d7a10;font-weight:700;">${esc(input.kicker ?? "SCADA EMS")}</div>
<h1 style="margin:8px 0 10px;font-size:20px;line-height:1.3;color:#1f2a24;">${esc(input.title)}</h1>
<p style="margin:0 0 14px;font-size:15px;line-height:1.5;color:#3f3f46;">${esc(input.lead)}</p>
${facts ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 16px;">${facts}</table>` : ""}
${input.ctaUrl ? `<a href="${esc(input.ctaUrl)}" style="display:inline-block;background:#c6e34a;color:#24300a;text-decoration:none;border-radius:8px;padding:10px 16px;font-size:14px;font-weight:600;">${esc(input.ctaLabel ?? "Открыть в SCADA EMS")}</a>` : ""}
<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#a1a1aa;">Причина письма: ${esc(input.reason)}. Настроить уведомления: ${esc(publicUrl())}/settings/notifications</p>
</td></tr></table></td></tr></table></body></html>`
  const text = [
    input.title,
    "",
    input.lead,
    ...(input.facts ?? []).map(([k, v]) => `${k}: ${v}`),
    "",
    input.ctaUrl ? `${input.ctaLabel ?? "Открыть"}: ${input.ctaUrl}` : "",
    `Причина письма: ${input.reason}.`,
  ]
    .filter((l) => l !== undefined)
    .join("\n")
  return { html, text }
}

export type EnqueueInput = {
  orgId: string
  kind: NotificationKind
  siteId?: string | null
  subject: string
  lead: string
  facts?: Array<[string, string]>
  reason: string
  refType?: string
  refId?: string
  link?: string
  dedupKey: string
  severity?: "info" | "warning" | "critical"
  /** Только эти получатели (например, выбранные в обязательстве). */
  recipientIds?: string[]
  /** Отложить доставку до определённого момента. */
  deliverAt?: Date
  /** Напоминания: доставить в час, выбранный получателем (send_hour) в этом часовом поясе. */
  sendHourTz?: string
  /** Писать ли запись в мобильную ленту. */
  feed?: boolean
}

/** Ставит письма подписанным получателям и запись в мобильную ленту. Возвращает число писем. */
export async function enqueueNotification(c: Db, n: EnqueueInput): Promise<number> {
  const recipients = await c.query<{ recipient_id: string; email: string; send_hour: number }>(
    `SELECT recipient_id, email, send_hour FROM ems_email_recipients
      WHERE org_id = $1 AND verified_at IS NOT NULL AND enabled
        AND (paused_until IS NULL OR paused_until < now())
        AND ($2::text = ANY(kinds) OR $4::uuid[] IS NOT NULL)
        AND (site_ids IS NULL OR $3::uuid IS NULL OR $3::uuid = ANY(site_ids))
        AND ($4::uuid[] IS NULL OR recipient_id = ANY($4::uuid[]))`,
    [n.orgId, n.kind, n.siteId ?? null, n.recipientIds && n.recipientIds.length ? n.recipientIds : null],
  )
  const url = n.link ? (n.link.startsWith("http") ? n.link : `${publicUrl()}${n.link}`) : undefined
  const body = renderEmail({ title: n.subject, lead: n.lead, facts: n.facts, ctaUrl: url, reason: n.reason })
  let count = 0
  for (const r of recipients.rows) {
    const ins = await c.query(
      `INSERT INTO ems_notifications (org_id, recipient, recipient_id, kind, subject, body_text, body_html, reason, ref_type, ref_id, link, dedup_key, next_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, now()))
       ON CONFLICT (org_id, dedup_key) DO NOTHING`,
      [n.orgId, r.email, r.recipient_id, n.kind, n.subject, body.text, body.html, n.reason, n.refType ?? null, n.refId ?? null, url ?? null, `${n.dedupKey}:${r.recipient_id}`, n.deliverAt ?? (n.sendHourTz ? deliverAtHour(n.sendHourTz, r.send_hour) : null)],
    )
    count += ins.rowCount ?? 0
  }
  if (n.feed !== false) {
    const f = await c.query(
      `INSERT INTO ems_feed (org_id, kind, severity, title, body, ref_type, ref_id, site_id, dedup_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (org_id, dedup_key) DO NOTHING`,
      [n.orgId, n.kind, n.severity ?? "info", n.subject, n.lead, n.refType ?? null, n.refId ?? null, n.siteId ?? null, n.dedupKey],
    )
    if (f.rowCount) await c.query("SELECT pg_notify('ems_feed', $1)", [n.orgId])
  }
  return count
}

/** Ближайший момент, когда в поясе tz наступит час hour (если уже прошёл сегодня — сейчас). */
export function deliverAtHour(tz: string, hour: number, now = Date.now()): Date {
  if (localParts(now, tz).hour >= hour) return new Date(now)
  const { year, month, day } = parseDateKey(localDateKey(now, tz))
  return new Date(zonedTimeToUtc(year, month, day, hour, tz))
}

/** Письмо на конкретный адрес вне подписок (подтверждение адреса, приглашение). */
export async function enqueueDirect(c: Db, input: { orgId: string; email: string; recipientId?: string | null; kind: NotificationKind; subject: string; lead: string; link: string; ctaLabel: string; reason: string; dedupKey: string }): Promise<void> {
  const body = renderEmail({ title: input.subject, lead: input.lead, ctaUrl: input.link, ctaLabel: input.ctaLabel, reason: input.reason })
  await c.query(
    `INSERT INTO ems_notifications (org_id, recipient, recipient_id, kind, subject, body_text, body_html, reason, link, dedup_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (org_id, dedup_key) DO NOTHING`,
    [input.orgId, input.email, input.recipientId ?? null, input.kind, input.subject, body.text, body.html, input.reason, input.link, input.dedupKey],
  )
}
