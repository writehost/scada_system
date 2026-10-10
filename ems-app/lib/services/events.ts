// События оборудования и аварии. Одно открытое событие на ключ дедупликации:
// повторы увеличивают счётчик и не рассылают письма заново (подавление).

import type { Db } from "../server/db.ts"
import { enqueueNotification, type NotificationKind } from "./notify.ts"

export type Severity = "info" | "warning" | "critical"
export type Category = "anomaly" | "telemetry_lost" | "leak" | "limit" | "equipment" | "data_quality" | "billing"

export type RaiseInput = {
  orgId: string
  kind: string
  category: Category
  severity: Severity
  title: string
  message: string
  dedupKey: string
  siteId?: string | null
  meterId?: string | null
  channelId?: number | null
  gatewayId?: string | null
  ruleId?: string | null
  details?: Record<string, unknown>
  /** Отправлять ли уведомление при открытии события. */
  notify?: boolean
  /** Повторное уведомление по открытому событию не чаще, чем раз в N минут. */
  repeatMinutes?: number | null
}

export type RaiseResult = { eventId: string; created: boolean; notified: boolean }

const CATEGORY_KIND: Record<Category, NotificationKind> = {
  anomaly: "anomaly",
  telemetry_lost: "telemetry_lost",
  leak: "leak",
  limit: "limit",
  equipment: "equipment",
  data_quality: "equipment",
  billing: "limit",
}

export async function raiseEvent(c: Db, e: RaiseInput): Promise<RaiseResult> {
  const r = await c.query<{ event_id: string; created: boolean; status: string; notified_at: Date | null; opened_at: Date }>(
    `INSERT INTO ems_events (org_id, site_id, meter_id, channel_id, gateway_id, rule_id, kind, category, severity, title, message, details, dedup_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
     ON CONFLICT (org_id, dedup_key) WHERE status <> 'resolved'
     DO UPDATE SET occurrences = ems_events.occurrences + 1, last_seen_at = now(),
       message = EXCLUDED.message, details = EXCLUDED.details,
       severity = CASE WHEN EXCLUDED.severity = 'critical' THEN 'critical' ELSE ems_events.severity END
     RETURNING event_id, (xmax = 0) AS created, status, notified_at, opened_at`,
    [e.orgId, e.siteId ?? null, e.meterId ?? null, e.channelId ?? null, e.gatewayId ?? null, e.ruleId ?? null, e.kind, e.category, e.severity, e.title, e.message, JSON.stringify(e.details ?? {}), e.dedupKey],
  )
  const row = r.rows[0]
  let notified = false
  const shouldNotify =
    e.notify !== false &&
    e.category !== "data_quality" &&
    (row.created ||
      (row.status === "open" &&
        e.repeatMinutes != null &&
        row.notified_at != null &&
        Date.now() - new Date(row.notified_at).getTime() >= e.repeatMinutes * 60_000))
  if (shouldNotify) {
    const stamp = row.created ? "open" : `repeat:${Math.floor(Date.now() / 60_000)}`
    await enqueueNotification(c, {
      orgId: e.orgId,
      kind: CATEGORY_KIND[e.category],
      siteId: e.siteId,
      subject: e.title,
      lead: e.message,
      reason: `событие «${e.title}»`,
      refType: "event",
      refId: row.event_id,
      link: `/monitoring/events?event=${row.event_id}`,
      dedupKey: `event:${row.event_id}:${stamp}`,
      severity: e.severity,
    })
    await c.query("UPDATE ems_events SET notified_at = now() WHERE event_id = $1", [row.event_id])
    notified = true
  } else if (row.created && e.category === "data_quality") {
    // Качество данных — только в ленту, без писем.
    await c.query(
      `INSERT INTO ems_feed (org_id, kind, severity, title, body, ref_type, ref_id, site_id, dedup_key)
       VALUES ($1, 'data_quality', $2, $3, $4, 'event', $5, $6, $7) ON CONFLICT DO NOTHING`,
      [e.orgId, e.severity, e.title, e.message, row.event_id, e.siteId ?? null, `event:${row.event_id}`],
    )
  }
  return { eventId: row.event_id, created: row.created, notified }
}

/** Автоматически закрывает событие, когда условие больше не выполняется. */
export async function resolveEvent(c: Db, orgId: string, dedupKey: string, note = "условие больше не выполняется"): Promise<boolean> {
  const r = await c.query(
    `UPDATE ems_events SET status = 'resolved', resolved_at = now(), details = details || jsonb_build_object('resolution', $3::text)
      WHERE org_id = $1 AND dedup_key = $2 AND status <> 'resolved'`,
    [orgId, dedupKey, note],
  )
  return (r.rowCount ?? 0) > 0
}
