import { HttpError } from "@/lib/db.ts"
import { jsonBody, route } from "@/lib/http.ts"
import { archiveDocument, setStatus, toggleFavorite } from "@/lib/edi/documents.ts"
import { decide } from "@/lib/edi/workflow.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Массовые действия: каждый документ — отдельная точка сохранения, ошибки не откатывают остальные. */
export const POST = route(async ({ client, actor, req }) => {
  const b = await jsonBody<{ ids: string[]; action: string; to?: string; comment?: string }>(req)
  const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(String))].slice(0, 500) : []
  if (!ids.length) throw new HttpError(400, "Не выбраны документы", "no_ids")
  const results: Array<{ id: string; ok: boolean; error?: string }> = []
  for (const id of ids) {
    await client.query("SAVEPOINT bulk_item")
    try {
      if (b.action === "archive") await archiveDocument(client, actor, id)
      else if (b.action === "favorite") await toggleFavorite(client, actor, id, true)
      else if (b.action === "unfavorite") await toggleFavorite(client, actor, id, false)
      else if (b.action === "status") await setStatus(client, actor, id, String(b.to), b.comment)
      else if (b.action === "approve") {
        const t = await client.query<{ task_id: string }>(
          `SELECT task_id::text FROM edi_tasks WHERE document_id = $1::bigint AND status = 'pending' AND assignee_user_id = $2::bigint ORDER BY task_id LIMIT 1`,
          [id, actor.userId]
        )
        if (!t.rows[0]) throw new HttpError(409, "Нет вашей задачи по документу", "no_task")
        await decide(client, actor, t.rows[0].task_id, "approve", b.comment)
      } else throw new HttpError(400, "Неизвестное действие", "bad_action")
      await client.query("RELEASE SAVEPOINT bulk_item")
      results.push({ id, ok: true })
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT bulk_item")
      results.push({ id, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return { results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length }
}, { tx: true })
