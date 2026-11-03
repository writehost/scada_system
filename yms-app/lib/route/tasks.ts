import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { WmsHttpError } from "@/lib/wms/errors"
import { actorCan, actorLabel, type RouteActor, type RouteUserActor } from "@/lib/route/auth"
import { classifyScan, palletKey, parseAddressScan } from "@/lib/route/codes"
import { rankCandidates, type Candidate } from "@/lib/route/dispatch"
import { publish } from "@/lib/route/events"
import { getForklift, listForklifts } from "@/lib/route/fleet"
import { findRoute, nodeForAddress, normalizeLocation, type MapGeometry, type Pt, type RouteResult } from "@/lib/route/graph"
import { blockedEdgeSet, getPublishedMap, requirePublishedMap } from "@/lib/route/maps"
import { getPosition, type ForkliftPosition } from "@/lib/route/positions"
import { decideAddressScan, decidePalletScan, type ScanDecision, type TaskForScan } from "@/lib/route/scan-rules"
import {
  allowedRouteActions,
  DRIVER_ACTIVE,
  isLoaded,
  isRouteTaskType,
  resolveRouteTransition,
  STATUS_LABEL,
  TERMINAL,
  TYPE_LABEL,
  type RouteAction,
  type RouteTaskStatus,
  type RouteTaskType,
} from "@/lib/route/state-machine"
import { wmsGateway, type PalletCheck } from "@/lib/route/wms-gateway"

/* ------------------------------------------------------------------ */
/* Модель                                                              */
/* ------------------------------------------------------------------ */

export type TaskRow = {
  taskId: string
  siteId: number
  taskNo: string
  type: RouteTaskType
  priority: number
  status: RouteTaskStatus
  resumeStatus: RouteTaskStatus | null
  version: number
  karaId: string | null
  driverLogin: string | null
  driverUserId: string | null
  sourceCode: string
  sourceNodeId: string | null
  destCode: string
  destNodeId: string | null
  huCode: string
  itemCode: string | null
  itemName: string | null
  lotCode: string | null
  qty: number | null
  expiryAt: string | null
  wmsRefKind: string | null
  wmsRefId: string | null
  loadScanId: string | null
  addressScanId: string | null
  wmsMovementRequestId: string | null
  wmsMovementStatus: string | null
  wmsMovementResult: Record<string, unknown> | null
  blockedReason: string | null
  cancelReason: string | null
  note: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  offeredAt: string | null
  acceptedAt: string | null
  loadedAt: string | null
  completedAt: string | null
  payload: Record<string, unknown>
}

const TASK_COLS = `
  t.task_id::text AS "taskId", t.site_id AS "siteId", t.task_no AS "taskNo", t.task_type AS type, t.priority,
  t.status, t.resume_status AS "resumeStatus", t.version, t.kara_id AS "karaId", t.driver_login AS "driverLogin",
  t.driver_user_id AS "driverUserId", t.source_code AS "sourceCode", t.source_node_id AS "sourceNodeId",
  t.dest_code AS "destCode", t.dest_node_id AS "destNodeId", t.hu_code AS "huCode", t.item_code AS "itemCode",
  t.item_name AS "itemName", t.lot_code AS "lotCode", t.qty::float AS qty, t.expiry_at::text AS "expiryAt",
  t.wms_ref_kind AS "wmsRefKind", t.wms_ref_id AS "wmsRefId", t.load_scan_id::text AS "loadScanId",
  t.address_scan_id::text AS "addressScanId", t.wms_movement_request_id::text AS "wmsMovementRequestId",
  t.wms_movement_status AS "wmsMovementStatus", t.wms_movement_result AS "wmsMovementResult",
  t.blocked_reason AS "blockedReason", t.cancel_reason AS "cancelReason", t.note, t.created_by AS "createdBy",
  t.created_at::text AS "createdAt", t.updated_at::text AS "updatedAt", t.offered_at::text AS "offeredAt",
  t.accepted_at::text AS "acceptedAt", t.loaded_at::text AS "loadedAt", t.completed_at::text AS "completedAt",
  COALESCE(t.payload, '{}'::jsonb) AS payload`

export async function loadTask(client: PoolClient, siteId: number, taskId: string, lock = false): Promise<TaskRow> {
  if (!/^\d+$/.test(taskId)) throw new WmsHttpError(400, "некорректный ID задания", "bad_task_id")
  const r = await client.query<TaskRow>(
    `SELECT ${TASK_COLS} FROM route_tasks t WHERE t.site_id = $1 AND t.task_id = $2::bigint ${lock ? "FOR UPDATE" : ""}`,
    [siteId, taskId]
  )
  if (!r.rows[0]) throw new WmsHttpError(404, "задание не найдено", "task_not_found")
  return r.rows[0]
}

export function taskRef(t: Pick<TaskRow, "taskNo">): string {
  return `ROUTE:${t.taskNo}`
}

/* ------------------------------------------------------------------ */
/* Журнал и переходы                                                   */
/* ------------------------------------------------------------------ */

async function replay(client: PoolClient, siteId: number, clientRequestId: string | null) {
  if (!clientRequestId) return null
  const r = await client.query<{ task_id: string; action: string; payload: Record<string, unknown> }>(
    `SELECT task_id::text, action, payload FROM route_task_events WHERE site_id = $1 AND client_request_id = $2`,
    [siteId, clientRequestId]
  )
  return r.rows[0] ?? null
}

async function recordEvent(
  client: PoolClient,
  task: TaskRow,
  e: {
    action: string
    from: RouteTaskStatus | null
    to: RouteTaskStatus | null
    version: number
    actor: string
    actorUserId?: string | null
    reason?: string | null
    clientRequestId?: string | null
    payload?: Record<string, unknown>
    wmsState?: unknown
  }
) {
  await client.query(
    `INSERT INTO route_task_events (site_id, task_id, action, from_status, to_status, version, actor_login, actor_user_id,
       kara_id, reason, client_request_id, payload, wms_state)
     VALUES ($1, $2::bigint, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)`,
    [
      task.siteId,
      task.taskId,
      e.action,
      e.from,
      e.to,
      e.version,
      e.actor,
      e.actorUserId ?? null,
      task.karaId,
      e.reason ?? null,
      e.clientRequestId ?? null,
      JSON.stringify(e.payload ?? {}),
      e.wmsState === undefined ? null : JSON.stringify(e.wmsState),
    ]
  )
}

type Patch = Partial<{
  kara_id: string | null
  driver_login: string | null
  driver_user_id: string | null
  dest_code: string
  dest_node_id: string | null
  source_node_id: string | null
  load_scan_id: string | null
  address_scan_id: string | null
  blocked_reason: string | null
  cancel_reason: string | null
  priority: number
  offered_at: string
  accepted_at: string
  loaded_at: string
  completed_at: string
  item_code: string | null
  item_name: string | null
  lot_code: string | null
  qty: number | null
  expiry_at: string | null
  wms_movement_request_id: string | null
  wms_movement_status: string | null
  wms_movement_result: string | null
  payload: string
}>

const NOW = "__now__"

async function writeTask(client: PoolClient, task: TaskRow, sets: Record<string, unknown>, expectVersion: number) {
  const keys = Object.keys(sets)
  const vals: unknown[] = [task.siteId, task.taskId, expectVersion]
  const parts = keys.map((k) => {
    const v = sets[k]
    if (v === NOW) return `${k} = now()`
    vals.push(v)
    if (k === "payload" || k === "wms_movement_result") return `${k} = $${vals.length}::jsonb`
    return `${k} = $${vals.length}`
  })
  const r = await client.query(
    `UPDATE route_tasks SET ${[...parts, "version = version + 1", "updated_at = now()"].join(", ")}
     WHERE site_id = $1 AND task_id = $2::bigint AND version = $3`,
    vals
  )
  if (r.rowCount !== 1) {
    throw new WmsHttpError(409, "Задание изменилось на сервере — экран обновлён", "version_conflict")
  }
}

