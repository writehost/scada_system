import { HttpError } from "@/lib/db.ts"
import { route } from "@/lib/http.ts"
import { readUploads } from "@/lib/multipart.ts"
import { requirePermission } from "@/lib/edi/actor.ts"
import { inspectUpload, saveFile } from "@/lib/edi/files.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Логотип организации для печатных форм (PNG/JPEG до 1 МБ). */
export const POST = route(async ({ client, actor, req }) => {
  requirePermission(actor, "edi.admin")
  const { files } = await readUploads(req, "file", 1)
  const f = files[0]
  if (!f) throw new HttpError(400, "Приложите изображение", "no_file")
  const { mime } = inspectUpload(f.name, f.bytes)
  if (!["image/png", "image/jpeg"].includes(mime)) throw new HttpError(415, "Логотип — PNG или JPEG", "bad_logo")
  if (f.bytes.length > 1024 * 1024) throw new HttpError(413, "Логотип больше 1 МБ", "too_large")
  const saved = await saveFile(client, { siteId: actor.siteId, kind: "logo", fileName: f.name, bytes: f.bytes, mime, uploadedBy: actor.userId })
  await client.query(
    `INSERT INTO edi_org_settings (site_id, logo_file_id) VALUES ($1, $2::bigint)
     ON CONFLICT (site_id) DO UPDATE SET logo_file_id = $2::bigint, updated_at = now()`,
    [actor.siteId, saved.fileId]
  )
  return { fileId: saved.fileId }
}, { tx: true })
