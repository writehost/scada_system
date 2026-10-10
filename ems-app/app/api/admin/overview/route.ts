// Администрирование платформы: организации, подписки, тарифы, заявки, состояние системы.
import { NextResponse } from "next/server"
import { errorResponse } from "@/lib/server/http.ts"
import { requirePlatformAdmin } from "@/lib/server/admin.ts"
import { withSystem } from "@/lib/server/db.ts"
import { resolveStatus } from "@/lib/domain/plans.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    await requirePlatformAdmin(req)
    const data = await withSystem(async (c) => {
      const orgs = await c.query(
        `SELECT o.org_id, o.name, o.kind, o.segment, o.is_demo, o.created_at, s.plan_code, s.status, s.trial_ends_at, s.current_period_end,
                (SELECT count(*) FROM ems_meters m WHERE m.org_id = o.org_id AND m.status = 'active')::int AS meters,
                (SELECT count(*) FROM ems_memberships m WHERE m.org_id = o.org_id)::int AS users,
                COALESCE((SELECT readings_ingested FROM ems_usage_counters u WHERE u.org_id = o.org_id AND u.month = date_trunc('month', now())::date), 0) AS readings_month,
                COALESCE((SELECT emails_sent FROM ems_usage_counters u WHERE u.org_id = o.org_id AND u.month = date_trunc('month', now())::date), 0) AS emails_month,
                (SELECT h.to_plan FROM ems_subscription_history h WHERE h.org_id = o.org_id AND h.reason LIKE 'заявка%' ORDER BY h.created_at DESC LIMIT 1) AS requested_plan
           FROM ems_organizations o LEFT JOIN ems_subscriptions s ON s.org_id = o.org_id WHERE o.archived_at IS NULL ORDER BY o.created_at DESC LIMIT 500`,
      )
      const plans = await c.query("SELECT * FROM ems_plans ORDER BY sort")
      const requests = await c.query(
        `SELECT r.*, o.name AS org_name, m.manufacturer, m.model FROM ems_device_requests r JOIN ems_organizations o ON o.org_id = r.org_id JOIN ems_catalog_models m ON m.model_id = r.model_id ORDER BY r.created_at DESC LIMIT 200`,
      )
      const metrics = await c.query(
        `SELECT (SELECT pg_database_size(current_database())) AS db_bytes,
                (SELECT COALESCE(sum(pg_total_relation_size(inhrelid)), 0) FROM pg_inherits WHERE inhparent = 'ems_readings'::regclass) AS readings_bytes,
                (SELECT COALESCE(sum(readings_ingested), 0) FROM ems_usage_counters WHERE month = date_trunc('month', now())::date) AS readings_month,
                (SELECT count(*) FROM ems_notifications WHERE status IN ('queued','failed') AND next_attempt_at <= now())::int AS mail_queue,
                (SELECT count(*) FROM ems_notifications WHERE status = 'failed')::int AS mail_failed,
                (SELECT count(*) FROM ems_gateways WHERE status = 'online' AND archived_at IS NULL)::int AS gateways_online,
                (SELECT count(*) FROM ems_gateways WHERE status = 'offline' AND archived_at IS NULL)::int AS gateways_offline,
                (SELECT count(*) FROM ems_meters WHERE status = 'active')::int AS meters_active`,
      )
      const workers = await c.query("SELECT * FROM ems_worker_runs ORDER BY job")
      return {
        orgs: orgs.rows.map((o) => ({ ...o, effective_status: o.status ? resolveStatus(o) : null })),
        plans: plans.rows,
        requests: requests.rows,
        metrics: metrics.rows[0],
        workers: workers.rows,
      }
    })
    return NextResponse.json(data)
  } catch (e) {
    return errorResponse(e)
  }
}
