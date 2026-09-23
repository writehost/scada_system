import { createHash, randomBytes } from "node:crypto"
import type { PoolClient } from "pg"
import { readFleetUnits } from "@/lib/wms/yms/fleet-read"
import { canFinishOperation, operationPhase } from "@/lib/wms/yms/loading-gate"
import { actorLogin, bad, type YmsCtx } from "@/lib/wms/yms/http"
import { grantsAllow } from "@/lib/wms/yms/permissions"
import { decidePalletScan, normalizeScanCode } from "@/lib/wms/yms/pallet-scan"
import { readOrderPallets } from "@/lib/wms/yms/wms-pallets"

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function hashDriverToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function newDriverToken(): string {
  return randomBytes(18).toString("hex")
}

async function visitRow(client: PoolClient, siteId: number, visitId: string) {
  const r = await client.query<{
    visitId: string
    status: string
    operation: string
    wmsDocumentId: string | null
    dockObjectId: string | null
    driverId: string | null
    plate: string
  }>(
    `SELECT v.visit_id::text AS "visitId", v.status, v.operation,
            v.wms_document_id::text AS "wmsDocumentId",
            v.dock_object_id::text AS "dockObjectId",
            v.driver_id::text AS "driverId",
            veh.plate AS plate
     FROM yms_visits v
     JOIN yms_vehicles veh ON veh.vehicle_id = v.vehicle_id
     WHERE v.site_id = $1 AND v.visit_id = $2::bigint`,
    [siteId, visitId]
  )
  return r.rows[0] ?? null
}

export async function upsertDriver(
  client: PoolClient,
  siteId: number,
  input: { fullName: string; carrierName?: string | null; phone?: string | null; restrictions?: string | null }
) {
  const fullName = input.fullName.trim()
  if (fullName.length < 2) bad("укажите ФИО водителя", "bad_driver")
  const carrier = input.carrierName?.trim() || null
  const found = await client.query<{ driverId: string }>(
    `SELECT driver_id::text AS "driverId"
     FROM yms_drivers
     WHERE site_id = $1
       AND lower(full_name) = lower($2)
       AND lower(COALESCE(carrier_name, '')) = lower(COALESCE($3, ''))
     LIMIT 1`,
    [siteId, fullName, carrier]
  )
  if (found.rows[0]) {
    await client.query(
      `UPDATE yms_drivers SET
         phone = COALESCE($3, phone),
         restrictions = COALESCE($4, restrictions),
         updated_at = now()
       WHERE driver_id = $1::bigint AND site_id = $2`,
      [found.rows[0].driverId, siteId, input.phone?.trim() || null, input.restrictions?.trim() || null]
    )
    return found.rows[0].driverId
  }
  const ins = await client.query<{ driverId: string }>(
    `INSERT INTO yms_drivers (site_id, full_name, carrier_name, phone, restrictions)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING driver_id::text AS "driverId"`,
    [siteId, fullName, carrier, input.phone?.trim() || null, input.restrictions?.trim() || null]
  )
  return ins.rows[0].driverId
}

export async function linkVisitDriver(ctx: YmsCtx, visitId: string) {
  if (!grantsAllow(ctx.roleCodes, "yms.visit.write") && !grantsAllow(ctx.roleCodes, "yms.gate.confirm")) {
    bad("недостаточно прав", "permission_denied", 403)
  }
  const visit = await visitRow(ctx.client, ctx.siteId, visitId)
  if (!visit) bad("визит не найден", "visit_not_found", 404)
  const driverId = await upsertDriver(ctx.client, ctx.siteId, {
    fullName: str(ctx.body.driverName),
    carrierName: str(ctx.body.carrierName) || null,
    phone: str(ctx.body.driverPhone) || null,
  })
  await ctx.client.query(
    `UPDATE yms_visits SET
       driver_id = $3::bigint,
       driver_name = $4,
       driver_phone = COALESCE($5, driver_phone),
       carrier_name = COALESCE($6, carrier_name),
       updated_at = now()
     WHERE site_id = $1 AND visit_id = $2::bigint`,
    [ctx.siteId, visitId, driverId, str(ctx.body.driverName), str(ctx.body.driverPhone) || null, str(ctx.body.carrierName) || null]
  )
  return { driverId }
}

