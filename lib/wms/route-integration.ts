/**
 * Интеграционный слой WMS для SCADA System Route (навигатор погрузчика, yms.scadasystem.io).
 *
 * WMS остаётся источником истины по палетам, адресам и остаткам. Route не пишет в таблицы WMS —
 * он вызывает эти функции через /api/wms/route/* с сервисным токеном пользователя WMS.
 *
 *  - checkRoutePallet   — палета по SSCC (AI 00) или HU: площадка, адрес, карантин, резерв, пересорт;
 *  - checkRouteAddress  — адрес хранения: активен, карантин, вместимость, резервы, правила размещения;
 *  - moveRoutePallet    — перемещение палеты (палета + вложенные коды) в новый адрес, идемпотентно
 *                         по requestId (wms_request_log), с записью в журнал движений;
 *  - recommendRouteAddress — альтернативный адрес по правилам размещения ГП;
 *  - pull/releaseRouteDemand — передача открытых заданий WMS по палетам ГП в Route.
 */
import type { PoolClient } from "pg"
import { WmsHttpError } from "@/lib/wms/errors"
import { logWmsOperationEvent } from "@/lib/wms/operation-events"
import { applyStockTransfer } from "@/lib/wms/stock-ledger"
import { canonicalPlanRowId, normalizePlanRowId } from "@/lib/wms/fg-plan-location-codes"

export type RouteProblem = { code: string; message: string }

const GS = "\u001d"

/** Код палеты: ]C1(00)123… / 00123… → { full: "00"+18 цифр, sscc18 } или HU как есть. */
export function parseRoutePalletCode(raw: string): { full: string; sscc18: string | null } {
  let v = (raw ?? "").trim().replace(/^\][A-Za-z]\d/, "").split(GS).join("").replace(/\s+/g, "")
  v = v.replace(/^\(00\)/, "00")
  const m = v.match(/^00(\d{18})$/)
  if (m) return { full: `00${m[1]}`, sscc18: m[1] }
  return { full: v.toUpperCase(), sscc18: null }
}

export function normalizeRouteLocation(raw: string | null | undefined): string {
  const v = (raw ?? "").trim().toUpperCase().replace(/\s+/g, "")
  if (!v) return ""
  if (v.startsWith("FG-")) return v
  return /^[A-ZА-ЯЁ]-\d+/.test(v) ? `FG-${v}` : v
}

type PalletRow = {
  palletId: string
  gtin: string | null
  serial: string | null
  raw: string | null
  itemId: string
  itemCode: string
  itemName: string
  siteId: number | null
  locationId: string | null
  locationCode: string | null
  locationStatusId: number | null
  unlinkedAt: string | null
  lotCode: string | null
  expiryAt: string | null
  lotBlocked: boolean | null
}

async function findPallet(client: PoolClient, code: string): Promise<PalletRow | null> {
  const p = parseRoutePalletCode(code)
  const r = await client.query<PalletRow>(
    `SELECT c.code_id::text AS "palletId", c.ai01_gtin AS gtin, c.ai21_serial AS serial,
            encode(c.raw, 'escape') AS raw,
            mic.item_id::text AS "itemId", i.item_code AS "itemCode", i.name AS "itemName",
            mic.current_site_id AS "siteId", mic.current_location_id::text AS "locationId",
            l.location_code AS "locationCode", l.location_status_id AS "locationStatusId",
            mic.unlinked_at::text AS "unlinkedAt",
            wl.lot_code AS "lotCode", COALESCE(wl.expiry_at, wl.best_before_at)::text AS "expiryAt",
            wl.is_blocked AS "lotBlocked"
     FROM codes c
     JOIN wms_item_codes mic ON mic.code_id = c.code_id
     JOIN wms_items i ON i.item_id = mic.item_id
     LEFT JOIN wms_locations l ON l.location_id = mic.current_location_id
     LEFT JOIN wms_lots wl ON wl.lot_id = c.lot_id
     WHERE (c.ai01_gtin LIKE '00%' OR COALESCE(mic.pack_level, '') = 'pallet')
       AND (
         ($2::text IS NOT NULL AND c.ai21_serial = $2)
         OR c.ai01_gtin || COALESCE(c.ai21_serial, '') = $1
         OR encode(c.raw, 'escape') = $1
         OR c.ai21_serial = $1
       )
     ORDER BY (mic.unlinked_at IS NULL) DESC, mic.linked_at DESC NULLS LAST
     LIMIT 1`,
    [p.full, p.sscc18]
  )
  return r.rows[0] ?? null
}

