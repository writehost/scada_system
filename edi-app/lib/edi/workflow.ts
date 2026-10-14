import type { PoolClient } from "pg"
import { HttpError } from "../db.ts"
import { can, requirePermission, type Actor } from "./actor.ts"
import { actorEvent, recordEvent } from "./audit.ts"
import { getDocument, lockVersion, touch, validateForSubmit, type DocRow } from "./documents.ts"
import { EDI_ROLES, effectiveEdiRoles } from "./permissions.ts"
import { notifyUsers, signalDocument } from "./notify.ts"
import { requireFeature } from "./saas.ts"

/* ---------- определение маршрута ---------- */

export type Condition = {
  field: "amount" | "docType" | "department" | "direction"
  op: "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "in"
  value: string | number | string[]
}

export type Assignee =
  | { type: "user"; userId: string }
  | { type: "role"; role: string; department?: string | null }
  | { type: "responsible" }

export type StepDef = {
  id: string
  name: string
  kind: "approval" | "review" | "signing"
  assignee: Assignee
  mode: "any" | "all"
  stage: number
  condition?: Condition | null
  dueHours?: number | null
  decisions: Array<"approve" | "reject" | "rework" | "sign">
  escalateToUserId?: string | null
}

export type WorkflowDefinition = { steps: StepDef[] }

export const DECISION_LABEL: Record<string, string> = {
  approve: "Согласовать",
  reject: "Отклонить",
  rework: "Вернуть на доработку",
  sign: "Подписание выполнено",
}

export function validateDefinition(def: WorkflowDefinition): string[] {
  const errors: string[] = []
  if (!Array.isArray(def?.steps) || def.steps.length === 0) return ["Добавьте хотя бы один шаг"]
  if (def.steps.length > 30) errors.push("Не больше 30 шагов")
  const ids = new Set<string>()
  def.steps.forEach((s, i) => {
    const n = `Шаг ${i + 1}`
    if (!s.id || ids.has(s.id)) errors.push(`${n}: повтор или пустой идентификатор`)
    ids.add(s.id)
    if (!s.name?.trim()) errors.push(`${n}: нет названия`)
    if (!["approval", "review", "signing"].includes(s.kind)) errors.push(`${n}: неизвестный вид шага`)
    if (!Number.isInteger(s.stage) || s.stage < 1) errors.push(`${n}: этап должен быть целым числом ≥ 1`)
    if (!["any", "all"].includes(s.mode)) errors.push(`${n}: режим any/all`)
    const a = s.assignee
    if (!a || !["user", "role", "responsible"].includes(a.type)) errors.push(`${n}: не задан исполнитель`)
    if (a?.type === "role" && !EDI_ROLES[a.role]) errors.push(`${n}: неизвестная роль ${a.role}`)
    if (a?.type === "user" && !/^\d+$/.test(String(a.userId))) errors.push(`${n}: не выбран пользователь`)
    const allowed = s.kind === "signing" ? ["sign", "reject"] : ["approve", "reject", "rework"]
    if (!s.decisions?.length || s.decisions.some((d) => !allowed.includes(d))) errors.push(`${n}: недопустимые решения`)
    if (s.dueHours != null && (!(s.dueHours > 0) || s.dueHours > 24 * 90)) errors.push(`${n}: срок от 1 часа до 90 дней`)
    if (s.condition && !["amount", "docType", "department", "direction"].includes(s.condition.field)) errors.push(`${n}: неизвестное условие`)
  })
  return errors
}

export function conditionHolds(c: Condition | null | undefined, doc: Pick<DocRow, "amountTotal" | "docType" | "department" | "direction">): boolean {
  if (!c) return true
  const raw =
    c.field === "amount" ? Number(doc.amountTotal ?? 0) : c.field === "docType" ? doc.docType : c.field === "department" ? doc.department ?? "" : doc.direction
  const v = c.value
  switch (c.op) {
    case "gt":
      return Number(raw) > Number(v)
    case "gte":
      return Number(raw) >= Number(v)
    case "lt":
      return Number(raw) < Number(v)
    case "lte":
      return Number(raw) <= Number(v)
    case "eq":
      return String(raw) === String(v)
    case "neq":
      return String(raw) !== String(v)
    case "in":
      return (Array.isArray(v) ? v : String(v).split(",")).map((x) => String(x).trim()).includes(String(raw))
    default:
      return false
  }
}