export async function issueDriverAccess(ctx: YmsCtx, visitId: string) {
  if (!grantsAllow(ctx.roleCodes, "yms.assign") && !grantsAllow(ctx.roleCodes, "yms.visit.write")) {
    bad("недостаточно прав", "permission_denied", 403)
  }
  const visit = await visitRow(ctx.client, ctx.siteId, visitId)
  if (!visit) bad("визит не найден", "visit_not_found", 404)
  const token = newDriverToken()
  await ctx.client.query(
    `UPDATE yms_visits SET driver_token_hash = $3, updated_at = now()
     WHERE site_id = $1 AND visit_id = $2::bigint`,
    [ctx.siteId, visitId, hashDriverToken(token)]
  )
  return { token, path: `/d/${token}` }
}

export async function recordDriverCall(ctx: YmsCtx, visitId: string, message: string) {
  await ctx.client.query(
    `INSERT INTO yms_driver_calls (site_id, visit_id, channel, message, actor_login)
     VALUES ($1,$2::bigint,'board',$3,$4)`,
    [ctx.siteId, visitId, message, actorLogin(ctx.actor)]
  )
}

export async function loadingCard(ctx: YmsCtx, visitId: string) {
  const visit = await visitRow(ctx.client, ctx.siteId, visitId)
  if (!visit) bad("визит не найден", "visit_not_found", 404)
  const pallets = visit.wmsDocumentId
    ? await readOrderPallets(ctx.client, ctx.siteId, visit.wmsDocumentId)
    : { available: false, gap: "wms_order_required", pallets: [], wmsScanCodes: [] }
  const scans = await ctx.client.query<{ code: string; result: string; rejectCode: string | null; createdAt: string }>(
    `SELECT code, result, reject_code AS "rejectCode", created_at AS "createdAt"
     FROM yms_pallet_scans
     WHERE site_id = $1 AND visit_id = $2::bigint
     ORDER BY scan_id DESC
     LIMIT 80`,
    [ctx.siteId, visitId]
  )
  const accepted = scans.rows.filter((row) => row.result === "accepted").map((row) => normalizeScanCode(row.code))
  const fromWms = pallets.wmsScanCodes.map(normalizeScanCode)
  const loaded = new Set([...accepted, ...fromWms])
  const jobs = await ctx.client.query<{ status: string }>(
    `SELECT status FROM yms_dock_jobs
     WHERE site_id = $1 AND visit_id = $2::bigint
       AND status NOT IN ('done', 'cancelled')
     ORDER BY job_id DESC
     LIMIT 1`,
    [ctx.siteId, visitId]
  )
  const started = await ctx.client.query<{ createdAt: string | null }>(
    `SELECT created_at AS "createdAt" FROM yms_visit_events
     WHERE site_id = $1 AND visit_id = $2::bigint AND action = 'start_operation'
     ORDER BY event_id DESC LIMIT 1`,
    [ctx.siteId, visitId]
  )
  const disc = await ctx.client.query(
    `SELECT 1 FROM yms_visit_discrepancies
     WHERE site_id = $1 AND visit_id = $2::bigint AND acknowledged LIMIT 1`,
    [ctx.siteId, visitId]
  )
  const order = visit.wmsDocumentId
    ? (
        await ctx.client.query<{ plannedQty: number; confirmedQty: number; documentNo: string | null }>(
          `SELECT d.document_no AS "documentNo",
                  COALESCE(SUM(dl.requested_qty), 0)::float AS "plannedQty",
                  COALESCE(SUM(dl.confirmed_qty), 0)::float AS "confirmedQty"
           FROM wms_documents d
           LEFT JOIN wms_document_lines dl ON dl.document_id = d.document_id
           WHERE d.site_id = $1 AND d.document_id = $2::bigint
           GROUP BY d.document_no`,
          [ctx.siteId, visit.wmsDocumentId]
        )
      ).rows[0]
    : null
  const plannedPallets = pallets.pallets.length
  const loadedPallets = [...loaded].filter((code) =>
    plannedPallets === 0 ? fromWms.includes(code) || accepted.includes(code) : pallets.pallets.some((row) => normalizeScanCode(row.code) === code) || accepted.includes(code)
  ).length
  const gate = canFinishOperation(visit.operation as "OUTBOUND", {
    hasDocument: Boolean(visit.wmsDocumentId),
    plannedQty: Number(order?.plannedQty) || 0,
    confirmedQty: Number(order?.confirmedQty) || 0,
    plannedPallets,
    loadedPallets,
    acknowledgedDiscrepancy: Boolean(disc.rowCount),
  })
  const phase = operationPhase({
    status: visit.status,
    orderReady: order ? Number(order.plannedQty) > 0 && Number(order.confirmedQty) + 0.0001 >= Number(order.plannedQty) : null,
    loadedPallets,
    plannedPallets,
    jobStatus: jobs.rows[0]?.status ?? null,
  })
  const startedAt = started.rows[0]?.createdAt ?? null
  const idleMinutes =
    startedAt && (visit.status === "loading" || visit.status === "unloading" || visit.status === "to_dock")
      ? Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 60000))
      : null
  return {
    phase,
    documentNo: order?.documentNo ?? null,
    plannedQty: Number(order?.plannedQty) || 0,
    confirmedQty: Number(order?.confirmedQty) || 0,
    plannedPallets,
    loadedPallets,
    gap: pallets.gap,
    startedAt,
    idleMinutes,
    canFinish: gate.ok === true,
    blockReason: gate.ok === false ? gate.message : null,
    scans: scans.rows,
    wmsScanCodes: fromWms,
  }
}

