import { unzipSync } from "fflate"
import type { PoolClient } from "pg"
import { HttpError } from "../db.ts"
import { getStorage, maxFileBytes, sha256Hex, storageKey } from "./storage.ts"

export type StoredFile = {
  fileId: string
  documentId: string | null
  versionNo: number | null
  kind: string
  fileName: string
  mime: string
  sizeBytes: number
  sha256: string
  createdAt: string
}

const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  xml: "application/xml",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  tif: "image/tiff",
  tiff: "image/tiff",
  zip: "application/zip",
  sig: "application/pkcs7-signature",
  p7s: "application/pkcs7-signature",
  sgn: "application/pkcs7-signature",
}

const BLOCKED_EXT = new Set([
  "exe", "dll", "com", "bat", "cmd", "ps1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "msi", "msp", "scr", "jar",
  "sh", "bash", "app", "html", "htm", "xhtml", "svg", "hta", "lnk", "docm", "xlsm", "pptm", "dotm", "xltm", "iso", "img",
])

export function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim())
  return m ? m[1].toLowerCase() : ""
}

export function safeFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() || "file"
  return base.replace(/[\u0000-\u001f<>:"|?*]+/g, "_").slice(0, 180) || "file"
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false
  return sig.every((b, i) => bytes[offset + i] === b)
}

/** Тип по сигнатуре содержимого; расширение не доверяется. */
export function sniff(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf"
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "png"
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpg"
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return "tiff"
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) return "zip"
  if (startsWith(bytes, [0x4d, 0x5a])) return "exe"
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return "exe"
  if (bytes[0] === 0x30 && (bytes[1] === 0x82 || bytes[1] === 0x80 || bytes[1] === 0x83)) return "der"
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 256)).replace(/^﻿|^\xEF\xBB\xBF/, "").trimStart()
  if (/^<\?xml/i.test(head)) return "xml"
  if (/^<(!doctype\s+html|html|script|svg)/i.test(head)) return "html"
  return null
}

/** Проверка загружаемого файла: размер, запрещённые типы, несоответствие сигнатуры, макросы в OOXML. */
export function inspectUpload(name: string, bytes: Uint8Array): { ext: string; mime: string } {
  const max = maxFileBytes()
  if (bytes.length === 0) throw new HttpError(400, `Файл «${name}» пустой`, "file_empty")
  if (bytes.length > max) throw new HttpError(413, `Файл «${name}» больше ${Math.round(max / 1048576)} МБ`, "file_too_large")
  const ext = extOf(name)
  if (BLOCKED_EXT.has(ext)) throw new HttpError(415, `Тип файла .${ext} запрещён`, "file_blocked")
  const sniffed = sniff(bytes)
  if (sniffed === "exe" || sniffed === "html") throw new HttpError(415, `Файл «${name}» похож на исполняемый или HTML и отклонён`, "file_blocked")
  const allowed = EXT_MIME[ext]
  if (!allowed) throw new HttpError(415, `Неподдерживаемый тип файла: .${ext || "без расширения"}`, "file_type")
  const expectZip = ext === "docx" || ext === "xlsx" || ext === "zip"
  if (expectZip && sniffed !== "zip") throw new HttpError(415, `Содержимое «${name}» не соответствует расширению`, "file_mismatch")
  if ((ext === "pdf" && sniffed !== "pdf") || ((ext === "png" || ext === "jpg" || ext === "jpeg") && sniffed !== ext.replace("jpeg", "jpg"))) {
    throw new HttpError(415, `Содержимое «${name}» не соответствует расширению`, "file_mismatch")
  }
  if (ext === "docx" || ext === "xlsx") {
    const names = zipEntryNames(bytes)
    if (names.some((n) => /vbaProject\.bin$/i.test(n) || /\.(exe|dll|js|vbs|bat|ps1)$/i.test(n))) {
      throw new HttpError(415, `Документ «${name}» содержит макросы или исполняемые вложения`, "file_macro")
    }
  }
  return { ext, mime: allowed }
}