/** Применить действие машины состояний. Версия проверяется: устаревшая команда отклоняется. */
export async function transition(
  client: PoolClient,
  task: TaskRow,
  action: RouteAction,
  ctx: {
    actor: string
    actorUserId?: string | null
    expectedVersion?: number | null
    reason?: string | null
    clientRequestId?: string | null
    patch?: Patch
    payload?: Record<string, unknown>
    wmsState?: unknown
  }
): Promise<TaskRow> {
  if (ctx.expectedVersion != null && ctx.expectedVersion !== task.version) {
    throw new WmsHttpError(409, "Задание изменилось на сервере — экран обновлён", "version_conflict", {
      version: task.version,
      status: task.status,
    })
  }
  const res = resolveRouteTransition(task.status, action, task.resumeStatus)
  if (!res.ok) throw new WmsHttpError(409, res.reason, res.code, { status: task.status })
  const sets: Record<string, unknown> = { status: res.to, resume_status: res.resumeStatus, ...(ctx.patch ?? {}) }
  for (const k of ["offered_at", "accepted_at", "loaded_at", "completed_at"]) {
    if (sets[k] === true) sets[k] = NOW
  }
  await writeTask(client, task, sets, task.version)
  const next = await loadTask(client, task.siteId, task.taskId, true)
  await recordEvent(client, next, {
    action,
    from: task.status,
    to: res.to,
    version: next.version,
    actor: ctx.actor,
    actorUserId: ctx.actorUserId,
    reason: ctx.reason,
    clientRequestId: ctx.clientRequestId,
    payload: ctx.payload,
    wmsState: ctx.wmsState,
  })
  const topic = res.to === "CANCELLED" ? "task.cancelled" : action === "offer" ? "task.assigned" : "task.updated"
  await publish(client, task.siteId, topic, {
    karaId: next.karaId ?? task.karaId,
    taskId: next.taskId,
    payload: { status: next.status, version: next.version, action, prevKaraId: task.karaId },
  })
  return next
}

/* ------------------------------------------------------------------ */
/* Маршрут                                                             */
/* ------------------------------------------------------------------ */

export type TaskRoute = {
  phase: "to_pickup" | "to_dropoff" | "none"
  result: RouteResult | null
  plannedPickupToDrop: RouteResult | null
  from: "position" | "pickup" | "none"
  mapVersion: number | null
}

export function resolveNodes(map: MapGeometry, sourceCode: string, destCode: string) {
  return { sourceNodeId: nodeForAddress(map, sourceCode), destNodeId: nodeForAddress(map, destCode) }
}

function usablePosition(p: ForkliftPosition | null): Pt | null {
  if (!p) return null
  if (p.state === "ok" || p.state === "degraded" || p.state === "manual") return { x: p.x, y: p.y }
  return null
}

export async function computeTaskRoute(
  client: PoolClient,
  task: TaskRow,
  opts: { position?: ForkliftPosition | null } = {}
): Promise<TaskRoute> {
  const map = await getPublishedMap(client, task.siteId)
  if (!map) return { phase: "none", result: null, plannedPickupToDrop: null, from: "none", mapVersion: null }
  const g = map.geometry
  const blocked = await blockedEdgeSet(client, task.siteId)
  const kara = task.karaId ? await getForklift(client, task.siteId, task.karaId) : null
  const base = { forkliftType: kara?.forkliftType ?? null, widthM: kara?.widthM ?? null, heightM: kara?.heightM ?? null, blockedEdgeIds: blocked }
  const srcNode = task.sourceNodeId || nodeForAddress(g, task.sourceCode)
  const dstNode = task.destNodeId || nodeForAddress(g, task.destCode)
  const loaded = isLoaded(task.status, task.resumeStatus)
  const planned =
    srcNode && dstNode ? findRoute(g, { nodeId: srcNode }, dstNode, { ...base, loaded: true }) : null
  if (TERMINAL.has(task.status)) return { phase: "none", result: null, plannedPickupToDrop: planned, from: "none", mapVersion: map.version }
  const pos = opts.position !== undefined ? opts.position : task.karaId ? await getPosition(client, task.siteId, task.karaId) : null
  const at = usablePosition(pos)
  const target = loaded ? dstNode : srcNode
  const phase = loaded ? "to_dropoff" : "to_pickup"
  if (!target) {
    return {
      phase,
      result: { ok: false, code: "unknown_node", reason: `адрес ${loaded ? task.destCode : task.sourceCode} не привязан к карте` },
      plannedPickupToDrop: planned,
      from: "none",
      mapVersion: map.version,
    }
  }
  if (at) {
    const r = findRoute(g, { point: at, snapMaxM: 6 }, target, { ...base, loaded })
    if (r.ok || r.code === "no_path" || r.code === "same_place") {
      return { phase, result: r, plannedPickupToDrop: planned, from: "position", mapVersion: map.version }
    }
  }
  if (loaded && srcNode) {
    return { phase, result: planned, plannedPickupToDrop: planned, from: "pickup", mapVersion: map.version }
  }
  return { phase, result: null, plannedPickupToDrop: planned, from: "none", mapVersion: map.version }
}

/* ------------------------------------------------------------------ */
/* Представление для экрана                                            */
/* ------------------------------------------------------------------ */

const INSTRUCTION: Partial<Record<RouteTaskStatus, (t: TaskRow) => string>> = {
  OFFERED: (t) => `Новое задание: ${TYPE_LABEL[t.type].toLowerCase()}`,
  ACCEPTED: (t) => `К месту получения — ${t.sourceCode}`,
  EN_ROUTE_PICKUP: (t) => `К месту получения — ${t.sourceCode}`,
  AT_PICKUP: () => "Отсканируйте палету",
  LOAD_CONFIRMED: (t) => `Доставьте палету в ${t.destCode}`,
  EN_ROUTE_DROPOFF: (t) => `Доставьте палету в ${t.destCode}`,
  AT_DROPOFF: (t) => `Подтвердите адрес ${t.destCode}`,
  PAUSED: () => "Задание приостановлено",
  BLOCKED: (t) => `Остановлено: ${t.blockedReason || "требуется диспетчер"}`,
  COMPLETED: () => "Задание выполнено",
  CANCELLED: (t) => `Задание отменено${t.cancelReason ? `: ${t.cancelReason}` : ""}`,
}

export async function scanOf(client: PoolClient, siteId: number, scanId: string | null) {
  if (!scanId) return null
  const r = await client.query(
    `SELECT scan_id::text AS "scanId", code, code_type AS "codeType", method, result, reject_code AS "rejectCode",
            message, expected_code AS "expected", details, task_version AS "taskVersion", created_at::text AS at
     FROM route_scan_events WHERE site_id = $1 AND scan_id = $2::bigint`,
    [siteId, scanId]
  )
  return r.rows[0] ?? null
}

export async function lastScans(client: PoolClient, siteId: number, taskId: string, limit = 5) {
  const r = await client.query(
    `SELECT scan_id::text AS "scanId", code, code_type AS "codeType", method, result, reject_code AS "rejectCode",
            message, expected_code AS "expected", details, created_at::text AS at
     FROM route_scan_events WHERE site_id = $1 AND task_id = $2::bigint ORDER BY scan_id DESC LIMIT $3`,
    [siteId, taskId, limit]
  )
  return r.rows
}

export async function taskView(client: PoolClient, task: TaskRow, opts: { withRoute?: boolean; position?: ForkliftPosition | null } = {}) {
  const route = opts.withRoute === false ? null : await computeTaskRoute(client, task, { position: opts.position })
  const loadScan = await scanOf(client, task.siteId, task.loadScanId)
  const addressScan = await scanOf(client, task.siteId, task.addressScanId)
  const scans = await lastScans(client, task.siteId, task.taskId, 3)
  return {
    ...task,
    typeLabel: TYPE_LABEL[task.type],
    statusLabel: STATUS_LABEL[task.status],
    instruction: (INSTRUCTION[task.status] ?? (() => STATUS_LABEL[task.status]))(task),
    loaded: isLoaded(task.status, task.resumeStatus),
    actions: allowedRouteActions(task.status, task.resumeStatus),
    loadScan,
    addressScan,
    lastScan: scans[0] ?? null,
    route,
  }
}

/* ------------------------------------------------------------------ */
/* Создание                                                            */
/* ------------------------------------------------------------------ */

export type CreateTaskInput = {
  type: string
  sourceCode: string
  destCode: string
  huCode: string
  priority?: number | null
  wmsRefKind?: string | null
  wmsRefId?: string | null
  note?: string | null
  forkliftTypes?: string[] | null
  sourceIsStorage?: boolean | null
}

async function nextTaskNo(client: PoolClient, siteId: number): Promise<string> {
  const r = await client.query<{ n: string }>(
    `SELECT COALESCE(max(substring(task_no from 'RT-(\\d+)')::bigint), 0) + 1 AS n FROM route_tasks WHERE site_id = $1`,
    [siteId]
  )
  return `RT-${String(r.rows[0].n).padStart(6, "0")}`
}

function isStorageCode(code: string): boolean {
  return /^FG-/i.test(normalizeLocation(code))
}

/**
 * Создать задание по реальной палете. Палета проверяется в WMS: нет палеты — нет задания.
 * Номенклатура, партия, количество, срок годности берутся из WMS, не из запроса.
 */