async function unitCount(client: PoolClient, palletId: string): Promise<number> {
  const r = await client.query<{ n: string }>(
    `WITH RECURSIVE tree AS (
       SELECT code_id, 0 AS depth FROM codes WHERE code_id = $1::bigint
       UNION ALL
       SELECT c.code_id, t.depth + 1 FROM codes c JOIN tree t ON c.parent_code_id = t.code_id WHERE t.depth < 4
     )
     SELECT count(*)::text AS n FROM tree t
     WHERE t.depth > 0 AND NOT EXISTS (SELECT 1 FROM codes x WHERE x.parent_code_id = t.code_id)`,
    [palletId]
  )
  return Number(r.rows[0]?.n || 0)
}

/** Таблицы модулей ГП создаются лениво — проверяем наличие, чтобы не обрушить транзакцию ошибкой. */
async function hasTable(client: PoolClient, name: string): Promise<boolean> {
  const r = await client.query<{ ok: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS ok`, [name])
  return Boolean(r.rows[0]?.ok)
}

async function reservationOf(client: PoolClient, siteId: number, keys: string[]): Promise<string | null> {
  if (!(await hasTable(client, "wms_fg_placement_reservations"))) return null
  {
    const r = await client.query<{ task_id: string }>(
      `SELECT task_id FROM wms_fg_placement_reservations WHERE site_id = $1 AND lpn = ANY($2::text[]) LIMIT 1`,
      [siteId, keys.filter(Boolean)]
    )
    return r.rows[0]?.task_id ?? null
  }
}

async function resortOpen(client: PoolClient, siteId: number, palletId: string, keys: string[]): Promise<boolean> {
  if (!(await hasTable(client, "wms_fg_resort_jobs"))) return false
  {
    const r = await client.query(
      `SELECT 1 FROM wms_fg_resort_jobs
       WHERE site_id = $1 AND status IN ('open', 'in_progress')
         AND (pallet_code_id = $2::bigint OR pallet_code = ANY($3::text[]))
       LIMIT 1`,
      [siteId, palletId, keys.filter(Boolean)]
    )
    return Boolean(r.rowCount)
  }
}

export type RoutePalletCheck = {
  found: boolean
  pallet: {
    palletId: string
    code: string
    sscc: string | null
    itemCode: string | null
    itemName: string | null
    lotCode: string | null
    qty: number | null
    expiryAt: string | null
    locationCode: string | null
    locationStatus: "active" | "quarantine" | "blocked" | null
    reservedTaskRef: string | null
    resortOpen: boolean
    status: string
  } | null
  problems: RouteProblem[]
}

export async function checkRoutePallet(client: PoolClient, siteId: number, code: string, taskRef?: string | null): Promise<RoutePalletCheck> {
  const row = await findPallet(client, code)
  if (!row) {
    const hu = parseRoutePalletCode(code).full
    if (await hasTable(client, "wms_load_units")) {
      const lu = await client.query<{ code: string; site_id: number }>(
        `SELECT load_unit_code AS code, site_id FROM wms_load_units WHERE upper(load_unit_code) = $1 LIMIT 1`,
        [hu]
      )
      if (lu.rows[0]) {
        return {
          found: false,
          pallet: null,
          problems: [{ code: "hu_without_codes", message: "HU есть в WMS, но к нему не привязаны коды палеты — перемещение по Route невозможно" }],
        }
      }
    }
    return { found: false, pallet: null, problems: [{ code: "pallet_not_found", message: "Палета не найдена в WMS" }] }
  }
  const full = row.gtin && row.gtin.startsWith("00") && row.serial && /^\d{18}$/.test(row.serial) ? `00${row.serial}` : `${row.gtin ?? ""}${row.serial ?? ""}` || row.raw || code
  const keys = [full, `${row.gtin ?? ""}${row.serial ?? ""}`, row.serial ?? "", row.palletId]
  const problems: RouteProblem[] = []
  if (row.unlinkedAt) problems.push({ code: "pallet_unlinked", message: "Палета списана/отвязана в WMS" })
  if (row.siteId !== siteId) problems.push({ code: "pallet_other_site", message: "Палета числится на другой площадке" })
  // location_status_id = 2 в WMS — адрес заблокирован/карантин (см. issue-stock, finished-goods-warehouse)
  const status = row.locationStatusId === 2 ? "quarantine" : row.locationId ? "active" : null
  if (status === "quarantine" || row.lotBlocked) problems.push({ code: "pallet_quarantine", message: "Палета или партия в карантине" })
  const reserved = await reservationOf(client, siteId, keys)
  if (reserved && taskRef && reserved !== taskRef) {
    problems.push({ code: "pallet_locked", message: `Палета зарезервирована операцией ${reserved}` })
  }
  const resort = await resortOpen(client, siteId, row.palletId, keys)
  if (resort) problems.push({ code: "pallet_resort", message: "Палета отправлена на пересорт" })
  return {
    found: true,
    pallet: {
      palletId: row.palletId,
      code: full,
      sscc: full.startsWith("00") && full.length === 20 ? full : null,
      itemCode: row.itemCode,
      itemName: row.itemName,
      lotCode: row.lotCode,
      qty: await unitCount(client, row.palletId),
      expiryAt: row.expiryAt,
      locationCode: row.locationCode,
      locationStatus: status,
      reservedTaskRef: reserved,
      resortOpen: resort,
      status: row.unlinkedAt ? "unlinked" : "stored",
    },
    problems,
  }
}

type LocationRow = {
  locationId: string
  locationCode: string
  statusId: number | null
  attrs: Record<string, unknown> | null
}

async function findLocation(client: PoolClient, siteId: number, code: string): Promise<LocationRow | null> {
  const want = normalizeRouteLocation(code)
  const r = await client.query<LocationRow>(
    `SELECT location_id::text AS "locationId", location_code AS "locationCode", location_status_id AS "statusId",
            location_attrs_json AS attrs
     FROM wms_locations WHERE site_id = $1 AND upper(location_code) = $2 LIMIT 1`,
    [siteId, want]
  )
  return r.rows[0] ?? null
}

async function palletsAt(client: PoolClient, siteId: number, locationId: string): Promise<number> {
  const r = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM wms_item_codes mic JOIN codes c ON c.code_id = mic.code_id
     WHERE mic.current_site_id = $1 AND mic.current_location_id = $2::bigint AND mic.unlinked_at IS NULL
       AND (c.ai01_gtin LIKE '00%' OR COALESCE(mic.pack_level, '') = 'pallet')`,
    [siteId, locationId]
  )
  return Number(r.rows[0]?.n || 0)
}