export function stagesOf(def: WorkflowDefinition): number[] {
  return [...new Set(def.steps.map((s) => s.stage))].sort((a, b) => a - b)
}

/* ---------- определения: версии ---------- */

export async function listDefinitions(client: PoolClient, siteId: number) {
  const r = await client.query(
    `SELECT DISTINCT ON (code) def_id::text AS "defId", code, name, version, is_active AS "isActive", doc_types AS "docTypes",
            priority, definition, created_at AS "createdAt",
            (SELECT count(*)::int FROM edi_workflow_instances i WHERE i.def_id = d.def_id AND i.status = 'running') AS "running"
     FROM edi_workflow_defs d WHERE site_id = $1
     ORDER BY code, version DESC`,
    [siteId]
  )
  return r.rows
}

/** Сохранение создаёт новую версию; запущенные процессы продолжают идти по своей копии определения. */
export async function saveDefinition(
  client: PoolClient,
  actor: Actor,
  input: { code: string; name: string; docTypes: string[]; priority?: number; isActive?: boolean; definition: WorkflowDefinition }
) {
  requirePermission(actor, "edi.workflow.admin")
  await requireFeature(client, actor.siteId, "workflows", "Маршруты согласования")
  const code = String(input.code || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 60)
  if (!code) throw new HttpError(400, "Укажите код маршрута", "bad_code")
  const errors = validateDefinition(input.definition)
  if (errors.length) throw new HttpError(400, errors.join("; "), "bad_definition", errors)
  for (const s of input.definition.steps) {
    const uid = s.assignee.type === "user" ? s.assignee.userId : s.escalateToUserId
    if (uid) {
      const u = await client.query(`SELECT 1 FROM wms_users WHERE user_id = $1::bigint AND site_id = $2 AND is_active`, [uid, actor.siteId])
      if (!u.rows[0]) throw new HttpError(400, `Шаг «${s.name}»: пользователь не найден в организации`, "bad_user")
    }
  }
  const v = await client.query<{ v: number }>(`SELECT COALESCE(max(version), 0)::int + 1 AS v FROM edi_workflow_defs WHERE site_id = $1 AND code = $2`, [actor.siteId, code])
  await client.query(`UPDATE edi_workflow_defs SET is_active = FALSE WHERE site_id = $1 AND code = $2`, [actor.siteId, code])
  const r = await client.query<{ def_id: string }>(
    `INSERT INTO edi_workflow_defs (site_id, code, name, version, is_active, doc_types, priority, definition, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::bigint) RETURNING def_id::text`,
    [actor.siteId, code, input.name.trim().slice(0, 200) || code, v.rows[0].v, input.isActive !== false, input.docTypes ?? [], input.priority ?? 100, JSON.stringify(input.definition), actor.userId]
  )
  await recordEvent(client, actorEvent(actor, "admin.workflow", null, { code, version: v.rows[0].v }))
  return { defId: r.rows[0].def_id, version: v.rows[0].v }
}

async function pickDefinition(client: PoolClient, siteId: number, doc: DocRow, defId?: string | null) {
  const r = defId
    ? await client.query<{ def_id: string; version: number; definition: WorkflowDefinition; name: string }>(
        `SELECT def_id::text, version, definition, name FROM edi_workflow_defs WHERE site_id = $1 AND def_id = $2::bigint AND is_active`,
        [siteId, defId]
      )
    : await client.query<{ def_id: string; version: number; definition: WorkflowDefinition; name: string }>(
        `SELECT def_id::text, version, definition, name FROM edi_workflow_defs
         WHERE site_id = $1 AND is_active AND (cardinality(doc_types) = 0 OR $2 = ANY(doc_types))
         ORDER BY CASE WHEN $2 = ANY(doc_types) THEN 0 ELSE 1 END, priority, def_id DESC LIMIT 1`,
        [siteId, doc.docType]
      )
  return r.rows[0] ?? null
}

/* ---------- исполнители ---------- */

