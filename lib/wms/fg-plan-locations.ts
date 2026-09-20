import type { PoolClient } from "pg"
import { WmsHttpError } from "@/lib/wms/errors"
import {
  FG_LOCATION_PREFIX,
  FG_WAREHOUSE_CODE,
  FG_WAREHOUSE_NAME,
  FG_WAREHOUSE_TYPE,
  canonicalPlanRowId,
  fgPlanLocationCode,
  isPlanRowId,
  normalizePlanRowId,
  planRowIdFromLocationCode,
} from "@/lib/wms/fg-plan-location-codes"
import { findPlanRow, listPlanRows } from "@/lib/wms/row-identify-rows"
import { resolveLocation } from "@/lib/wms/resolve"
import type { FgPlanRowCatalogItem } from "@/lib/wms/row-identify-types"
import type { RowIdentifySession } from "@/lib/wms/row-identify-types"

export {
  FG_WAREHOUSE_CODE,
  FG_WAREHOUSE_NAME,
  fgPlanLocationCode,
  normalizePlanRowId,
  planRowIdFromLocationCode,
} from "@/lib/wms/fg-plan-location-codes"

export type FgPlanLocationRef = {
  locationId: string
  locationCode: string
  planRowId: string
  zoneCode: string
}

export type FgPlanSyncResult = {
  catalogRows: number
  created: number
  updated: number
  warehouseCode: string
  zones: string[]
}

function planRowAttrs(row: FgPlanRowCatalogItem): Record<string, unknown> {
  return {
    fgRow: true,
    storageModel: "pallet_row",
    planRowId: row.id,
    planZone: row.zone,
    planNumber: String(row.number),
    planGroup: row.group ?? null,
    planCapacity: row.capacity,
    planSections: row.sections,
    slotProfile: {
      physicalAddress: row.id,
      capacityUnits: row.capacity > 0 ? row.capacity : null,
      allowMixedNomenclature: true,
      allowMixedBatches: true,
    },
  }
}

async function ensureFgWarehouse(
  client: PoolClient,
  siteId: number
): Promise<{ warehouseId: string; warehouseCode: string }> {
  const found = await client.query<{ warehouseId: string; warehouseCode: string }>(
    `SELECT warehouse_id::text AS "warehouseId", warehouse_code AS "warehouseCode"
     FROM wms_warehouses
     WHERE site_id = $1
       AND (
         warehouse_code ILIKE 'FG%'
         OR warehouse_type ILIKE '%finish%'
         OR name ILIKE '%готов%'
         OR name ILIKE '%ГП%'
       )
     ORDER BY CASE WHEN warehouse_code = 'FG' THEN 0 ELSE 1 END, warehouse_id
     LIMIT 1`,
    [siteId]
  )
  if (found.rows[0]) return found.rows[0]

  const created = await client.query<{ warehouseId: string; warehouseCode: string }>(
    `INSERT INTO wms_warehouses (
       site_id, warehouse_code, name, warehouse_type, is_active, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, TRUE, now(), now())
     ON CONFLICT (site_id, warehouse_code)
     DO UPDATE SET
       name = EXCLUDED.name,
       warehouse_type = EXCLUDED.warehouse_type,
       is_active = TRUE,
       updated_at = now()
     RETURNING warehouse_id::text AS "warehouseId", warehouse_code AS "warehouseCode"`,
    [siteId, FG_WAREHOUSE_CODE, FG_WAREHOUSE_NAME, FG_WAREHOUSE_TYPE]
  )
  return created.rows[0]!
}

async function ensurePlanZones(
  client: PoolClient,
  warehouseId: string,
  zones: string[]
): Promise<void> {
  const unique = [...new Set(zones.map((z) => z.trim().toUpperCase()).filter(Boolean))]
  if (unique.length === 0) return
  await client.query(
    `INSERT INTO wms_zones (warehouse_id, zone_code, name, is_active, created_at)
     SELECT $1::bigint, z, $3 || z, TRUE, now()
     FROM unnest($2::text[]) AS z
     ON CONFLICT (warehouse_id, zone_code)
     DO UPDATE SET
       name = CASE
         WHEN wms_zones.name ILIKE 'ряды%' THEN wms_zones.name
         ELSE EXCLUDED.name
       END,
       is_active = TRUE`,
    [warehouseId, unique, "Зона "]
  )
}

