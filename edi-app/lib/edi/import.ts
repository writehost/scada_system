import { unzipSync } from "fflate"
import type { PoolClient } from "pg"
import { HttpError } from "../db.ts"
import { requirePermission, type Actor } from "./actor.ts"
import { actorEvent, recordEvent } from "./audit.ts"
import { findCounterpartyByInn } from "./counterparties.ts"
import { docType } from "./doc-types.ts"
import { createDocument, relateDocuments, type LineIn } from "./documents.ts"
import { attachFileToDocument, docxText, extOf, inspectUpload, saveFile, sniff } from "./files.ts"
import { wmsClientFor } from "./integrations/wms.ts"
import { matchLines, saveMapping, type MatchResult } from "./matching.ts"
import { notifyUsers } from "./notify.ts"
import { decodeText, guessRequisites, parseCsv, parseXlsx, rowsToLines } from "./parsers/table.ts"
import { isFnsInvoiceXml, parseUpd, type ParsedLine, type ParseIssue, type Party } from "./parsers/upd.ts"
import { decodeXmlBytes, flatText, parseXml, XmlError } from "./parsers/xml.ts"
import { enforceLimits } from "./saas.ts"
import { enrichImportedSignatures } from "./signatures.ts"
import { createReceiptDraft } from "./wms-receipt.ts"

const ZIP_LIMITS = { entries: 200, totalBytes: 150 * 1024 * 1024, ratio: 200 }

export type ImportLine = ParsedLine & {
  itemCode: string | null
  itemName: string | null
  matchSource: MatchResult["source"]
  uomFactor: number
  candidates: MatchResult["candidates"]
}

export type ParsedImport = {
  sourceKind: "fns_upd" | "table" | "unstructured"
  fileName: string
  mime: string
  docType: string | null
  direction: "incoming"
  number: string | null
  date: string | null
  formatCode: string | null
  formatVersion: string | null
  function: string | null
  currencyCode: string | null
  seller: Party | null
  buyer: Party | null
  counterparty: { id: string; name: string } | null
  basis: Array<{ name: string; number: string | null; date: string | null }>
  shipmentDate: string | null
  operation: string | null
  lines: ImportLine[]
  totals: { amountNet: number | null; vatAmount: number | null; amountTotal: number | null }
  related: Array<{ documentId: string; title: string; reason: string }>
  signatureFileIds: string[]
  previewText: string | null
  wmsAvailable: boolean
  wmsError: string | null
  tableHeader?: string[]
}

type Entry = { name: string; bytes: Uint8Array }

/** Распаковка контейнера с ограничениями: число файлов, суммарный объём, степень сжатия, вложенность. */
export function expandZip(bytes: Uint8Array): Entry[] {
  let total = 0
  let count = 0
  const out = unzipSync(bytes, {
    filter: (f) => {
      if (f.name.endsWith("/") || f.name.startsWith("__MACOSX/") || /(^|\/)\.[^/]+$/.test(f.name)) return false
      if (f.name.includes("..") || f.name.startsWith("/")) throw new HttpError(400, `Недопустимый путь в архиве: ${f.name}`, "zip_path")
      count += 1
      total += f.originalSize
      if (count > ZIP_LIMITS.entries) throw new HttpError(413, `В архиве больше ${ZIP_LIMITS.entries} файлов`, "zip_entries")
      if (total > ZIP_LIMITS.totalBytes) throw new HttpError(413, "Архив слишком большой после распаковки", "zip_size")
      if (f.size > 0 && f.originalSize / f.size > ZIP_LIMITS.ratio) throw new HttpError(413, `Подозрительная степень сжатия: ${f.name}`, "zip_bomb")
      return true
    },
  })
  return Object.entries(out).map(([name, data]) => {
    if (sniff(data) === "zip" && extOf(name) === "zip") throw new HttpError(400, "Вложенные ZIP-архивы не обрабатываются", "zip_nested")
    return { name: name.split("/").pop() || name, bytes: data }
  })
}