export async function createTask(
  client: PoolClient,
  siteId: number,
  siteCode: string,
  input: CreateTaskInput,
  actor: string
): Promise<{ task: TaskRow; created: boolean }> {
  if (!isRouteTaskType(input.type)) throw new WmsHttpError(400, `неизвестный тип задания: ${input.type}`, "bad_type")
  const huRaw = (input.huCode || "").trim()
  const src = normalizeLocation(input.sourceCode)
  const dst = normalizeLocation(input.destCode)
  if (!huRaw || !src || !dst) throw new WmsHttpError(400, "нужны huCode, sourceCode, destCode", "fields_required")
  if (src === dst) throw new WmsHttpError(400, "место получения и назначения совпадают", "same_place")

  if (input.wmsRefId) {
    const dup = await client.query<{ task_id: string }>(
      `SELECT task_id::text FROM route_tasks WHERE site_id = $1 AND wms_ref_kind = $2 AND wms_ref_id = $3 AND status <> 'CANCELLED'`,
      [siteId, input.wmsRefKind || "wms", input.wmsRefId]
    )
    if (dup.rows[0]) return { task: await loadTask(client, siteId, dup.rows[0].task_id), created: false }
  }

  const hu = palletKey(huRaw)
  const check = await wmsGateway().checkPallet({ siteCode, code: hu })
  if (!check.found || !check.pallet) {
    throw new WmsHttpError(422, `Палета ${huRaw} не найдена в WMS — задание не создано`, "pallet_not_found")
  }
  const hard = check.problems.find((p) => ["pallet_other_site", "pallet_quarantine", "pallet_shipped", "pallet_unlinked"].includes(p.code))
  if (hard) throw new WmsHttpError(422, hard.message, hard.code)
  const p = check.pallet

  const map = await getPublishedMap(client, siteId)
  const nodes = map ? resolveNodes(map.geometry, src, dst) : { sourceNodeId: null, destNodeId: null }
  const taskNo = await nextTaskNo(client, siteId)
  const priority = Math.max(0, Math.min(100, Math.trunc(input.priority ?? 50)))
  const payload = {
    forkliftTypes: input.forkliftTypes ?? null,
    sourceIsStorage: input.sourceIsStorage ?? isStorageCode(src),
    declinedBy: [] as string[],
  }
  let ins
  try {
    ins = await client.query<{ task_id: string }>(
      `INSERT INTO route_tasks (site_id, task_no, task_type, priority, status, source_code, source_node_id, dest_code, dest_node_id,
         hu_code, item_code, item_name, lot_code, qty, expiry_at, wms_ref_kind, wms_ref_id, note, created_by, payload)
       VALUES ($1,$2,$3,$4,'CREATED',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)
       RETURNING task_id::text`,
      [
        siteId,
        taskNo,
        input.type,
        priority,
        src,
        nodes.sourceNodeId,
        dst,
        nodes.destNodeId,
        p.sscc || p.code || hu,
        p.itemCode,
        p.itemName,
        p.lotCode,
        p.qty,
        p.expiryAt,
        input.wmsRefId ? input.wmsRefKind || "wms" : null,
        input.wmsRefId || null,
        input.note || null,
        actor,
        JSON.stringify(payload),
      ]
    )
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new WmsHttpError(409, `По палете ${huRaw} уже есть открытое задание`, "pallet_has_open_task")
    }
    throw error
  }
  let task = await loadTask(client, siteId, ins.rows[0].task_id, true)
  await recordEvent(client, task, {
    action: "create",
    from: null,
    to: "CREATED",
    version: task.version,
    actor,
    payload: { wmsRef: input.wmsRefId ?? null, source: src, dest: dst },
    wmsState: check,
  })
  task = await transition(client, task, "queue", { actor: "system" })
  return { task, created: true }
}

/* ------------------------------------------------------------------ */
/* Сессия водителя                                                     */
/* ------------------------------------------------------------------ */

export type DriverSession = {
  sessionId: string
  login: string
  fio: string
  karaId: string
  karaName: string | null
  shiftCode: string | null
  startedAt: string
}

export async function currentSession(client: PoolClient, siteId: number, login: string): Promise<DriverSession | null> {
  const r = await client.query<DriverSession>(
    `SELECT session_id::text AS "sessionId", login, fio, kara_id AS "karaId", kara_name AS "karaName",
            shift_code AS "shiftCode", started_at::text AS "startedAt"
     FROM route_driver_sessions WHERE site_id = $1 AND lower(login) = lower($2) AND ended_at IS NULL`,
    [siteId, login]
  )
  return r.rows[0] ?? null
}

export async function requireSession(client: PoolClient, siteId: number, actor: RouteActor): Promise<{ user: RouteUserActor; session: DriverSession }> {
  if (actor.kind !== "user") throw new WmsHttpError(403, "нужен пользователь", "user_required")
  const s = await currentSession(client, siteId, actor.login)
  if (!s) throw new WmsHttpError(409, "Выберите погрузчик, чтобы начать смену", "no_session")
  await client.query(`UPDATE route_driver_sessions SET last_seen_at = now() WHERE session_id = $1::bigint`, [s.sessionId])
  return { user: actor, session: s }
}

/** Закрытие сессии и перепроверка назначений: всё, что не на вилах, — обратно в очередь. */
async function closeSession(client: PoolClient, siteId: number, s: DriverSession, reason: string, actor: string) {
  await client.query(`UPDATE route_driver_sessions SET ended_at = now(), end_reason = $2 WHERE session_id = $1::bigint`, [
    s.sessionId,
    reason,
  ])
  const r = await client.query<{ task_id: string }>(
    `SELECT task_id::text FROM route_tasks WHERE site_id = $1 AND kara_id = $2
       AND status IN ('OFFERED','ACCEPTED','EN_ROUTE_PICKUP','AT_PICKUP','LOAD_CONFIRMED','EN_ROUTE_DROPOFF','AT_DROPOFF','PAUSED')
     FOR UPDATE`,
    [siteId, s.karaId]
  )
  for (const row of r.rows) {
    const t = await loadTask(client, siteId, row.task_id, true)
    if (t.status === "OFFERED") {
      await transition(client, t, "decline", { actor, reason: `сессия закрыта: ${reason}`, patch: { kara_id: null } })
    } else if (isLoaded(t.status, t.resumeStatus)) {
      await transition(client, t, "block", {
        actor,
        reason: `водитель покинул погрузчик с палетой на вилах (${reason})`,
        patch: { blocked_reason: "палета на вилах, водитель сменился — решение диспетчера" },
      })
      await openException(client, siteId, t, "driver_changed_with_load", `Сессия ${s.login} на ${s.karaId} закрыта: ${reason}`, actor, null)
    } else {
      await transition(client, t, "requeue", {
        actor,
        reason: `сессия закрыта: ${reason}`,
        patch: { kara_id: null, driver_login: null, driver_user_id: null, load_scan_id: null },
      })
    }
  }
  await publish(client, siteId, "session.ended", { karaId: s.karaId, payload: { login: s.login, reason } })
}

export async function startSession(
  client: PoolClient,
  siteId: number,
  actor: RouteUserActor,
  input: { karaId: string; shiftCode?: string | null; deviceId?: string | null; force?: boolean }
): Promise<DriverSession> {
  const kara = await getForklift(client, siteId, input.karaId)
  if (!kara) throw new WmsHttpError(404, "Погрузчик не найден во флоте WMS", "kara_not_found")
  if (!kara.enabled || kara.profileStatus !== "active") throw new WmsHttpError(409, "Погрузчик выключен или на обслуживании", "kara_disabled")
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`route-session:${siteId}`])
  const mine = await currentSession(client, siteId, actor.login)
  if (mine && mine.karaId === input.karaId) return mine
  if (mine) await closeSession(client, siteId, mine, `водитель сменил погрузчик на ${kara.name}`, actor.login)
  const other = await client.query<DriverSession>(
    `SELECT session_id::text AS "sessionId", login, fio, kara_id AS "karaId", kara_name AS "karaName", shift_code AS "shiftCode", started_at::text AS "startedAt"
     FROM route_driver_sessions WHERE site_id = $1 AND kara_id = $2 AND ended_at IS NULL`,
    [siteId, input.karaId]
  )
  if (other.rows[0]) {
    if (!input.force || !actorCan(actor, "route.dispatch")) {
      throw new WmsHttpError(409, `${kara.name} уже работает с водителем ${other.rows[0].fio}`, "kara_busy")
    }
    await closeSession(client, siteId, other.rows[0], `погрузчик передан ${actor.fio}`, actor.login)
  }
  const r = await client.query<{ session_id: string }>(
    `INSERT INTO route_driver_sessions (site_id, user_id, login, fio, kara_id, kara_name, shift_code, device_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING session_id::text`,
    [siteId, actor.userId, actor.login, actor.fio, kara.id, kara.name, input.shiftCode || kara.shiftCode || null, input.deviceId || null]
  )
  await publish(client, siteId, "session.started", { karaId: kara.id, payload: { login: actor.login, fio: actor.fio } })
  void r
  return (await currentSession(client, siteId, actor.login))!
}

