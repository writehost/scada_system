import type { PoolClient } from "pg"
import { HttpError } from "../db.ts"
import { requirePermission, type Actor } from "./actor.ts"
import { actorEvent, recordEvent } from "./audit.ts"
import { visibility } from "./documents.ts"

/** Контрольная сумма ИНН (10 цифр — ЮЛ, 12 — ФЛ/ИП). */
export function isValidInn(inn: string): boolean {
  if (!/^\d{10}$|^\d{12}$/.test(inn)) return false
  const d = inn.split("").map(Number)
  const check = (w: number[]) => (w.reduce((s, k, i) => s + k * d[i], 0) % 11) % 10
  if (inn.length === 10) return check([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9]
  return check([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] && check([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11]
}

export function isValidOgrn(ogrn: string): boolean {
  if (/^\d{13}$/.test(ogrn)) return Number(BigInt(ogrn.slice(0, 12)) % 11n % 10n) === Number(ogrn[12])
  if (/^\d{15}$/.test(ogrn)) return Number(BigInt(ogrn.slice(0, 14)) % 13n % 10n) === Number(ogrn[14])
  return false
}

export type CounterpartyIn = {
  kind?: string
  name?: string
  shortName?: string | null
  inn?: string | null
  kpp?: string | null
  ogrn?: string | null
  addressLegal?: string | null
  addressActual?: string | null
  phone?: string | null
  email?: string | null
  contactPerson?: string | null
  bankName?: string | null
  bankBik?: string | null
  bankAccount?: string | null
  corrAccount?: string | null
  edoIds?: Array<{ provider: string; boxId: string }>
  roles?: string[]
  status?: string
  wmsSupplierCode?: string | null
  note?: string | null
}

const COLS = `counterparty_id::text AS id, kind, name, short_name AS "shortName", inn, kpp, ogrn,
  address_legal AS "addressLegal", address_actual AS "addressActual", phone, email, contact_person AS "contactPerson",
  bank_name AS "bankName", bank_bik AS "bankBik", bank_account AS "bankAccount", corr_account AS "corrAccount",
  edo_ids AS "edoIds", roles, status, wms_supplier_code AS "wmsSupplierCode", note, created_at AS "createdAt", updated_at AS "updatedAt"`

function t(v: unknown, max = 500): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}

export function validateCounterparty(input: CounterpartyIn, partial = false): string[] {
  const errors: string[] = []
  if (!partial && !t(input.name)) errors.push("Укажите наименование")
  const inn = t(input.inn, 12)
  if (inn && !isValidInn(inn)) errors.push("ИНН не прошёл проверку контрольной суммы")
  const kpp = t(input.kpp, 9)
  if (kpp && !/^\d{4}[\dA-Z]{2}\d{3}$/.test(kpp)) errors.push("КПП: 9 символов")
  if (kpp && inn && inn.length === 12) errors.push("У ИП и физлиц КПП не указывается")
  const ogrn = t(input.ogrn, 15)
  if (ogrn && !isValidOgrn(ogrn)) errors.push("ОГРН/ОГРНИП не прошёл проверку")
  const bik = t(input.bankBik, 9)
  if (bik && !/^\d{9}$/.test(bik)) errors.push("БИК: 9 цифр")
  const acc = t(input.bankAccount, 20)
  if (acc && !/^\d{20}$/.test(acc)) errors.push("Расчётный счёт: 20 цифр")
  const email = t(input.email, 200)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Некорректный email")
  return errors
}

export async function listCounterparties(
  client: PoolClient,
  actor: Actor,
  q: { search?: string; status?: string; role?: string; limit?: number; offset?: number }
) {
  const params: unknown[] = [actor.siteId]
  const conds = ["c.site_id = $1"]
  if (q.search?.trim()) {
    params.push(`%${q.search.trim().toLowerCase()}%`)
    conds.push(`(lower(c.name) LIKE $${params.length} OR lower(COALESCE(c.short_name,'')) LIKE $${params.length} OR c.inn LIKE $${params.length})`)
  }
  if (q.status) {
    params.push(q.status)
    conds.push(`c.status = $${params.length}`)
  }
  if (q.role) {
    params.push(q.role)
    conds.push(`$${params.length} = ANY(c.roles)`)
  }
  params.push(Math.min(q.limit ?? 50, 200), q.offset ?? 0)
  const r = await client.query(
    `SELECT c.counterparty_id::text AS id, c.name, c.short_name AS "shortName", c.inn, c.kpp, c.status, c.roles,
            c.wms_supplier_code AS "wmsSupplierCode", c.edo_ids AS "edoIds",
            (SELECT count(*)::int FROM edi_documents d WHERE d.counterparty_id = c.counterparty_id AND d.deleted_at IS NULL) AS "documentCount",
            (SELECT max(d.created_at) FROM edi_documents d WHERE d.counterparty_id = c.counterparty_id AND d.deleted_at IS NULL) AS "lastDocumentAt",
            count(*) OVER()::int AS "_total"
     FROM edi_counterparties c WHERE ${conds.join(" AND ")}
     ORDER BY lower(COALESCE(c.short_name, c.name))
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return { rows: r.rows.map(({ _total, ...x }) => x), total: r.rows[0]?._total ?? 0 }
}

export async function getCounterparty(client: PoolClient, actor: Actor, id: string) {
  if (!/^\d+$/.test(id)) throw new HttpError(404, "Контрагент не найден", "not_found")
  const r = await client.query(`SELECT ${COLS} FROM edi_counterparties WHERE site_id = $1 AND counterparty_id = $2::bigint`, [actor.siteId, id])
  if (!r.rows[0]) throw new HttpError(404, "Контрагент не найден", "not_found")
  return r.rows[0]
}

/** Карточка: реквизиты + документы, суммы, договоры, незавершённые задачи — только видимые пользователю документы. */
export async function counterpartyCard(client: PoolClient, actor: Actor, id: string) {
  const cp = await getCounterparty(client, actor, id)
  const vis = visibility(actor, "d", 2)
  const stats = await client.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE d.direction = 'incoming')::int AS incoming,
            count(*) FILTER (WHERE d.direction = 'outgoing')::int AS outgoing,
            COALESCE(sum(d.amount_total) FILTER (WHERE d.direction = 'incoming' AND d.doc_type IN ('upd','invoice_fact','act_works','act_services')), 0)::float8 AS "purchased",
            COALESCE(sum(d.amount_total) FILTER (WHERE d.direction = 'outgoing' AND d.doc_type IN ('upd','invoice_fact','act_works','act_services')), 0)::float8 AS "sold",
            count(*) FILTER (WHERE d.status NOT IN ('completed','cancelled','signed','sent') AND d.archived_at IS NULL)::int AS "open"
     FROM edi_documents d WHERE d.counterparty_id = $1::bigint AND ${vis.sql}`,
    [id, ...vis.params]
  )
  const docs = await client.query(
    `SELECT d.document_id::text AS "documentId", d.doc_type AS "docType", d.number, to_char(d.doc_date, 'YYYY-MM-DD') AS "docDate",
            d.title, d.status, d.amount_total::float8 AS "amountTotal", d.direction
     FROM edi_documents d WHERE d.counterparty_id = $1::bigint AND ${vis.sql}
     ORDER BY d.doc_date DESC NULLS LAST, d.document_id DESC LIMIT 50`,
    [id, ...vis.params]
  )
  const contracts = await client.query(
    `SELECT d.document_id::text AS "documentId", d.number, to_char(d.doc_date, 'YYYY-MM-DD') AS "docDate", d.status,
            d.fields->>'validTo' AS "validTo", d.amount_total::float8 AS "amountTotal"
     FROM edi_documents d WHERE d.counterparty_id = $1::bigint AND d.doc_type IN ('contract','supplementary','specification') AND ${vis.sql}
     ORDER BY d.doc_date DESC NULLS LAST`,
    [id, ...vis.params]
  )
  const tasks = await client.query(
    `SELECT t.task_id::text AS "taskId", t.step_name AS "stepName", t.due_at AS "dueAt", d.document_id::text AS "documentId", d.title,
            u.display_name AS "assignee"
     FROM edi_tasks t JOIN edi_documents d ON d.document_id = t.document_id
     LEFT JOIN wms_users u ON u.user_id = t.assignee_user_id
     WHERE d.counterparty_id = $1::bigint AND t.status = 'pending' AND ${vis.sql}
     ORDER BY t.due_at NULLS LAST`,
    [id, ...vis.params]
  )
  const mappings = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM edi_item_mappings WHERE site_id = $1 AND supplier_inn = $2`,
    [actor.siteId, cp.inn ?? ""]
  )
  return { counterparty: cp, stats: stats.rows[0], documents: docs.rows, contracts: contracts.rows, tasks: tasks.rows, itemMappings: mappings.rows[0]?.n ?? 0 }
}

export async function findCounterpartyByInn(client: PoolClient, siteId: number, inn: string, kpp?: string | null) {
  const r = await client.query<{ id: string; name: string; kpp: string | null; wmsSupplierCode: string | null }>(
    `SELECT counterparty_id::text AS id, name, kpp, wms_supplier_code AS "wmsSupplierCode" FROM edi_counterparties
     WHERE site_id = $1 AND inn = $2
     ORDER BY CASE WHEN COALESCE(kpp,'') = COALESCE($3,'') THEN 0 ELSE 1 END LIMIT 1`,
    [siteId, inn, kpp ?? ""]
  )
  return r.rows[0] ?? null
}

export async function createCounterparty(client: PoolClient, actor: Actor, input: CounterpartyIn) {
  requirePermission(actor, "edi.counterparty.write")
  const errors = validateCounterparty(input)
  if (errors.length) throw new HttpError(400, errors.join("; "), "validation", errors)
  const inn = t(input.inn, 12)
  if (inn) {
    const dup = await findCounterpartyByInn(client, actor.siteId, inn, t(input.kpp, 9))
    if (dup && (dup.kpp ?? "") === (t(input.kpp, 9) ?? "")) {
      throw new HttpError(409, `Контрагент с ИНН ${inn} уже есть: ${dup.name}`, "duplicate", { id: dup.id })
    }
  }
  const r = await client.query(
    `INSERT INTO edi_counterparties (site_id, kind, name, short_name, inn, kpp, ogrn, address_legal, address_actual, phone, email,
       contact_person, bank_name, bank_bik, bank_account, corr_account, edo_ids, roles, status, wms_supplier_code, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19, $20, $21, $22::bigint)
     RETURNING counterparty_id::text AS id`,
    [
      actor.siteId,
      inn?.length === 12 ? "ip" : t(input.kind, 20) ?? "legal",
      t(input.name, 500),
      t(input.shortName, 200),
      inn,
      t(input.kpp, 9),
      t(input.ogrn, 15),
      t(input.addressLegal, 1000),
      t(input.addressActual, 1000),
      t(input.phone, 100),
      t(input.email, 200),
      t(input.contactPerson, 200),
      t(input.bankName, 300),
      t(input.bankBik, 9),
      t(input.bankAccount, 20),
      t(input.corrAccount, 20),
      JSON.stringify(Array.isArray(input.edoIds) ? input.edoIds.slice(0, 10) : []),
      Array.isArray(input.roles) ? input.roles.filter((r) => ["supplier", "customer", "carrier", "service"].includes(r)) : [],
      ["active", "paused", "blocked", "prospect"].includes(String(input.status)) ? input.status : "active",
      t(input.wmsSupplierCode, 64)?.toUpperCase() ?? null,
      t(input.note, 2000),
      actor.userId,
    ]
  )
  await recordEvent(client, actorEvent(actor, "counterparty.created", null, { counterpartyId: r.rows[0].id, inn }))
  return getCounterparty(client, actor, r.rows[0].id)
}

const PATCHABLE: Record<string, [string, number]> = {
  name: ["name", 500],
  shortName: ["short_name", 200],
  inn: ["inn", 12],
  kpp: ["kpp", 9],
  ogrn: ["ogrn", 15],
  addressLegal: ["address_legal", 1000],
  addressActual: ["address_actual", 1000],
  phone: ["phone", 100],
  email: ["email", 200],
  contactPerson: ["contact_person", 200],
  bankName: ["bank_name", 300],
  bankBik: ["bank_bik", 9],
  bankAccount: ["bank_account", 20],
  corrAccount: ["corr_account", 20],
  note: ["note", 2000],
}

export async function updateCounterparty(client: PoolClient, actor: Actor, id: string, input: CounterpartyIn) {
  requirePermission(actor, "edi.counterparty.write")
  const current = await getCounterparty(client, actor, id)
  const merged = { ...current, ...input }
  const errors = validateCounterparty(merged)
  if (errors.length) throw new HttpError(400, errors.join("; "), "validation", errors)
  const sets: string[] = []
  const vals: unknown[] = [actor.siteId, id]
  for (const [k, [col, max]] of Object.entries(PATCHABLE)) {
    if ((input as Record<string, unknown>)[k] === undefined) continue
    vals.push(t((input as Record<string, unknown>)[k], max))
    sets.push(`${col} = $${vals.length}`)
  }
  if (input.status !== undefined && ["active", "paused", "blocked", "prospect"].includes(input.status)) {
    vals.push(input.status)
    sets.push(`status = $${vals.length}`)
  }
  if (input.roles !== undefined) {
    vals.push(input.roles.filter((r) => ["supplier", "customer", "carrier", "service"].includes(r)))
    sets.push(`roles = $${vals.length}`)
  }
  if (input.edoIds !== undefined) {
    vals.push(JSON.stringify(input.edoIds.slice(0, 10)))
    sets.push(`edo_ids = $${vals.length}::jsonb`)
  }
  if (input.wmsSupplierCode !== undefined) {
    vals.push(t(input.wmsSupplierCode, 64)?.toUpperCase() ?? null)
    sets.push(`wms_supplier_code = $${vals.length}`)
  }
  if (sets.length === 0) return current
  await client.query(`UPDATE edi_counterparties SET ${sets.join(", ")}, updated_at = now() WHERE site_id = $1 AND counterparty_id = $2::bigint`, vals)
  await recordEvent(client, actorEvent(actor, "counterparty.updated", null, { counterpartyId: id, fields: Object.keys(input) }))
  return getCounterparty(client, actor, id)
}