export async function usersWithRole(client: PoolClient, siteId: number, role: string, department?: string | null): Promise<string[]> {
  const r = await client.query<{ user_id: string; wms_roles: string[]; edi_roles: string[]; department: string | null }>(
    `SELECT u.user_id::text,
            COALESCE((SELECT array_agg(r.code) FROM wms_user_roles ur JOIN wms_roles r ON r.role_id = ur.role_id WHERE ur.user_id = u.user_id), '{}') AS wms_roles,
            COALESCE((SELECT array_agg(er.role_code) FROM edi_user_roles er WHERE er.user_id = u.user_id AND er.site_id = u.site_id), '{}') AS edi_roles,
            (SELECT p.department FROM edi_user_profiles p WHERE p.user_id = u.user_id AND p.site_id = u.site_id) AS department
     FROM wms_users u WHERE u.site_id = $1 AND u.is_active`,
    [siteId]
  )
  return r.rows
    .filter((u) => effectiveEdiRoles(u.wms_roles, u.edi_roles).includes(role))
    .filter((u) => !department || (u.department ?? "").toLowerCase() === department.toLowerCase())
    .map((u) => u.user_id)
}

async function resolveAssignees(client: PoolClient, siteId: number, step: StepDef, doc: DocRow): Promise<string[]> {
  const a = step.assignee
  if (a.type === "user") return [a.userId]
  if (a.type === "responsible") return doc.responsibleUserId ? [doc.responsibleUserId] : doc.authorUserId ? [doc.authorUserId] : []
  return usersWithRole(client, siteId, a.role, a.department)
}

/* ---------- исполнение ---------- */

type Instance = { instance_id: string; site_id: number; document_id: string; definition: WorkflowDefinition; status: string; document_version: number }

async function loadInstance(client: PoolClient, instanceId: string): Promise<Instance> {
  const r = await client.query<Instance>(
    `SELECT instance_id::text, site_id, document_id::text, definition, status, document_version FROM edi_workflow_instances WHERE instance_id = $1::bigint FOR UPDATE`,
    [instanceId]
  )
  if (!r.rows[0]) throw new HttpError(404, "Процесс не найден", "not_found")
  return r.rows[0]
}

async function docRaw(client: PoolClient, documentId: string): Promise<DocRow> {
  const r = await client.query<DocRow>(
    `SELECT document_id::text AS "documentId", doc_type AS "docType", direction, amount_total::text AS "amountTotal", department,
            author_user_id::text AS "authorUserId", responsible_user_id::text AS "responsibleUserId", title, status,
            current_version AS "currentVersion", site_id
     FROM edi_documents WHERE document_id = $1::bigint`,
    [documentId]
  )
  return r.rows[0]
}