export async function endSession(client: PoolClient, siteId: number, actor: RouteUserActor, reason: string) {
  const s = await currentSession(client, siteId, actor.login)
  if (!s) return { ended: false }
  await closeSession(client, siteId, s, reason || "конец смены", actor.login)
  return { ended: true }
}

/* ------------------------------------------------------------------ */
/* Назначение                                                          */
/* ------------------------------------------------------------------ */

export async function activeTaskForKara(client: PoolClient, siteId: number, karaId: string): Promise<TaskRow | null> {
  const r = await client.query<TaskRow>(
    `SELECT ${TASK_COLS} FROM route_tasks t
     WHERE t.site_id = $1 AND t.kara_id = $2
       AND t.status IN ('OFFERED','ACCEPTED','EN_ROUTE_PICKUP','AT_PICKUP','LOAD_CONFIRMED','EN_ROUTE_DROPOFF','AT_DROPOFF','PAUSED','BLOCKED')
     ORDER BY CASE WHEN t.status IN ('ACCEPTED','EN_ROUTE_PICKUP','AT_PICKUP','LOAD_CONFIRMED','EN_ROUTE_DROPOFF','AT_DROPOFF') THEN 0
                   WHEN t.status IN ('PAUSED','BLOCKED') THEN 1 ELSE 2 END, t.task_id
     LIMIT 1`,
    [siteId, karaId]
  )
  return r.rows[0] ?? null
}

async function queuedCandidates(client: PoolClient, siteId: number, lock: boolean): Promise<TaskRow[]> {
  const r = await client.query<TaskRow>(
    `SELECT ${TASK_COLS} FROM route_tasks t WHERE t.site_id = $1 AND t.status = 'QUEUED'
     ORDER BY t.priority DESC, t.created_at LIMIT 300 ${lock ? "FOR UPDATE SKIP LOCKED" : ""}`,
    [siteId]
  )
  return r.rows
}

function toCandidate(t: TaskRow): Candidate {
  const pl = t.payload || {}
  return {
    taskId: t.taskId,
    type: t.type,
    priority: t.priority,
    createdAt: t.createdAt,
    itemCode: t.itemCode,
    expiryAt: t.expiryAt,
    forkliftTypes: Array.isArray(pl.forkliftTypes) ? (pl.forkliftTypes as string[]) : null,
    declinedBy: Array.isArray(pl.declinedBy) ? (pl.declinedBy as string[]) : [],
  }
}

/** Рассчитать лучший кандидат для погрузчика (без изменения состояния). */
export async function bestCandidate(client: PoolClient, siteId: number, karaId: string, opts: { lock: boolean; excludeTaskId?: string } = { lock: false }) {
  const map = await getPublishedMap(client, siteId)
  if (!map) return null
  const kara = await getForklift(client, siteId, karaId)
  if (!kara) return null
  const blocked = await blockedEdgeSet(client, siteId)
  const pos = await getPosition(client, siteId, karaId)
  const at = usablePosition(pos)
  const rows = (await queuedCandidates(client, siteId, opts.lock)).filter((t) => t.taskId !== opts.excludeTaskId)
  const byId = new Map(rows.map((t) => [t.taskId, t]))
  const constraints = { forkliftType: kara.forkliftType, widthM: kara.widthM, heightM: kara.heightM, blockedEdgeIds: blocked }
  const ranked = rankCandidates(rows.map(toCandidate), { karaId, forkliftType: kara.forkliftType }, (c) => {
    const t = byId.get(c.taskId)!
    const src = t.sourceNodeId || nodeForAddress(map.geometry, t.sourceCode)
    const dst = t.destNodeId || nodeForAddress(map.geometry, t.destCode)
    if (!src || !dst) return null
    const carry = findRoute(map.geometry, { nodeId: src }, dst, { ...constraints, loaded: true })
    if (!carry.ok) return null
    if (!at) return 0
    const empty = findRoute(map.geometry, { point: at, snapMaxM: 6 }, src, { ...constraints, loaded: false })
    if (empty.ok) return empty.lengthM
    if (empty.code === "same_place") return 0
    return empty.code === "off_graph" ? 0 : null
  })
  const best = ranked[0]
  return best ? { task: byId.get(best.taskId)!, score: best } : null
}

/** Предложить погрузчику следующее подходящее задание (YMS). Возвращает предложенное или null. */
export async function offerNext(client: PoolClient, siteId: number, karaId: string, actor = "system"): Promise<TaskRow | null> {
  const busy = await activeTaskForKara(client, siteId, karaId)
  if (busy) return null
  const kara = await getForklift(client, siteId, karaId)
  if (!kara || !kara.autoAssign) return null
  const sess = await client.query(`SELECT 1 FROM route_driver_sessions WHERE site_id = $1 AND kara_id = $2 AND ended_at IS NULL`, [siteId, karaId])
  if (!sess.rowCount) return null
  const best = await bestCandidate(client, siteId, karaId, { lock: true })
  if (!best) return null
  const t = await loadTask(client, siteId, best.task.taskId, true)
  if (t.status !== "QUEUED") return null
  return transition(client, t, "offer", {
    actor,
    reason: best.score.reason,
    patch: { kara_id: karaId, offered_at: true as unknown as string },
    payload: { auto: true, emptyRunM: best.score.emptyRunM, band: best.score.band },
  })
}

/** Диспетчер: назначить/переназначить задание на погрузчик. После погрузки — нельзя. */
export async function assignTask(
  client: PoolClient,
  siteId: number,
  taskId: string,
  karaId: string,
  actor: string,
  reason: string,
  expectedVersion: number | null
): Promise<TaskRow> {
  let t = await loadTask(client, siteId, taskId, true)
  if (expectedVersion != null && expectedVersion !== t.version) {
    throw new WmsHttpError(409, "Задание изменилось — обновите список", "version_conflict")
  }
  if (isLoaded(t.status, t.resumeStatus)) {
    throw new WmsHttpError(409, "Палета уже на вилах — переназначение запрещено", "task_loaded")
  }
  const kara = await getForklift(client, siteId, karaId)
  if (!kara) throw new WmsHttpError(404, "погрузчик не найден во флоте WMS", "kara_not_found")
  const other = await activeTaskForKara(client, siteId, karaId)
  if (other && other.taskId !== t.taskId && (DRIVER_ACTIVE.has(other.status) || other.status === "OFFERED")) {
    throw new WmsHttpError(409, `${kara.name} занят заданием ${other.taskNo}`, "kara_busy")
  }
  if (t.karaId === karaId && (t.status === "OFFERED" || DRIVER_ACTIVE.has(t.status))) return t
  if (t.status !== "QUEUED") {
    t = await transition(client, t, "requeue", {
      actor,
      reason: reason || "переназначение диспетчером",
      patch: { kara_id: null, driver_login: null, driver_user_id: null, load_scan_id: null, address_scan_id: null },
    })
  }
  return transition(client, t, "offer", {
    actor,
    reason: reason || "назначено диспетчером",
    patch: { kara_id: karaId, offered_at: true as unknown as string },
    payload: { auto: false },
  })
}

/* ------------------------------------------------------------------ */
/* Команды водителя                                                    */
/* ------------------------------------------------------------------ */

function assertOwnTask(t: TaskRow, session: DriverSession, actor: RouteUserActor) {
  if (t.status === "CANCELLED") throw new WmsHttpError(409, "Задание отменено", "task_cancelled")
  if (t.status === "COMPLETED") throw new WmsHttpError(409, "Задание уже завершено", "task_completed")
  if (t.karaId !== session.karaId) throw new WmsHttpError(409, "Задание переназначено на другой погрузчик", "task_reassigned")
  if (t.driverLogin && t.driverLogin.toLowerCase() !== actor.login.toLowerCase()) {
    throw new WmsHttpError(409, "Задание выполняет другой водитель", "task_other_driver")
  }
}

type Cmd = {
  siteId: number
  siteCode: string
  actor: RouteActor
  taskId: string
  expectedVersion: number | null
  clientRequestId: string | null
}

async function withReplay<T>(client: PoolClient, cmd: Cmd, run: () => Promise<T>): Promise<T | { replayed: true; task: TaskRow }> {
  const prev = await replay(client, cmd.siteId, cmd.clientRequestId)
  if (prev) return { replayed: true, task: await loadTask(client, cmd.siteId, prev.task_id) }
  return run()
}

