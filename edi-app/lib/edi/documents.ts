import type { PoolClient } from "pg"
import { HttpError } from "../db.ts"
import { can, requirePermission, type Actor } from "./actor.ts"
import { actorEvent, recordEvent } from "./audit.ts"
import { DOC_TYPES, docType, isEditableStatus, MANUAL_TRANSITIONS, STATUS_LABEL, type DocTypeDef } from "./doc-types.ts"
import { computeLine, num, sumLines } from "./money.ts"
import { saveFile } from "./files.ts"
import { enforceLimits } from "./saas.ts"
import { sha256Hex } from "./storage.ts"

export type LineIn = {
  name?: string
  supplierCode?: string | null
  gtin?: string | null
  okei?: string | null
  uomName?: string | null
  qty?: unknown
  price?: unknown
  amountNet?: unknown
  vatRate?: string | null
  vatAmount?: unknown
  amountTotal?: unknown
  itemCode?: string | null
  itemName?: string | null
  matchSource?: string | null
  uomFactor?: unknown
  markingCodes?: string[]
  lotCode?: string | null
  extra?: Record<string, unknown>
}

export type DocumentIn = {
  docType: string
  direction: string
  number?: string | null
  docDate?: string | null
  title?: string | null
  counterpartyId?: string | null
  currency?: string | null
  fields?: Record<string, unknown>
  lines?: LineIn[]
  responsibleUserId?: string | null
  department?: string | null
  confidential?: boolean
  dueDate?: string | null
  basis?: string | null
  templateId?: string | null
  source?: string
  formatCode?: string | null
  status?: string
  extraSearchText?: string
}

export type NormalizedLine = ReturnType<typeof normalizeLines>[number]

/* ---------- доступ ---------- */

/**
 * SQL-условие видимости документа для пользователя. Проверяется на сервере для каждого запроса:
 * организация, удаление, конфиденциальность, явный доступ, участие в маршруте (включая делегирование).
 */
export function visibility(actor: Actor, alias = "d", first = 1): { sql: string; params: unknown[] } {
  const p = (i: number) => `$${first + i}`
  const sql = `${alias}.site_id = ${p(0)} AND ${alias}.deleted_at IS NULL AND (
    (${p(2)}::boolean AND (NOT ${alias}.confidential OR ${p(3)}::boolean))
    OR ${alias}.author_user_id = ${p(1)}::bigint
    OR ${alias}.responsible_user_id = ${p(1)}::bigint
    OR EXISTS (SELECT 1 FROM edi_document_access a WHERE a.document_id = ${alias}.document_id AND a.user_id = ${p(1)}::bigint)
    OR EXISTS (SELECT 1 FROM edi_tasks t WHERE t.document_id = ${alias}.document_id AND (
         t.assignee_user_id = ${p(1)}::bigint OR t.assignee_user_id IN (${delegatorsSql(p(0), p(1))})))
  )`
  return {
    sql,
    params: [actor.siteId, actor.userId, can(actor, "edi.doc.read"), can(actor, "edi.doc.read_confidential")],
  }
}

/** Пользователи, которые сейчас делегировали свои задачи этому пользователю. */
export function delegatorsSql(siteParam: string, userParam: string): string {
  return `SELECT dl.from_user_id FROM edi_delegations dl
          WHERE dl.site_id = ${siteParam} AND dl.to_user_id = ${userParam}::bigint AND dl.revoked_at IS NULL
            AND dl.starts_at <= now() AND (dl.ends_at IS NULL OR dl.ends_at > now())`
}

