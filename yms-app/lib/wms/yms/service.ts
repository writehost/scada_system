import type { PoolClient } from "pg"
import { canFinishOperation } from "@/lib/wms/yms/loading-gate"
import {
  ACTION_LABEL,
  allowedActions,
  isYmsAction,
  isYmsOperation,
  isYmsStatus,
  ON_YARD_STATUSES,
  resolveTransition,
  type YmsAction,
  type YmsOperation,
  type YmsStatus,
} from "@/lib/wms/yms/state-machine"
import { actorLogin, actorUserId, bad, type YmsCtx } from "@/lib/wms/yms/http"
import { canRevealDriverPhone, grantsAllow, maskPhone } from "@/lib/wms/yms/permissions"
import { getWmsOrder, resolveWmsOrder, type WmsOrderCard } from "@/lib/wms/yms/wms-link"

const VEHICLE_TYPES = new Set(["tent", "fridge", "container", "van", "tanker", "other"])
const DISCREPANCY_KINDS = new Set(["short", "extra", "damage", "partial_cancel"])
const ACTIVE = [
  "expected",
  "at_gate",
  "awaiting_entry",
  "on_yard",
  "parked",
  "awaiting_dock",
  "to_dock",
  "loading",
  "unloading",
  "awaiting_docs",
  "ready_exit",
]

type VisitRow = {
  visitId: string
  visitNo: string
  plate: string
  vehicleType: string
  trailerPlate: string | null
  carrierName: string | null
  driverName: string | null
  driverPhone: string | null
  counterparty: string | null
  operation: YmsOperation
  plannedArrival: string | null
  actualArrival: string | null
  parkingObjectId: string | null
  parkingCode: string | null
  dockObjectId: string | null
  dockCode: string | null
  wmsDocumentId: string | null
  relatedVisitId: string | null
  status: YmsStatus
  priority: number
  note: string | null
  restrictions: string | null
  capacityKg: number | null
  createdAt: string
  updatedAt: string
}

const VISIT_SELECT = `
  SELECT
    v.visit_id::text AS "visitId",
    v.visit_no AS "visitNo",
    veh.plate AS "plate",
    veh.vehicle_type AS "vehicleType",
    v.trailer_plate AS "trailerPlate",
    COALESCE(v.carrier_name, veh.carrier_name) AS "carrierName",
    COALESCE(v.driver_name, veh.driver_name) AS "driverName",
    COALESCE(v.driver_phone, veh.driver_phone) AS "driverPhone",
    v.counterparty AS "counterparty",
    v.operation AS "operation",
    v.planned_arrival AS "plannedArrival",
    v.actual_arrival AS "actualArrival",
    v.parking_object_id::text AS "parkingObjectId",
    pk.code AS "parkingCode",
    v.dock_object_id::text AS "dockObjectId",
    dk.code AS "dockCode",
    v.wms_document_id::text AS "wmsDocumentId",
    v.related_visit_id::text AS "relatedVisitId",
    v.status AS "status",
    v.priority AS "priority",
    v.note AS "note",
    veh.restrictions AS "restrictions",
    veh.capacity_kg AS "capacityKg",
    v.created_at AS "createdAt",
    v.updated_at AS "updatedAt"
  FROM yms_visits v
  JOIN yms_vehicles veh ON veh.vehicle_id = v.vehicle_id
  LEFT JOIN yms_yard_objects pk ON pk.object_id = v.parking_object_id
  LEFT JOIN yms_yard_objects dk ON dk.object_id = v.dock_object_id
`

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, "").trim()
}

function presentVisit(row: VisitRow, revealPhone: boolean) {
  if (!isYmsStatus(row.status) || !isYmsOperation(row.operation)) {
    bad("повреждённая запись визита", "bad_visit")
  }
  const late =
    row.plannedArrival != null &&
    (row.status === "expected" || row.status === "at_gate" || row.status === "awaiting_entry") &&
    new Date(row.plannedArrival).getTime() < Date.now()
  const early =
    row.plannedArrival != null &&
    row.actualArrival != null &&
    new Date(row.actualArrival).getTime() + 15 * 60 * 1000 < new Date(row.plannedArrival).getTime()
  return {
    ...row,
    capacityKg: row.capacityKg == null ? null : Number(row.capacityKg),
    driverPhone: revealPhone ? row.driverPhone : maskPhone(row.driverPhone),
    actions: allowedActions(row.status, row.operation),
    late,
    early,
  }
}