const SIGNATURE_EXT = new Set(["sig", "p7s", "sgn"])

function emptyParsed(fileName: string, mime: string): ParsedImport {
  return {
    sourceKind: "unstructured",
    fileName,
    mime,
    docType: null,
    direction: "incoming",
    number: null,
    date: null,
    formatCode: null,
    formatVersion: null,
    function: null,
    currencyCode: null,
    seller: null,
    buyer: null,
    counterparty: null,
    basis: [],
    shipmentDate: null,
    operation: null,
    lines: [],
    totals: { amountNet: null, vatAmount: null, amountTotal: null },
    related: [],
    signatureFileIds: [],
    previewText: null,
    wmsAvailable: false,
    wmsError: null,
  }
}

function asImportLines(lines: ParsedLine[]): ImportLine[] {
  return lines.map((l) => ({ ...l, itemCode: null, itemName: null, matchSource: null, uomFactor: 1, candidates: [] }))
}

/** Разбор одного файла: тип по содержимому, извлечение реквизитов и строк. */
export function parseFile(name: string, bytes: Uint8Array, ext: string, mime: string): { parsed: ParsedImport; issues: ParseIssue[]; text: string | null } {
  const parsed = emptyParsed(name, mime)
  const issues: ParseIssue[] = []
  if (ext === "xml") {
    let root
    try {
      root = parseXml(decodeXmlBytes(bytes).text)
    } catch (e) {
      issues.push({ level: "error", code: "xml_invalid", message: e instanceof XmlError ? `XML не прочитан: ${e.message}` : "XML не прочитан" })
      return { parsed, issues, text: null }
    }
    if (isFnsInvoiceXml(root)) {
      const u = parseUpd(root)
      Object.assign(parsed, {
        sourceKind: "fns_upd",
        docType: u.knd === "1115133" ? "ukd" : u.docType,
        number: u.number,
        date: u.date,
        formatCode: u.formatCode,
        formatVersion: u.formatVersion,
        function: u.function,
        currencyCode: u.currencyCode,
        seller: u.seller,
        buyer: u.buyer,
        basis: u.basis,
        shipmentDate: u.shipmentDate,
        operation: u.operation,
        lines: asImportLines(u.lines),
        totals: u.totals,
      })
      issues.push(...u.issues)
      return { parsed, issues, text: u.searchText }
    }
    issues.push({ level: "warning", code: "xml_unknown", message: `XML с корнем <${root.name}> не распознан как поддерживаемый формат; сохранится как файл` })
    return { parsed, issues, text: flatText(root) }
  }
  if (ext === "csv" || ext === "xlsx") {
    let rows: string[][]
    try {
      rows = ext === "csv" ? parseCsv(decodeText(bytes)) : parseXlsx(bytes)
    } catch (e) {
      issues.push({ level: "error", code: "table_invalid", message: `Таблица не прочитана: ${e instanceof Error ? e.message : e}` })
      return { parsed, issues, text: null }
    }
    const t = rowsToLines(rows)
    parsed.sourceKind = "table"
    parsed.lines = asImportLines(t.lines)
    parsed.tableHeader = t.headerRow
    if (!t.lines.length) issues.push({ level: "error", code: "table_empty", message: "Не найдены строки с наименованием товара" })
    if (!t.mapping.includes("qty")) issues.push({ level: "warning", code: "table_no_qty", message: "Не найден столбец количества" })
    issues.push({ level: "info", code: "table_header", message: "Номер, дату и контрагента укажите вручную — в таблице их нет" })
    return { parsed, issues, text: rows.slice(0, 2000).map((r) => r.join(" ")).join("\n") }
  }
  if (ext === "docx" || ext === "txt") {
    const text = ext === "docx" ? docxText(bytes) : decodeText(bytes)
    parsed.previewText = text.slice(0, 20000)
    const g = guessRequisites(text)
    parsed.number = g.number
    parsed.date = g.date
    parsed.totals.amountTotal = g.amountTotal
    if (g.inns.length) parsed.seller = { name: "", inn: g.inns[0], kpp: null, address: null, bankName: null, bankBik: null, bankAccount: null, corrAccount: null, phone: null, email: null, isIp: g.inns[0].length === 12 }
    issues.push({ level: "info", code: "unstructured", message: "Неструктурированный документ: реквизиты найдены по тексту, проверьте их" })
    return { parsed, issues, text }
  }
  issues.push({ level: "info", code: "unstructured", message: "Реквизиты из этого файла не извлекаются автоматически (распознавание текста не подключено) — заполните вручную" })
  return { parsed, issues, text: null }
}

