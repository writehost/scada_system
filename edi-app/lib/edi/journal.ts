import type { PoolClient } from "pg"
import type { Actor } from "./actor.ts"
import { delegatorsSql, visibility } from "./documents.ts"

export const FOLDERS = [
  { key: "all", label: "Все документы" },
  { key: "tasks", label: "Мои задачи" },
  { key: "incoming", label: "Входящие" },
  { key: "outgoing", label: "Исходящие" },
  { key: "drafts", label: "Черновики" },
  { key: "in_review", label: "На согласовании" },
  { key: "signing", label: "На подписи" },
  { key: "rejected", label: "Отклонённые" },
  { key: "completed", label: "Завершённые" },
  { key: "archive", label: "Архив" },
  { key: "favorites", label: "Избранное" },
] as const

export type JournalQuery = {
  folder?: string
  q?: string
  types?: string[]
  statuses?: string[]
  direction?: string
  counterpartyId?: string
  dateFrom?: string
  dateTo?: string
  amountMin?: number | null
  amountMax?: number | null
  authorId?: string
  responsibleId?: string
  wmsStatus?: string
  viewId?: string
  sort?: string
  dir?: "asc" | "desc"
  page?: number
  pageSize?: number
}

const SORTS: Record<string, string> = {
  date: "d.doc_date",
  number: "lower(d.number)",
  amount: "d.amount_total",
  updated: "d.updated_at",
  counterparty: "lower(c.name)",
  status: "d.status",
  type: "d.doc_type",
  title: "lower(d.title)",
}

class Sql {
  parts: string[] = []
  params: unknown[]
  constructor(params: unknown[]) {
    this.params = params
  }
  p(v: unknown): string {
    this.params.push(v)
    return `$${this.params.length}`
  }
  and(cond: string) {
    this.parts.push(cond)
  }
}

function folderCondition(sql: Sql, actor: Actor, folder: string): string {
  // параметры добавляются только в ветках, где используются: лишний параметр PostgreSQL не типизирует
  switch (folder) {
    case "tasks": {
      const me = sql.p(actor.userId)
      const site = sql.p(actor.siteId)
      return `EXISTS (SELECT 1 FROM edi_tasks t WHERE t.document_id = d.document_id AND t.status = 'pending'
        AND (t.assignee_user_id = ${me}::bigint OR t.assignee_user_id IN (${delegatorsSql(site, me)})))`
    }
    case "incoming":
      return `d.direction = 'incoming' AND d.archived_at IS NULL`
    case "outgoing":
      return `d.direction = 'outgoing' AND d.archived_at IS NULL`
    case "drafts":
      return `d.status = 'draft' AND d.author_user_id = ${sql.p(actor.userId)}::bigint`
    case "in_review":
      return `d.status IN ('in_review','rework') AND d.archived_at IS NULL`
    case "signing":
      return `d.status = 'signing' AND d.archived_at IS NULL`
    case "rejected":
      return `(d.status = 'rejected' OR d.exchange_status = 'rejected') AND d.archived_at IS NULL`
    case "completed":
      return `d.status IN ('completed','signed','sent') AND d.archived_at IS NULL`
    case "archive":
      return `d.archived_at IS NOT NULL`
    case "favorites":
      return `EXISTS (SELECT 1 FROM edi_favorites f WHERE f.document_id = d.document_id AND f.user_id = ${sql.p(actor.userId)}::bigint)`
    default:
      return `d.archived_at IS NULL`
  }
}

/** Разбор строки поиска: номер, ИНН, текст. Числовые и короткие запросы ищутся префиксом по номеру/ИНН. */
function searchCondition(sql: Sql, q: string): string {
  const term = q.trim().slice(0, 200)
  const conds: string[] = []
  const like = sql.p(`%${term.replace(/[\\%_]/g, (m) => "\\" + m)}%`)
  conds.push(`lower(d.number) LIKE lower(${like})`)
  conds.push(`lower(d.title) LIKE lower(${like})`)
  if (/^\d{10}(\d{2})?$/.test(term)) {
    conds.push(`EXISTS (SELECT 1 FROM edi_counterparties c2 WHERE c2.counterparty_id = d.counterparty_id AND c2.inn = ${sql.p(term)})`)
  }
  const words = term
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 8)
  if (words.length) {
    const tsq = words.map((w) => `${w.replace(/'/g, "")}:*`).join(" & ")
    conds.push(`d.search_tsv @@ to_tsquery('russian', ${sql.p(tsq)})`)
  }
  return `(${conds.join(" OR ")})`
}

