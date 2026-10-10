import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const id = idParam(p.id)
    const log = await c.query("SELECT log_id, level, code, message, details, created_at FROM ems_connection_log WHERE meter_id = $1 AND org_id = $2 ORDER BY created_at DESC LIMIT 200", [id, ctx.orgId])
    const corrections = await c.query(
      `SELECT k.correction_id, k.channel_id, ch.name AS channel_name, k.measured_at, k.action, k.old_value, k.new_value, k.old_quality, k.new_quality, k.reason, k.created_at, u.display_name AS actor
         FROM ems_reading_corrections k JOIN ems_channels ch ON ch.channel_id = k.channel_id LEFT JOIN ems_users u ON u.user_id = k.actor_id
        WHERE ch.meter_id = $1 AND k.org_id = $2 ORDER BY k.created_at DESC LIMIT 200`,
      [id, ctx.orgId],
    )
    const conflicts = await c.query(
      `SELECT k.measured_at, k.existing_value, k.incoming_value, k.source, k.received_at, ch.name AS channel_name FROM ems_reading_conflicts k JOIN ems_channels ch ON ch.channel_id = k.channel_id
        WHERE ch.meter_id = $1 AND k.org_id = $2 ORDER BY k.received_at DESC LIMIT 50`,
      [id, ctx.orgId],
    )
    return { log: log.rows, corrections: corrections.rows, conflicts: conflicts.rows }
  }),
)