async function formatIssues(client: PoolClient, formatCode: string | null, date: string | null): Promise<ParseIssue[]> {
  if (!formatCode || !date) return []
  const r = await client.query<{ name: string; valid_from: string | null; valid_to: string | null; note: string | null }>(
    `SELECT name, valid_from::text, valid_to::text, note FROM edi_formats WHERE format_code = $1`,
    [formatCode]
  )
  const f = r.rows[0]
  if (!f) return [{ level: "warning", code: "format_unregistered", message: `Формат ${formatCode} отсутствует в реестре форматов` }]
  if ((f.valid_from && date < f.valid_from) || (f.valid_to && date > f.valid_to)) {
    return [{ level: "warning", code: "format_not_applicable", message: `${f.name} не применяется на дату документа ${date}. ${f.note ?? ""}`.trim() }]
  }
  return []
}

/** Контрагент, связанные документы, сопоставление номенклатуры. Повторно вызывается после правок пользователя. */
export async function analyze(client: PoolClient, actor: Actor, parsed: ParsedImport, baseIssues: ParseIssue[]): Promise<{ parsed: ParsedImport; issues: ParseIssue[] }> {
  const issues = baseIssues.filter((i) => !["counterparty_unknown", "buyer_mismatch", "duplicate", "unmatched", "wms_unavailable", "format_not_applicable", "format_unregistered"].includes(i.code))
  issues.push(...(await formatIssues(client, parsed.formatCode, parsed.date)))
  if (!parsed.counterparty && parsed.seller?.inn) {
    const cp = await findCounterpartyByInn(client, actor.siteId, parsed.seller.inn, parsed.seller.kpp)
    if (cp) parsed.counterparty = { id: cp.id, name: cp.name }
  }
  if (parsed.counterparty) {
    const exists = await client.query(`SELECT 1 FROM edi_counterparties WHERE site_id = $1 AND counterparty_id = $2::bigint`, [actor.siteId, parsed.counterparty.id])
    if (!exists.rows[0]) parsed.counterparty = null
  }
  if (!parsed.counterparty && parsed.sourceKind === "fns_upd") {
    issues.push({ level: "warning", code: "counterparty_unknown", message: `Контрагент ${parsed.seller?.name ?? ""} (ИНН ${parsed.seller?.inn ?? "—"}) не найден в справочнике — создайте его` })
  }
  const org = await client.query<{ inn: string | null }>(`SELECT inn FROM edi_org_settings WHERE site_id = $1`, [actor.siteId])
  const ourInn = org.rows[0]?.inn
  if (ourInn && parsed.buyer?.inn && parsed.buyer.inn !== ourInn) {
    issues.push({ level: "warning", code: "buyer_mismatch", message: `Покупатель в документе (ИНН ${parsed.buyer.inn}) — не ваша организация (ИНН ${ourInn})` })
  }
  parsed.related = []
  if (parsed.counterparty && parsed.number) {
    const dup = await client.query<{ document_id: string; title: string }>(
      `SELECT document_id::text, title FROM edi_documents WHERE site_id = $1 AND counterparty_id = $2::bigint AND lower(number) = lower($3)
         AND doc_date = $4::date AND deleted_at IS NULL LIMIT 3`,
      [actor.siteId, parsed.counterparty.id, parsed.number, parsed.date]
    )
    for (const d of dup.rows) {
      parsed.related.push({ documentId: d.document_id, title: d.title, reason: "Тот же номер и дата" })
      issues.push({ level: "warning", code: "duplicate", message: `Похоже, документ уже загружен: ${d.title}` })
    }
    for (const b of parsed.basis.filter((x) => x.number)) {
      const rel = await client.query<{ document_id: string; title: string }>(
        `SELECT document_id::text, title FROM edi_documents WHERE site_id = $1 AND counterparty_id = $2::bigint AND lower(number) = lower($3)
           AND doc_type IN ('contract','supplementary','specification','invoice','request') AND deleted_at IS NULL LIMIT 3`,
        [actor.siteId, parsed.counterparty.id, b.number]
      )
      for (const d of rel.rows) parsed.related.push({ documentId: d.document_id, title: d.title, reason: `Основание: ${b.name} № ${b.number}` })
    }
  }
  if (parsed.lines.length) {
    const cpRow = parsed.counterparty
      ? (await client.query<{ wms_supplier_code: string | null }>(`SELECT wms_supplier_code FROM edi_counterparties WHERE counterparty_id = $1::bigint`, [parsed.counterparty.id])).rows[0]
      : null
    const wms = await wmsClientFor(client, actor.siteId, actor.siteCode)
    const m = await matchLines(client, actor.siteId, wms, { inn: parsed.seller?.inn ?? null, name: parsed.seller?.name ?? null, wmsSupplierCode: cpRow?.wms_supplier_code ?? null }, parsed.lines)
    parsed.wmsAvailable = m.wmsAvailable
    parsed.wmsError = m.wmsError
    parsed.lines = parsed.lines.map((l, i) => {
      if (l.itemCode && l.matchSource === null) return l // ручной выбор пользователя сохраняется
      const r = m.results[i]
      return { ...l, itemCode: r.itemCode, itemName: r.itemName, matchSource: r.source, uomFactor: r.uomFactor, candidates: r.candidates }
    })
    const unmatched = parsed.lines.filter((l) => !l.itemCode)
    if (unmatched.length) {
      issues.push({ level: "warning", code: "unmatched", message: `Не сопоставлено с номенклатурой WMS: ${unmatched.length} из ${parsed.lines.length} строк` })
    }
    if (!m.wmsAvailable && m.wmsError) issues.push({ level: "info", code: "wms_unavailable", message: `Сопоставление по WMS недоступно: ${m.wmsError}` })
  }
  return { parsed, issues }
}