export type DocRow = {
  documentId: string
  docType: string
  direction: string
  number: string | null
  docDate: string | null
  title: string
  counterpartyId: string | null
  currency: string
  amountNet: string | null
  amountVat: string | null
  amountTotal: string | null
  status: string
  exchangeStatus: string
  wmsStatus: string | null
  authorUserId: string | null
  responsibleUserId: string | null
  department: string | null
  confidential: boolean
  currentVersion: number
  signedVersion: number | null
  fields: Record<string, unknown>
  formatCode: string | null
  source: string
  templateId: string | null
  dueDate: string | null
  basis: string | null
  lastAction: string | null
  lastActionAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export const DOC_COLS = `d.document_id::text AS "documentId", d.doc_type AS "docType", d.direction, d.number,
  to_char(d.doc_date, 'YYYY-MM-DD') AS "docDate", d.title, d.counterparty_id::text AS "counterpartyId", d.currency,
  d.amount_net::text AS "amountNet", d.amount_vat::text AS "amountVat", d.amount_total::text AS "amountTotal",
  d.status, d.exchange_status AS "exchangeStatus", d.wms_status AS "wmsStatus",
  d.author_user_id::text AS "authorUserId", d.responsible_user_id::text AS "responsibleUserId", d.department,
  d.confidential, d.current_version AS "currentVersion", d.signed_version AS "signedVersion", d.fields,
  d.format_code AS "formatCode", d.source, d.template_id::text AS "templateId",
  to_char(d.due_date, 'YYYY-MM-DD') AS "dueDate", d.basis, d.last_action AS "lastAction", d.last_action_at AS "lastActionAt",
  d.archived_at AS "archivedAt", d.created_at AS "createdAt", d.updated_at AS "updatedAt"`

export async function getDocument(client: PoolClient, actor: Actor, documentId: string, opts?: { forUpdate?: boolean }): Promise<DocRow> {
  if (!/^\d{1,18}$/.test(String(documentId))) throw new HttpError(404, "Документ не найден", "not_found")
  const v = visibility(actor, "d", 2)
  const r = await client.query<DocRow>(
    `SELECT ${DOC_COLS} FROM edi_documents d WHERE d.document_id = $1::bigint AND ${v.sql}${opts?.forUpdate ? " FOR UPDATE OF d" : ""}`,
    [documentId, ...v.params]
  )
  if (!r.rows[0]) throw new HttpError(404, "Документ не найден", "not_found")
  return r.rows[0]
}

/* ---------- нормализация ---------- */

function trimOrNull(v: unknown, max = 500): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}

