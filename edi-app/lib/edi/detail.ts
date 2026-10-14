import type { PoolClient } from "pg"
import { can, type Actor } from "./actor.ts"
import { ACTION_LABEL } from "./audit.ts"
import { docType, isEditableStatus, MANUAL_TRANSITIONS } from "./doc-types.ts"
import { getDocument, loadLines, validateForSubmit, type DocRow } from "./documents.ts"
import { edoAvailable, listExchanges } from "./edo.ts"
import { listDocumentFiles } from "./files.ts"
import { resolveIntegration } from "./integrations/config.ts"
import { loadSubscription } from "./saas.ts"
import { listSignatures } from "./signatures.ts"
import { DECISION_LABEL, type WorkflowDefinition } from "./workflow.ts"

export type ActionKey =
  | "edit"
  | "start_workflow"
  | "cancel_workflow"
  | "decide"
  | "sign"
  | "send_edo"
  | "wms_receipt"
  | "wms_sync"
  | "discrepancy_act"
  | "status"
  | "archive"
  | "restore"
  | "delete"
  | "related"
  | "share"
  | "print"

export type Action = { key: ActionKey; label: string; taskId?: string; decisions?: Array<{ value: string; label: string }>; to?: string[] }

export async function documentDetail(client: PoolClient, actor: Actor, documentId: string) {
  const doc = await getDocument(client, actor, documentId)
  const type = docType(doc.docType)
  const [lines, files, signatures, exchanges] = await Promise.all([
    loadLines(client, documentId),
    listDocumentFiles(client, documentId),
    listSignatures(client, documentId),
    listExchanges(client, documentId),
  ])
  const cp = doc.counterpartyId
    ? (
        await client.query(
          `SELECT counterparty_id::text AS id, name, short_name AS "shortName", inn, kpp, address_legal AS "addressLegal",
                  bank_name AS "bankName", bank_bik AS "bankBik", bank_account AS "bankAccount", wms_supplier_code AS "wmsSupplierCode"
           FROM edi_counterparties WHERE counterparty_id = $1::bigint`,
          [doc.counterpartyId]
        )
      ).rows[0] ?? null
    : null
  const people = await client.query<{ user_id: string; display_name: string }>(
    `SELECT user_id::text, display_name FROM wms_users WHERE user_id = ANY($1::bigint[])`,
    [[doc.authorUserId, doc.responsibleUserId].filter(Boolean)]
  )
  const nameOf = (id: string | null) => people.rows.find((p) => p.user_id === id)?.display_name ?? null
  const versions = await client.query(
    `SELECT version_no AS "versionNo", content_hash AS "contentHash", reason, created_by_name AS "createdBy", created_at AS "createdAt", locked, locked_reason AS "lockedReason"
     FROM edi_document_versions WHERE document_id = $1::bigint ORDER BY version_no DESC`,
    [documentId]
  )
  const history = await client.query(
    `SELECT event_id::text AS id, action, actor_name AS "actorName", details, created_at AS "createdAt"
     FROM edi_events WHERE document_id = $1::bigint ORDER BY event_id DESC LIMIT 300`,
    [documentId]
  )
  const instances = await client.query<{ instance_id: string; status: string; def_version: number; definition: WorkflowDefinition; started_at: string; finished_at: string | null; document_version: number }>(
    `SELECT instance_id::text, status, def_version, definition, started_at, finished_at, document_version
     FROM edi_workflow_instances WHERE document_id = $1::bigint ORDER BY instance_id DESC`,
    [documentId]
  )
  const tasks = await client.query(
    `SELECT t.task_id::text AS "taskId", t.instance_id::text AS "instanceId", t.step_index AS "stepIndex", t.step_name AS "stepName", t.kind,
            t.status, t.decision, t.comment, t.due_at AS "dueAt", t.escalated_at AS "escalatedAt", t.created_at AS "createdAt",
            t.completed_at AS "completedAt", t.assignee_user_id::text AS "assigneeUserId", u.display_name AS "assigneeName",
            t.completed_by_name AS "completedByName", ob.display_name AS "onBehalfOfName"
     FROM edi_tasks t LEFT JOIN wms_users u ON u.user_id = t.assignee_user_id LEFT JOIN wms_users ob ON ob.user_id = t.on_behalf_of
     WHERE t.document_id = $1::bigint ORDER BY t.instance_id DESC, t.step_index, t.task_id`,
    [documentId]
  )
  const relations = await client.query(
    `SELECT r.kind, CASE WHEN r.from_document_id = $1::bigint THEN 'out' ELSE 'in' END AS dir,
            d.document_id::text AS "documentId", d.title, d.status, d.doc_type AS "docType"
     FROM edi_relations r
     JOIN edi_documents d ON d.document_id = CASE WHEN r.from_document_id = $1::bigint THEN r.to_document_id ELSE r.from_document_id END
     WHERE (r.from_document_id = $1::bigint OR r.to_document_id = $1::bigint) AND d.deleted_at IS NULL AND d.site_id = $2`,
    [documentId, actor.siteId]
  )
  const links = await client.query(
    `SELECT link_id::text AS id, system, object_type AS "objectType", object_id AS "objectId", url, status, payload, synced_at AS "syncedAt", sync_error AS "syncError"
     FROM edi_external_links WHERE document_id = $1::bigint ORDER BY link_id`,
    [documentId]
  )
  const comments = await client.query(
    `SELECT comment_id::text AS id, author_name AS "authorName", body, created_at AS "createdAt" FROM edi_comments WHERE document_id = $1::bigint ORDER BY comment_id`,
    [documentId]
  )
  const fav = await client.query(`SELECT 1 FROM edi_favorites WHERE user_id = $1::bigint AND document_id = $2::bigint`, [actor.userId, documentId])
  const issues = await validateForSubmit(client, doc)
  const myTasks = tasks.rows.filter((t) => t.status === "pending")
  const actions = await availableActions(client, actor, doc, {
    pendingTasks: myTasks as Array<{ taskId: string; assigneeUserId: string; stepIndex: number; instanceId: string; kind: string }>,
    instance: instances.rows[0] ?? null,
    hasLines: lines.length > 0,
    allMatched: lines.length > 0 && lines.every((l) => l.itemCode),
    hasWmsLink: links.rows.some((l) => l.system === "wms"),
    hasDiscrepancy: links.rows.some((l) => l.status === "received_with_discrepancies"),
    hasOwnSignatureForCurrent: signatures.some((s) => s.side === "own" && s.versionNo === doc.currentVersion),
  })
  return {
    document: { ...doc, authorName: nameOf(doc.authorUserId), responsibleName: nameOf(doc.responsibleUserId), favorite: Boolean(fav.rows[0]) },
    type,
    counterparty: cp,
    lines,
    files,
    versions: versions.rows,
    history: history.rows.map((h) => ({ ...h, label: ACTION_LABEL[h.action] ?? h.action })),
    workflow: instances.rows.map((i) => ({
      instanceId: i.instance_id,
      status: i.status,
      defVersion: i.def_version,
      documentVersion: i.document_version,
      startedAt: i.started_at,
      finishedAt: i.finished_at,
      steps: i.definition.steps.map((s, idx) => ({ id: s.id, name: s.name, kind: s.kind, stage: s.stage, index: idx })),
    })),
    tasks: tasks.rows,
    signatures,
    exchanges,
    relations: relations.rows,
    links: links.rows,
    comments: comments.rows,
    issues,
    actions,
  }
}