export type ImportRow = { importId: string; status: string; parsed: ParsedImport; issues: ParseIssue[]; documentId: string | null; fileId: string | null; createdAt: string }

/** Загрузка файлов: каждый документ (или документ из ZIP) — отдельная запись импорта для проверки. */
export async function ingestFiles(client: PoolClient, actor: Actor, files: Entry[]): Promise<ImportRow[]> {
  requirePermission(actor, "edi.import")
  if (files.length === 0) throw new HttpError(400, "Нет файлов", "no_files")
  if (files.length > 50) throw new HttpError(400, "За раз можно загрузить не больше 50 файлов", "too_many_files")
  const entries: Array<Entry & { fromZip?: string }> = []
  for (const f of files) {
    const { ext } = inspectUpload(f.name, f.bytes)
    await enforceLimits(client, actor.siteId, { bytes: f.bytes.length })
    if (ext === "zip") for (const e of expandZip(f.bytes)) entries.push({ ...e, fromZip: f.name })
    else entries.push(f)
  }
  const batchKey = `${actor.userId}-${Date.now()}`
  const signatures = new Map<string, Entry>()
  const primaries: Array<Entry & { fromZip?: string }> = []
  for (const e of entries) {
    if (SIGNATURE_EXT.has(extOf(e.name))) signatures.set(e.name.toLowerCase(), e)
    else primaries.push(e)
  }
  const out: ImportRow[] = []
  for (const e of primaries) {
    let ext: string
    let mime: string
    try {
      ;({ ext, mime } = inspectUpload(e.name, e.bytes))
    } catch (err) {
      if (e.fromZip) continue // недопустимые вложения архива пропускаются, сам архив принят
      throw err
    }
    const { parsed, issues, text } = parseFile(e.name, e.bytes, ext, mime)
    const file = await saveFile(client, { siteId: actor.siteId, kind: "original", fileName: e.name, bytes: e.bytes, mime, uploadedBy: actor.userId, textContent: text })
    const base = e.name.replace(/\.[^.]+$/, "").toLowerCase()
    for (const [sigName, sig] of signatures) {
      const stem = sigName.replace(/\.(sig|p7s|sgn)$/, "")
      if (stem === e.name.toLowerCase() || stem === base) {
        const sf = await saveFile(client, { siteId: actor.siteId, kind: "signature", fileName: sig.name, bytes: sig.bytes, mime: "application/pkcs7-signature", uploadedBy: actor.userId })
        parsed.signatureFileIds.push(sf.fileId)
        signatures.delete(sigName)
      }
    }
    const previous = await client.query<{ import_id: string; document_id: string | null }>(
      `SELECT i.import_id::text, i.document_id::text FROM edi_imports i JOIN edi_files f ON f.file_id = i.file_id
       WHERE i.site_id = $1 AND f.sha256 = $2 AND i.status = 'confirmed' LIMIT 1`,
      [actor.siteId, file.sha256]
    )
    if (previous.rows[0]) {
      issues.push({ level: "warning", code: "already_imported", message: `Этот файл уже загружен ранее (документ #${previous.rows[0].document_id})` })
    }
    const a = await analyze(client, actor, parsed, issues)
    const status = a.issues.some((i) => i.level === "error") ? "needs_review" : "parsed"
    const r = await client.query<{ import_id: string; created_at: string }>(
      `INSERT INTO edi_imports (site_id, created_by, status, source, file_id, batch_key, detected_type, format_code, parsed, issues)
       VALUES ($1, $2::bigint, $3, $4, $5::bigint, $6, $7, $8, $9::jsonb, $10::jsonb) RETURNING import_id::text, created_at`,
      [actor.siteId, actor.userId, status, e.fromZip ? "zip" : "upload", file.fileId, batchKey, a.parsed.docType, a.parsed.formatCode, JSON.stringify(a.parsed), JSON.stringify(a.issues)]
    )
    out.push({ importId: r.rows[0].import_id, status, parsed: a.parsed, issues: a.issues, documentId: null, fileId: file.fileId, createdAt: r.rows[0].created_at })
  }
  for (const orphan of signatures.values()) {
    out.push({
      importId: "",
      status: "skipped",
      parsed: emptyParsed(orphan.name, "application/pkcs7-signature"),
      issues: [{ level: "warning", code: "orphan_signature", message: `Подпись ${orphan.name} не сопоставлена ни с одним файлом` }],
      documentId: null,
      fileId: null,
      createdAt: new Date().toISOString(),
    })
  }
  return out
}