async function reservedAt(client: PoolClient, siteId: number, locationCode: string): Promise<string[]> {
  if (!(await hasTable(client, "wms_tasks"))) return []
  {
    const r = await client.query<{ ref: string }>(
      `SELECT DISTINCT COALESCE(task_payload->>'routeTaskRef', task_code) AS ref
       FROM wms_tasks t JOIN wms_locations l ON l.location_id = t.target_location_id
       WHERE t.site_id = $1 AND upper(l.location_code) = $2 AND t.task_status_id IN (1, 2, 3)`,
      [siteId, normalizeRouteLocation(locationCode)]
    )
    return r.rows.map((x) => x.ref).filter(Boolean)
  }
}

export type RouteAddressCheck = {
  found: boolean
  address: {
    locationCode: string
    locationId: string
    active: boolean
    quarantine: boolean
    isFgRow: boolean
    capacity: number | null
    occupied: number
    free: number | null
    reservedBy: string[]
  } | null
  problems: RouteProblem[]
  placement: { ok: boolean; reason: string } | null
}

export async function checkRouteAddress(
  client: PoolClient,
  siteId: number,
  locationCode: string,
  palletCode?: string | null,
  taskRef?: string | null
): Promise<RouteAddressCheck> {
  const loc = await findLocation(client, siteId, locationCode)
  if (!loc) return { found: false, address: null, problems: [{ code: "address_not_found", message: "Адрес не найден в WMS" }], placement: null }
  const attrs = loc.attrs ?? {}
  const isFgRow = attrs.fgRow === true || /^FG-/i.test(loc.locationCode)
  const capRaw = Number((attrs.planCapacity as number) ?? (attrs.slotProfile as { capacityUnits?: number } | undefined)?.capacityUnits)
  const capacity = Number.isFinite(capRaw) && capRaw > 0 ? capRaw : null
  const occupied = await palletsAt(client, siteId, loc.locationId)
  const reservedBy = (await reservedAt(client, siteId, loc.locationCode)).filter((r) => r !== taskRef)
  const problems: RouteProblem[] = []
  let placement: RouteAddressCheck["placement"] = null
  if (palletCode && isFgRow) {
    const pallet = await findPallet(client, palletCode)
    if (pallet) {
      // Правила размещения ГП: ошибка модуля правил не должна обрушить транзакцию перемещения.
      let inTx = true
      await client.query("SAVEPOINT route_placement").catch(() => {
        inTx = false
      })
      try {
        const { checkPlacement } = await import("@/lib/wms/fg-placement")
        const planRowId = canonicalPlanRowId(normalizePlanRowId(loc.locationCode)) || normalizePlanRowId(loc.locationCode)
        const res = await checkPlacement(client, siteId, { query: pallet.itemCode, planRowId, lotCode: pallet.lotCode ?? undefined })
        placement = { ok: res.ok, reason: res.reason }
        if (inTx) await client.query("RELEASE SAVEPOINT route_placement")
      } catch (error) {
        if (inTx) await client.query("ROLLBACK TO SAVEPOINT route_placement").catch(() => undefined)
        placement = { ok: true, reason: `правила размещения не проверены: ${(error as Error).message}` }
      }
    }
  }
  return {
    found: true,
    address: {
      locationCode: loc.locationCode,
      locationId: loc.locationId,
      active: attrs.isActive !== false,
      quarantine: loc.statusId === 2,
      isFgRow,
      capacity,
      occupied,
      free: capacity != null ? Math.max(0, capacity - occupied) : null,
      reservedBy,
    },
    problems,
    placement,
  }
}

