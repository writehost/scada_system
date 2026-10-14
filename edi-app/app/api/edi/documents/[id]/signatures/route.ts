import { HttpError } from "@/lib/db.ts"
import { route } from "@/lib/http.ts"
import { readUploads } from "@/lib/multipart.ts"
import { addOwnSignature, listSignatures, verifySignature } from "@/lib/edi/signatures.ts"
import { getDocument } from "@/lib/edi/documents.ts"
import { signalDocument } from "@/lib/edi/notify.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = route(async ({ client, actor, params }) => {
  await getDocument(client, actor, params.id)
  return { signatures: await listSignatures(client, params.id) }
})

/**
 * Добавить свою подпись: multipart (signature=<.sig/.p7s>, fileId) или JSON
 * { fileId, signatureBase64 } — результат КриптоПро ЭЦП Browser plug-in. Повторная проверка: { recheck: signatureId }.
 */
export const POST = route(async ({ client, actor, params, req }) => {
  const ct = req.headers.get("content-type") || ""
  if (ct.includes("application/json")) {
    const b = (await req.json()) as { fileId?: string; signatureBase64?: string; poaNumber?: string; recheck?: string }
    if (b.recheck) {
      await getDocument(client, actor, params.id)
      return { check: await verifySignature(client, actor.siteId, b.recheck) }
    }
    if (!b.fileId || !b.signatureBase64) throw new HttpError(400, "Нужны fileId и signatureBase64", "bad_request")
    const bytes = new Uint8Array(Buffer.from(b.signatureBase64.replace(/\s+/g, ""), "base64"))
    const r = await addOwnSignature(client, actor, params.id, { fileId: b.fileId, signatureBytes: bytes, poaNumber: b.poaNumber })
    await signalDocument(client, actor.siteId, params.id)
    return r
  }
  const { files, form } = await readUploads(req, "signature", 1)
  if (!files[0]) throw new HttpError(400, "Приложите файл подписи", "no_signature")
  const fileId = String(form.get("fileId") ?? "")
  const r = await addOwnSignature(client, actor, params.id, { fileId, signatureBytes: files[0].bytes, fileName: files[0].name, poaNumber: String(form.get("poaNumber") ?? "") || null })
  await signalDocument(client, actor.siteId, params.id)
  return r
}, { tx: true })