export async function listDocuments(client: PoolClient, actor: Actor, query: JournalQuery) {
  const vis = visibility(actor, "d", 1)
  const sql = new Sql([...vis.params])
  sql.and(vis.sql)
  sql.and(folderCondition(sql, actor, query.folder || "all"))
  if (query.viewId) {
    sql.and(`EXISTS (SELECT 1 FROM edi_folder_items fi JOIN edi_saved_views sv ON sv.view_id = fi.view_id
      WHERE fi.document_id = d.document_id AND sv.view_id = ${sql.p(query.viewId)}::bigint AND sv.user_id = ${sql.p(actor.userId)}::bigint)`)
  }
  if (query.q?.trim()) sql.and(searchCondition(sql, query.q))
  if (query.types?.length) sql.and(`d.doc_type = ANY(${sql.p(query.types)}::text[])`)
  if (query.statuses?.length) sql.and(`d.status = ANY(${sql.p(query.statuses)}::text[])`)
  if (query.direction) sql.and(`d.direction = ${sql.p(query.direction)}`)
  if (query.counterpartyId) sql.and(`d.counterparty_id = ${sql.p(query.counterpartyId)}::bigint`)
  if (query.dateFrom) sql.and(`d.doc_date >= ${sql.p(query.dateFrom)}::date`)
  if (query.dateTo) sql.and(`d.doc_date <= ${sql.p(query.dateTo)}::date`)
  if (query.amountMin != null) sql.and(`d.amount_total >= ${sql.p(query.amountMin)}`)
  if (query.amountMax != null) sql.and(`d.amount_total <= ${sql.p(query.amountMax)}`)
  if (query.authorId) sql.and(`d.author_user_id = ${sql.p(query.authorId)}::bigint`)
  if (query.responsibleId) sql.and(`d.responsible_user_id = ${sql.p(query.responsibleId)}::bigint`)
  if (query.wmsStatus) sql.and(`d.wms_status = ${sql.p(query.wmsStatus)}`)

  const sortCol = SORTS[query.sort || "updated"] ?? SORTS.updated
  const dir = query.dir === "asc" ? "ASC" : "DESC"
  const pageSize = Math.min(Math.max(Number(query.pageSize) || 50, 10), 200)
  const page = Math.max(Number(query.page) || 1, 1)
  const limit = sql.p(pageSize)
  const offset = sql.p((page - 1) * pageSize)
  const me = sql.p(actor.userId)

  const r = await client.query(
    `SELECT d.document_id::text AS "documentId", d.doc_type AS "docType", d.direction, d.number,
            to_char(d.doc_date, 'YYYY-MM-DD') AS "docDate", d.title, d.currency,
            d.amount_total::float8 AS "amountTotal", d.status, d.exchange_status AS "exchangeStatus", d.wms_status AS "wmsStatus",
            d.counterparty_id::text AS "counterpartyId", COALESCE(c.short_name, c.name) AS "counterpartyName", c.inn AS "counterpartyInn",
            ru.display_name AS "responsibleName", d.last_action AS "lastAction", d.last_action_at AS "lastActionAt",
            d.updated_at AS "updatedAt", d.confidential, d.archived_at IS NOT NULL AS archived,
            EXISTS (SELECT 1 FROM edi_favorites f WHERE f.document_id = d.document_id AND f.user_id = ${me}::bigint) AS favorite,
            (SELECT t.task_id::text FROM edi_tasks t WHERE t.document_id = d.document_id AND t.status = 'pending'
               AND t.assignee_user_id = ${me}::bigint ORDER BY t.task_id LIMIT 1) AS "myTaskId",
            count(*) OVER()::int AS "_total"
     FROM edi_documents d
     LEFT JOIN edi_counterparties c ON c.counterparty_id = d.counterparty_id
     LEFT JOIN wms_users ru ON ru.user_id = d.responsible_user_id
     WHERE ${sql.parts.join(" AND ")}
     ORDER BY ${sortCol} ${dir} NULLS LAST, d.document_id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    sql.params
  )
  const total = r.rows[0]?._total ?? 0
  return {
    rows: r.rows.map(({ _total, ...row }) => row),
    total,
    page,
    pageSize,
  }
}

export async function folderCounts(client: PoolClient, actor: Actor): Promise<Record<string, number>> {
  const vis = visibility(actor, "d", 1)
  const sql = new Sql([...vis.params])
  const conds: Record<string, string> = {}
  for (const f of FOLDERS) if (f.key !== "all") conds[f.key] = folderCondition(sql, actor, f.key)
  const newIncoming = `d.direction = 'incoming' AND d.status = 'received' AND d.archived_at IS NULL`
  const r = await client.query(
    `SELECT ${Object.entries(conds)
      .map(([k, c]) => `count(*) FILTER (WHERE ${c})::int AS "${k}"`)
      .join(", ")}, count(*) FILTER (WHERE ${newIncoming})::int AS "newIncoming"
     FROM edi_documents d WHERE ${vis.sql}`,
    sql.params
  )
  return r.rows[0] ?? {}
}

/** Главная: счётчики, «требуют моего внимания», графики. Только реальные данные организации. */
export async function dashboard(client: PoolClient, actor: Actor) {
  const counts = await folderCounts(client, actor)
  const vis = visibility(actor, "d", 1)
  const me = `$${vis.params.length + 1}`
  const site = "$1"
  const attention = await client.query(
    `SELECT kind, "documentId", title, "docType", "taskId", "dueAt", note, "at" FROM (
       SELECT 'task' AS kind, d.document_id::text AS "documentId", d.title, d.doc_type AS "docType", t.task_id::text AS "taskId",
              t.due_at AS "dueAt", t.step_name AS note, t.created_at AS "at"
       FROM edi_tasks t JOIN edi_documents d ON d.document_id = t.document_id
       WHERE t.status = 'pending' AND (t.assignee_user_id = ${me}::bigint OR t.assignee_user_id IN (${delegatorsSql(site, me)})) AND ${vis.sql}
       UNION ALL
       SELECT 'incoming', d.document_id::text, d.title, d.doc_type, NULL, NULL,
              CASE WHEN d.wms_status = 'received_with_discrepancies' THEN 'Склад принял с расхождениями' ELSE 'Новый входящий документ' END,
              d.created_at
       FROM edi_documents d
       WHERE d.direction = 'incoming' AND (d.status = 'received' OR d.wms_status = 'received_with_discrepancies') AND d.archived_at IS NULL
         AND (d.responsible_user_id = ${me}::bigint OR d.responsible_user_id IS NULL) AND ${vis.sql}
       UNION ALL
       SELECT 'rejected', d.document_id::text, d.title, d.doc_type, NULL, NULL,
              CASE WHEN d.exchange_status = 'rejected' THEN 'Контрагент отклонил документ' ELSE 'Документ отклонён' END, d.updated_at
       FROM edi_documents d
       WHERE (d.status IN ('rejected','rework') OR d.exchange_status IN ('rejected','error','clarification')) AND d.archived_at IS NULL
         AND d.author_user_id = ${me}::bigint AND ${vis.sql}
       UNION ALL
       SELECT 'payment', d.document_id::text, d.title, d.doc_type, NULL, (d.fields->>'paymentDue')::timestamptz, 'Счёт к оплате', d.created_at
       FROM edi_documents d
       WHERE d.doc_type = 'invoice' AND d.direction = 'incoming' AND d.status IN ('received','approved') AND d.archived_at IS NULL
         AND (d.fields->>'paymentDue') ~ '^\\d{4}-\\d{2}-\\d{2}$' AND ${vis.sql}
     ) a
     ORDER BY "dueAt" ASC NULLS LAST, "at" DESC
     LIMIT 40`,
    [...vis.params, actor.userId]
  )
  const overdue = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM edi_tasks t
     WHERE t.site_id = $1 AND t.status = 'pending' AND t.due_at < now()
       AND (t.assignee_user_id = $2::bigint OR t.assignee_user_id IN (${delegatorsSql("$1", "$2")}))`,
    [actor.siteId, actor.userId]
  )
  const flow = await client.query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day,
            count(d.document_id) FILTER (WHERE d.direction = 'incoming')::int AS incoming,
            count(d.document_id) FILTER (WHERE d.direction = 'outgoing')::int AS outgoing,
            count(d.document_id) FILTER (WHERE d.direction = 'internal')::int AS internal
     FROM generate_series(current_date - 29, current_date, interval '1 day') day
     LEFT JOIN edi_documents d ON d.site_id = $1 AND d.deleted_at IS NULL AND d.created_at::date = day::date
     GROUP BY day ORDER BY day`,
    [actor.siteId]
  )
  const completedFlow = await client.query(
    `SELECT to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS week, count(*)::int AS n
     FROM edi_events WHERE site_id = $1 AND action = 'document.status' AND details->>'to' = 'completed'
       AND created_at > now() - interval '12 weeks'
     GROUP BY 1 ORDER BY 1`,
    [actor.siteId]
  )
  const byType = await client.query(
    `SELECT doc_type AS "docType", count(*)::int AS n FROM edi_documents
     WHERE site_id = $1 AND deleted_at IS NULL AND created_at > now() - interval '90 days'
     GROUP BY doc_type ORDER BY n DESC LIMIT 8`,
    [actor.siteId]
  )
  const approval = await client.query<{ hours: number | null; n: number }>(
    `SELECT (avg(extract(epoch FROM finished_at - started_at)) / 3600)::float8 AS hours, count(*)::int AS n
     FROM edi_workflow_instances WHERE site_id = $1 AND status = 'approved' AND finished_at > now() - interval '90 days'`,
    [actor.siteId]
  )
  const partners = await client.query(
    `SELECT c.counterparty_id::text AS id, COALESCE(c.short_name, c.name) AS name, count(*)::int AS n,
            COALESCE(sum(d.amount_total), 0)::float8 AS amount
     FROM edi_documents d JOIN edi_counterparties c ON c.counterparty_id = d.counterparty_id
     WHERE d.site_id = $1 AND d.deleted_at IS NULL AND d.created_at > now() - interval '90 days'
     GROUP BY c.counterparty_id ORDER BY n DESC LIMIT 6`,
    [actor.siteId]
  )
  return {
    counts: { ...counts, overdue: overdue.rows[0]?.n ?? 0 },
    attention: attention.rows,
    charts: {
      flow: flow.rows,
      completed: completedFlow.rows,
      byType: byType.rows,
      approvalHours: approval.rows[0]?.n ? approval.rows[0].hours : null,
      approvalCount: approval.rows[0]?.n ?? 0,
      partners: partners.rows,
    },
  }
}