async function fetchVisit(client: PoolClient, siteId: number, visitId: string, revealPhone: boolean) {
  const r = await client.query<VisitRow>(
    `${VISIT_SELECT} WHERE v.site_id = $1 AND v.visit_id = $2::bigint`,
    [siteId, visitId]
  )
  const row = r.rows[0]
  if (!row) bad("визит не найден", "visit_not_found", 404)
  return presentVisit(row, revealPhone)
}

export async function listYard(ctx: YmsCtx) {
  const r = await ctx.client.query(
    `SELECT
       object_id::text AS "objectId",
       code, name, kind, status,
       x::float AS x, y::float AS y, w::float AS w, h::float AS h,
       allowed_vehicle_types AS "allowedVehicleTypes",
       allowed_operations AS "allowedOperations",
       current_visit_id::text AS "currentVisitId",
       blocked_reason AS "blockedReason"
     FROM yms_yard_objects
     WHERE site_id = $1
     ORDER BY kind, code`,
    [ctx.siteId]
  )
  return { objects: r.rows }
}

export async function saveYardObject(ctx: YmsCtx) {
  const body = ctx.body
  const objectId = str(body.objectId)
  const code = str(body.code).toUpperCase()
  const name = str(body.name)
  const kind = str(body.kind)
  const kinds = new Set([
    "boundary",
    "gate_in",
    "gate_out",
    "road",
    "parking",
    "dock",
    "unload_zone",
    "wait_zone",
    "building",
  ])
  if (!kinds.has(kind)) bad("неизвестный тип объекта", "bad_kind")
  if (!code || !name) bad("нужны код и название", "bad_object")
  const x = Number(body.x ?? 0)
  const y = Number(body.y ?? 0)
  const w = Number(body.w ?? 40)
  const h = Number(body.h ?? 24)
  if (![x, y, w, h].every((n) => Number.isFinite(n))) bad("координаты некорректны", "bad_geometry")
  const status = str(body.status) || "free"
  if (!["free", "occupied", "reserved", "loading", "unloading", "blocked", "unavailable"].includes(status)) {
    bad("неизвестный статус объекта", "bad_status")
  }
  const vehicleTypes = Array.isArray(body.allowedVehicleTypes)
    ? body.allowedVehicleTypes.map((v) => String(v))
    : []
  const operations = Array.isArray(body.allowedOperations)
    ? body.allowedOperations.map((v) => String(v))
    : []
  const blockedReason = str(body.blockedReason) || null
  if (objectId) {
    if (body.geometryOnly === true) {
      const r = await ctx.client.query(
        `UPDATE yms_yard_objects SET
           x = $3, y = $4, w = $5, h = $6, updated_at = now()
         WHERE site_id = $1 AND object_id = $2::bigint
         RETURNING object_id::text AS "objectId"`,
        [ctx.siteId, objectId, x, y, w, h]
      )
      if (!r.rowCount) bad("объект не найден", "object_not_found", 404)
      return { objectId: r.rows[0].objectId }
    }
    const r = await ctx.client.query(
      `UPDATE yms_yard_objects SET
         code = $3, name = $4, kind = $5, status = $6,
         x = $7, y = $8, w = $9, h = $10,
         allowed_vehicle_types = $11::text[],
         allowed_operations = $12::text[],
         blocked_reason = $13,
         updated_at = now()
       WHERE site_id = $1 AND object_id = $2::bigint
       RETURNING object_id::text AS "objectId"`,
      [ctx.siteId, objectId, code, name, kind, status, x, y, w, h, vehicleTypes, operations, blockedReason]
    )
    if (!r.rowCount) bad("объект не найден", "object_not_found", 404)
    return { objectId: r.rows[0].objectId }
  }
  const r = await ctx.client.query(
    `INSERT INTO yms_yard_objects (
       site_id, code, name, kind, status, x, y, w, h,
       allowed_vehicle_types, allowed_operations, blocked_reason
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text[],$11::text[],$12)
     RETURNING object_id::text AS "objectId"`,
    [ctx.siteId, code, name, kind, status, x, y, w, h, vehicleTypes, operations, blockedReason]
  )
  return { objectId: r.rows[0].objectId }
}