async function upsertPlanLocations(
  client: PoolClient,
  siteId: number,
  warehouseId: string,
  rows: FgPlanRowCatalogItem[]
): Promise<{ created: number; updated: number }> {
  if (rows.length === 0) return { created: 0, updated: 0 }
  const codes = rows.map((row) => fgPlanLocationCode(row.id))
  const displays = rows.map((row) => row.id)
  const zones = rows.map((row) => row.zone.trim().toUpperCase())
  const attrs = rows.map((row) => JSON.stringify(planRowAttrs(row)))

  const result = await client.query<{ inserted: boolean }>(
    `INSERT INTO wms_locations (
       site_id, warehouse_id, zone_id, location_code, display_name,
       location_status_id, accuracy_status_id, is_pick_face, revision_version,
       location_attrs_json, created_at, updated_at
     )
     SELECT
       $1,
       $2::bigint,
       z.zone_id,
       x.code,
       x.display,
       1,
       1,
       FALSE,
       1,
       x.attrs::jsonb,
       now(),
       now()
     FROM unnest($3::text[], $4::text[], $5::text[], $6::text[])
       AS x(code, display, zone, attrs)
     JOIN wms_zones z
       ON z.warehouse_id = $2::bigint
      AND z.zone_code = x.zone
     ON CONFLICT (site_id, location_code) DO UPDATE SET
       warehouse_id = EXCLUDED.warehouse_id,
       zone_id = EXCLUDED.zone_id,
       display_name = EXCLUDED.display_name,
       location_attrs_json = CASE
         WHEN COALESCE(wms_locations.location_attrs_json, '{}'::jsonb) ? 'slotProfile'
         THEN COALESCE(wms_locations.location_attrs_json, '{}'::jsonb)
           || (EXCLUDED.location_attrs_json - 'slotProfile')
         ELSE COALESCE(wms_locations.location_attrs_json, '{}'::jsonb)
           || EXCLUDED.location_attrs_json
       END,
       updated_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [siteId, warehouseId, codes, displays, zones, attrs]
  )

  let created = 0
  let updated = 0
  for (const row of result.rows) {
    if (row.inserted) created += 1
    else updated += 1
  }
  return { created, updated }
}

export async function syncFgPlanLocations(
  client: PoolClient,
  siteId: number
): Promise<FgPlanSyncResult> {
  const catalog = await listPlanRows()
  if (catalog.length === 0) {
    throw new WmsHttpError(503, "Каталог рядов плана ГП пуст", "fg_plan_catalog_empty")
  }
  const warehouse = await ensureFgWarehouse(client, siteId)
  const zones = [...new Set(catalog.map((row) => row.zone.trim().toUpperCase()).filter(Boolean))]
  await ensurePlanZones(client, warehouse.warehouseId, zones)
  const { created, updated } = await upsertPlanLocations(client, siteId, warehouse.warehouseId, catalog)
  return {
    catalogRows: catalog.length,
    created,
    updated,
    warehouseCode: warehouse.warehouseCode,
    zones,
  }
}

export async function ensureFgPlanRowLocation(
  client: PoolClient,
  siteId: number,
  row: FgPlanRowCatalogItem
): Promise<FgPlanLocationRef> {
  const sync = await syncFgPlanLocations(client, siteId)
  const locationCode = fgPlanLocationCode(row.id)
  const loc = await resolveLocation(client, siteId, locationCode)
  if (!loc) {
    throw new WmsHttpError(
      500,
      `Не удалось создать ячейку ряда ${row.id} (${locationCode})`,
      "fg_plan_location_failed"
    )
  }
  return {
    locationId: loc.location_id,
    locationCode: loc.location_code,
    planRowId: row.id,
    zoneCode: row.zone.trim().toUpperCase() || sync.zones[0] || "",
  }
}

/**
 * Ряд плана (A-1 / FG-A-1) → ячейка склада ГП.
 * Нельзя резолвить голый A-1 через общие ячейки: A-1 уже есть на складе материалов.
 */
export async function resolveOrCreateFgPlanLocation(
  client: PoolClient,
  siteId: number,
  input: string,
  options?: { createIfMissing?: boolean }
): Promise<FgPlanLocationRef> {
  const raw = input.trim()
  if (!raw) {
    throw new WmsHttpError(400, "Не указан ряд плана ГП", "fg_plan_row_required")
  }

  const planId = canonicalPlanRowId(raw) || normalizePlanRowId(raw)
  const plan = (planId && (await findPlanRow(planId))) || (await findPlanRow(raw))
  if (plan) {
    if (options?.createIfMissing === false) {
      const existing = await resolveLocation(client, siteId, fgPlanLocationCode(plan.id))
      if (!existing) {
        throw new WmsHttpError(404, `Ячейка ряда плана ${plan.id} ещё не создана`, "fg_plan_location_missing")
      }
      return {
        locationId: existing.location_id,
        locationCode: existing.location_code,
        planRowId: plan.id,
        zoneCode: plan.zone.trim().toUpperCase(),
      }
    }
    return ensureFgPlanRowLocation(client, siteId, plan)
  }

  const existing = await resolveLocation(client, siteId, raw)
  if (existing) {
    const meta = await client.query<{
      warehouseCode: string
      planRowId: string | null
      fgRow: string | null
    }>(
      `SELECT
         w.warehouse_code AS "warehouseCode",
         l.location_attrs_json->>'planRowId' AS "planRowId",
         l.location_attrs_json->>'fgRow' AS "fgRow"
       FROM wms_locations l
       JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
       WHERE l.location_id = $1::bigint`,
      [existing.location_id]
    )
    const row = meta.rows[0]
    const isFg =
      Boolean(row?.planRowId) ||
      row?.fgRow === "true" ||
      (row?.warehouseCode ?? "").toUpperCase().startsWith("FG") ||
      existing.location_code.toUpperCase().startsWith(FG_LOCATION_PREFIX)
    if (isFg) {
      return {
        locationId: existing.location_id,
        locationCode: existing.location_code,
        planRowId: row?.planRowId || planRowIdFromLocationCode(existing.location_code) || existing.location_code,
        zoneCode: "",
      }
    }
    throw new WmsHttpError(
      400,
      `${raw} — ячейка не склада ГП. Укажите ряд плана (A-1, B-12, C-15).`,
      "not_fg_plan_row"
    )
  }

  const hint = planId && planId !== raw ? ` Это место палеты ряда ${planId}.` : ""
  throw new WmsHttpError(
    400,
    `Неизвестный ряд плана ГП: ${raw}.${hint} Нужен ряд (A-35), не слот (A-35-LOWER-001).`,
    "unknown_fg_plan_row"
  )
}

export async function attachSessionCodesToFgLocation(
  client: PoolClient,
  siteId: number,
  locationId: string,
  session: Pick<RowIdentifySession, "codes" | "pallets">
): Promise<number> {
  const gtins: string[] = []
  const serials: string[] = []
  for (const code of session.codes ?? []) {
    const gtin = (code.gtin ?? "").trim()
    const serial = (code.serial ?? "").trim()
    if (!gtin || !serial) continue
    gtins.push(gtin)
    serials.push(serial)
  }
  const palletNeedles = (session.pallets ?? [])
    .map((pallet) => (pallet.palletCode ?? "").replace(/\s+/g, ""))
    .filter((value) => value.length >= 6)
  if (gtins.length === 0 && palletNeedles.length === 0) return 0

  const result = await client.query<{ code_id: string }>(
    `UPDATE wms_item_codes wc
     SET
       current_location_id = $1::bigint,
       current_site_id = $2,
       unlinked_at = NULL,
       linked_at = COALESCE(wc.linked_at, now())
     FROM codes c
     WHERE wc.code_id = c.code_id
       AND (
         (
           cardinality($3::text[]) > 0
           AND EXISTS (
             SELECT 1
             FROM unnest($3::text[], $4::text[]) AS p(g, s)
             WHERE p.g = c.ai01_gtin AND p.s = c.ai21_serial
           )
         )
         OR (
           cardinality($5::text[]) > 0
           AND (
             replace(encode(c.raw, 'escape'), ' ', '') = ANY($5::text[])
             OR (c.ai01_gtin || COALESCE(c.ai21_serial, '')) = ANY($5::text[])
           )
         )
       )
     RETURNING wc.code_id::text`,
    [locationId, siteId, gtins, serials, palletNeedles]
  )
  return result.rowCount ?? result.rows.length
}

export function isLikelyPlanRowInput(value: string): boolean {
  const id = normalizePlanRowId(value)
  return isPlanRowId(id)
}