export async function scanPallet(ctx: YmsCtx, visitId: string) {
  if (!grantsAllow(ctx.roleCodes, "yms.warehouse.confirm")) {
    bad("недостаточно прав: yms.warehouse.confirm", "permission_denied", 403)
  }
  const visit = await visitRow(ctx.client, ctx.siteId, visitId)
  if (!visit) bad("визит не найден", "visit_not_found", 404)
  if (visit.status !== "loading" && visit.status !== "unloading") {
    bad("скан доступен только во время погрузки или разгрузки", "bad_status", 409)
  }
  if (!visit.wmsDocumentId) bad("визит не связан с заказом WMS", "wms_order_required", 409)
  const requestId = str(ctx.body.requestId) || null
  if (requestId) {
    const prev = await ctx.client.query<{ result: string; rejectCode: string | null }>(
      `SELECT result, reject_code AS "rejectCode"
       FROM yms_pallet_scans
       WHERE site_id = $1 AND client_request_id = $2`,
      [ctx.siteId, requestId]
    )
    if (prev.rows[0]) return { disposition: "replay", result: prev.rows[0].result, rejectCode: prev.rows[0].rejectCode }
  }
  const order = await readOrderPallets(ctx.client, ctx.siteId, visit.wmsDocumentId)
  if (!order.available) {
    bad("в WMS нет справочника палет этого заказа", order.gap || "wms_pallet_api_missing", 409)
  }
  const acceptedRows = await ctx.client.query<{ code: string }>(
    `SELECT code FROM yms_pallet_scans
     WHERE site_id = $1 AND visit_id = $2::bigint AND result = 'accepted'`,
    [ctx.siteId, visitId]
  )
  const code = normalizeScanCode(str(ctx.body.code))
  const elsewhere = await ctx.client.query(
    `SELECT 1
     FROM yms_pallet_scans s
     JOIN yms_visits v ON v.visit_id = s.visit_id
     WHERE s.site_id = $1 AND s.code = $2 AND s.result = 'accepted'
       AND s.visit_id <> $3::bigint
       AND v.status NOT IN ('cancelled', 'entry_denied', 'no_show', 'departed')
     LIMIT 1`,
    [ctx.siteId, code, visitId]
  )
  const decision = decidePalletScan({
    code,
    pallets: order.pallets,
    acceptedCodes: [...acceptedRows.rows.map((row) => row.code), ...order.wmsScanCodes],
    acceptedElsewhere: Boolean(elsewhere.rowCount),
  })
  const mark = str(ctx.body.mark)
  if (decision.ok && mark === "damage") {
    await ctx.client.query(
      `INSERT INTO yms_pallet_scans (
         site_id, visit_id, code, load_unit_id, qty, result, reject_code, actor_login, client_request_id
       ) VALUES ($1,$2::bigint,$3,$4::bigint,0,'rejected','damage',$5,$6)`,
      [ctx.siteId, visitId, code, decision.loadUnitId, actorLogin(ctx.actor), requestId]
    )
    await ctx.client.query(
      `INSERT INTO yms_visit_discrepancies (site_id, visit_id, kind, qty, note, actor_login)
       VALUES ($1,$2::bigint,'damage',1,$3,$4)`,
      [ctx.siteId, visitId, `Повреждение ${code}`, actorLogin(ctx.actor)]
    )
    return { disposition: "rejected", result: "rejected", rejectCode: "damage" }
  }
  if (!decision.ok) {
    await ctx.client.query(
      `INSERT INTO yms_pallet_scans (
         site_id, visit_id, code, qty, result, reject_code, actor_login, client_request_id
       ) VALUES ($1,$2::bigint,$3,0,'rejected',$4,$5,$6)`,
      [ctx.siteId, visitId, code || "EMPTY", decision.code, actorLogin(ctx.actor), requestId]
    )
    bad(decision.message, decision.code, 409)
  }
  await ctx.client.query(
    `INSERT INTO yms_pallet_scans (
       site_id, visit_id, code, load_unit_id, qty, result, actor_login, client_request_id
     ) VALUES ($1,$2::bigint,$3,$4::bigint,$5,'accepted',$6,$7)`,
    [ctx.siteId, visitId, code, decision.loadUnitId, decision.qty, actorLogin(ctx.actor), requestId]
  )
  await ctx.client.query(
    `INSERT INTO yms_visit_events (
       site_id, visit_id, from_status, to_status, action, actor_login, payload
     ) VALUES ($1,$2::bigint,$3,$3,'scan',$4,$5::jsonb)`,
    [ctx.siteId, visitId, visit.status, actorLogin(ctx.actor), JSON.stringify({ code })]
  )
  return { disposition: "accepted", result: "accepted", code, qty: decision.qty }
}