export async function acceptTask(client: PoolClient, cmd: Cmd) {
  return withReplay(client, cmd, async () => {
    const { user, session } = await requireSession(client, cmd.siteId, cmd.actor)
    let t = await loadTask(client, cmd.siteId, cmd.taskId, true)
    assertOwnTask(t, session, user)
    try {
      t = await transition(client, t, "accept", {
        actor: user.login,
        actorUserId: user.userId,
        expectedVersion: cmd.expectedVersion,
        clientRequestId: cmd.clientRequestId,
        patch: { driver_login: user.login, driver_user_id: user.userId, accepted_at: true as unknown as string },
      })
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new WmsHttpError(409, "У погрузчика уже есть активное задание", "kara_has_active_task")
      }
      throw error
    }
    t = await transition(client, t, "start_pickup", { actor: "system" })
    return { task: t }
  })
}

export async function declineTask(client: PoolClient, cmd: Cmd, reason: string) {
  return withReplay(client, cmd, async () => {
    const { user, session } = await requireSession(client, cmd.siteId, cmd.actor)
    let t = await loadTask(client, cmd.siteId, cmd.taskId, true)
    assertOwnTask(t, session, user)
    const declined = Array.isArray(t.payload.declinedBy) ? (t.payload.declinedBy as string[]) : []
    t = await transition(client, t, "decline", {
      actor: user.login,
      expectedVersion: cmd.expectedVersion,
      clientRequestId: cmd.clientRequestId,
      reason: reason || "отказ водителя",
      patch: { kara_id: null, payload: JSON.stringify({ ...t.payload, declinedBy: [...new Set([...declined, session.karaId])] }) },
    })
    return { task: t }
  })
}

export async function arriveTask(client: PoolClient, cmd: Cmd, auto = false) {
  return withReplay(client, cmd, async () => {
    const { user, session } = await requireSession(client, cmd.siteId, cmd.actor)
    let t = await loadTask(client, cmd.siteId, cmd.taskId, true)
    assertOwnTask(t, session, user)
    const action: RouteAction = t.status === "EN_ROUTE_PICKUP" ? "arrive_pickup" : "arrive_dropoff"
    t = await transition(client, t, action, {
      actor: user.login,
      expectedVersion: cmd.expectedVersion,
      clientRequestId: cmd.clientRequestId,
      reason: auto ? "по позиции" : "водитель подтвердил прибытие",
    })
    return { task: t }
  })
}

async function insertScan(
  client: PoolClient,
  t: TaskRow,
  s: {
    code: string
    codeType: "sscc" | "hu" | "address"
    method: string
    manualReason: string | null
    decision: ScanDecision
    actor: string
    deviceId: string | null
    clientRequestId: string | null
  }
): Promise<string> {
  const d = s.decision
  const r = await client.query<{ scan_id: string }>(
    `INSERT INTO route_scan_events (site_id, task_id, task_version, code, code_type, method, manual_reason, result, reject_code,
       message, expected_code, details, actor_login, device_id, client_request_id)
     VALUES ($1,$2::bigint,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15) RETURNING scan_id::text`,
    [
      t.siteId,
      t.taskId,
      t.version,
      s.code.slice(0, 200),
      s.codeType,
      s.method,
      s.manualReason,
      d.ok ? "accepted" : "rejected",
      d.ok ? null : d.code,
      d.message,
      d.ok ? null : (d.expected ?? null),
      JSON.stringify(d.ok ? d.details : { actual: d.actual ?? null, ...(d.details ?? {}) }),
      s.actor,
      s.deviceId,
      s.clientRequestId,
    ]
  )
  return r.rows[0].scan_id
}

function scanMethod(actor: RouteActor, method: string, manualReason: string): { method: string; manualReason: string | null } {
  const m = ["scanner", "camera", "tablet", "manual"].includes(method) ? method : "scanner"
  if (m === "manual") {
    if (!actorCan(actor, "route.scan.manual")) {
      throw new WmsHttpError(403, "Ручной ввод кода не разрешён вашей роли", "manual_scan_denied")
    }
    if (manualReason.trim().length < 3) throw new WmsHttpError(400, "Укажите причину ручного ввода", "manual_reason_required")
    return { method: m, manualReason: manualReason.trim().slice(0, 240) }
  }
  return { method: m, manualReason: null }
}

function forScan(t: TaskRow): TaskForScan {
  return {
    huCode: t.huCode,
    sourceCode: t.sourceCode,
    sourceIsStorage: t.payload?.sourceIsStorage === true || isStorageCode(t.sourceCode),
    destCode: t.destCode,
    taskRef: taskRef(t),
  }
}

async function scanReplay(client: PoolClient, siteId: number, crid: string | null) {
  if (!crid) return null
  const r = await client.query<{ scan_id: string; task_id: string }>(
    `SELECT scan_id::text, task_id::text FROM route_scan_events WHERE site_id = $1 AND client_request_id = $2`,
    [siteId, crid]
  )
  return r.rows[0] ?? null
}

export async function scanPallet(client: PoolClient, cmd: Cmd, input: { code: string; method: string; manualReason: string; deviceId: string | null }) {
  const prev = await scanReplay(client, cmd.siteId, cmd.clientRequestId)
  if (prev) {
    return { replayed: true, scan: await scanOf(client, cmd.siteId, prev.scan_id), task: await loadTask(client, cmd.siteId, prev.task_id) }
  }
  const { user, session } = await requireSession(client, cmd.siteId, cmd.actor)
  const m = scanMethod(cmd.actor, input.method, input.manualReason)
  let t = await loadTask(client, cmd.siteId, cmd.taskId, true)
  assertOwnTask(t, session, user)
  if (t.status === "EN_ROUTE_PICKUP") {
    t = await transition(client, t, "arrive_pickup", { actor: user.login, reason: "прибытие подтверждено сканом палеты" })
  }
  if (t.status !== "AT_PICKUP") {
    throw new WmsHttpError(409, `Скан палеты недоступен в статусе «${STATUS_LABEL[t.status]}»`, "invalid_state")
  }
  const cls = classifyScan(input.code)
  if (cls.kind === "address") {
    throw new WmsHttpError(422, "Отсканирован адрес, а нужна палета", "scan_kind_mismatch")
  }
  let wms: PalletCheck
  try {
    wms = await wmsGateway().checkPallet({ siteCode: cmd.siteCode, code: cls.value, taskRef: taskRef(t) })
  } catch (error) {
    throw new WmsHttpError(503, `Проверка палеты невозможна: ${(error as Error).message}`, "wms_unavailable")
  }
  let decision = decidePalletScan(forScan(t), cls.value, wms)
  if (decision.ok && cls.kind === "sscc" && !cls.checkOk) {
    decision = { ok: false, code: "bad_check_digit", message: "Неверная контрольная цифра SSCC — пересканируйте" }
  }
  const scanId = await insertScan(client, t, {
    code: cls.value,
    codeType: cls.kind === "sscc" ? "sscc" : "hu",
    method: m.method,
    manualReason: m.manualReason,
    decision,
    actor: user.login,
    deviceId: input.deviceId,
    clientRequestId: cmd.clientRequestId,
  })
  if (decision.ok) {
    const p = wms.pallet!
    await writeTask(
      client,
      t,
      {
        load_scan_id: scanId,
        item_code: p.itemCode ?? t.itemCode,
        item_name: p.itemName ?? t.itemName,
        lot_code: p.lotCode ?? t.lotCode,
        qty: p.qty ?? t.qty,
      },
      t.version
    )
    t = await loadTask(client, cmd.siteId, cmd.taskId, true)
    await recordEvent(client, t, { action: "scan_pallet", from: t.status, to: t.status, version: t.version, actor: user.login, payload: { scanId }, wmsState: wms })
  } else {
    await recordEvent(client, t, {
      action: "scan_pallet_rejected",
      from: t.status,
      to: t.status,
      version: t.version,
      actor: user.login,
      reason: decision.code,
      payload: { scanId, expected: decision.expected ?? null, actual: decision.actual ?? null },
      wmsState: wms,
    })
  }
  await publish(client, cmd.siteId, decision.ok ? "pallet.scan.accepted" : "pallet.scan.rejected", {
    karaId: t.karaId,
    taskId: t.taskId,
    payload: { scanId, code: cls.value, result: decision.ok ? "accepted" : decision.code },
  })
  return { scan: await scanOf(client, cmd.siteId, scanId), decision, task: t }
}