async function upsertVehicle(ctx: YmsCtx, plate: string) {
  const vehicleType = str(ctx.body.vehicleType) || "tent"
  if (!VEHICLE_TYPES.has(vehicleType)) bad("неизвестный тип транспорта", "bad_vehicle_type")
  const r = await ctx.client.query<{ vehicleId: string }>(
    `INSERT INTO yms_vehicles (
       site_id, plate, vehicle_type, carrier_name, driver_name, driver_phone,
       body_length_m, capacity_kg, restrictions, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
     ON CONFLICT (site_id, plate) DO UPDATE SET
       vehicle_type = EXCLUDED.vehicle_type,
       carrier_name = COALESCE(EXCLUDED.carrier_name, yms_vehicles.carrier_name),
       driver_name = COALESCE(EXCLUDED.driver_name, yms_vehicles.driver_name),
       driver_phone = COALESCE(EXCLUDED.driver_phone, yms_vehicles.driver_phone),
       body_length_m = COALESCE(EXCLUDED.body_length_m, yms_vehicles.body_length_m),
       capacity_kg = COALESCE(EXCLUDED.capacity_kg, yms_vehicles.capacity_kg),
       restrictions = COALESCE(EXCLUDED.restrictions, yms_vehicles.restrictions),
       updated_at = now()
     RETURNING vehicle_id::text AS "vehicleId"`,
    [
      ctx.siteId,
      plate,
      vehicleType,
      str(ctx.body.carrierName) || null,
      str(ctx.body.driverName) || null,
      str(ctx.body.driverPhone) || null,
      numberOrNull(ctx.body.bodyLengthM),
      numberOrNull(ctx.body.capacityKg),
      str(ctx.body.restrictions) || null,
    ]
  )
  return r.rows[0].vehicleId
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function nextVisitNo(client: PoolClient, siteId: number): Promise<string> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`yms-visit-${siteId}`])
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  const prefix = `YMS-${day}-`
  const r = await client.query<{ n: string }>(
    `SELECT COALESCE(MAX(CAST(substring(visit_no from 14) AS INT)), 0)::text AS n
     FROM yms_visits
     WHERE site_id = $1 AND visit_no LIKE $2`,
    [siteId, `${prefix}%`]
  )
  const n = Number(r.rows[0]?.n ?? 0) + 1
  return `${prefix}${String(n).padStart(4, "0")}`
}