export type RouteMoveInput = {
  requestId: string
  palletCode: string
  fromLocationCode: string | null
  toLocationCode: string
  taskRef: string
  actorLogin: string
  actorUserId: string | null
  wmsRef?: { kind: string; id: string } | null
}

/**
 * Перемещение палеты. Вызывается внутри runIdempotentWrite (одна транзакция + запись в wms_request_log).
 * Отказ — WmsHttpError (409/422): Route не покажет успешного завершения.
 */
export async function moveRoutePallet(client: PoolClient, siteId: number, input: RouteMoveInput) {
  const pallet = await findPallet(client, input.palletCode)
  if (!pallet) throw new WmsHttpError(404, "Палета не найдена в WMS", "pallet_not_found")
  await client.query(`SELECT 1 FROM wms_item_codes WHERE code_id = $1::bigint FOR UPDATE`, [pallet.palletId])
  const fresh = await findPallet(client, input.palletCode)
  if (!fresh || fresh.unlinkedAt) throw new WmsHttpError(409, "Палета списана/отвязана в WMS", "pallet_unlinked")
  if (fresh.siteId !== siteId) throw new WmsHttpError(409, "Палета числится на другой площадке", "pallet_other_site")
  if (fresh.locationStatusId === 2 || fresh.lotBlocked) throw new WmsHttpError(409, "Палета в карантине", "pallet_quarantine")
  const from = input.fromLocationCode ? normalizeRouteLocation(input.fromLocationCode) : null
  const at = normalizeRouteLocation(fresh.locationCode)
  const to = normalizeRouteLocation(input.toLocationCode)
  if (at && at === to) throw new WmsHttpError(409, `Палета уже в ${fresh.locationCode} — повторное перемещение отклонено`, "pallet_moved")
  if (from && at !== from) {
    throw new WmsHttpError(409, `Палета уже перемещена: по WMS она в ${fresh.locationCode || "без адреса"}, а не в ${from}`, "pallet_moved")
  }
  const keys = [parseRoutePalletCode(input.palletCode).full, `${fresh.gtin ?? ""}${fresh.serial ?? ""}`, fresh.serial ?? "", fresh.palletId]
  const reserved = await reservationOf(client, siteId, keys)
  if (reserved && reserved !== input.taskRef) throw new WmsHttpError(409, `Палета зарезервирована операцией ${reserved}`, "pallet_locked")
  if (await resortOpen(client, siteId, fresh.palletId, keys)) throw new WmsHttpError(409, "Палета на пересорте", "pallet_resort")

  const target = await findLocation(client, siteId, to)
  if (!target) throw new WmsHttpError(404, `Адрес ${to} не найден в WMS`, "address_not_found")
  await client.query(`SELECT 1 FROM wms_locations WHERE location_id = $1::bigint FOR UPDATE`, [target.locationId])
  const check = await checkRouteAddress(client, siteId, to, input.palletCode, input.taskRef)
  const a = check.address!
  if (!a.active) throw new WmsHttpError(409, `Адрес ${to} отключён`, "address_inactive")
  if (a.quarantine) throw new WmsHttpError(409, `Адрес ${to} в карантине`, "address_quarantine")
  if (a.free != null && a.free <= 0) throw new WmsHttpError(409, `В ${to} нет свободного места`, "address_full")
  if (a.reservedBy.length && a.free != null && a.free <= a.reservedBy.length) {
    throw new WmsHttpError(409, `Место в ${to} зарезервировано: ${a.reservedBy.join(", ")}`, "address_reserved")
  }
  if (check.placement && !check.placement.ok) throw new WmsHttpError(422, check.placement.reason, "placement_rule")

  // Палета и все вложенные коды (короба, единицы) — в новый адрес.
  const moved = await client.query(
    `WITH RECURSIVE tree AS (
       SELECT code_id, 0 AS depth FROM codes WHERE code_id = $1::bigint
       UNION ALL
       SELECT c.code_id, t.depth + 1 FROM codes c JOIN tree t ON c.parent_code_id = t.code_id WHERE t.depth < 4
     )
     UPDATE wms_item_codes mic SET current_location_id = $2::bigint
     FROM tree WHERE mic.code_id = tree.code_id AND mic.current_site_id = $3 AND mic.unlinked_at IS NULL`,
    [fresh.palletId, target.locationId, siteId]
  )

  // Остатки: если по исходному адресу ведётся баланс номенклатуры — переносим количество единиц.
  let ledger = "codes_only"
  const qty = await unitCount(client, fresh.palletId)
  if (fresh.locationId && qty > 0) {
    const bal = await client.query<{ available_qty: string }>(
      `SELECT available_qty::text FROM wms_stock_balances WHERE site_id = $1 AND location_id = $2::bigint AND item_id = $3::bigint`,
      [siteId, fresh.locationId, fresh.itemId]
    )
    if (bal.rows[0] && Number(bal.rows[0].available_qty) + 1e-9 >= qty) {
      await applyStockTransfer(client, {
        siteId,
        itemId: fresh.itemId,
        fromLocationId: fresh.locationId,
        toLocationId: target.locationId,
        qty,
        lotCode: fresh.lotCode,
        requestId: input.requestId,
        actorUserId: input.actorUserId,
        eventType: "stock.transfer.route",
        payload: { palletCode: input.palletCode, taskRef: input.taskRef, source: "scada-route" },
      })
      ledger = "stock_transfer"
    }
  }

  if (await hasTable(client, "wms_fg_placement_reservations")) {
    await client.query(`DELETE FROM wms_fg_placement_reservations WHERE site_id = $1 AND lpn = ANY($2::text[])`, [siteId, keys.filter(Boolean)])
  }

  if (input.wmsRef?.kind === "wms_task" && /^\d+$/.test(input.wmsRef.id)) {
    await client.query(
      `UPDATE wms_tasks SET task_status_id = 4, confirmed_qty = planned_qty, completed_at = now(), updated_at = now(),
              task_payload = COALESCE(task_payload, '{}'::jsonb) || jsonb_build_object('routeTaskRef', $3::text, 'routeMovementId', $4::text)
       WHERE site_id = $1 AND task_id = $2::bigint AND task_status_id IN (1, 2, 3)`,
      [siteId, input.wmsRef.id, input.taskRef, input.requestId]
    )
  }

  await logWmsOperationEvent(client, {
    siteId,
    eventType: "route.pallet.moved",
    actorUserId: input.actorUserId,
    itemId: fresh.itemId,
    locationId: target.locationId,
    codeValue: keys[0],
    payload: {
      from: fresh.locationCode,
      to: target.locationCode,
      taskRef: input.taskRef,
      requestId: input.requestId,
      actorLogin: input.actorLogin,
      movedCodes: moved.rowCount ?? 0,
      ledger,
      wmsRef: input.wmsRef ?? null,
    },
  })

  return {
    movementId: input.requestId,
    palletCode: keys[0],
    fromLocationCode: fresh.locationCode,
    toLocationCode: target.locationCode,
    movedCodes: moved.rowCount ?? 0,
    ledger,
    at: new Date().toISOString(),
  }
}