export async function confirmLoad(client: PoolClient, cmd: Cmd) {
  return withReplay(client, cmd, async () => {
    const { user, session } = await requireSession(client, cmd.siteId, cmd.actor)
    let t = await loadTask(client, cmd.siteId, cmd.taskId, true)
    assertOwnTask(t, session, user)
    if (cmd.expectedVersion != null && cmd.expectedVersion !== t.version) {
      throw new WmsHttpError(409, "Задание изменилось на сервере — экран обновлён", "version_conflict")
    }
    if (t.status !== "AT_PICKUP") throw new WmsHttpError(409, `Погрузку нельзя подтвердить в статусе «${STATUS_LABEL[t.status]}»`, "invalid_state")
    const scan = await scanOf(client, cmd.siteId, t.loadScanId)
    if (!scan || scan.result !== "accepted" || palletKey(scan.code) !== palletKey(t.huCode)) {
      throw new WmsHttpError(409, "Сначала отсканируйте палету задания", "scan_required")
    }
    // Повторная проверка в WMS: палету могли переместить/заблокировать между сканом и подтверждением.
    let wms: PalletCheck
    try {
      wms = await wmsGateway().checkPallet({ siteCode: cmd.siteCode, code: t.huCode, taskRef: taskRef(t) })
    } catch (error) {
      throw new WmsHttpError(503, `Подтверждение невозможно — WMS недоступна: ${(error as Error).message}`, "wms_unavailable")
    }
    const recheck = decidePalletScan(forScan(t), t.huCode, wms)
    if (!recheck.ok) {
      await writeTask(client, t, { load_scan_id: null }, t.version)
      throw new WmsHttpError(409, `Погрузка отклонена: ${recheck.message}`, recheck.code)
    }
    t = await transition(client, t, "confirm_load", {
      actor: user.login,
      actorUserId: user.userId,
      clientRequestId: cmd.clientRequestId,
      patch: { loaded_at: true as unknown as string },
      wmsState: wms,
    })
    t = await transition(client, t, "start_dropoff", { actor: "system" })
    return { task: t }
  })
}

export async function scanAddress(client: PoolClient, cmd: Cmd, input: { code: string; method: string; manualReason: string; deviceId: string | null }) {
  const prev = await scanReplay(client, cmd.siteId, cmd.clientRequestId)
  if (prev) {
    return { replayed: true, scan: await scanOf(client, cmd.siteId, prev.scan_id), task: await loadTask(client, cmd.siteId, prev.task_id) }
  }
  const { user, session } = await requireSession(client, cmd.siteId, cmd.actor)
  const m = scanMethod(cmd.actor, input.method, input.manualReason)
  let t = await loadTask(client, cmd.siteId, cmd.taskId, true)
  assertOwnTask(t, session, user)
  if (t.status === "EN_ROUTE_DROPOFF") {
    t = await transition(client, t, "arrive_dropoff", { actor: user.login, reason: "прибытие подтверждено сканом адреса" })
  }
  if (t.status !== "AT_DROPOFF") throw new WmsHttpError(409, `Скан адреса недоступен в статусе «${STATUS_LABEL[t.status]}»`, "invalid_state")
  const cls = classifyScan(input.code)
  if (cls.kind === "sscc") throw new WmsHttpError(422, "Отсканирована палета, а нужен адрес", "scan_kind_mismatch")
  const addr = parseAddressScan(input.code) || cls.value
  let decision: ScanDecision
  let wmsState: unknown = null
  if (normalizeLocation(addr) !== normalizeLocation(t.destCode)) {
    decision = { ok: false, code: "wrong_address", message: "Неверный адрес", expected: t.destCode, actual: addr }
  } else {
    try {
      const wms = await wmsGateway().checkAddress({ siteCode: cmd.siteCode, locationCode: addr, palletCode: t.huCode, taskRef: taskRef(t) })
      wmsState = wms
      decision = decideAddressScan(forScan(t), addr, wms)
    } catch (error) {
      throw new WmsHttpError(503, `Проверка адреса невозможна: ${(error as Error).message}`, "wms_unavailable")
    }
  }
  const scanId = await insertScan(client, t, {
    code: addr,
    codeType: "address",
    method: m.method,
    manualReason: m.manualReason,
    decision,
    actor: user.login,
    deviceId: input.deviceId,
    clientRequestId: cmd.clientRequestId,
  })
  if (decision.ok) {
    await writeTask(client, t, { address_scan_id: scanId }, t.version)
    t = await loadTask(client, cmd.siteId, cmd.taskId, true)
  }
  await recordEvent(client, t, {
    action: decision.ok ? "scan_address" : "scan_address_rejected",
    from: t.status,
    to: t.status,
    version: t.version,
    actor: user.login,
    reason: decision.ok ? null : decision.code,
    payload: { scanId },
    wmsState,
  })
  await publish(client, cmd.siteId, decision.ok ? "address.scan.accepted" : "address.scan.rejected", {
    karaId: t.karaId,
    taskId: t.taskId,
    payload: { scanId, code: addr, result: decision.ok ? "accepted" : decision.code },
  })
  return { scan: await scanOf(client, cmd.siteId, scanId), decision, task: t }
}

/**
 * Подтверждение постановки. Три шага, каждый в своей транзакции:
 *  1) проверка состояния и фиксация requestId перемещения;
 *  2) вызов WMS (идемпотентно по requestId) — без открытой транзакции Route;
 *  3) COMPLETED только при подтверждении WMS, иначе задание остаётся у места назначения.
 * Повтор после сбоя на шаге 2/3 идёт с тем же requestId — второго перемещения не будет.
 */
export async function confirmDropoff(
  client: PoolClient,
  cmd: Cmd
): Promise<{ task: TaskRow; wms: Record<string, unknown>; next: TaskRow | null; replayed?: boolean }> {
  await client.query("BEGIN")
  let t: TaskRow
  let movementId: string
  let actorLogin: string
  try {
    const prev = await replay(client, cmd.siteId, cmd.clientRequestId)
    if (prev) {
      await client.query("COMMIT")
      const task = await loadTask(client, cmd.siteId, prev.task_id)
      return { task, wms: (task.wmsMovementResult as Record<string, unknown>) ?? {}, next: null, replayed: true }
    }
    const { user, session } = await requireSession(client, cmd.siteId, cmd.actor)
    actorLogin = user.login
    t = await loadTask(client, cmd.siteId, cmd.taskId, true)
    assertOwnTask(t, session, user)
    if (cmd.expectedVersion != null && cmd.expectedVersion !== t.version) {
      throw new WmsHttpError(409, "Задание изменилось на сервере — экран обновлён", "version_conflict")
    }
    if (t.status !== "AT_DROPOFF") {
      throw new WmsHttpError(409, `Постановку нельзя подтвердить в статусе «${STATUS_LABEL[t.status]}»`, "invalid_state")
    }
    const addrScan = await scanOf(client, cmd.siteId, t.addressScanId)
    if (!addrScan || addrScan.result !== "accepted" || normalizeLocation(addrScan.code) !== normalizeLocation(t.destCode)) {
      throw new WmsHttpError(409, "Сначала отсканируйте адрес назначения", "address_scan_required")
    }
    const loadScan = await scanOf(client, cmd.siteId, t.loadScanId)
    if (!loadScan || loadScan.result !== "accepted") throw new WmsHttpError(409, "Нет подтверждённого скана палеты", "scan_required")
    movementId = t.wmsMovementRequestId || randomUUID()
    await writeTask(client, t, { wms_movement_request_id: movementId, wms_movement_status: "pending" }, t.version)
    t = await loadTask(client, cmd.siteId, cmd.taskId, true)
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined)
    throw error
  }

  const result = await wmsGateway().movePallet({
    siteCode: cmd.siteCode,
    requestId: movementId,
    palletCode: t.huCode,
    fromLocationCode: t.payload?.sourceIsStorage === true || isStorageCode(t.sourceCode) ? t.sourceCode : null,
    toLocationCode: t.destCode,
    taskRef: taskRef(t),
    actorLogin,
    wmsRef: t.wmsRefKind && t.wmsRefId ? { kind: t.wmsRefKind, id: t.wmsRefId } : null,
  })

  await client.query("BEGIN")
  try {
    t = await loadTask(client, cmd.siteId, cmd.taskId, true)
    if (!result.ok) {
      const status = result.kind === "unavailable" ? "unknown" : "rejected"
      await writeTask(client, t, { wms_movement_status: status, wms_movement_result: JSON.stringify(result) }, t.version)
      t = await loadTask(client, cmd.siteId, cmd.taskId, true)
      await recordEvent(client, t, {
        action: result.kind === "unavailable" ? "wms_unavailable" : "wms_rejected",
        from: t.status,
        to: t.status,
        version: t.version,
        actor: actorLogin,
        reason: result.message,
        wmsState: result,
      })
      if (result.kind === "rejected") {
        await publish(client, cmd.siteId, "wms.movement.rejected", {
          karaId: t.karaId,
          taskId: t.taskId,
          payload: { code: result.code, message: result.message },
        })
        if (result.code === "address_full" || result.code === "address_reserved" || result.code === "placement_rule") {
          await writeTask(client, t, { address_scan_id: null }, t.version)
          t = await loadTask(client, cmd.siteId, cmd.taskId, true)
        }
      }
      await client.query("COMMIT")
      throw new WmsHttpError(
        result.kind === "unavailable" ? 503 : 409,
        result.kind === "unavailable"
          ? "WMS не подтвердила перемещение. Палета не списана с задания — повторите подтверждение."
          : `WMS отклонила перемещение: ${result.message}`,
        result.kind === "unavailable" ? "wms_unavailable" : result.code,
        { task: { taskId: t.taskId, version: t.version, status: t.status } }
      )
    }
    await writeTask(client, t, { wms_movement_status: "confirmed", wms_movement_result: JSON.stringify(result) }, t.version)
    t = await loadTask(client, cmd.siteId, cmd.taskId, true)
    t = await transition(client, t, "complete", {
      actor: actorLogin,
      clientRequestId: cmd.clientRequestId,
      patch: { completed_at: true as unknown as string },
      wmsState: result,
    })
    await publish(client, cmd.siteId, "wms.movement.confirmed", {
      karaId: t.karaId,
      taskId: t.taskId,
      payload: { movementId: result.movementId, to: result.toLocationCode, disposition: result.disposition },
    })
    let next: TaskRow | null = null
    if (t.karaId) next = await offerNext(client, cmd.siteId, t.karaId)
    await client.query("COMMIT")
    return { task: t, wms: result as unknown as Record<string, unknown>, next }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined)
    throw error
  }
}

