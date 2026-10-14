import { HttpError } from "@/lib/db.ts"
import { jsonBody, route } from "@/lib/http.ts"
import { getDocument } from "@/lib/edi/documents.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Сохранённые фильтры (kind=filter) и пользовательские папки (kind=folder) — личные. */
export const GET = route(async ({ client, actor }) => {
  const r = await client.query(
    `SELECT v.view_id::text AS id, v.name, v.kind, v.query,
            (SELECT count(*)::int FROM edi_folder_items fi WHERE fi.view_id = v.view_id) AS count
     FROM edi_saved_views v WHERE v.site_id = $1 AND v.user_id = $2::bigint ORDER BY v.kind, v.name`,
    [actor.siteId, actor.userId]
  )
  return { views: r.rows }
})

export const POST = route(async ({ client, actor, req }) => {
  const b = await jsonBody<{ name?: string; kind?: string; query?: Record<string, unknown>; addTo?: string; documentIds?: string[]; remove?: boolean }>(req)
  if (b.addTo) {
    const v = await client.query(`SELECT 1 FROM edi_saved_views WHERE view_id = $1::bigint AND user_id = $2::bigint AND kind = 'folder'`, [b.addTo, actor.userId])
    if (!v.rows[0]) throw new HttpError(404, "Папка не найдена", "not_found")
    for (const id of (b.documentIds ?? []).slice(0, 500)) {
      await getDocument(client, actor, id)
      if (b.remove) await client.query(`DELETE FROM edi_folder_items WHERE view_id = $1::bigint AND document_id = $2::bigint`, [b.addTo, id])
      else await client.query(`INSERT INTO edi_folder_items (view_id, document_id) VALUES ($1::bigint, $2::bigint) ON CONFLICT DO NOTHING`, [b.addTo, id])
    }
    return { ok: true }
  }
  const name = String(b.name ?? "").trim().slice(0, 100)
  if (!name) throw new HttpError(400, "Укажите название", "bad_name")
  const kind = b.kind === "folder" ? "folder" : "filter"
  const r = await client.query<{ id: string }>(
    `INSERT INTO edi_saved_views (site_id, user_id, name, kind, query) VALUES ($1, $2::bigint, $3, $4, $5::jsonb) RETURNING view_id::text AS id`,
    [actor.siteId, actor.userId, name, kind, JSON.stringify(kind === "filter" ? b.query ?? {} : {})]
  )
  return { id: r.rows[0].id }
}, { tx: true })

export const DELETE = route(async ({ client, actor, req }) => {
  const id = new URL(req.url).searchParams.get("id") ?? ""
  await client.query(`DELETE FROM edi_saved_views WHERE view_id = $1::bigint AND user_id = $2::bigint`, [id, actor.userId])
  return { ok: true }
})
