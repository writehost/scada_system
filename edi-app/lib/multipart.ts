import { HttpError } from "./db.ts"
import { maxFileBytes } from "./edi/storage.ts"

/** Файлы из multipart/form-data с проверкой размера до чтения в память. */
export async function readUploads(req: Request, field = "file", maxFiles = 50): Promise<{ files: Array<{ name: string; bytes: Uint8Array }>; form: FormData }> {
  const len = Number(req.headers.get("content-length") || 0)
  if (len > maxFileBytes() * Math.min(maxFiles, 10) + 1024 * 1024) throw new HttpError(413, "Слишком большой объём загрузки", "too_large")
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    throw new HttpError(400, "Ожидалась форма с файлами", "bad_form")
  }
  const out: Array<{ name: string; bytes: Uint8Array }> = []
  for (const v of form.getAll(field)) {
    if (typeof v === "string") continue
    if (v.size > maxFileBytes()) throw new HttpError(413, `Файл «${v.name}» слишком большой`, "file_too_large")
    out.push({ name: v.name || "file", bytes: new Uint8Array(await v.arrayBuffer()) })
    if (out.length > maxFiles) throw new HttpError(400, "Слишком много файлов", "too_many_files")
  }
  return { files: out, form }
}