export async function getImport(client: PoolClient, actor: Actor, importId: string): Promise<ImportRow> {
  if (!/^\d+$/.test(importId)) throw new HttpError(404, "Загрузка не найдена", "not_found")
  const r = await client.query(
    `SELECT import_id::text AS "importId", status, parsed, issues, document_id::text AS "documentId", file_id::text AS "fileId", created_at AS "createdAt"
     FROM edi_imports WHERE site_id = $1 AND import_id = $2::bigint`,
    [actor.siteId, importId]
  )
  if (!r.rows[0]) throw new HttpError(404, "Загрузка не найдена", "not_found")
  return r.rows[0] as ImportRow
}

export async function listImports(client: PoolClient, actor: Actor, status?: string) {
  const r = await client.query(
    `SELECT i.import_id::text AS "importId", i.status, i.detected_type AS "detectedType", i.document_id::text AS "documentId",
            i.parsed->>'fileName' AS "fileName", i.parsed->>'number' AS number, i.parsed->>'date' AS date,
            COALESCE(i.parsed#>>'{counterparty,name}', i.parsed#>>'{seller,name}') AS "counterpartyName",
            jsonb_array_length(i.issues) AS "issueCount", i.created_at AS "createdAt", u.display_name AS "createdBy"
     FROM edi_imports i LEFT JOIN wms_users u ON u.user_id = i.created_by
     WHERE i.site_id = $1 AND ($2::text = '' OR i.status = $2)
     ORDER BY i.import_id DESC LIMIT 100`,
    [actor.siteId, status ?? ""]
  )
  return r.rows
}