export async function requestNewAddress(client: PoolClient, cmd: Cmd, reason: string) {
  return withReplay(client, cmd, async () => {
    const isDispatcher = actorCan(cmd.actor, "route.dispatch")
    let t = await loadTask(client, cmd.siteId, cmd.taskId, true)
    let actor = actorLabel(cmd.actor)
    if (!isDispatcher) {
      const { user, session } = await requireSession(client, cmd.siteId, cmd.actor)
      assertOwnTask(t, session, user)
      actor = user.login
    }
    if (!isLoaded(t.status, t.resumeStatus)) throw new WmsHttpError(409, "Новый адрес запрашивается только для палеты на вилах", "not_loaded")
    const rec = await wmsGateway().recommendAddress({ siteCode: cmd.siteCode, palletCode: t.huCode, excludeLocationCodes: [t.destCode] })
    if (!rec.ok) {
      await openException(client, cmd.siteId, t, "address_occupied", `Адрес ${t.destCode} занят, WMS не предложила другой: ${rec.message}`, actor, null)
      throw new WmsHttpError(409, `WMS не предложила другой адрес: ${rec.message}. Диспетчер уведомлён.`, "no_alt_address")
    }
    const map = await requirePublishedMap(client, cmd.siteId)
    const destNode = nodeForAddress(map.geometry, rec.locationCode)
    const old = t.destCode
    t = await transition(client, t, "redirect", {
      actor,
      expectedVersion: cmd.expectedVersion,
      clientRequestId: cmd.clientRequestId,
      reason: reason || `адрес ${old} недоступен`,
      patch: { dest_code: normalizeLocation(rec.locationCode), dest_node_id: destNode, address_scan_id: null, blocked_reason: null },
      payload: { from: old, to: rec.locationCode, wmsReason: rec.reason },
    })
    await publish(client, cmd.siteId, "route.recalculated", { karaId: t.karaId, taskId: t.taskId, payload: { reason: "new_address", dest: t.destCode } })
    return { task: t }
  })
}

/* ------------------------------------------------------------------ */
/* Проблемы                                                            */
/* ------------------------------------------------------------------ */

export const EXCEPTION_KINDS: Record<string, { label: string; effect: "block" | "pause" | "new_address" | "none" }> = {
  pallet_missing: { label: "Палета отсутствует", effect: "block" },
  pallet_damaged: { label: "Палета повреждена", effect: "block" },
  wrong_pallet_on_place: { label: "На месте другая палета", effect: "block" },
  address_occupied: { label: "Адрес занят", effect: "new_address" },
  no_route: { label: "Не проехать", effect: "block" },
  forklift_fault: { label: "Неисправен погрузчик", effect: "pause" },
  stop_task: { label: "Остановить задание", effect: "pause" },
  other: { label: "Другое — позвать диспетчера", effect: "none" },
}

export async function openException(
  client: PoolClient,
  siteId: number,
  t: TaskRow | null,
  kind: string,
  note: string,
  actor: string,
  wmsState: unknown,
  clientRequestId: string | null = null
) {
  const r = await client.query<{ exception_id: string }>(
    `INSERT INTO route_exceptions (site_id, task_id, kind, note, actor_login, kara_id, task_status, wms_state, client_request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING exception_id::text`,
    [siteId, t ? t.taskId : null, kind, note.slice(0, 1000), actor, t?.karaId ?? null, t?.status ?? null, wmsState == null ? null : JSON.stringify(wmsState), clientRequestId]
  )
  await publish(client, siteId, "exception.created", {
    karaId: t?.karaId ?? null,
    taskId: t?.taskId ?? null,
    payload: { exceptionId: r.rows[0].exception_id, kind, note },
  })
  return r.rows[0].exception_id
}

export async function reportProblem(client: PoolClient, cmd: Cmd, input: { kind: string; note: string }) {
  const kind = EXCEPTION_KINDS[input.kind] ? input.kind : "other"
  if (cmd.clientRequestId) {
    const dup = await client.query<{ exception_id: string }>(
      `SELECT exception_id::text FROM route_exceptions WHERE site_id = $1 AND client_request_id = $2`,
      [cmd.siteId, cmd.clientRequestId]
    )
    if (dup.rows[0]) return { replayed: true, exceptionId: dup.rows[0].exception_id, task: await loadTask(client, cmd.siteId, cmd.taskId) }
  }
  const { user, session } = await requireSession(client, cmd.siteId, cmd.actor)
  let t = await loadTask(client, cmd.siteId, cmd.taskId, true)
  assertOwnTask(t, session, user)
  let wmsState: unknown = null
  if (kind === "pallet_missing" || kind === "wrong_pallet_on_place" || kind === "pallet_damaged") {
    try {
      wmsState = await wmsGateway().checkPallet({ siteCode: cmd.siteCode, code: t.huCode, taskRef: taskRef(t) })
    } catch (error) {
      wmsState = { unavailable: (error as Error).message }
    }
  }
  const label = EXCEPTION_KINDS[kind].label
  const note = `${label}${input.note ? `: ${input.note}` : ""}`
  const exceptionId = await openException(client, cmd.siteId, t, kind, note, user.login, wmsState, cmd.clientRequestId)
  const effect = EXCEPTION_KINDS[kind].effect
  let message = "Диспетчер уведомлён"
  if (effect === "block" && t.status !== "BLOCKED") {
    t = await transition(client, t, "block", { actor: user.login, reason: note, patch: { blocked_reason: label }, wmsState })
    message = "Задание остановлено, диспетчер уведомлён"
  } else if (effect === "pause" && t.status !== "PAUSED" && t.status !== "BLOCKED") {
    t = await transition(client, t, "pause", { actor: user.login, reason: note })
    message = "Задание приостановлено, диспетчер уведомлён"
  } else if (effect === "new_address") {
    if (isLoaded(t.status, t.resumeStatus)) {
      try {
        const res = await requestNewAddress(client, { ...cmd, expectedVersion: null, clientRequestId: null }, note)
        if ("task" in res) t = res.task
        message = `Новый адрес: ${t.destCode}`
      } catch (error) {
        if (t.status !== "BLOCKED") {
          t = await transition(client, await loadTask(client, cmd.siteId, cmd.taskId, true), "block", {
            actor: user.login,
            reason: note,
            patch: { blocked_reason: "адрес занят, нет альтернативы" },
          })
        }
        message = (error as Error).message
      }
    }
  }
  return { exceptionId, task: t, message }
}

/* ------------------------------------------------------------------ */
/* Диспетчер                                                           */
/* ------------------------------------------------------------------ */

