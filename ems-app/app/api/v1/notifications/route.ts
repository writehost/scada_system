// Журнал уведомлений: причина, получатель, время, статус доставки, ссылка.
import { api } from "@/lib/server/http.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => {
    const r = await c.query(
      `SELECT notification_id, recipient, kind, subject, reason, ref_type, ref_id, link, status, attempts, last_error, sent_at, created_at, next_attempt_at
         FROM ems_notifications WHERE org_id = $1 AND kind <> 'verify' ORDER BY created_at DESC LIMIT 200`,
      [ctx.orgId],
    )
    return { items: r.rows }
  }),
)
