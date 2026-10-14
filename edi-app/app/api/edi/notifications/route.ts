import { jsonBody, route } from "@/lib/http.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = route(async ({ client, actor }) => {
  const r = await client.query(
    `SELECT n.notification_id::text AS id, n.event, n.title, n.body, n.document_id::text AS "documentId", n.read_at AS "readAt", n.created_at AS "createdAt",
            (SELECT COALESCE(jsonb_agg(jsonb_build_object('channel', d.channel, 'status', d.status, 'attempts', d.attempts, 'error', d.last_error)), '[]'::jsonb)
               FROM edi_deliveries d WHERE d.notification_id = n.notification_id) AS deliveries
     FROM edi_notifications n WHERE n.site_id = $1 AND n.user_id = $2::bigint ORDER BY n.notification_id DESC LIMIT 100`,
    [actor.siteId, actor.userId]
  )
  const unread = r.rows.filter((x) => !x.readAt).length
  return { notifications: r.rows, unread }
})

/** Отметить прочитанными: { ids: [...] } или { all: true }. */
export const POST = route(async ({ client, actor, req }) => {
  const b = await jsonBody<{ ids?: string[]; all?: boolean }>(req)
  await client.query(
    `UPDATE edi_notifications SET read_at = now() WHERE site_id = $1 AND user_id = $2::bigint AND read_at IS NULL
       AND ($3::boolean OR notification_id = ANY($4::bigint[]))`,
    [actor.siteId, actor.userId, Boolean(b.all), (b.ids ?? []).filter((x) => /^\d+$/.test(x))]
  )
  return { ok: true }
})