async function availableActions(
  client: PoolClient,
  actor: Actor,
  doc: DocRow,
  ctx: {
    pendingTasks: Array<{ taskId: string; assigneeUserId: string; stepIndex: number; instanceId: string; kind: string }>
    instance: { status: string; definition: WorkflowDefinition; instance_id: string } | null
    hasLines: boolean
    allMatched: boolean
    hasWmsLink: boolean
    hasDiscrepancy: boolean
    hasOwnSignatureForCurrent: boolean
  }
): Promise<Action[]> {
  const out: Action[] = []
  const type = docType(doc.docType)
  const sub = await loadSubscription(client, actor.siteId)
  const archived = Boolean(doc.archivedAt)
  if (archived) {
    if (can(actor, "edi.doc.archive")) out.push({ key: "restore", label: "Вернуть из архива" })
    out.push({ key: "print", label: "Печатная форма" })
    return out
  }
  // задачи пользователя (в т.ч. по делегированию)
  const delegators = await client.query<{ from_user_id: string; scope: string }>(
    `SELECT from_user_id::text, scope FROM edi_delegations WHERE site_id = $1 AND to_user_id = $2::bigint AND revoked_at IS NULL
       AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())`,
    [actor.siteId, actor.userId]
  )
  for (const t of ctx.pendingTasks) {
    const mine = t.assigneeUserId === actor.userId
    const deleg = delegators.rows.find((d) => d.from_user_id === t.assigneeUserId && (d.scope === "all" || d.scope === (t.kind === "signing" ? "signing" : "approval")))
    if (!mine && !deleg) continue
    const step = ctx.instance?.instance_id === t.instanceId ? ctx.instance.definition.steps[t.stepIndex] : null
    if (!step) continue
    let decisions = step.decisions.map((d) => ({ value: d, label: DECISION_LABEL[d] ?? d }))
    if (step.kind === "signing" && !can(actor, "edi.doc.sign")) decisions = decisions.filter((d) => d.value !== "sign")
    out.push({ key: "decide", label: mine ? step.name : `${step.name} (за коллегу)`, taskId: t.taskId, decisions })
    if (step.kind === "signing" && can(actor, "edi.doc.sign") && !ctx.hasOwnSignatureForCurrent) out.push({ key: "sign", label: "Подписать ЭП" })
  }
  const author = doc.authorUserId === actor.userId || doc.responsibleUserId === actor.userId
  if (isEditableStatus(doc.status) && can(actor, "edi.doc.edit")) out.push({ key: "edit", label: "Редактировать" })
  if (["draft", "rework", "received"].includes(doc.status) && (author || can(actor, "edi.doc.edit")) && sub.features.workflows) {
    out.push({ key: "start_workflow", label: doc.status === "rework" ? "Отправить повторно на согласование" : "На согласование" })
  }
  if (ctx.instance?.status === "running" && (doc.authorUserId === actor.userId || can(actor, "edi.admin"))) out.push({ key: "cancel_workflow", label: "Отозвать с согласования" })
  if (["approved", "signing"].includes(doc.status) && can(actor, "edi.doc.sign") && ctx.instance?.status !== "running" && !ctx.hasOwnSignatureForCurrent) {
    out.push({ key: "sign", label: "Подписать ЭП" })
  }
  if (doc.signedVersion != null && doc.exchangeStatus === "none" && can(actor, "edi.doc.send") && doc.direction === "outgoing") {
    const edo = await edoAvailable(client, actor.siteId)
    if (edo.available) out.push({ key: "send_edo", label: "Отправить через оператора ЭДО" })
  }
  if (type?.wmsReceipt && doc.direction === "incoming" && ctx.hasLines && can(actor, "edi.wms.receipt") && sub.features.integrations && !["cancelled", "rejected"].includes(doc.status)) {
    const wms = await resolveIntegration(client, actor.siteId, "wms")
    if (wms?.enabled) {
      if (!ctx.hasWmsLink) out.push({ key: "wms_receipt", label: ctx.allMatched ? "Создать приёмку в WMS" : "Создать приёмку в WMS (сопоставьте строки)" })
      else out.push({ key: "wms_sync", label: "Обновить статус приёмки" })
    }
  }
  if (ctx.hasDiscrepancy && can(actor, "edi.doc.create")) out.push({ key: "discrepancy_act", label: "Создать акт расхождений" })
  const transitions = (MANUAL_TRANSITIONS[doc.status] ?? []).filter((to) => {
    if (to === "sent") return can(actor, "edi.doc.send")
    if (to === "approved" && doc.status === "signing") return can(actor, "edi.doc.sign")
    if (ctx.instance?.status === "running") return false
    return can(actor, "edi.doc.edit")
  })
  if (transitions.length) out.push({ key: "status", label: "Сменить статус", to: transitions })
  if (can(actor, "edi.doc.archive") && ["completed", "cancelled", "signed", "sent", "rejected"].includes(doc.status)) out.push({ key: "archive", label: "В архив" })
  if (doc.status === "draft" && can(actor, "edi.doc.delete") && (doc.authorUserId === actor.userId || can(actor, "edi.admin"))) out.push({ key: "delete", label: "Удалить черновик" })
  out.push({ key: "related", label: "Связать документ" })
  if (author || can(actor, "edi.admin")) out.push({ key: "share", label: "Дать доступ" })
  out.push({ key: "print", label: "Печатная форма" })
  return out
}