export async function dispatcherAction(
  client: PoolClient,
  siteId: number,
  taskId: string,
  action: "pause" | "resume" | "cancel" | "block" | "unblock" | "requeue" | "priority",
  input: { reason: string; priority?: number | null; expectedVersion: number | null; actor: string; clientRequestId: string | null }
) {
  const prev = await replay(client, siteId, input.clientRequestId)
  if (prev) return { replayed: true, task: await loadTask(client, siteId, prev.task_id) }
  let t = await loadTask(client, siteId, taskId, true)
  if (action === "priority") {
    const p = Math.max(0, Math.min(100, Math.trunc(Number(input.priority))))
    if (!Number.isFinite(p)) throw new WmsHttpError(400, "priority 0..100", "bad_priority")
    if (input.expectedVersion != null && input.expectedVersion !== t.version) {
      throw new WmsHttpError(409, "Задание изменилось — обновите список", "version_conflict")
    }
    await writeTask(client, t, { priority: p }, t.version)
    t = await loadTask(client, siteId, taskId, true)
    await recordEvent(client, t, {
      action: "priority",
      from: t.status,
      to: t.status,
      version: t.version,
      actor: input.actor,
      reason: input.reason || null,
      clientRequestId: input.clientRequestId,
      payload: { priority: p },
    })
    await publish(client, siteId, "task.updated", { karaId: t.karaId, taskId: t.taskId, payload: { priority: p } })
    return { task: t }
  }
  if ((action === "cancel" || action === "block" || action === "pause") && input.reason.trim().length < 3) {
    throw new WmsHttpError(400, "Укажите причину", "reason_required")
  }
  const patch: Patch = {}
  if (action === "cancel") patch.cancel_reason = input.reason
  if (action === "block") patch.blocked_reason = input.reason
  if (action === "unblock") patch.blocked_reason = null
  if (action === "requeue") Object.assign(patch, { kara_id: null, driver_login: null, driver_user_id: null, load_scan_id: null, address_scan_id: null })
  if (action === "cancel" && isLoaded(t.status, t.resumeStatus)) {
    input.reason = `${input.reason} (палета на вилах — поставить по указанию диспетчера)`
  }
  const prevKara = t.karaId
  t = await transition(client, t, action, {
    actor: input.actor,
    expectedVersion: input.expectedVersion,
    reason: input.reason,
    clientRequestId: input.clientRequestId,
    patch,
  })
  if ((action === "cancel" || action === "requeue") && prevKara) await offerNext(client, siteId, prevKara)
  return { task: t }
}

export async function resolveException(
  client: PoolClient,
  siteId: number,
  exceptionId: string,
  input: { resolution: string; action: "none" | "unblock" | "requeue" | "cancel"; actor: string }
) {
  if (!/^\d+$/.test(exceptionId)) throw new WmsHttpError(400, "некорректный ID", "bad_id")
  const r = await client.query<{ task_id: string | null; status: string }>(
    `SELECT task_id::text, status FROM route_exceptions WHERE site_id = $1 AND exception_id = $2::bigint FOR UPDATE`,
    [siteId, exceptionId]
  )
  const ex = r.rows[0]
  if (!ex) throw new WmsHttpError(404, "проблема не найдена", "exception_not_found")
  if (ex.status !== "open") throw new WmsHttpError(409, "проблема уже закрыта", "exception_closed")
  if (input.resolution.trim().length < 3) throw new WmsHttpError(400, "Опишите решение", "resolution_required")
  let task: TaskRow | null = null
  if (ex.task_id && input.action !== "none") {
    const res = await dispatcherAction(client, siteId, ex.task_id, input.action, {
      reason: input.resolution,
      expectedVersion: null,
      actor: input.actor,
      clientRequestId: null,
    })
    task = res.task
  }
  await client.query(
    `UPDATE route_exceptions SET status = 'resolved', resolution = $3, resolved_by = $4, resolved_at = now()
     WHERE site_id = $1 AND exception_id = $2::bigint`,
    [siteId, exceptionId, input.resolution, input.actor]
  )
  await publish(client, siteId, "exception.resolved", { taskId: ex.task_id, payload: { exceptionId, action: input.action } })
  return { exceptionId, task }
}

/** После закрытия проезда: пересчёт маршрутов активных заданий; нет пути — блок и уведомление. */
export async function recheckRoutesAfterBlock(client: PoolClient, siteId: number, actor: string) {
  const r = await client.query<{ task_id: string }>(
    `SELECT task_id::text FROM route_tasks WHERE site_id = $1
       AND status IN ('ACCEPTED','EN_ROUTE_PICKUP','LOAD_CONFIRMED','EN_ROUTE_DROPOFF')`,
    [siteId]
  )
  const out: Array<{ taskId: string; ok: boolean; reason?: string }> = []
  for (const row of r.rows) {
    const t = await loadTask(client, siteId, row.task_id, true)
    const route = await computeTaskRoute(client, t)
    if (route.result && !route.result.ok && route.result.code === "no_path") {
      const blocked = await transition(client, t, "block", {
        actor,
        reason: "нет безопасного маршрута после закрытия проезда",
        patch: { blocked_reason: "нет безопасного маршрута" },
      })
      await openException(client, siteId, blocked, "no_route", "Нет допустимого маршрута после закрытия проезда", actor, null)
      out.push({ taskId: t.taskId, ok: false, reason: "no_path" })
    } else {
      await publish(client, siteId, "route.recalculated", {
        karaId: t.karaId,
        taskId: t.taskId,
        payload: { lengthM: route.result && route.result.ok ? route.result.lengthM : null },
      })
      out.push({ taskId: t.taskId, ok: true })
    }
  }
  return out
}

export async function listTasks(client: PoolClient, siteId: number, filter: { status?: string | null; open?: boolean; limit?: number }) {
  const r = await client.query<TaskRow>(
    `SELECT ${TASK_COLS} FROM route_tasks t
     WHERE t.site_id = $1
       AND ($2::text IS NULL OR t.status = $2)
       AND (NOT $3 OR t.status NOT IN ('COMPLETED','CANCELLED') OR t.updated_at > now() - interval '30 minutes')
     ORDER BY CASE WHEN t.status IN ('BLOCKED') THEN 0 WHEN t.status IN ('COMPLETED','CANCELLED') THEN 3 ELSE 1 END,
              t.priority DESC, t.created_at
     LIMIT $4`,
    [siteId, filter.status || null, filter.open !== false, Math.min(500, filter.limit || 200)]
  )
  return r.rows.map((t) => ({ ...t, statusLabel: STATUS_LABEL[t.status], typeLabel: TYPE_LABEL[t.type] }))
}

export async function taskEvents(client: PoolClient, siteId: number, filter: { taskId?: string | null; limit?: number }) {
  const r = await client.query(
    `SELECT e.event_id::text AS "eventId", e.task_id::text AS "taskId", t.task_no AS "taskNo", e.action,
            e.from_status AS "from", e.to_status AS "to", e.version, e.actor_login AS actor, e.kara_id AS "karaId",
            e.reason, e.client_request_id AS "clientRequestId", e.wms_state AS "wmsState", e.payload, e.created_at::text AS at
     FROM route_task_events e JOIN route_tasks t ON t.task_id = e.task_id
     WHERE e.site_id = $1 AND ($2::text IS NULL OR e.task_id = $2::bigint)
     ORDER BY e.event_id DESC LIMIT $3`,
    [siteId, filter.taskId || null, Math.min(1000, filter.limit || 200)]
  )
  return r.rows
}

export async function listExceptions(client: PoolClient, siteId: number, openOnly: boolean) {
  const r = await client.query(
    `SELECT x.exception_id::text AS "exceptionId", x.task_id::text AS "taskId", t.task_no AS "taskNo", x.kind, x.note,
            x.status, x.resolution, x.actor_login AS actor, x.kara_id AS "karaId", x.task_status AS "taskStatus",
            x.wms_state AS "wmsState", x.resolved_by AS "resolvedBy", x.resolved_at::text AS "resolvedAt", x.created_at::text AS at
     FROM route_exceptions x LEFT JOIN route_tasks t ON t.task_id = x.task_id
     WHERE x.site_id = $1 AND (NOT $2 OR x.status = 'open')
     ORDER BY x.exception_id DESC LIMIT 200`,
    [siteId, openOnly]
  )
  return r.rows
}

export async function sessionsList(client: PoolClient, siteId: number) {
  const r = await client.query(
    `SELECT session_id::text AS "sessionId", login, fio, kara_id AS "karaId", kara_name AS "karaName",
            shift_code AS "shiftCode", started_at::text AS "startedAt", last_seen_at::text AS "lastSeenAt"
     FROM route_driver_sessions WHERE site_id = $1 AND ended_at IS NULL ORDER BY started_at`,
    [siteId]
  )
  return r.rows
}

export { listForklifts }
