import type { PoolClient } from "pg"
import { HttpError } from "../db.ts"
import { can, type Actor } from "./actor.ts"
import { actorEvent, recordEvent } from "./audit.ts"
import { getDocument } from "./documents.ts"
import { inlineSafe, readFileChecked } from "./files.ts"

/** Скачивание с проверкой прав на документ (или на загрузку, если файл ещё не привязан). */
export async function fileForActor(client: PoolClient, actor: Actor, fileId: string) {
  if (!/^\d+$/.test(fileId)) throw new HttpError(404, "Файл не найден", "file_not_found")
  const r = await client.query<{ document_id: string | null; uploaded_by: string | null }>(
    `SELECT document_id::text, uploaded_by::text FROM edi_files WHERE file_id = $1::bigint AND site_id = $2`,
    [fileId, actor.siteId]
  )
  const row = r.rows[0]
  if (!row) throw new HttpError(404, "Файл не найден", "file_not_found")
  if (row.document_id) await getDocument(client, actor, row.document_id)
  else if (row.uploaded_by !== actor.userId && !can(actor, "edi.import")) throw new HttpError(404, "Файл не найден", "file_not_found")
  const f = await readFileChecked(client, actor.siteId, fileId)
  if (row.document_id) await recordEvent(client, actorEvent(actor, "document.downloaded", row.document_id, { fileId, name: f.meta.fileName }))
  return f
}

export function fileResponse(f: Awaited<ReturnType<typeof fileForActor>>, inline: boolean): Response {
  const asInline = inline && inlineSafe(f.meta.mime)
  const encoded = encodeURIComponent(f.meta.fileName)
  return new Response(Buffer.from(f.bytes), {
    headers: {
      "Content-Type": asInline ? f.meta.mime : f.meta.mime === "application/xml" ? "application/xml; charset=binary" : f.meta.mime,
      "Content-Length": String(f.bytes.length),
      "Content-Disposition": `${asInline ? "inline" : "attachment"}; filename="file"; filename*=UTF-8''${encoded}`,
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "X-Content-SHA256": f.meta.sha256,
    },
  })
}