function isoDateOrNull(v: unknown): string | null {
  const s = trimOrNull(v, 40)
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s) || /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s)
  if (!m) throw new HttpError(400, `Некорректная дата: ${s}`, "bad_date")
  const iso = m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`
  if (Number.isNaN(Date.parse(iso))) throw new HttpError(400, `Некорректная дата: ${s}`, "bad_date")
  return iso
}

export function normalizeLines(lines: LineIn[] | undefined) {
  const list = Array.isArray(lines) ? lines : []
  if (list.length > 5000) throw new HttpError(400, "Слишком много строк (максимум 5000)", "too_many_lines")
  return list
    .filter((l) => trimOrNull(l.name) || trimOrNull(l.itemCode))
    .map((l, i) => {
      const c = computeLine(l)
      if (c.qty < 0) throw new HttpError(400, `Строка ${i + 1}: отрицательное количество`, "bad_qty")
      return {
        lineNo: i + 1,
        name: trimOrNull(l.name, 1000) ?? trimOrNull(l.itemName, 1000) ?? "",
        supplierCode: trimOrNull(l.supplierCode, 100),
        gtin: trimOrNull(l.gtin, 14),
        okei: trimOrNull(l.okei, 10),
        uomName: trimOrNull(l.uomName, 40),
        qty: c.qty,
        price: c.price,
        amountNet: c.amountNet,
        vatRate: trimOrNull(l.vatRate, 20),
        vatAmount: c.vatAmount,
        amountTotal: c.amountTotal,
        itemCode: trimOrNull(l.itemCode, 100),
        itemName: trimOrNull(l.itemName, 500),
        matchSource: trimOrNull(l.matchSource, 40),
        uomFactor: num(l.uomFactor) ?? 1,
        markingCodes: Array.isArray(l.markingCodes) ? l.markingCodes.map(String).slice(0, 10000) : [],
        lotCode: trimOrNull(l.lotCode, 100),
        extra: l.extra && typeof l.extra === "object" ? l.extra : {},
      }
    })
}

function cleanFields(type: DocTypeDef, fields: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const src = fields && typeof fields === "object" ? fields : {}
  for (const [k, v] of Object.entries(src)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k)) continue
    const def = type.fields.find((f) => f.key === k)
    if (def?.type === "date" && v) out[k] = isoDateOrNull(v)
    else if ((def?.type === "number" || def?.type === "money") && v !== "" && v != null) out[k] = num(v)
    else if (def?.type === "boolean") out[k] = Boolean(v)
    else if (typeof v === "string") out[k] = v.slice(0, 20000)
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v
    else if (k.startsWith("custom") || k === "parsed" || k === "wms") out[k] = v
  }
  return out
}

/* ---------- версии ---------- */

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, stable((value as Record<string, unknown>)[k])])
    )
  }
  return value
}

export function contentHash(snapshot: unknown): string {
  return sha256Hex(JSON.stringify(stable(snapshot)))
}

async function loadLines(client: PoolClient, documentId: string) {
  const r = await client.query(
    `SELECT line_no AS "lineNo", name, supplier_code AS "supplierCode", gtin, okei, uom_name AS "uomName",
            qty::float8 AS qty, price::float8 AS price, amount_net::float8 AS "amountNet", vat_rate AS "vatRate",
            vat_amount::float8 AS "vatAmount", amount_total::float8 AS "amountTotal", item_code AS "itemCode",
            item_name AS "itemName", match_source AS "matchSource", uom_factor::float8 AS "uomFactor",
            marking_codes AS "markingCodes", lot_code AS "lotCode", extra
     FROM edi_document_lines WHERE document_id = $1::bigint ORDER BY line_no`,
    [documentId]
  )
  return r.rows as NormalizedLine[]
}

export async function buildSnapshot(client: PoolClient, documentId: string) {
  const d = await client.query(
    `SELECT d.doc_type, d.direction, d.number, to_char(d.doc_date, 'YYYY-MM-DD') AS doc_date, d.title, d.currency,
            d.amount_net::text, d.amount_vat::text, d.amount_total::text, d.fields, d.basis,
            to_char(d.due_date, 'YYYY-MM-DD') AS due_date, d.department,
            c.name AS cp_name, c.inn AS cp_inn, c.kpp AS cp_kpp
     FROM edi_documents d LEFT JOIN edi_counterparties c ON c.counterparty_id = d.counterparty_id
     WHERE d.document_id = $1::bigint`,
    [documentId]
  )
  const h = d.rows[0]
  const lines = await loadLines(client, documentId)
  return {
    header: {
      docType: h.doc_type,
      direction: h.direction,
      number: h.number,
      docDate: h.doc_date,
      title: h.title,
      currency: h.currency,
      amountNet: h.amount_net,
      amountVat: h.amount_vat,
      amountTotal: h.amount_total,
      fields: h.fields,
      basis: h.basis,
      dueDate: h.due_date,
      department: h.department,
      counterparty: h.cp_name ? { name: h.cp_name, inn: h.cp_inn, kpp: h.cp_kpp } : null,
    },
    lines,
  }
}

async function writeVersion(client: PoolClient, actor: Actor | null, documentId: string, versionNo: number, reason: string | null) {
  const snapshot = await buildSnapshot(client, documentId)
  const hash = contentHash(snapshot)
  await client.query(
    `INSERT INTO edi_document_versions (document_id, version_no, snapshot, content_hash, reason, created_by, created_by_name)
     VALUES ($1::bigint, $2, $3::jsonb, $4, $5, NULLIF($6, '')::bigint, $7)
     ON CONFLICT (document_id, version_no) DO UPDATE
       SET snapshot = EXCLUDED.snapshot, content_hash = EXCLUDED.content_hash, reason = COALESCE(EXCLUDED.reason, edi_document_versions.reason),
           created_at = now()
       WHERE NOT edi_document_versions.locked`,
    [documentId, versionNo, JSON.stringify(snapshot), hash, reason, actor?.userId ?? "", actor?.fio ?? null]
  )
  return hash
}

/** Фиксирует версию: после подписания её содержимое не меняется (UPDATE запрещён условием locked). */
export async function lockVersion(client: PoolClient, documentId: string, versionNo: number, reason: string) {
  await client.query(
    `UPDATE edi_document_versions SET locked = TRUE, locked_reason = $3 WHERE document_id = $1::bigint AND version_no = $2`,
    [documentId, versionNo, reason]
  )
}

/* ---------- нумерация ---------- */

export async function nextNumber(
  client: PoolClient,
  siteId: number,
  key: string,
  numbering: { prefix?: string; pattern?: string; reset?: string } | null,
  date: string | null
): Promise<string> {
  const d = date ? new Date(date) : new Date()
  const year = String(d.getFullYear())
  const period = numbering?.reset === "never" ? "all" : year
  const r = await client.query<{ value: string }>(
    `INSERT INTO edi_counters (site_id, counter_key, period, value) VALUES ($1, $2, $3, 1)
     ON CONFLICT (site_id, counter_key, period) DO UPDATE SET value = edi_counters.value + 1
     RETURNING value::text`,
    [siteId, key, period]
  )
  const seq = r.rows[0].value
  const pattern = numbering?.pattern || "{prefix}{seq}"
  return pattern
    .replace("{prefix}", numbering?.prefix ?? "")
    .replace("{year}", year)
    .replace(/\{seq(?::(\d+))?\}/, (_m, w) => (w ? seq.padStart(Number(w), "0") : seq))
}

/* ---------- поиск ---------- */

export async function refreshSearchText(client: PoolClient, documentId: string, extra = "") {
  await client.query(
    `UPDATE edi_documents d SET search_text = left(concat_ws(' ',
        d.number, d.title, d.basis, d.department, d.fields::text,
        (SELECT concat_ws(' ', c.name, c.short_name, c.inn, c.kpp) FROM edi_counterparties c WHERE c.counterparty_id = d.counterparty_id),
        (SELECT string_agg(concat_ws(' ', l.name, l.supplier_code, l.gtin, l.item_code, l.item_name, l.lot_code), ' ')
           FROM edi_document_lines l WHERE l.document_id = d.document_id),
        (SELECT string_agg(concat_ws(' ', x.system, x.object_type, x.object_id), ' ')
           FROM edi_external_links x WHERE x.document_id = d.document_id),
        (SELECT string_agg(left(f.text_content, 20000), ' ') FROM edi_files f WHERE f.document_id = d.document_id),
        $2::text), 400000)
     WHERE d.document_id = $1::bigint`,
    [documentId, extra]
  )
}

/* ---------- создание и изменение ---------- */

async function insertLines(client: PoolClient, documentId: string, lines: NormalizedLine[]) {
  await client.query(`DELETE FROM edi_document_lines WHERE document_id = $1::bigint`, [documentId])
  for (const l of lines) {
    await client.query(
      `INSERT INTO edi_document_lines (document_id, line_no, name, supplier_code, gtin, okei, uom_name, qty, price, amount_net,
         vat_rate, vat_amount, amount_total, item_code, item_name, match_source, uom_factor, marking_codes, lot_code, extra)
       VALUES ($1::bigint, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb)`,
      [
        documentId, l.lineNo, l.name, l.supplierCode, l.gtin, l.okei, l.uomName, l.qty, l.price, l.amountNet,
        l.vatRate, l.vatAmount, l.amountTotal, l.itemCode, l.itemName, l.matchSource, l.uomFactor, l.markingCodes,
        l.lotCode, JSON.stringify(l.extra ?? {}),
      ]
    )
  }
}

async function counterpartyName(client: PoolClient, siteId: number, id: string | null): Promise<string | null> {
  if (!id) return null
  const r = await client.query<{ name: string }>(
    `SELECT COALESCE(short_name, name) AS name FROM edi_counterparties WHERE site_id = $1 AND counterparty_id = $2::bigint`,
    [siteId, id]
  )
  if (!r.rows[0]) throw new HttpError(400, "Контрагент не найден", "counterparty_not_found")
  return r.rows[0].name
}

export function defaultTitle(type: DocTypeDef, number: string | null, date: string | null, cpName: string | null): string {
  const d = date ? date.split("-").reverse().join(".") : ""
  return [type.short, number ? `№ ${number}` : "", d ? `от ${d}` : "", cpName ? `· ${cpName}` : ""].filter(Boolean).join(" ")
}

export async function createDocument(client: PoolClient, actor: Actor, input: DocumentIn): Promise<DocRow> {
  requirePermission(actor, "edi.doc.create")
  const type = docType(input.docType)
  if (!type) throw new HttpError(400, `Неизвестный тип документа: ${input.docType}`, "bad_type")
  const direction = String(input.direction || type.directions[0])
  if (!type.directions.includes(direction as never)) {
    throw new HttpError(400, `Тип «${type.name}» не может быть «${direction}»`, "bad_direction")
  }
  await enforceLimits(client, actor.siteId, { documents: 1 })
  const docDate = isoDateOrNull(input.docDate) ?? new Date().toISOString().slice(0, 10)
  let number = trimOrNull(input.number, 100)
  let numbering: Record<string, string> | null = null
  if (input.templateId) {
    const t = await client.query<{ numbering: Record<string, string>; doc_type: string }>(
      `SELECT numbering, doc_type FROM edi_templates WHERE template_id = $1::bigint AND (site_id IS NULL OR site_id = $2) AND is_active`,
      [input.templateId, actor.siteId]
    )
    if (!t.rows[0]) throw new HttpError(400, "Шаблон не найден", "template_not_found")
    numbering = t.rows[0].numbering
  }
  if (!number && direction !== "incoming") {
    number = await nextNumber(client, actor.siteId, input.templateId ? `tpl:${input.templateId}` : `type:${type.code}`, numbering, docDate)
  }
  const cpName = type.hasCounterparty ? await counterpartyName(client, actor.siteId, trimOrNull(input.counterpartyId, 20)) : null
  const lines = type.hasLines ? normalizeLines(input.lines) : []
  const totals = sumLines(lines)
  const fields = cleanFields(type, input.fields)
  const explicitTotal = num(fields.totalOverride)
  const amountTotal = type.hasAmount ? (lines.length ? totals.amountTotal : explicitTotal) : null
  const status = input.status === "received" && direction === "incoming" ? "received" : "draft"
  const ins = await client.query<{ document_id: string }>(
    `INSERT INTO edi_documents (site_id, doc_type, direction, number, doc_date, title, counterparty_id, currency,
       amount_net, amount_vat, amount_total, status, author_user_id, responsible_user_id, department, confidential,
       fields, format_code, source, template_id, due_date, basis, last_action, last_action_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::bigint, $8, $9, $10, $11, $12, $13::bigint, COALESCE($14::bigint, $13::bigint), $15, $16,
       $17::jsonb, $18, $19, $20::bigint, $21, $22, 'document.created', now())
     RETURNING document_id::text`,
    [
      actor.siteId, type.code, direction, number, docDate,
      trimOrNull(input.title, 300) ?? defaultTitle(type, number, docDate, cpName),
      type.hasCounterparty ? trimOrNull(input.counterpartyId, 20) : null,
      trimOrNull(input.currency, 3) ?? "RUB",
      lines.length ? totals.amountNet : null,
      lines.length ? totals.amountVat : null,
      amountTotal,
      status, actor.userId, trimOrNull(input.responsibleUserId, 20), trimOrNull(input.department, 200) ?? actor.department,
      Boolean(input.confidential), JSON.stringify(fields), trimOrNull(input.formatCode, 40), input.source ?? "manual",
      trimOrNull(input.templateId, 20), isoDateOrNull(input.dueDate), trimOrNull(input.basis, 500),
    ]
  )
  const id = ins.rows[0].document_id
  await insertLines(client, id, lines)
  await writeVersion(client, actor, id, 1, input.source === "import" ? "Загружено из файла" : "Создание")
  await refreshSearchText(client, id, input.extraSearchText ?? "")
  await recordEvent(client, actorEvent(actor, input.source === "import" ? "document.imported" : "document.created", id, { docType: type.code }))
  return getDocument(client, actor, id)
}

export type DocumentPatch = Partial<Omit<DocumentIn, "docType" | "source" | "status">> & { reason?: string }

/** Реквизиты меняются только в редактируемых статусах. Вне черновика каждое сохранение — новая версия с причиной. */
export async function updateDocument(client: PoolClient, actor: Actor, documentId: string, patch: DocumentPatch): Promise<DocRow> {
  requirePermission(actor, "edi.doc.edit")
  const doc = await getDocument(client, actor, documentId, { forUpdate: true })
  const type = docType(doc.docType)!
  if (!isEditableStatus(doc.status)) {
    throw new HttpError(409, `Документ в статусе «${STATUS_LABEL[doc.status]}» нельзя изменить. Создайте корректировку или верните на доработку.`, "not_editable")
  }
  if (doc.signedVersion != null && doc.signedVersion >= doc.currentVersion) {
    throw new HttpError(409, "Подписанная версия неизменна", "signed_locked")
  }
  const newVersion = doc.status !== "draft"
  const reason = trimOrNull(patch.reason, 500)
  if (newVersion && !reason) throw new HttpError(400, "Укажите причину изменения", "reason_required")

  const sets: string[] = []
  const vals: unknown[] = [documentId]
  const set = (col: string, v: unknown, cast = "") => {
    vals.push(v)
    sets.push(`${col} = $${vals.length}${cast}`)
  }
  if (patch.number !== undefined) set("number", trimOrNull(patch.number, 100))
  if (patch.docDate !== undefined) set("doc_date", isoDateOrNull(patch.docDate))
  if (patch.title !== undefined) set("title", trimOrNull(patch.title, 300) ?? doc.title)
  if (patch.counterpartyId !== undefined && type.hasCounterparty) {
    await counterpartyName(client, actor.siteId, trimOrNull(patch.counterpartyId, 20))
    set("counterparty_id", trimOrNull(patch.counterpartyId, 20), "::bigint")
  }
  if (patch.currency !== undefined) set("currency", trimOrNull(patch.currency, 3) ?? "RUB")
  if (patch.fields !== undefined) set("fields", JSON.stringify({ ...doc.fields, ...cleanFields(type, patch.fields) }), "::jsonb")
  if (patch.responsibleUserId !== undefined) set("responsible_user_id", trimOrNull(patch.responsibleUserId, 20), "::bigint")
  if (patch.department !== undefined) set("department", trimOrNull(patch.department, 200))
  if (patch.confidential !== undefined) set("confidential", Boolean(patch.confidential))
  if (patch.dueDate !== undefined) set("due_date", isoDateOrNull(patch.dueDate))
  if (patch.basis !== undefined) set("basis", trimOrNull(patch.basis, 500))
  if (patch.lines !== undefined && type.hasLines) {
    const lines = normalizeLines(patch.lines)
    await insertLines(client, documentId, lines)
    const t = sumLines(lines)
    set("amount_net", lines.length ? t.amountNet : null)
    set("amount_vat", lines.length ? t.amountVat : null)
    set("amount_total", lines.length ? t.amountTotal : null)
  }
  const version = newVersion ? doc.currentVersion + 1 : doc.currentVersion
  set("current_version", version)
  sets.push("updated_at = now()", "last_action = 'document.updated'", "last_action_at = now()")
  await client.query(`UPDATE edi_documents SET ${sets.join(", ")} WHERE document_id = $1::bigint`, vals)
  if (patch.title === undefined && (patch.number !== undefined || patch.docDate !== undefined || patch.counterpartyId !== undefined)) {
    const fresh = await getDocument(client, actor, documentId)
    if (fresh.title === doc.title) {
      const cp = await counterpartyName(client, actor.siteId, fresh.counterpartyId)
      await client.query(`UPDATE edi_documents SET title = $2 WHERE document_id = $1::bigint`, [
        documentId,
        defaultTitle(type, fresh.number, fresh.docDate, cp),
      ])
    }
  }
  await writeVersion(client, actor, documentId, version, reason)
  await refreshSearchText(client, documentId)
  await recordEvent(client, actorEvent(actor, newVersion ? "document.version" : "document.updated", documentId, { version, reason }))
  return getDocument(client, actor, documentId)
}

export async function touch(client: PoolClient, documentId: string, action: string, sets: Record<string, unknown> = {}) {
  const cols = Object.keys(sets)
  const vals = cols.map((c) => sets[c])
  const extra = cols.map((c, i) => `${c} = $${i + 3}`).join(", ")
  await client.query(
    `UPDATE edi_documents SET last_action = $2, last_action_at = now(), updated_at = now()${extra ? ", " + extra : ""}
     WHERE document_id = $1::bigint`,
    [documentId, action, ...vals]
  )
}

/* ---------- проверка полноты ---------- */

export type Issue = { level: "error" | "warning"; field?: string; line?: number; message: string }

export async function validateForSubmit(client: PoolClient, doc: DocRow): Promise<Issue[]> {
  const type = docType(doc.docType)
  const issues: Issue[] = []
  if (!type) return [{ level: "error", message: "Неизвестный тип документа" }]
  if (!doc.number && doc.direction !== "internal") issues.push({ level: "error", field: "number", message: "Не указан номер" })
  if (!doc.docDate) issues.push({ level: "error", field: "docDate", message: "Не указана дата" })
  if (type.hasCounterparty && doc.direction !== "internal" && !doc.counterpartyId) {
    issues.push({ level: "error", field: "counterpartyId", message: "Не выбран контрагент" })
  }
  for (const f of type.fields) {
    if (!f.required) continue
    const v = doc.fields?.[f.key]
    if (v == null || v === "") issues.push({ level: "error", field: f.key, message: `Не заполнено: ${f.label}` })
  }
  if (type.hasLines) {
    const lines = await loadLines(client, doc.documentId)
    if (lines.length === 0 && type.code !== "request") issues.push({ level: "error", message: "Нет строк табличной части" })
    lines.forEach((l) => {
      if (!(l.qty > 0)) issues.push({ level: "warning", line: l.lineNo, message: `Строка ${l.lineNo}: нулевое количество` })
    })
  }
  if (doc.direction === "outgoing" && doc.counterpartyId) {
    const cp = await client.query<{ inn: string | null }>(`SELECT inn FROM edi_counterparties WHERE counterparty_id = $1::bigint`, [doc.counterpartyId])
    if (!cp.rows[0]?.inn) issues.push({ level: "warning", field: "counterpartyId", message: "У контрагента нет ИНН" })
  }
  return issues
}

/* ---------- статусы, архив, удаление ---------- */

export async function setStatus(client: PoolClient, actor: Actor, documentId: string, to: string, comment?: string | null) {
  const doc = await getDocument(client, actor, documentId, { forUpdate: true })
  const allowed = MANUAL_TRANSITIONS[doc.status] ?? []
  if (!allowed.includes(to)) {
    throw new HttpError(409, `Переход «${STATUS_LABEL[doc.status]}» → «${STATUS_LABEL[to] ?? to}» недоступен`, "bad_transition")
  }
  if (to === "signing" || to === "completed" || to === "cancelled" || to === "draft" || to === "rejected") requirePermission(actor, "edi.doc.edit")
  if (to === "sent") requirePermission(actor, "edi.doc.send")
  if (to === "approved" && doc.status === "signing") requirePermission(actor, "edi.doc.sign")
  if (to === "completed" && doc.status === "received" && doc.wmsStatus === "receiving") {
    throw new HttpError(409, "Склад ещё не завершил приёмку по этому документу", "wms_pending")
  }
  await touch(client, documentId, "document.status", { status: to })
  await recordEvent(client, actorEvent(actor, "document.status", documentId, { from: doc.status, to, comment: comment ?? null }))
  return getDocument(client, actor, documentId)
}

export async function archiveDocument(client: PoolClient, actor: Actor, documentId: string, restore = false) {
  requirePermission(actor, "edi.doc.archive")
  const doc = await getDocument(client, actor, documentId, { forUpdate: true })
  if (!restore && !["completed", "cancelled", "signed", "sent", "rejected"].includes(doc.status)) {
    throw new HttpError(409, "В архив переносятся завершённые, подписанные, отправленные или аннулированные документы", "not_archivable")
  }
  await client.query(`UPDATE edi_documents SET archived_at = ${restore ? "NULL" : "now()"}, updated_at = now() WHERE document_id = $1::bigint`, [documentId])
  await recordEvent(client, actorEvent(actor, restore ? "document.restored" : "document.archived", documentId))
}

export async function deleteDraft(client: PoolClient, actor: Actor, documentId: string) {
  requirePermission(actor, "edi.doc.delete")
  const doc = await getDocument(client, actor, documentId, { forUpdate: true })
  if (doc.status !== "draft") throw new HttpError(409, "Удалить можно только черновик", "not_draft")
  if (doc.authorUserId !== actor.userId && !can(actor, "edi.admin")) throw new HttpError(403, "Удалить черновик может автор", "not_author")
  await client.query(`UPDATE edi_documents SET deleted_at = now() WHERE document_id = $1::bigint`, [documentId])
  await recordEvent(client, actorEvent(actor, "document.deleted", documentId))
}

export async function toggleFavorite(client: PoolClient, actor: Actor, documentId: string, on: boolean) {
  await getDocument(client, actor, documentId)
  if (on) {
    await client.query(`INSERT INTO edi_favorites (user_id, document_id) VALUES ($1::bigint, $2::bigint) ON CONFLICT DO NOTHING`, [actor.userId, documentId])
  } else {
    await client.query(`DELETE FROM edi_favorites WHERE user_id = $1::bigint AND document_id = $2::bigint`, [actor.userId, documentId])
  }
}

export async function addComment(client: PoolClient, actor: Actor, documentId: string, body: string) {
  await getDocument(client, actor, documentId)
  const text = body.trim().slice(0, 5000)
  if (!text) throw new HttpError(400, "Пустой комментарий", "empty")
  await client.query(`INSERT INTO edi_comments (document_id, author_user_id, author_name, body) VALUES ($1::bigint, $2::bigint, $3, $4)`, [
    documentId,
    actor.userId,
    actor.fio,
    text,
  ])
  await recordEvent(client, actorEvent(actor, "document.comment", documentId))
}

export async function relateDocuments(client: PoolClient, actor: Actor, fromId: string, toId: string, kind: string) {
  await getDocument(client, actor, fromId)
  await getDocument(client, actor, toId)
  if (fromId === toId) throw new HttpError(400, "Нельзя связать документ с самим собой", "self_relation")
  const k = ["basis", "correction", "reply", "related", "contract"].includes(kind) ? kind : "related"
  await client.query(
    `INSERT INTO edi_relations (site_id, from_document_id, to_document_id, kind, created_by) VALUES ($1, $2::bigint, $3::bigint, $4, $5::bigint)
     ON CONFLICT DO NOTHING`,
    [actor.siteId, fromId, toId, k, actor.userId]
  )
  await recordEvent(client, actorEvent(actor, "document.related", fromId, { to: toId, kind: k }))
}

export async function grantAccess(client: PoolClient, actor: Actor, documentId: string, userId: string, access: "read" | "edit") {
  const doc = await getDocument(client, actor, documentId)
  if (doc.authorUserId !== actor.userId && doc.responsibleUserId !== actor.userId && !can(actor, "edi.admin")) {
    throw new HttpError(403, "Доступ выдаёт автор, ответственный или администратор", "forbidden")
  }
  const u = await client.query(`SELECT 1 FROM wms_users WHERE user_id = $1::bigint AND site_id = $2 AND is_active`, [userId, actor.siteId])
  if (!u.rows[0]) throw new HttpError(400, "Пользователь не найден в организации", "user_not_found")
  await client.query(
    `INSERT INTO edi_document_access (document_id, user_id, access, granted_by) VALUES ($1::bigint, $2::bigint, $3, $4::bigint)
     ON CONFLICT (document_id, user_id) DO UPDATE SET access = EXCLUDED.access`,
    [documentId, userId, access, actor.userId]
  )
  await recordEvent(client, actorEvent(actor, "document.access", documentId, { userId, access }))
}

/**
 * Файл текущей версии для подписи документов, созданных в EDI: канонический JSON снимка версии
 * (тот же, по которому считается content_hash). Подпись ставится на эти байты; печатная форма — отдельное представление.
 */
export async function freezeVersionFile(client: PoolClient, actor: Actor, documentId: string) {
  const doc = await getDocument(client, actor, documentId)
  const existing = await client.query<{ file_id: string }>(
    `SELECT file_id::text FROM edi_files WHERE document_id = $1::bigint AND version_no = $2 AND kind = 'version' LIMIT 1`,
    [documentId, doc.currentVersion]
  )
  if (existing.rows[0]) return { fileId: existing.rows[0].file_id }
  const v = await client.query<{ snapshot: unknown; content_hash: string }>(
    `SELECT snapshot, content_hash FROM edi_document_versions WHERE document_id = $1::bigint AND version_no = $2`,
    [documentId, doc.currentVersion]
  )
  if (!v.rows[0]) throw new HttpError(404, "Версия не найдена", "not_found")
  const body = JSON.stringify({ documentId, version: doc.currentVersion, contentHash: v.rows[0].content_hash, snapshot: stable(v.rows[0].snapshot) }, null, 2)
  const f = await saveFile(client, {
    siteId: actor.siteId,
    documentId,
    versionNo: doc.currentVersion,
    kind: "version",
    fileName: `document-${documentId}-v${doc.currentVersion}.json`,
    bytes: new TextEncoder().encode(body),
    mime: "application/json",
    uploadedBy: actor.userId,
  })
  await recordEvent(client, actorEvent(actor, "document.file_added", documentId, { kind: "version", version: doc.currentVersion }))
  return { fileId: f.fileId }
}

export { loadLines, writeVersion, DOC_TYPES }