/** Запуск следующего этапа. Шаги с невыполненным условием фиксируются как пропущенные. */
async function advance(client: PoolClient, inst: Instance, actorName: string): Promise<"running" | "approved"> {
  const doc = await docRaw(client, inst.document_id)
  const done = await client.query<{ step_index: number }>(`SELECT DISTINCT step_index FROM edi_tasks WHERE instance_id = $1::bigint`, [inst.instance_id])
  const started = new Set(done.rows.map((r) => r.step_index))
  for (const stage of stagesOf(inst.definition)) {
    const steps = inst.definition.steps.map((s, i) => ({ s, i })).filter((x) => x.s.stage === stage)
    if (steps.every((x) => started.has(x.i))) continue
    let created = 0
    for (const { s, i } of steps) {
      if (started.has(i)) continue
      if (!conditionHolds(s.condition, doc)) {
        await client.query(
          `INSERT INTO edi_tasks (site_id, instance_id, document_id, step_id, step_index, step_name, kind, status, comment, completed_at)
           VALUES ($1, $2::bigint, $3::bigint, $4, $5, $6, $7, 'skipped', 'Условие шага не выполнено', now())`,
          [inst.site_id, inst.instance_id, inst.document_id, s.id, i, s.name, s.kind]
        )
        continue
      }
      const users = await resolveAssignees(client, inst.site_id, s, doc)
      if (users.length === 0) throw new HttpError(409, `Шаг «${s.name}»: нет пользователей для назначения`, "no_assignees")
      for (const u of users) {
        const t = await client.query<{ task_id: string }>(
          `INSERT INTO edi_tasks (site_id, instance_id, document_id, step_id, step_index, step_name, kind, assignee_user_id, assignee_role, due_at, escalate_to_user_id)
           VALUES ($1, $2::bigint, $3::bigint, $4, $5, $6, $7, $8::bigint, $9,
                   CASE WHEN $10::numeric IS NULL THEN NULL ELSE now() + make_interval(hours => $10::int) END, $11::bigint)
           RETURNING task_id::text`,
          [inst.site_id, inst.instance_id, inst.document_id, s.id, i, s.name, s.kind, u, s.assignee.type === "role" ? s.assignee.role : null, s.dueHours ?? null, s.escalateToUserId ?? null]
        )
        await notifyUsers(client, {
          siteId: inst.site_id,
          userIds: [u],
          event: s.kind === "signing" ? "signature.requested" : "task.assigned",
          title: s.kind === "signing" ? `Требуется подпись: ${s.name}` : `На согласование: ${s.name}`,
          body: doc.title,
          documentId: inst.document_id,
          taskId: t.rows[0].task_id,
          dedupeKey: `task:${t.rows[0].task_id}`,
        })
        created++
      }
    }
    if (created > 0) {
      const signing = steps.some((x) => x.s.kind === "signing" && conditionHolds(x.s.condition, doc))
      await touch(client, inst.document_id, "workflow.stage", { status: signing ? "signing" : "in_review" })
      return "running"
    }
  }
  // все этапы пройдены
  const hadSigning = await client.query(`SELECT 1 FROM edi_tasks WHERE instance_id = $1::bigint AND kind = 'signing' AND decision = 'sign' LIMIT 1`, [inst.instance_id])
  await client.query(`UPDATE edi_workflow_instances SET status = 'approved', finished_at = now() WHERE instance_id = $1::bigint`, [inst.instance_id])
  if (hadSigning.rows[0]) {
    await touch(client, inst.document_id, "workflow.finished", { status: "signed", signed_version: inst.document_version })
    await lockVersion(client, inst.document_id, inst.document_version, "Подписано")
  } else {
    await touch(client, inst.document_id, "workflow.finished", { status: "approved" })
  }
  await recordEvent(client, { siteId: inst.site_id, documentId: inst.document_id, actorName, action: "workflow.finished", details: { result: "approved" } })
  if (doc.authorUserId) {
    await notifyUsers(client, {
      siteId: inst.site_id,
      userIds: [doc.authorUserId],
      event: "document.approved",
      title: hadSigning.rows[0] ? "Документ подписан" : "Документ согласован",
      body: doc.title,
      documentId: inst.document_id,
      dedupeKey: `approved:${inst.instance_id}`,
    })
  }
  return "approved"
}

export async function startWorkflow(client: PoolClient, actor: Actor, documentId: string, defId?: string | null) {
  await requireFeature(client, actor.siteId, "workflows", "Согласование по маршруту")
  const doc = await getDocument(client, actor, documentId, { forUpdate: true })
  if (!["draft", "rework", "received"].includes(doc.status)) throw new HttpError(409, "Документ уже на согласовании или завершён", "bad_status")
  if (doc.authorUserId !== actor.userId && doc.responsibleUserId !== actor.userId && !can(actor, "edi.doc.edit")) {
    throw new HttpError(403, "Отправить на согласование может автор или ответственный", "forbidden")
  }
  const issues = (await validateForSubmit(client, doc)).filter((i) => i.level === "error")
  if (issues.length) throw new HttpError(409, `Документ не готов: ${issues.map((i) => i.message).join("; ")}`, "not_ready", issues)
  const running = await client.query(`SELECT 1 FROM edi_workflow_instances WHERE document_id = $1::bigint AND status = 'running'`, [documentId])
  if (running.rows[0]) throw new HttpError(409, "Согласование уже запущено", "already_running")
  const def = await pickDefinition(client, actor.siteId, doc, defId)
  if (!def) throw new HttpError(409, "Нет подходящего маршрута согласования — настройте его в разделе «Маршруты»", "no_route")
  const ins = await client.query<{ instance_id: string }>(
    `INSERT INTO edi_workflow_instances (site_id, document_id, def_id, def_version, definition, document_version, started_by)
     VALUES ($1, $2::bigint, $3::bigint, $4, $5::jsonb, $6, $7::bigint) RETURNING instance_id::text`,
    [actor.siteId, documentId, def.def_id, def.version, JSON.stringify(def.definition), doc.currentVersion, actor.userId]
  )
  await recordEvent(client, actorEvent(actor, "workflow.started", documentId, { route: def.name, version: def.version }))
  const inst = await loadInstance(client, ins.rows[0].instance_id)
  const state = await advance(client, inst, actor.fio)
  await signalDocument(client, actor.siteId, documentId)
  return { instanceId: inst.instance_id, state }
}