const JOB_STATUSES = new Set(["queued", "active", "carrying", "waiting", "done", "cancelled"])

export async function listFleetForSite(ctx: YmsCtx) {
  const fleet = await readFleetUnits(ctx.siteId)
  const jobs = await ctx.client.query(
    `SELECT job_id::text AS "jobId", visit_id::text AS "visitId",
            dock_object_id::text AS "dockObjectId", fleet_unit_id AS "fleetUnitId",
            fleet_driver_id AS "fleetDriverId", status, carrying_code AS "carryingCode"
     FROM yms_dock_jobs
     WHERE site_id = $1 AND status NOT IN ('done', 'cancelled')
     ORDER BY job_id DESC
     LIMIT 80`,
    [ctx.siteId]
  )
  return { fleet, jobs: jobs.rows }
}

export async function assignDockJob(ctx: YmsCtx, visitId: string) {
  if (!grantsAllow(ctx.roleCodes, "yms.warehouse.confirm") && !grantsAllow(ctx.roleCodes, "yms.assign")) {
    bad("недостаточно прав", "permission_denied", 403)
  }
  const visit = await visitRow(ctx.client, ctx.siteId, visitId)
  if (!visit) bad("визит не найден", "visit_not_found", 404)
  if (!visit.dockObjectId) bad("сначала назначьте док", "dock_required", 409)
  const fleet = await readFleetUnits(ctx.siteId)
  if (!fleet.available) bad(fleet.reason, "fleet_unavailable", 409)
  const unitId = str(ctx.body.fleetUnitId)
  const unit = fleet.units.find((row) => row.id === unitId)
  if (!unit) bad("такого погрузчика нет во флоте WMS", "fleet_unit_missing", 404)
  if (!unit.enabled) bad("погрузчик недоступен", "fleet_unit_disabled", 409)
  const busy = await ctx.client.query(
    `SELECT 1 FROM yms_dock_jobs
     WHERE site_id = $1 AND fleet_unit_id = $2 AND status IN ('queued', 'active', 'carrying')
     LIMIT 1`,
    [ctx.siteId, unitId]
  )
  if (busy.rowCount) bad("погрузчик уже на задании", "fleet_unit_busy", 409)
  const ins = await ctx.client.query<{ jobId: string }>(
    `INSERT INTO yms_dock_jobs (
       site_id, visit_id, dock_object_id, fleet_unit_id, fleet_driver_id, status, note
     ) VALUES ($1,$2::bigint,$3::bigint,$4,$5,'queued',$6)
     RETURNING job_id::text AS "jobId"`,
    [ctx.siteId, visitId, visit.dockObjectId, unit.id, unit.driverId, str(ctx.body.note) || null]
  )
  return { jobId: ins.rows[0].jobId, unit }
}