export async function createVisit(ctx: YmsCtx) {
  const plate = normalizePlate(str(ctx.body.plate))
  if (plate.length < 4) bad("укажите госномер", "bad_plate")
  const operation = str(ctx.body.operation).toUpperCase()
  if (!isYmsOperation(operation)) bad("неизвестный тип операции", "bad_operation")
  const walkIn = ctx.body.walkIn === true
  const canWrite = grantsAllow(ctx.roleCodes, "yms.visit.write")
  const canGate = grantsAllow(ctx.roleCodes, "yms.gate.confirm")
  if (walkIn) {
    if (!canGate && !canWrite) bad("внеплановый визит регистрирует охрана или диспетчер", "permission_denied", 403)
  } else if (!canWrite) {
    bad("недостаточно прав: yms.visit.write", "permission_denied", 403)
  }
  const vehicleId = await upsertVehicle(ctx, plate)
  const visitNo = await nextVisitNo(ctx.client, ctx.siteId)
  const status: YmsStatus = walkIn ? "at_gate" : "expected"
  const documentRaw = str(ctx.body.wmsDocumentId)
  let documentId = ""
  if (documentRaw) {
    const order = await resolveWmsOrder(ctx.client, ctx.siteId, documentRaw)
    if (!order) bad("заказ WMS не найден на этой площадке", "wms_order_not_found", 404)
    documentId = order.documentId
  }
  const related = str(ctx.body.relatedVisitId)
  if (related && !/^\d+$/.test(related)) bad("связанный визит указан неверно", "bad_related_visit")
  const ins = await ctx.client.query<{ visitId: string }>(
    `INSERT INTO yms_visits (
       site_id, visit_no, vehicle_id, trailer_plate, carrier_name, driver_name, driver_phone,
       counterparty, operation, planned_arrival, actual_arrival, wms_document_id, related_visit_id,
       status, priority, note, created_by
     ) VALUES (
       $1,$2,$3::bigint,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::timestamptz,$12::bigint,$13::bigint,$14,$15,$16,$17
     ) RETURNING visit_id::text AS "visitId"`,
    [
      ctx.siteId,
      visitNo,
      vehicleId,
      str(ctx.body.trailerPlate) || null,
      str(ctx.body.carrierName) || null,
      str(ctx.body.driverName) || null,
      str(ctx.body.driverPhone) || null,
      str(ctx.body.counterparty) || null,
      operation,
      str(ctx.body.plannedArrival) || null,
      walkIn ? new Date().toISOString() : null,
      documentId || null,
      related || null,
      status,
      Number(ctx.body.priority ?? 0) || 0,
      str(ctx.body.note) || null,
      actorLogin(ctx.actor),
    ]
  )
  const visitId = ins.rows[0].visitId
  await writeEvent(ctx, visitId, null, status, walkIn ? "arrive" : "create", str(ctx.body.reason) || null, null)
  if (walkIn) await notify(ctx, visitId, "gate", "arrived", `Внеплановый ${plate} на КПП`)
  const visit = await fetchVisit(ctx.client, ctx.siteId, visitId, true)
  return { visit }
}