/** Имена в ZIP без распаковки содержимого (по центральному каталогу). */
export function zipEntryNames(bytes: Uint8Array): string[] {
  const names: string[] = []
  try {
    unzipSync(bytes, {
      filter: (f) => {
        names.push(f.name)
        return false
      },
    })
  } catch {
    throw new HttpError(400, "Повреждённый ZIP-контейнер", "zip_corrupt")
  }
  return names
}

/** Текст DOCX для предпросмотра и поиска (word/document.xml без форматирования). */
export function docxText(bytes: Uint8Array): string {
  try {
    const out = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" && f.originalSize < 20 * 1024 * 1024 })
    const xml = out["word/document.xml"]
    if (!xml) return ""
    const s = new TextDecoder().decode(xml)
    return s
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  } catch {
    return ""
  }
}

const FILE_COLS = `file_id::text AS "fileId", document_id::text AS "documentId", version_no AS "versionNo", kind,
  file_name AS "fileName", mime, size_bytes::int AS "sizeBytes", sha256, created_at AS "createdAt"`

export async function saveFile(
  client: PoolClient,
  input: {
    siteId: number
    documentId?: string | null
    versionNo?: number | null
    kind: string
    fileName: string
    bytes: Uint8Array
    mime: string
    uploadedBy?: string | null
    textContent?: string | null
  }
): Promise<StoredFile> {
  const sha = sha256Hex(input.bytes)
  const key = storageKey(input.siteId, sha)
  await getStorage().put(key, input.bytes, input.mime)
  const r = await client.query<StoredFile>(
    `INSERT INTO edi_files (site_id, document_id, version_no, kind, file_name, mime, size_bytes, sha256, storage_key, uploaded_by, text_content)
     VALUES ($1, $2::bigint, $3, $4, $5, $6, $7, $8, $9, NULLIF($10, '')::bigint, $11)
     RETURNING ${FILE_COLS}`,
    [
      input.siteId,
      input.documentId ?? null,
      input.versionNo ?? null,
      input.kind,
      safeFileName(input.fileName),
      input.mime,
      input.bytes.length,
      sha,
      key,
      input.uploadedBy ?? "",
      input.textContent ? input.textContent.slice(0, 200_000) : null,
    ]
  )
  return r.rows[0]
}

export async function attachFileToDocument(client: PoolClient, siteId: number, fileId: string, documentId: string, versionNo: number) {
  await client.query(
    `UPDATE edi_files SET document_id = $3::bigint, version_no = COALESCE(version_no, $4)
     WHERE site_id = $1 AND file_id = $2::bigint AND (document_id IS NULL OR document_id = $3::bigint)`,
    [siteId, fileId, documentId, versionNo]
  )
}

export async function listDocumentFiles(client: PoolClient, documentId: string): Promise<StoredFile[]> {
  const r = await client.query<StoredFile>(`SELECT ${FILE_COLS} FROM edi_files WHERE document_id = $1::bigint ORDER BY file_id`, [documentId])
  return r.rows
}

/** Чтение файла с проверкой целостности: хеш содержимого обязан совпасть с записанным. */
export async function readFileChecked(
  client: PoolClient,
  siteId: number,
  fileId: string
): Promise<{ meta: StoredFile & { storageKey: string; textContent: string | null }; bytes: Uint8Array }> {
  const r = await client.query<StoredFile & { storageKey: string; textContent: string | null }>(
    `SELECT ${FILE_COLS}, storage_key AS "storageKey", text_content AS "textContent" FROM edi_files WHERE site_id = $1 AND file_id = $2::bigint`,
    [siteId, fileId]
  )
  const meta = r.rows[0]
  if (!meta) throw new HttpError(404, "Файл не найден", "file_not_found")
  const bytes = await getStorage().get(meta.storageKey)
  if (sha256Hex(bytes) !== meta.sha256) throw new HttpError(500, "Нарушена целостность файла: хеш не совпадает", "file_integrity")
  return { meta, bytes }
}

/** Типы, которые можно показывать в браузере встраиванием. HTML/SVG сюда никогда не входят. */
export function inlineSafe(mime: string): boolean {
  return mime === "application/pdf" || mime === "image/png" || mime === "image/jpeg"
}