export async function setDockJobStatus(ctx: YmsCtx, jobId: string) {
  if (!grantsAllow(ctx.roleCodes, "yms.warehouse.confirm") && !grantsAllow(ctx.roleCodes, "yms.assign")) {
    bad("недостаточно прав", "permission_denied", 403)
  }
  const status = str(ctx.body.status)
  if (!JOB_STATUSES.has(status)) bad("неизвестный статус задания", "bad_job")
  let carrying = str(ctx.body.carryingCode) || null
  if (status === "carrying") {
    if (!carrying) bad("для палеты на вилах нужен код из скана", "carrying_code_required")
    const known = await ctx.client.query(
      `SELECT 1 FROM yms_pallet_scans s
       JOIN yms_dock_jobs j ON j.visit_id = s.visit_id AND j.site_id = s.site_id
       WHERE j.site_id = $1 AND j.job_id = $2::bigint AND s.code = $3 AND s.result = 'accepted'
       LIMIT 1`,
      [ctx.siteId, jobId, normalizeScanCode(carrying)]
    )
    if (!known.rowCount) bad("палета на вилах не подтверждена сканом этого визита", "carrying_unconfirmed", 409)
    carrying = normalizeScanCode(carrying)
  } else {
    carrying = null
  }
  const r = await ctx.client.query(
    `UPDATE yms_dock_jobs SET status = $3, carrying_code = $4, updated_at = now()
     WHERE site_id = $1 AND job_id = $2::bigint
     RETURNING job_id::text AS "jobId"`,
    [ctx.siteId, jobId, status, carrying]
  )
  if (!r.rowCount) bad("задание не найдено", "job_not_found", 404)
  return { jobId }
}

