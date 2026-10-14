import { route } from "@/lib/http.ts"
import { delegatorsSql } from "@/lib/edi/documents.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Компактная лента для SCADA Mobile (отдельное мобильное приложение не создаётся):
 * задачи согласования, непрочитанные уведомления, ссылки на карточки. Принимает cookie EDI
 * или персональный токен WMS `Authorization: Bearer wmsu_…`.
 */
export const GET = route(async ({ client, actor }) => {
  const tasks = await client.query(
    `SELECT t.task_id::text AS "taskId", t.step_name AS "stepName", t.kind, t.due_at AS "dueAt", d.document_id::text AS "documentId",
            d.title, d.amount_total::float8 AS "amountTotal", d.currency, d.status
     FROM edi_tasks t JOIN edi_documents d ON d.document_id = t.document_id
     WHERE t.site_id = $1 AND t.status = 'pending' AND (t.assignee_user_id = $2::bigint OR t.assignee_user_id IN (${delegatorsSql("$1", "$2")}))
     ORDER BY t.due_at NULLS LAST, t.task_id LIMIT 50`,
    [actor.siteId, actor.userId]
  )
  const notes = await client.query(
    `SELECT notification_id::text AS id, title, body, document_id::text AS "documentId", created_at AS "createdAt"
     FROM edi_notifications WHERE site_id = $1 AND user_id = $2::bigint AND read_at IS NULL ORDER BY notification_id DESC LIMIT 30`,
    [actor.siteId, actor.userId]
  )
  return {
    user: { fio: actor.fio, org: actor.orgName },
    tasks: tasks.rows.map((t) => ({ ...t, url: `/documents?id=${t.documentId}`, decideUrl: `/api/edi/tasks/${t.taskId}/decide` })),
    notifications: notes.rows.map((n) => ({ ...n, url: n.documentId ? `/documents?id=${n.documentId}` : null })),
  }
})