export async function recommendRouteAddress(client: PoolClient, siteId: number, palletCode: string, exclude: string[]) {
  const pallet = await findPallet(client, palletCode)
  if (!pallet) throw new WmsHttpError(404, "Палета не найдена в WMS", "pallet_not_found")
  const { recommendPlacement } = await import("@/lib/wms/fg-placement")
  const rec = await recommendPlacement(client, siteId, { query: pallet.itemCode, itemCode: pallet.itemCode, lotCode: pallet.lotCode ?? undefined, limit: 12 })
  const skip = new Set(exclude.map(normalizeRouteLocation))
  const pick = [rec.recommended, ...rec.alternatives].find(
    (c) => c && c.locationId !== "cross-dock" && !skip.has(normalizeRouteLocation(c.locationCode))
  )
  if (!pick) throw new WmsHttpError(409, "Нет подходящего свободного адреса по правилам размещения", "no_address")
  return { locationCode: pick.locationCode, reason: (pick.reasons || []).join("; ") }
}

const ROUTE_TYPES: Record<number, string> = { 2: "putaway", 3: "replenishment", 4: "internal_transfer", 7: "return_from_line", 9: "pick", 10: "ship" }

/** Передать Route открытые задания WMS по палетам ГП. Задание помечается routeClaim и переходит в claimed. */
export async function pullRouteDemand(client: PoolClient, siteId: number, limit: number) {
  const r = await client.query<{
    taskId: string
    taskCode: string | null
    typeId: number
    priorityId: number | null
    payload: Record<string, unknown> | null
    src: string | null
    dst: string | null
    lu: string | null
    dueAt: string | null
  }>(
    `SELECT t.task_id::text AS "taskId", t.task_code AS "taskCode", t.task_type_id AS "typeId", t.task_priority_id AS "priorityId",
            t.task_payload AS payload, sl.location_code AS src, tl.location_code AS dst, lu.load_unit_code AS lu, t.due_at::text AS "dueAt"
     FROM wms_tasks t
     LEFT JOIN wms_locations sl ON sl.location_id = t.source_location_id
     LEFT JOIN wms_locations tl ON tl.location_id = t.target_location_id
     LEFT JOIN wms_document_lines dl ON dl.document_line_id = t.document_line_id
     LEFT JOIN wms_load_units lu ON lu.load_unit_id = dl.load_unit_id
     WHERE t.site_id = $1 AND t.task_status_id = 1 AND t.task_type_id = ANY($2::smallint[])
       AND COALESCE(t.task_payload->>'routeClaim', '') = ''
       AND (upper(COALESCE(sl.location_code, '')) LIKE 'FG-%' OR upper(COALESCE(tl.location_code, '')) LIKE 'FG-%')
     ORDER BY t.task_priority_id DESC NULLS LAST, t.due_at NULLS LAST, t.task_id
     LIMIT $3
     FOR UPDATE OF t SKIP LOCKED`,
    [siteId, Object.keys(ROUTE_TYPES).map(Number), Math.min(200, Math.max(1, limit))]
  )
  const items = []
  for (const row of r.rows) {
    const p = row.payload ?? {}
    const pallet = String(p.palletCode || p.sscc || p.lpn || p.huCode || row.lu || "").trim()
    if (!pallet || !row.src) continue
    await client.query(
      `UPDATE wms_tasks SET task_status_id = 2, claimed_at = now(), updated_at = now(),
              task_payload = COALESCE(task_payload, '{}'::jsonb) || jsonb_build_object('routeClaim', 'route', 'routeClaimedAt', now()::text)
       WHERE task_id = $1::bigint`,
      [row.taskId]
    )
    items.push({
      wmsTaskId: row.taskId,
      taskCode: row.taskCode,
      type: ROUTE_TYPES[row.typeId],
      priority: ({ 1: 30, 2: 50, 3: 70, 4: 90 } as Record<number, number>)[row.priorityId ?? 2] ?? 50,
      palletCode: pallet,
      sourceLocationCode: row.src,
      targetLocationCode: row.dst,
      dueAt: row.dueAt,
    })
  }
  return items
}

export async function releaseRouteDemand(client: PoolClient, siteId: number, taskId: string, reason: string) {
  if (!/^\d+$/.test(taskId)) throw new WmsHttpError(400, "некорректный wmsTaskId", "bad_task_id")
  await client.query(
    `UPDATE wms_tasks SET task_status_id = 1, claimed_at = NULL, updated_at = now(),
            task_payload = (COALESCE(task_payload, '{}'::jsonb) - 'routeClaim') || jsonb_build_object('routeRejected', $3::text)
     WHERE site_id = $1 AND task_id = $2::bigint AND task_payload->>'routeClaim' = 'route' AND task_status_id = 2`,
    [siteId, taskId, reason.slice(0, 300)]
  )
}