export async function changeTractor(ctx: YmsCtx, visitId: string) {
  if (!grantsAllow(ctx.roleCodes, "yms.visit.write") && !grantsAllow(ctx.roleCodes, "yms.gate.confirm")) {
    bad("недостаточно прав", "permission_denied", 403)
  }
  const plate = str(ctx.body.plate).toUpperCase().replace(/\s+/g, "")
  if (plate.length < 4) bad("укажите госномер тягача", "bad_plate")
  const visit = await visitRow(ctx.client, ctx.siteId, visitId)
  if (!visit) bad("визит не найден", "visit_not_found", 404)
  if (["departed", "cancelled", "entry_denied", "no_show"].includes(visit.status)) {
    bad("визит уже закрыт", "bad_status", 409)
  }
  const vehicle = await ctx.client.query<{ vehicleId: string }>(
    `INSERT INTO yms_vehicles (site_id, plate, vehicle_type, unit_role, updated_at)
     VALUES ($1,$2,'tent','tractor', now())
     ON CONFLICT (site_id, plate) DO UPDATE SET
       unit_role = 'tractor',
       updated_at = now()
     RETURNING vehicle_id::text AS "vehicleId"`,
    [ctx.siteId, plate]
  )
  await ctx.client.query(
    `UPDATE yms_visits SET vehicle_id = $3::bigint, updated_at = now()
     WHERE site_id = $1 AND visit_id = $2::bigint`,
    [ctx.siteId, visitId, vehicle.rows[0].vehicleId]
  )
  return { vehicleId: vehicle.rows[0].vehicleId }
}

export async function setTrailer(ctx: YmsCtx, visitId: string) {
  if (!grantsAllow(ctx.roleCodes, "yms.visit.write") && !grantsAllow(ctx.roleCodes, "yms.gate.confirm")) {
    bad("недостаточно прав", "permission_denied", 403)
  }
  const visit = await visitRow(ctx.client, ctx.siteId, visitId)
  if (!visit) bad("визит не найден", "visit_not_found", 404)
  const plate = str(ctx.body.trailerPlate).toUpperCase().replace(/\s+/g, "")
  if (!plate) {
    await ctx.client.query(
      `UPDATE yms_visits SET trailer_plate = NULL, trailer_vehicle_id = NULL, updated_at = now()
       WHERE site_id = $1 AND visit_id = $2::bigint`,
      [ctx.siteId, visitId]
    )
    return { trailerVehicleId: null }
  }
  const trailer = await ctx.client.query<{ vehicleId: string }>(
    `INSERT INTO yms_vehicles (site_id, plate, vehicle_type, unit_role, updated_at)
     VALUES ($1,$2,'tent','trailer', now())
     ON CONFLICT (site_id, plate) DO UPDATE SET updated_at = now()
     RETURNING vehicle_id::text AS "vehicleId"`,
    [ctx.siteId, plate]
  )
  await ctx.client.query(
    `UPDATE yms_visits SET trailer_plate = $3, trailer_vehicle_id = $4::bigint, updated_at = now()
     WHERE site_id = $1 AND visit_id = $2::bigint`,
    [ctx.siteId, visitId, plate, trailer.rows[0].vehicleId]
  )
  return { trailerVehicleId: trailer.rows[0].vehicleId }
}