export type ImportEdits = {
  docType?: string
  number?: string | null
  date?: string | null
  counterpartyId?: string | null
  responsibleUserId?: string | null
  lines?: Array<{ lineNo: number; itemCode: string | null; itemName?: string | null; uomFactor?: number }>
}

/** Правки пользователя в предпросмотре и повторный анализ (без создания документа). */
export async function updateImport(client: PoolClient, actor: Actor, importId: string, edits: ImportEdits): Promise<ImportRow> {
  requirePermission(actor, "edi.import")
  const imp = await getImport(client, actor, importId)
  if (!["parsed", "needs_review"].includes(imp.status)) throw new HttpError(409, "Загрузка уже обработана", "import_done")
  const p = imp.parsed
  if (edits.docType !== undefined) {
    if (edits.docType && !docType(edits.docType)) throw new HttpError(400, "Неизвестный тип документа", "bad_type")
    p.docType = edits.docType || null
  }
  if (edits.number !== undefined) p.number = edits.number?.trim() || null
  if (edits.date !== undefined) p.date = edits.date || null
  if (edits.counterpartyId !== undefined) {
    if (edits.counterpartyId) {
      const cp = await client.query<{ name: string }>(`SELECT name FROM edi_counterparties WHERE site_id = $1 AND counterparty_id = $2::bigint`, [actor.siteId, edits.counterpartyId])
      if (!cp.rows[0]) throw new HttpError(400, "Контрагент не найден", "counterparty_not_found")
      p.counterparty = { id: edits.counterpartyId, name: cp.rows[0].name }
    } else p.counterparty = null
  }
  for (const e of edits.lines ?? []) {
    const l = p.lines.find((x) => x.lineNo === e.lineNo)
    if (!l) continue
    l.itemCode = e.itemCode?.trim() || null
    l.itemName = e.itemName ?? null
    l.matchSource = null
    l.uomFactor = e.uomFactor && e.uomFactor > 0 ? e.uomFactor : l.uomFactor
  }
  const baseIssues = imp.issues.filter((i) => !(["no_number", "no_date"].includes(i.code) && ((i.code === "no_number" && p.number) || (i.code === "no_date" && p.date))))
  const a = await analyze(client, actor, p, baseIssues)
  const status = a.issues.some((i) => i.level === "error") ? "needs_review" : "parsed"
  await client.query(`UPDATE edi_imports SET parsed = $3::jsonb, issues = $4::jsonb, status = $5, detected_type = $6, updated_at = now() WHERE site_id = $1 AND import_id = $2::bigint`, [
    actor.siteId,
    importId,
    JSON.stringify(a.parsed),
    JSON.stringify(a.issues),
    status,
    a.parsed.docType,
  ])
  return getImport(client, actor, importId)
}

/**
 * Подтверждение: создаётся документ (статус «Новый входящий»), оригинал и подписи прикрепляются
 * без изменений, подтверждённые сопоставления сохраняются, по желанию — заказ на приход в WMS.
 */