async function writeEvent(
  ctx: YmsCtx,
  visitId: string,
  from: string | null,
  to: string,
  action: string,
  reason: string | null,
  requestId: string | null,
  payload: Record<string, unknown> = {}
) {
  await ctx.client.query(
    `INSERT INTO yms_visit_events (
       site_id, visit_id, from_status, to_status, action, actor_user_id, actor_login, reason, client_request_id, payload
     ) VALUES ($1,$2::bigint,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [
      ctx.siteId,
      visitId,
      from,
      to,
      action,
      actorUserId(ctx.actor),
      actorLogin(ctx.actor),
      reason,
      requestId,
      JSON.stringify(payload),
    ]
  )
}

async function notify(ctx: YmsCtx, visitId: string, audience: string, kind: string, message: string) {
  await ctx.client.query(
    `INSERT INTO yms_notifications (site_id, visit_id, audience, kind, message)
     VALUES ($1,$2::bigint,$3,$4,$5)`,
    [ctx.siteId, visitId, audience, kind, message]
  )
}

export async function transitionVisit(ctx: YmsCtx, visitId: string) {
  const actionRaw = str(ctx.body.action)
  if (!isYmsAction(actionRaw)) bad("неизвестное действие", "bad_action")
  const action: YmsAction = actionRaw
  const requestId = str(ctx.body.requestId) || null
  if (requestId) {
    const dup = await ctx.client.query<{ visit_id: string }>(
      `SELECT visit_id::text FROM yms_visit_events
       WHERE site_id = $1 AND client_request_id = $2`,
      [ctx.siteId, requestId]
    )
    if (dup.rows[0]) {
      const visit = await fetchVisit(ctx.client, ctx.siteId, dup.rows[0].visit_id, canRevealDriverPhone(ctx.roleCodes))
      return { visit, disposition: "duplicate" }
    }
  }
  await ctx.client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`yms-visit-row-${visitId}`])
  const current = await fetchVisit(ctx.client, ctx.siteId, visitId, true)
  const step = resolveTransition(current.status, action, current.operation)
  if (step.ok === false) bad(step.reason, "illegal_transition", 409)
  assertActionPermission(ctx.roleCodes, action)

  if (action === "park") await assignParking(ctx, current.visitId, current.parkingObjectId)
  if (action === "assign_dock") await assignDock(ctx, current)
  if (action === "release_dock") await releaseDockOnly(ctx, current.visitId)
  if (action === "start_operation") await markDockWorking(ctx, current.dockObjectId, step.to)
  if (action === "complete_operation") await assertWarehouseReady(ctx, current)
  if (action === "cancel" || action === "depart" || action === "deny_entry") {
    await releaseAllHolds(ctx, current.visitId)
  }

  await ctx.client.query(
    `UPDATE yms_visits SET
       status = $3,
       actual_arrival = CASE WHEN $4 = 'at_gate' AND actual_arrival IS NULL THEN now() ELSE actual_arrival END,
       updated_at = now()
     WHERE site_id = $1 AND visit_id = $2::bigint`,
    [ctx.siteId, visitId, step.to, step.to]
  )
  await writeEvent(ctx, visitId, current.status, step.to, action, str(ctx.body.reason) || null, requestId, {
    label: ACTION_LABEL[action],
  })
  await notifyFor(ctx, current, step.to, action)
  const visit = await fetchVisit(ctx.client, ctx.siteId, visitId, canRevealDriverPhone(ctx.roleCodes))
  return { visit, disposition: "applied" }
}

async function notifyFor(ctx: YmsCtx, visit: { visitId: string; plate: string }, to: YmsStatus, action: YmsAction) {
  if (action === "arrive") await notify(ctx, visit.visitId, "dispatcher", "arrived", `${visit.plate} на КПП`)
  if (action === "assign_dock") await notify(ctx, visit.visitId, "driver", "called", `${visit.plate}: вызов к доку`)
  if (action === "complete_operation") {
    await notify(ctx, visit.visitId, "dispatcher", "loaded", `${visit.plate}: операция завершена`)
  }
  if (to === "ready_exit") await notify(ctx, visit.visitId, "gate", "exit_ready", `${visit.plate} готов к выезду`)
}

async function assignParking(ctx: YmsCtx, visitId: string, previousId: string | null) {
  const objectId = str(ctx.body.parkingObjectId)
  if (!objectId) bad("выберите стоянку", "parking_required")
  if (previousId && previousId !== objectId) {
    await ctx.client.query(
      `UPDATE yms_yard_objects
       SET status = 'free', current_visit_id = NULL, updated_at = now()
       WHERE site_id = $1 AND object_id = $2::bigint AND current_visit_id = $3::bigint`,
      [ctx.siteId, previousId, visitId]
    )
  }
  const lock = await ctx.client.query<{
    kind: string
    status: string
    currentVisitId: string | null
  }>(
    `SELECT kind, status, current_visit_id::text AS "currentVisitId"
     FROM yms_yard_objects
     WHERE site_id = $1 AND object_id = $2::bigint
     FOR UPDATE`,
    [ctx.siteId, objectId]
  )
  const spot = lock.rows[0]
  if (!spot || spot.kind !== "parking") bad("это не стоянка", "bad_parking", 404)
  if (spot.status === "blocked" || spot.status === "unavailable") bad("стоянка недоступна", "parking_blocked", 409)
  if (spot.currentVisitId && spot.currentVisitId !== visitId) bad("стоянка уже занята", "parking_taken", 409)
  await ctx.client.query(
    `UPDATE yms_yard_objects
     SET status = 'occupied', current_visit_id = $3::bigint, updated_at = now()
     WHERE site_id = $1 AND object_id = $2::bigint`,
    [ctx.siteId, objectId, visitId]
  )
  await ctx.client.query(
    `UPDATE yms_visits SET parking_object_id = $3::bigint WHERE site_id = $1 AND visit_id = $2::bigint`,
    [ctx.siteId, visitId, objectId]
  )
}

async function assignDock(
  ctx: YmsCtx,
  visit: { visitId: string; operation: YmsOperation; vehicleType: string; dockObjectId: string | null }
) {
  const objectId = str(ctx.body.dockObjectId)
  if (!objectId) bad("выберите док", "dock_required")
  const lock = await ctx.client.query<{
    kind: string
    status: string
    currentVisitId: string | null
    allowedVehicleTypes: string[]
    allowedOperations: string[]
    code: string
  }>(
    `SELECT kind, status, current_visit_id::text AS "currentVisitId",
            allowed_vehicle_types AS "allowedVehicleTypes",
            allowed_operations AS "allowedOperations",
            code
     FROM yms_yard_objects
     WHERE site_id = $1 AND object_id = $2::bigint
     FOR UPDATE`,
    [ctx.siteId, objectId]
  )
  const dock = lock.rows[0]
  if (!dock || dock.kind !== "dock") bad("это не док", "bad_dock", 404)
  if (dock.status === "blocked" || dock.status === "unavailable") {
    bad(`док ${dock.code} недоступен`, "dock_blocked", 409)
  }
  if (dock.currentVisitId && dock.currentVisitId !== visit.visitId) {
    bad(`док ${dock.code} уже занят`, "dock_taken", 409)
  }
  await ctx.client.query(
    `UPDATE yms_yard_objects
     SET status = 'free', current_visit_id = NULL, updated_at = now()
     WHERE site_id = $1 AND current_visit_id = $2::bigint AND kind = 'parking'`,
    [ctx.siteId, visit.visitId]
  )
  if (dock.allowedVehicleTypes?.length && !dock.allowedVehicleTypes.includes(visit.vehicleType)) {
    bad(`тип транспорта не допускается на ${dock.code}`, "dock_vehicle_mismatch", 409)
  }
  if (dock.allowedOperations?.length && !dock.allowedOperations.includes(visit.operation)) {
    bad(`операция ${visit.operation} не допускается на ${dock.code}`, "dock_operation_mismatch", 409)
  }
  if (visit.dockObjectId && visit.dockObjectId !== objectId) {
    await ctx.client.query(
      `UPDATE yms_yard_objects
       SET status = 'free', current_visit_id = NULL, updated_at = now()
       WHERE site_id = $1 AND object_id = $2::bigint`,
      [ctx.siteId, visit.dockObjectId]
    )
  }
  await ctx.client.query(
    `UPDATE yms_yard_objects
     SET status = 'reserved', current_visit_id = $3::bigint, updated_at = now()
     WHERE site_id = $1 AND object_id = $2::bigint`,
    [ctx.siteId, objectId, visit.visitId]
  )
  await ctx.client.query(
    `UPDATE yms_visits SET dock_object_id = $3::bigint WHERE site_id = $1 AND visit_id = $2::bigint`,
    [ctx.siteId, visit.visitId, objectId]
  )
}

function assertActionPermission(roleCodes: string[], action: YmsAction) {
  const gate = new Set<YmsAction>(["arrive", "hold_entry", "allow_entry", "deny_entry", "depart"])
  const assign = new Set<YmsAction>(["park", "wait_dock", "assign_dock", "release_dock", "start_operation", "release_exit"])
  const warehouse = new Set<YmsAction>(["complete_operation"])
  const need = gate.has(action)
    ? "yms.gate.confirm"
    : assign.has(action)
      ? "yms.assign"
      : "yms.visit.write"
  if (warehouse.has(action)) {
    if (!grantsAllow(roleCodes, "yms.warehouse.confirm") && !grantsAllow(roleCodes, "yms.assign")) {
      bad("недостаточно прав: yms.warehouse.confirm", "permission_denied", 403)
    }
    return
  }
  if (!grantsAllow(roleCodes, need)) bad(`недостаточно прав: ${need}`, "permission_denied", 403)
}

async function releaseDockOnly(ctx: YmsCtx, visitId: string) {
  await ctx.client.query(
    `UPDATE yms_yard_objects
     SET status = 'free', current_visit_id = NULL, updated_at = now()
     WHERE site_id = $1 AND current_visit_id = $2::bigint AND kind = 'dock'`,
    [ctx.siteId, visitId]
  )
  await ctx.client.query(
    `UPDATE yms_visits SET dock_object_id = NULL
     WHERE site_id = $1 AND visit_id = $2::bigint`,
    [ctx.siteId, visitId]
  )
}

async function releaseAllHolds(ctx: YmsCtx, visitId: string) {
  await ctx.client.query(
    `UPDATE yms_yard_objects
     SET status = 'free', current_visit_id = NULL, updated_at = now()
     WHERE site_id = $1 AND current_visit_id = $2::bigint`,
    [ctx.siteId, visitId]
  )
  await ctx.client.query(
    `UPDATE yms_visits
     SET dock_object_id = NULL, parking_object_id = NULL
     WHERE site_id = $1 AND visit_id = $2::bigint`,
    [ctx.siteId, visitId]
  )
}

async function markDockWorking(ctx: YmsCtx, dockObjectId: string | null, status: YmsStatus) {
  if (!dockObjectId) bad("у визита нет дока", "dock_required", 409)
  const dockStatus = status === "unloading" ? "unloading" : "loading"
  await ctx.client.query(
    `UPDATE yms_yard_objects SET status = $3, updated_at = now()
     WHERE site_id = $1 AND object_id = $2::bigint`,
    [ctx.siteId, dockObjectId, dockStatus]
  )
}

async function assertWarehouseReady(
  ctx: YmsCtx,
  visit: { visitId: string; operation: YmsOperation; wmsDocumentId: string | null }
) {
  const disc = await ctx.client.query(
    `SELECT 1 FROM yms_visit_discrepancies
     WHERE site_id = $1 AND visit_id = $2::bigint AND acknowledged
     LIMIT 1`,
    [ctx.siteId, visit.visitId]
  )
  let plannedQty = 0
  let confirmedQty = 0
  const hasDocument = Boolean(visit.wmsDocumentId)
  if (visit.wmsDocumentId) {
    const order = await getWmsOrder(ctx.client, ctx.siteId, visit.wmsDocumentId)
    if (!order) bad("связанный заказ WMS не найден", "wms_order_not_found", 404)
    plannedQty = order.plannedQty
    confirmedQty = order.confirmedQty
  }
  const gate = canFinishOperation(visit.operation, {
    hasDocument,
    plannedQty,
    confirmedQty,
    palletCount: 0,
    openTaskCount: 0,
    acknowledgedDiscrepancy: Boolean(disc.rowCount),
  })
  if (gate.ok === false) bad(gate.message, gate.code, 409)
}

export async function addDiscrepancy(ctx: YmsCtx, visitId: string) {
  if (!grantsAllow(ctx.roleCodes, "yms.warehouse.confirm") && !grantsAllow(ctx.roleCodes, "yms.assign")) {
    bad("недостаточно прав: yms.warehouse.confirm", "permission_denied", 403)
  }
  const kind = str(ctx.body.kind)
  if (!DISCREPANCY_KINDS.has(kind)) bad("неизвестный тип расхождения", "bad_discrepancy")
  await fetchVisit(ctx.client, ctx.siteId, visitId, true)
  await ctx.client.query(
    `INSERT INTO yms_visit_discrepancies (site_id, visit_id, kind, qty, note, actor_login)
     VALUES ($1,$2::bigint,$3,$4,$5,$6)`,
    [ctx.siteId, visitId, kind, numberOrNull(ctx.body.qty), str(ctx.body.note) || null, actorLogin(ctx.actor)]
  )
  await notify(ctx, visitId, "dispatcher", "discrepancy", `Расхождение ${kind} по визиту`)
  return { ok: true }
}

export async function getVisitDetail(ctx: YmsCtx, visitId: string) {
  const reveal = canRevealDriverPhone(ctx.roleCodes)
  const visit = await fetchVisit(ctx.client, ctx.siteId, visitId, reveal)
  const events = await ctx.client.query(
    `SELECT event_id::text AS "eventId", from_status AS "fromStatus", to_status AS "toStatus",
            action, actor_login AS "actorLogin", reason, created_at AS "createdAt"
     FROM yms_visit_events
     WHERE site_id = $1 AND visit_id = $2::bigint
     ORDER BY event_id DESC
     LIMIT 100`,
    [ctx.siteId, visitId]
  )
  const discrepancies = await ctx.client.query(
    `SELECT discrepancy_id::text AS "discrepancyId", kind, qty::float AS qty, note, created_at AS "createdAt"
     FROM yms_visit_discrepancies
     WHERE site_id = $1 AND visit_id = $2::bigint
     ORDER BY discrepancy_id DESC`,
    [ctx.siteId, visitId]
  )
  let order: WmsOrderCard | null = null
  if (visit.wmsDocumentId) order = await getWmsOrder(ctx.client, ctx.siteId, visit.wmsDocumentId)
  return { visit, events: events.rows, discrepancies: discrepancies.rows, order }
}

export async function loadBoard(ctx: YmsCtx) {
  const url = ctx.url
  const q = (url.searchParams.get("q") || "").trim()
  const status = (url.searchParams.get("status") || "").trim()
  const operation = (url.searchParams.get("operation") || "").trim()
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 80)))
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0))
  const reveal = canRevealDriverPhone(ctx.roleCodes)
  const plateQ = normalizePlate(q)
  const rows = await ctx.client.query<VisitRow>(
    `${VISIT_SELECT}
     WHERE v.site_id = $1
       AND v.status = ANY($2::text[])
       AND ($3::text = '' OR v.status = $3)
       AND ($4::text = '' OR v.operation = $4)
       AND (
         $5::text = ''
         OR veh.plate ILIKE '%' || $6 || '%'
         OR v.visit_no ILIKE '%' || $5 || '%'
         OR COALESCE(v.carrier_name, '') ILIKE '%' || $5 || '%'
         OR COALESCE(v.driver_name, '') ILIKE '%' || $5 || '%'
         OR COALESCE(v.counterparty, '') ILIKE '%' || $5 || '%'
       )
     ORDER BY v.priority DESC, v.planned_arrival NULLS LAST, v.visit_id DESC
     LIMIT $7 OFFSET $8`,
    [ctx.siteId, ACTIVE, status, operation, q, plateQ, limit, offset]
  )
  const kpi = await ctx.client.query<{
    onYard: number
    awaitingEntry: number
    awaitingDock: number
    loading: number
    unloading: number
    readyExit: number
    overdue: number
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = ANY($2::text[]))::int AS "onYard",
       COUNT(*) FILTER (WHERE status = ANY($3::text[]))::int AS "awaitingEntry",
       COUNT(*) FILTER (WHERE status = 'awaiting_dock')::int AS "awaitingDock",
       COUNT(*) FILTER (WHERE status = 'loading')::int AS "loading",
       COUNT(*) FILTER (WHERE status = 'unloading')::int AS "unloading",
       COUNT(*) FILTER (WHERE status = 'ready_exit')::int AS "readyExit",
       COUNT(*) FILTER (
         WHERE status = ANY($4::text[])
           AND planned_arrival IS NOT NULL
           AND planned_arrival < now()
       )::int AS "overdue"
     FROM yms_visits
     WHERE site_id = $1`,
    [
      ctx.siteId,
      ON_YARD_STATUSES,
      ["at_gate", "awaiting_entry"],
      ["expected", "at_gate", "awaiting_entry"],
    ]
  )
  const events = await ctx.client.query(
    `SELECT e.event_id::text AS "eventId", e.visit_id::text AS "visitId", v.visit_no AS "visitNo",
            veh.plate, e.from_status AS "fromStatus", e.to_status AS "toStatus",
            e.action, e.actor_login AS "actorLogin", e.reason, e.created_at AS "createdAt"
     FROM yms_visit_events e
     JOIN yms_visits v ON v.visit_id = e.visit_id
     JOIN yms_vehicles veh ON veh.vehicle_id = v.vehicle_id
     WHERE e.site_id = $1
     ORDER BY e.event_id DESC
     LIMIT 40`,
    [ctx.siteId]
  )
  const notices = await ctx.client.query(
    `SELECT notification_id::text AS "notificationId", visit_id::text AS "visitId",
            audience, kind, message, created_at AS "createdAt"
     FROM yms_notifications
     WHERE site_id = $1
     ORDER BY notification_id DESC
     LIMIT 20`,
    [ctx.siteId]
  )
  const yard = await listYard(ctx)
  return {
    kpis: kpi.rows[0],
    visits: rows.rows.map((row) => presentVisit(row, reveal)),
    events: events.rows,
    notifications: notices.rows,
    objects: yard.objects,
    limit,
    offset,
  }
}
