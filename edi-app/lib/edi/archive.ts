import { zipSync } from "fflate"
import type { PoolClient } from "pg"
import { HttpError } from "../db.ts"
import type { Actor } from "./actor.ts"
import { actorEvent, recordEvent } from "./audit.ts"
import { documentDetail } from "./detail.ts"
import { docType } from "./doc-types.ts"
import { readFileChecked, safeFileName } from "./files.ts"
import { sha256Hex } from "./storage.ts"

/**
 * Выгрузка архива: для каждого документа — оригиналы без изменений, подписи, квитанции обмена,
 * снимки версий и история; в корне manifest.json с SHA-256 каждого файла для проверки целостности.
 */
export async function exportArchive(client: PoolClient, actor: Actor, ids: string[]): Promise<{ zip: Uint8Array; name: string }> {
  const list = [...new Set(ids)].slice(0, 200)
  if (!list.length) throw new HttpError(400, "Не выбраны документы", "no_ids")
  const files: Record<string, Uint8Array> = {}
  const manifest: Array<{ path: string; sha256: string; size: number; documentId: string; kind: string }> = []
  let total = 0
  const enc = new TextEncoder()
  const put = (path: string, bytes: Uint8Array, documentId: string, kind: string) => {
    total += bytes.length
    if (total > 500 * 1024 * 1024) throw new HttpError(413, "Выгрузка больше 500 МБ — выберите меньше документов", "export_too_large")
    files[path] = bytes
    manifest.push({ path, sha256: sha256Hex(bytes), size: bytes.length, documentId, kind })
  }
  for (const id of list) {
    const d = await documentDetail(client, actor, id)
    const folder = `${id}_${safeFileName(d.document.number || "без_номера").replace(/\s+/g, "_")}`
    for (const f of d.files) {
      const { bytes, meta } = await readFileChecked(client, actor.siteId, f.fileId)
      put(`${folder}/${meta.kind}/${f.fileId}_${meta.fileName}`, bytes, id, meta.kind)
    }
    const card = {
      document: d.document,
      type: d.type?.name,
      retention: retentionFor(d.document.docType, d.document.docDate),
      counterparty: d.counterparty,
      lines: d.lines,
      signatures: d.signatures,
      exchanges: d.exchanges,
      workflow: d.workflow,
      tasks: d.tasks,
      links: d.links,
      relations: d.relations,
    }
    put(`${folder}/card.json`, enc.encode(JSON.stringify(card, null, 2)), id, "card")
    const versions = await client.query(`SELECT version_no, snapshot, content_hash, reason, created_by_name, created_at, locked FROM edi_document_versions WHERE document_id = $1::bigint ORDER BY version_no`, [id])
    put(`${folder}/versions.json`, enc.encode(JSON.stringify(versions.rows, null, 2)), id, "versions")
    put(`${folder}/history.json`, enc.encode(JSON.stringify(d.history, null, 2)), id, "history")
  }
  const manifestJson = enc.encode(JSON.stringify({ exportedAt: new Date().toISOString(), exportedBy: actor.fio, organization: actor.orgName, files: manifest }, null, 2))
  files["manifest.json"] = manifestJson
  for (const id of list) await recordEvent(client, actorEvent(actor, "document.downloaded", id, { export: true }))
  return { zip: zipSync(files, { level: 6 }), name: `edi-archive-${new Date().toISOString().slice(0, 10)}.zip` }
}

export function retentionFor(code: string, docDate: string | null, overrideYears?: number | null) {
  const t = docType(code)
  const years = overrideYears ?? t?.retentionYears ?? 5
  // срок исчисляется после окончания года, в котором составлен документ
  const year = docDate ? Number(docDate.slice(0, 4)) : new Date().getFullYear()
  return { years, until: `${year + years}-12-31`, basis: t?.retentionBasis ?? "" }
}