export async function confirmImport(
  client: PoolClient,
  actor: Actor,
  importId: string,
  opts: { saveMappings?: boolean; createWmsReceipt?: boolean; responsibleUserId?: string | null; edits?: ImportEdits }
) {
  requirePermission(actor, "edi.import")
  if (opts.edits) await updateImport(client, actor, importId, opts.edits)
  const lock = await client.query(`SELECT status FROM edi_imports WHERE site_id = $1 AND import_id = $2::bigint FOR UPDATE`, [actor.siteId, importId])
  if (!lock.rows[0]) throw new HttpError(404, "Загрузка не найдена", "not_found")
  const imp = await getImport(client, actor, importId)
  if (!["parsed", "needs_review"].includes(imp.status)) throw new HttpError(409, "Загрузка уже обработана", "import_done")
  const p = imp.parsed
  const blocking = imp.issues.filter((i) => i.level === "error" && !["ukd_unsupported"].includes(i.code))
  if (blocking.length) throw new HttpError(409, `Исправьте ошибки: ${blocking.map((b) => b.message).join("; ")}`, "import_errors", blocking)
  if (!p.docType) throw new HttpError(400, "Выберите тип документа", "type_required")
  const type = docType(p.docType)!
  if (type.hasCounterparty && !p.counterparty) throw new HttpError(400, "Выберите или создайте контрагента", "counterparty_required")

  const lines: LineIn[] = p.lines.map((l) => ({
    name: l.name,
    supplierCode: l.supplierCode,
    gtin: l.gtin,
    okei: l.okei,
    uomName: l.uomName,
    qty: l.qty,
    price: l.price,
    amountNet: l.amountNet,
    vatRate: l.vatRate,
    vatAmount: l.vatAmount,
    amountTotal: l.amountTotal,
    itemCode: l.itemCode,
    itemName: l.itemName,
    matchSource: l.matchSource ?? (l.itemCode ? "manual" : null),
    uomFactor: l.uomFactor,
    markingCodes: l.markingCodes,
    extra: { packageCodes: l.packageCodes, country: l.country, customsDeclaration: l.customsDeclaration },
  }))
  const fields: Record<string, unknown> = {}
  if (p.function) fields.function = p.function
  if (p.basis[0]) fields.basis = [p.basis[0].name, p.basis[0].number ? `№ ${p.basis[0].number}` : "", p.basis[0].date ? `от ${p.basis[0].date}` : ""].filter(Boolean).join(" ")
  if (p.shipmentDate) fields.shipmentDate = p.shipmentDate
  if (p.operation) fields.operation = p.operation
  if (p.sourceKind !== "fns_upd" && p.totals.amountTotal != null && !lines.length) fields.totalOverride = p.totals.amountTotal
  fields.parsed = { seller: p.seller, buyer: p.buyer, totals: p.totals, formatVersion: p.formatVersion, fileName: p.fileName }

  const doc = await createDocument(client, actor, {
    docType: p.docType,
    direction: "incoming",
    number: p.number,
    docDate: p.date,
    counterpartyId: p.counterparty?.id ?? null,
    fields,
    lines: type.hasLines ? lines : [],
    responsibleUserId: opts.responsibleUserId ?? actor.userId,
    source: "import",
    formatCode: p.formatCode,
    status: "received",
    basis: typeof fields.basis === "string" ? fields.basis : null,
  })
  if (imp.fileId) await attachFileToDocument(client, actor.siteId, imp.fileId, doc.documentId, 1)
  for (const sigId of p.signatureFileIds) {
    await attachFileToDocument(client, actor.siteId, sigId, doc.documentId, 1)
    if (imp.fileId) {
      await client.query(
        `INSERT INTO edi_signatures (site_id, document_id, version_no, signed_file_id, signature_file_id, kind, source, side, created_by)
         VALUES ($1, $2::bigint, 1, $3::bigint, $4::bigint, 'cades_detached', 'import', 'counterparty', $5::bigint)`,
        [actor.siteId, doc.documentId, imp.fileId, sigId, actor.userId]
      )
    }
  }
  if (p.signatureFileIds.length) await enrichImportedSignatures(client, actor.siteId, doc.documentId)
  for (const r of p.related) {
    if (r.reason.startsWith("Основание")) await relateDocuments(client, actor, doc.documentId, r.documentId, "basis")
  }
  // поиск по содержимому файла
  await client.query(`UPDATE edi_documents d SET search_text = left(d.search_text || ' ' || COALESCE((SELECT left(text_content, 200000) FROM edi_files WHERE file_id = $2::bigint), ''), 400000) WHERE document_id = $1::bigint`, [
    doc.documentId,
    imp.fileId,
  ])
  const mappingResults: Array<{ lineNo: number; wmsAlias: string; error?: string }> = []
  if (opts.saveMappings !== false && p.seller?.inn) {
    const wms = await wmsClientFor(client, actor.siteId, actor.siteCode)
    const cp = p.counterparty
      ? (await client.query<{ wms_supplier_code: string | null }>(`SELECT wms_supplier_code FROM edi_counterparties WHERE counterparty_id = $1::bigint`, [p.counterparty.id])).rows[0]
      : null
    for (const l of p.lines) {
      // сохраняем то, что человек подтвердил: ручной выбор и автоматические совпадения кроме уже сохранённых
      if (!l.itemCode || l.matchSource === "mapping") continue
      const r = await saveMapping(client, actor, l.matchSource === null ? wms : null, {
        supplierInn: p.seller.inn,
        supplierName: p.seller.name,
        wmsSupplierCode: cp?.wms_supplier_code ?? null,
        line: { name: l.name, supplierCode: l.supplierCode, gtin: l.gtin },
        itemCode: l.itemCode,
        itemName: l.itemName,
        uomFactor: l.uomFactor,
      })
      mappingResults.push({ lineNo: l.lineNo, ...r })
    }
  }
  await client.query(`UPDATE edi_imports SET status = 'confirmed', document_id = $3::bigint, updated_at = now() WHERE site_id = $1 AND import_id = $2::bigint`, [
    actor.siteId,
    importId,
    doc.documentId,
  ])
  await recordEvent(client, actorEvent(actor, "document.imported", doc.documentId, { importId, file: p.fileName, format: p.formatCode }))
  if (opts.responsibleUserId && opts.responsibleUserId !== actor.userId) {
    await notifyUsers(client, {
      siteId: actor.siteId,
      userIds: [opts.responsibleUserId],
      event: "document.received",
      title: "Получен новый документ",
      body: doc.title,
      documentId: doc.documentId,
      dedupeKey: `received:${doc.documentId}`,
    })
  }
  let wmsReceipt: { inboundId?: string; error?: string } | null = null
  if (opts.createWmsReceipt) {
    await client.query("SAVEPOINT wms_receipt")
    try {
      wmsReceipt = await createReceiptDraft(client, actor, doc.documentId)
      await client.query("RELEASE SAVEPOINT wms_receipt")
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT wms_receipt")
      wmsReceipt = { error: e instanceof Error ? e.message : String(e) }
    }
  }
  return { documentId: doc.documentId, mappings: mappingResults, wmsReceipt }
}

export async function discardImport(client: PoolClient, actor: Actor, importId: string) {
  requirePermission(actor, "edi.import")
  const r = await client.query(
    `UPDATE edi_imports SET status = 'discarded', updated_at = now() WHERE site_id = $1 AND import_id = $2::bigint AND status IN ('parsed','needs_review')`,
    [actor.siteId, importId]
  )
  if (!r.rowCount) throw new HttpError(409, "Загрузка уже обработана", "import_done")
}
