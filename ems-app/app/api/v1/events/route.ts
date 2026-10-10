import { api } from "@/lib/server/http.ts"
import { optUuid } from "@/lib/server/params.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => {
    const status = ctx.url.searchParams.get("status")
    const category = ctx.url.searchParams.get("category")
    const r = await c.query(
      `SELECT e.event_id, e.seq, e.kind, e.category, e.severity, e.title, e.message, e.details, e.status, e.occurrences, e.opened_at, e.last_seen_at,
              e.acknowledged_at, e.ack_note, e.resolved_at, e.notified_at, e.site_id, s.name AS site_name, e.meter_id, m.name AS meter_name, e.rule_id, u.display_name AS acknowledged_by
         FROM ems_events e LEFT JOIN ems_sites s ON s.site_id = e.site_id LEFT JOIN ems_meters m ON m.meter_id = e.meter_id LEFT JOIN ems_users u ON u.user_id = e.acknowledged_by
        WHERE e.org_id = $1 AND ($2::uuid IS NULL OR e.site_id = $2) AND ($3::text IS NULL OR e.status = $3) AND ($4::text IS NULL OR e.category = $4)
        ORDER BY (e.status = 'open') DESC, e.last_seen_at DESC LIMIT 300`,
      [ctx.orgId, optUuid(ctx.url, "siteId"), status && ["open", "acknowledged", "resolved"].includes(status) ? status : null, category || null],
    )
    const notifications = await c.query(
      `SELECT ref_id AS event_id, recipient, status, sent_at, last_error FROM ems_notifications WHERE org_id = $1 AND ref_type = 'event' AND ref_id = ANY($2::text[])`,
      [ctx.orgId, r.rows.map((e) => e.event_id)],
    )
    return { events: r.rows.map((e) => ({ ...e, deliveries: notifications.rows.filter((n) => n.event_id === e.event_id) })) }
  }),
)