export async function readinessForFinish(
  client: PoolClient,
  siteId: number,
  visit: { visitId: string; operation: "INBOUND" | "OUTBOUND" | "CROSS_DOCK" | "RETURN"; wmsDocumentId: string | null }
) {
  const disc = await client.query(
    `SELECT 1 FROM yms_visit_discrepancies
     WHERE site_id = $1 AND visit_id = $2::bigint AND acknowledged LIMIT 1`,
    [siteId, visit.visitId]
  )
  let plannedQty = 0
  let confirmedQty = 0
  let plannedPallets = 0
  let loadedPallets = 0
  if (visit.wmsDocumentId) {
    const qty = await client.query<{ plannedQty: number; confirmedQty: number }>(
      `SELECT COALESCE(SUM(dl.requested_qty), 0)::float AS "plannedQty",
              COALESCE(SUM(dl.confirmed_qty), 0)::float AS "confirmedQty"
       FROM wms_documents d
       LEFT JOIN wms_document_lines dl ON dl.document_id = d.document_id
       WHERE d.site_id = $1 AND d.document_id = $2::bigint`,
      [siteId, visit.wmsDocumentId]
    )
    plannedQty = Number(qty.rows[0]?.plannedQty) || 0
    confirmedQty = Number(qty.rows[0]?.confirmedQty) || 0
    const pallets = await readOrderPallets(client, siteId, visit.wmsDocumentId)
    plannedPallets = pallets.pallets.length
    const accepted = await client.query<{ code: string }>(
      `SELECT code FROM yms_pallet_scans
       WHERE site_id = $1 AND visit_id = $2::bigint AND result = 'accepted'`,
      [siteId, visit.visitId]
    )
    const codes = new Set([
      ...accepted.rows.map((row) => normalizeScanCode(row.code)),
      ...pallets.wmsScanCodes.map(normalizeScanCode),
    ])
    loadedPallets = [...codes].filter((code) =>
      plannedPallets === 0 ? true : pallets.pallets.some((row) => normalizeScanCode(row.code) === code) || accepted.rows.some((row) => normalizeScanCode(row.code) === code)
    ).length
  }
  return canFinishOperation(visit.operation, {
    hasDocument: Boolean(visit.wmsDocumentId),
    plannedQty,
    confirmedQty,
    plannedPallets,
    loadedPallets,
    acknowledgedDiscrepancy: Boolean(disc.rowCount),
  })
}

export async function publicDriverCard(client: PoolClient, token: string) {
  const hash = hashDriverToken(token)
  const r = await client.query<{
    visitNo: string
    plate: string
    trailerPlate: string | null
    driverName: string | null
    status: string
    operation: string
    parkingCode: string | null
    dockCode: string | null
  }>(
    `SELECT v.visit_no AS "visitNo", veh.plate, v.trailer_plate AS "trailerPlate",
            v.driver_name AS "driverName", v.status, v.operation,
            pk.code AS "parkingCode", dk.code AS "dockCode"
     FROM yms_visits v
     JOIN yms_vehicles veh ON veh.vehicle_id = v.vehicle_id
     LEFT JOIN yms_yard_objects pk ON pk.object_id = v.parking_object_id
     LEFT JOIN yms_yard_objects dk ON dk.object_id = v.dock_object_id
     WHERE v.driver_token_hash = $1
     LIMIT 1`,
    [hash]
  )
  const visit = r.rows[0]
  if (!visit) return null
  const call = await client.query<{
    message: string
    sentAt: string
    deliveredAt: string | null
    acknowledgedAt: string | null
  }>(
    `SELECT c.message, c.sent_at AS "sentAt", c.delivered_at AS "deliveredAt", c.acknowledged_at AS "acknowledgedAt"
     FROM yms_driver_calls c
     JOIN yms_visits v ON v.visit_id = c.visit_id
     WHERE v.driver_token_hash = $1
     ORDER BY c.call_id DESC
     LIMIT 1`,
    [hash]
  )
  return { visit, call: call.rows[0] ?? null }
}

export async function acknowledgeDriverCall(client: PoolClient, token: string) {
  const hash = hashDriverToken(token)
  const r = await client.query(
    `UPDATE yms_driver_calls c SET acknowledged_at = now()
     FROM yms_visits v
     WHERE v.visit_id = c.visit_id AND v.driver_token_hash = $1 AND c.acknowledged_at IS NULL
       AND c.call_id = (
         SELECT call_id FROM yms_driver_calls c2
         JOIN yms_visits v2 ON v2.visit_id = c2.visit_id
         WHERE v2.driver_token_hash = $1
         ORDER BY c2.call_id DESC LIMIT 1
       )`,
    [hash]
  )
  return { acknowledged: Boolean(r.rowCount) }
}
