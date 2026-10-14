import { HttpError } from "@/lib/db.ts"
import { route } from "@/lib/http.ts"
import { readUploads } from "@/lib/multipart.ts"
import { requirePermission } from "@/lib/edi/actor.ts"
import { actorEvent, recordEvent } from "@/lib/edi/audit.ts"
import { getDocument, refreshSearchText, touch } from "@/lib/edi/documents.ts"
import { docxText, inspectUpload, saveFile } from "@/lib/edi/files.ts"
import { enforceLimits } from "@/lib/edi/saas.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Вложения добавляются к текущей версии; подписанный оригинал при этом не меняется. */
export const POST = route(async ({ client, actor, params, req }) => {
  requirePermission(actor, "edi.doc.edit")
  const doc = await getDocument(client, actor, params.id)
  if (doc.archivedAt) throw new HttpError(409, "Документ в архиве", "archived")
  const { files } = await readUploads(req, "file", 20)
  if (!files.length) throw new HttpError(400, "Нет файлов", "no_files")
  const saved = []
  for (const f of files) {
    const { ext, mime } = inspectUpload(f.name, f.bytes)
    await enforceLimits(client, actor.siteId, { bytes: f.bytes.length })
    const text = ext === "docx" ? docxText(f.bytes) : ext === "txt" || ext === "csv" ? new TextDecoder().decode(f.bytes).slice(0, 200000) : null
    saved.push(await saveFile(client, { siteId: actor.siteId, documentId: params.id, versionNo: doc.currentVersion, kind: "attachment", fileName: f.name, bytes: f.bytes, mime, uploadedBy: actor.userId, textContent: text }))
    await recordEvent(client, actorEvent(actor, "document.file_added", params.id, { name: f.name }))
  }
  await touch(client, params.id, "document.file_added")
  await refreshSearchText(client, params.id)
  return { files: saved }
}, { tx: true })