/** Кто может действовать по задаче: исполнитель или его действующий заместитель (делегирование). */
async function actingFor(client: PoolClient, actor: Actor, assignee: string | null, kind: string): Promise<string | null> {
  if (!assignee) return null
  if (assignee === actor.userId) return actor.userId
  const r = await client.query(
    `SELECT 1 FROM edi_delegations WHERE site_id = $1 AND from_user_id = $2::bigint AND to_user_id = $3::bigint AND revoked_at IS NULL
       AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now()) AND (scope = 'all' OR scope = $4) LIMIT 1`,
    [actor.siteId, assignee, actor.userId, kind === "signing" ? "signing" : "approval"]
  )
  return r.rows[0] ? assignee : null
}

export async function decide(client: PoolClient, actor: Actor, taskId: string, decision: string, comment?: string | null) {
  if (!/^\d+$/.test(taskId)) throw new HttpError(404, "Задача не найдена", "not_found")
  const t = await client.query<{ task_id: string; instance_id: string; document_id: string; step_index: number; status: string; kind: string; assignee_user_id: string | null }>(
    `SELECT task_id::text, instance_id::text, document_id::text, step_index, status, kind, assignee_user_id::text
     FROM edi_tasks WHERE task_id = $1::bigint AND site_id = $2 FOR UPDATE`,
    [taskId, actor.siteId]
  )
  const task = t.rows[0]
  if (!task) throw new HttpError(404, "Задача не найдена", "not_found")
  if (task.status !== "pending") throw new HttpError(409, "Задача уже выполнена", "task_done")
  const onBehalf = await actingFor(client, actor, task.assignee_user_id, task.kind)
  if (!onBehalf) throw new HttpError(403, "Задача назначена другому сотруднику", "not_assignee")
  const inst = await loadInstance(client, task.instance_id)
  if (inst.status !== "running") throw new HttpError(409, "Процесс согласования уже завершён", "instance_done")
  const step = inst.definition.steps[task.step_index]
  if (!step.decisions.includes(decision as never)) throw new HttpError(400, "Это решение недоступно на шаге", "bad_decision")
  const text = (comment ?? "").trim().slice(0, 4000)
  if ((decision === "reject" || decision === "rework") && !text) throw new HttpError(400, "Укажите причину", "comment_required")
  if (decision === "sign") {
    requirePermission(actor, "edi.doc.sign")
    const sig = await client.query(
      `SELECT 1 FROM edi_signatures WHERE document_id = $1::bigint AND version_no = $2 AND side = 'own' AND created_by = $3::bigint LIMIT 1`,
      [task.document_id, inst.document_version, actor.userId]
    )
    if (!sig.rows[0]) {
      throw new HttpError(409, "Сначала добавьте электронную подпись текущей версии (вкладка «Подписи»). Нажатие кнопки подписью не является.", "signature_required")
    }
  }
  await client.query(
    `UPDATE edi_tasks SET status = 'done', decision = $2, comment = NULLIF($3, ''), completed_by = $4::bigint, completed_by_name = $5,
       on_behalf_of = CASE WHEN $6::bigint <> $4::bigint THEN $6::bigint ELSE NULL END, completed_at = now()
     WHERE task_id = $1::bigint`,
    [taskId, decision, text, actor.userId, actor.fio, onBehalf]
  )
  await recordEvent(client, actorEvent(actor, "workflow.decision", task.document_id, { step: step.name, decision, comment: text || null, onBehalfOf: onBehalf !== actor.userId ? onBehalf : null }))
  const doc = await docRaw(client, task.document_id)

  if (decision === "reject" || decision === "rework") {
    await client.query(`UPDATE edi_tasks SET status = 'cancelled', comment = 'Процесс остановлен решением другого участника' WHERE instance_id = $1::bigint AND status = 'pending'`, [inst.instance_id])
    await client.query(`UPDATE edi_workflow_instances SET status = $2, finished_at = now() WHERE instance_id = $1::bigint`, [inst.instance_id, decision === "reject" ? "rejected" : "rework"])
    await touch(client, task.document_id, "workflow.decision", { status: decision === "reject" ? "rejected" : "rework" })
    if (doc.authorUserId) {
      await notifyUsers(client, {
        siteId: actor.siteId,
        userIds: [doc.authorUserId],
        event: decision === "reject" ? "document.rejected" : "document.rework",
        title: decision === "reject" ? "Документ отклонён" : "Документ возвращён на доработку",
        body: `${doc.title}: ${text}`,
        documentId: task.document_id,
        dedupeKey: `${decision}:${taskId}`,
        excludeUserId: actor.userId,
      })
    }
    await signalDocument(client, actor.siteId, task.document_id)
    return { state: decision === "reject" ? "rejected" : "rework" }
  }

  // согласовано: при режиме «любой» остальные задачи этого шага снимаются
  if (step.mode === "any") {
    await client.query(
      `UPDATE edi_tasks SET status = 'cancelled', comment = $3 WHERE instance_id = $1::bigint AND step_index = $2 AND status = 'pending'`,
      [inst.instance_id, task.step_index, `Решение принял ${actor.fio}`]
    )
  }
  const pendingInStage = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM edi_tasks WHERE instance_id = $1::bigint AND status = 'pending' AND step_index = ANY($2::int[])`,
    [inst.instance_id, inst.definition.steps.map((s, i) => (s.stage === step.stage ? i : -1)).filter((i) => i >= 0)]
  )
  let state: string = "running"
  if (pendingInStage.rows[0].n === 0) state = await advance(client, inst, actor.fio)
  await signalDocument(client, actor.siteId, task.document_id)
  return { state }
}

export async function cancelWorkflow(client: PoolClient, actor: Actor, documentId: string, reason: string) {
  const doc = await getDocument(client, actor, documentId, { forUpdate: true })
  if (doc.authorUserId !== actor.userId && !can(actor, "edi.admin")) throw new HttpError(403, "Отменить согласование может автор или администратор", "forbidden")
  const r = await client.query<{ instance_id: string }>(
    `UPDATE edi_workflow_instances SET status = 'cancelled', finished_at = now() WHERE document_id = $1::bigint AND status = 'running' RETURNING instance_id::text`,
    [documentId]
  )
  if (!r.rows[0]) throw new HttpError(409, "Нет запущенного согласования", "not_running")
  await client.query(`UPDATE edi_tasks SET status = 'cancelled', comment = $2 WHERE instance_id = $1::bigint AND status = 'pending'`, [r.rows[0].instance_id, `Отменено: ${reason}`])
  await touch(client, documentId, "workflow.cancelled", { status: doc.source === "import" ? "received" : "draft" })
  await recordEvent(client, actorEvent(actor, "workflow.cancelled", documentId, { reason }))
}

/* ---------- сроки и эскалация (фоновая задача) ---------- */

export async function processDeadlines(client: PoolClient): Promise<{ dueSoon: number; overdue: number }> {
  let dueSoon = 0
  let overdue = 0
  const soon = await client.query<{ task_id: string; site_id: number; assignee_user_id: string; document_id: string; step_name: string; title: string }>(
    `SELECT t.task_id::text, t.site_id, t.assignee_user_id::text, t.document_id::text, t.step_name, d.title
     FROM edi_tasks t JOIN edi_documents d ON d.document_id = t.document_id
     WHERE t.status = 'pending' AND t.due_at BETWEEN now() AND now() + interval '4 hours' LIMIT 500`
  )
  for (const t of soon.rows) {
    dueSoon += await notifyUsers(client, {
      siteId: t.site_id,
      userIds: [t.assignee_user_id],
      event: "task.due_soon",
      title: `Срок согласования истекает: ${t.step_name}`,
      body: t.title,
      documentId: t.document_id,
      taskId: t.task_id,
      dedupeKey: `due_soon:${t.task_id}`,
    })
  }
  const late = await client.query<{ task_id: string; site_id: number; assignee_user_id: string; escalate_to_user_id: string | null; document_id: string; step_name: string; title: string; responsible: string | null; instance_id: string; step_index: number; kind: string; step_id: string }>(
    `SELECT t.task_id::text, t.site_id, t.assignee_user_id::text, t.escalate_to_user_id::text, t.document_id::text, t.step_name, d.title,
            d.responsible_user_id::text AS responsible, t.instance_id::text, t.step_index, t.kind, t.step_id
     FROM edi_tasks t JOIN edi_documents d ON d.document_id = t.document_id
     WHERE t.status = 'pending' AND t.due_at < now() AND t.escalated_at IS NULL
     FOR UPDATE OF t SKIP LOCKED LIMIT 500`
  )
  for (const t of late.rows) {
    await client.query(`UPDATE edi_tasks SET escalated_at = now() WHERE task_id = $1::bigint`, [t.task_id])
    const to = [t.assignee_user_id, t.escalate_to_user_id ?? t.responsible].filter((x): x is string => Boolean(x))
    overdue += await notifyUsers(client, {
      siteId: t.site_id,
      userIds: to,
      event: "task.overdue",
      title: `Просрочено согласование: ${t.step_name}`,
      body: t.title,
      documentId: t.document_id,
      taskId: t.task_id,
      dedupeKey: `overdue:${t.task_id}`,
    })
    if (t.escalate_to_user_id && t.escalate_to_user_id !== t.assignee_user_id) {
      // эскалация: руководитель получает параллельную задачу на том же шаге
      await client.query(
        `INSERT INTO edi_tasks (site_id, instance_id, document_id, step_id, step_index, step_name, kind, assignee_user_id, escalated_at)
         SELECT $1, $2::bigint, $3::bigint, $4, $5, $6 || ' (эскалация)', $7, $8::bigint, now()
         WHERE NOT EXISTS (SELECT 1 FROM edi_tasks WHERE instance_id = $2::bigint AND step_index = $5 AND assignee_user_id = $8::bigint AND status = 'pending')`,
        [t.site_id, t.instance_id, t.document_id, t.step_id, t.step_index, t.step_name, t.kind, t.escalate_to_user_id]
      )
    }
    await recordEvent(client, { siteId: t.site_id, documentId: t.document_id, actorName: "SCADA EDI", action: "workflow.escalated", details: { taskId: t.task_id, step: t.step_name } })
  }
  return { dueSoon, overdue }
}

/* ---------- делегирование ---------- */

export async function createDelegation(
  client: PoolClient,
  actor: Actor,
  input: { fromUserId?: string; toUserId: string; scope?: string; startsAt?: string | null; endsAt?: string | null; reason?: string | null }
) {
  const from = input.fromUserId || actor.userId
  if (from !== actor.userId) requirePermission(actor, "edi.admin")
  if (from === input.toUserId) throw new HttpError(400, "Нельзя делегировать самому себе", "self")
  const u = await client.query(`SELECT 1 FROM wms_users WHERE user_id = $1::bigint AND site_id = $2 AND is_active`, [input.toUserId, actor.siteId])
  if (!u.rows[0]) throw new HttpError(400, "Заместитель не найден в организации", "user_not_found")
  const scope = ["all", "approval", "signing"].includes(String(input.scope)) ? input.scope : "all"
  const r = await client.query<{ delegation_id: string }>(
    `INSERT INTO edi_delegations (site_id, from_user_id, to_user_id, scope, starts_at, ends_at, reason, created_by)
     VALUES ($1, $2::bigint, $3::bigint, $4, COALESCE($5::timestamptz, now()), $6::timestamptz, $7, $8::bigint) RETURNING delegation_id::text`,
    [actor.siteId, from, input.toUserId, scope, input.startsAt || null, input.endsAt || null, input.reason ?? null, actor.userId]
  )
  return { delegationId: r.rows[0].delegation_id }
}

export async function listDelegations(client: PoolClient, actor: Actor) {
  const r = await client.query(
    `SELECT d.delegation_id::text AS id, d.from_user_id::text AS "fromUserId", fu.display_name AS "fromName",
            d.to_user_id::text AS "toUserId", tu.display_name AS "toName", d.scope, d.starts_at AS "startsAt", d.ends_at AS "endsAt", d.reason,
            (d.revoked_at IS NULL AND d.starts_at <= now() AND (d.ends_at IS NULL OR d.ends_at > now())) AS active
     FROM edi_delegations d JOIN wms_users fu ON fu.user_id = d.from_user_id JOIN wms_users tu ON tu.user_id = d.to_user_id
     WHERE d.site_id = $1 AND d.revoked_at IS NULL AND (d.ends_at IS NULL OR d.ends_at > now())
       AND ($2::boolean OR d.from_user_id = $3::bigint OR d.to_user_id = $3::bigint)
     ORDER BY d.starts_at DESC`,
    [actor.siteId, can(actor, "edi.admin"), actor.userId]
  )
  return r.rows
}

export async function revokeDelegation(client: PoolClient, actor: Actor, id: string) {
  const r = await client.query(
    `UPDATE edi_delegations SET revoked_at = now() WHERE delegation_id = $1::bigint AND site_id = $2 AND revoked_at IS NULL
       AND ($3::boolean OR from_user_id = $4::bigint)`,
    [id, actor.siteId, can(actor, "edi.admin"), actor.userId]
  )
  if (!r.rowCount) throw new HttpError(404, "Делегирование не найдено", "not_found")
}

/** Готовые заготовки маршрутов для конструктора (не сохраняются автоматически). */
export const ROUTE_PRESETS: Array<{ code: string; name: string; docTypes: string[]; definition: WorkflowDefinition }> = [
  {
    code: "contract",
    name: "Договор: юрист → руководитель → директор → подписание",
    docTypes: ["contract", "supplementary", "specification"],
    definition: {
      steps: [
        { id: "lawyer", name: "Юрист", kind: "approval", assignee: { type: "role", role: "edi_lawyer" }, mode: "any", stage: 1, dueHours: 24, decisions: ["approve", "reject", "rework"] },
        { id: "head", name: "Руководитель отдела", kind: "approval", assignee: { type: "role", role: "edi_approver" }, mode: "any", stage: 2, dueHours: 24, decisions: ["approve", "reject", "rework"] },
        { id: "director", name: "Директор (сумма > 1 млн)", kind: "approval", assignee: { type: "role", role: "edi_admin" }, mode: "any", stage: 3, dueHours: 48, decisions: ["approve", "reject", "rework"], condition: { field: "amount", op: "gt", value: 1000000 } },
        { id: "sign", name: "Подписание", kind: "signing", assignee: { type: "role", role: "edi_signer" }, mode: "any", stage: 4, dueHours: 24, decisions: ["sign", "reject"] },
      ],
    },
  },
  {
    code: "incoming_invoice",
    name: "Входящий счёт/УПД: проверка и утверждение к оплате",
    docTypes: ["invoice", "upd", "act_works", "act_services"],
    definition: {
      steps: [
        { id: "check", name: "Проверка ответственным", kind: "review", assignee: { type: "responsible" }, mode: "any", stage: 1, dueHours: 8, decisions: ["approve", "reject", "rework"] },
        { id: "approve", name: "Утверждение руководителем", kind: "approval", assignee: { type: "role", role: "edi_approver" }, mode: "any", stage: 2, dueHours: 24, decisions: ["approve", "reject", "rework"] },
      ],
    },
  },
  {
    code: "internal",
    name: "Служебная записка / заявка: параллельно руководитель и бухгалтерия",
    docTypes: ["memo", "request", "application"],
    definition: {
      steps: [
        { id: "head", name: "Руководитель", kind: "approval", assignee: { type: "role", role: "edi_approver" }, mode: "any", stage: 1, dueHours: 24, decisions: ["approve", "reject", "rework"] },
        { id: "acc", name: "Бухгалтерия", kind: "approval", assignee: { type: "role", role: "edi_clerk" }, mode: "any", stage: 1, dueHours: 24, decisions: ["approve", "reject", "rework"] },
      ],
    },
  },
]
