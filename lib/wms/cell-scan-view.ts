import type { PoolClient } from "pg"
import { parseSlotProfileFromAttrs, buildSlotDisplayName, type StorageSlotProfile } from "@/lib/wms/storage-slot"
import { getSiteId } from "@/lib/wms/resolve"

export type CellScanStockRow = {
  itemCode: string
  barcode: string | null
  name: string
  availableQty: number
  reservedQty: number
  inProductionQty: number
  quarantineQty: number
  rejectedQty: number
  nearestExpiryAt: string | null
}

export type CellScanLotRow = {
  lotCode: string
  itemCode: string
  itemName: string
  availableQty: number
  quarantineQty: number
  expiryAt: string | null
  isBlocked: boolean
}

export type CellScanCodeRow = {
  codeId: string
  itemCode: string
  itemName: string
  gtin: string
  serial: string
  statusName: string
  display: string
}

export type CellScanView = {
  locationCode: string
  displayName: string | null
  locationStatus: string
  warehouseCode: string
  zoneCode: string
  slotProfile: StorageSlotProfile | null
  slotTitle: string
  stock: CellScanStockRow[]
  lots: CellScanLotRow[]
  codes: CellScanCodeRow[]
}

export async function resolveDefaultSiteId(client: PoolClient): Promise<number | null> {
  const preferred = await getSiteId(client, "DEFAULT")
  if (preferred != null) return preferred
  const r = await client.query<{ site_id: number }>(
    `SELECT site_id FROM wms_sites WHERE is_active ORDER BY site_id LIMIT 1`
  )
  return r.rows[0]?.site_id ?? null
}

export async function getCellScanView(
  client: PoolClient,
  siteId: number,
  locationCode: string
): Promise<CellScanView | null> {
  const code = locationCode.trim()
  if (!code) return null

  const loc = await client.query<{
    locationCode: string
    displayName: string | null
    locationStatus: string
    warehouseCode: string
    zoneCode: string
    locationAttrsJson: unknown
  }>(
    `SELECT
       l.location_code AS "locationCode",
       l.display_name AS "displayName",
       rls.code AS "locationStatus",
       w.warehouse_code AS "warehouseCode",
       z.zone_code AS "zoneCode",
       l.location_attrs_json AS "locationAttrsJson"
     FROM wms_locations l
     JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
     JOIN wms_zones z ON z.zone_id = l.zone_id
     JOIN ref_wms_location_status rls ON rls.location_status_id = l.location_status_id
     WHERE l.site_id = $1 AND l.location_code = $2`,
    [siteId, code]
  )
  if (!loc.rows[0]) return null

  const stock = await client.query<CellScanStockRow>(
    `SELECT
       i.item_code AS "itemCode",
       pb.barcode AS "barcode",
       i.name AS "name",
       sb.available_qty::float8 AS "availableQty",
       sb.reserved_qty::float8 AS "reservedQty",
       sb.in_production_qty::float8 AS "inProductionQty",
       sb.quarantine_qty::float8 AS "quarantineQty",
       sb.rejected_qty::float8 AS "rejectedQty",
       lot_exp."nearestExpiryAt" AS "nearestExpiryAt"
     FROM wms_stock_balances sb
     JOIN wms_items i ON i.item_id = sb.item_id
     JOIN wms_locations l ON l.location_id = sb.location_id
     LEFT JOIN LATERAL (
       SELECT b.barcode
       FROM wms_item_barcodes b
       WHERE b.item_id = i.item_id
       ORDER BY b.is_primary DESC, b.item_barcode_id
       LIMIT 1
     ) pb ON true
     LEFT JOIN LATERAL (
       SELECT MIN(COALESCE(wl.expiry_at, wl.best_before_at))::text AS "nearestExpiryAt"
       FROM wms_stock_lots sl2
       JOIN wms_lots wl ON wl.lot_id = sl2.lot_id AND wl.site_id = sb.site_id
       WHERE sl2.balance_id = sb.balance_id
         AND (COALESCE(sl2.available_qty, 0) + COALESCE(sl2.in_production_qty, 0) + COALESCE(sl2.reserved_qty, 0)) > 0
     ) lot_exp ON true
     WHERE sb.site_id = $1 AND l.location_code = $2
       AND (
         COALESCE(sb.available_qty, 0)
         + COALESCE(sb.reserved_qty, 0)
         + COALESCE(sb.in_production_qty, 0)
         + COALESCE(sb.quarantine_qty, 0)
         + COALESCE(sb.rejected_qty, 0)
       ) > 0
     ORDER BY i.name, i.item_code`,
    [siteId, code]
  )

  const lots = await client.query<CellScanLotRow>(
    `SELECT
       wl.lot_code AS "lotCode",
       i.item_code AS "itemCode",
       i.name AS "itemName",
       sl.available_qty::float8 AS "availableQty",
       sl.quarantine_qty::float8 AS "quarantineQty",
       COALESCE(wl.expiry_at, sl.expiry_at, wl.best_before_at)::text AS "expiryAt",
       wl.is_blocked AS "isBlocked"
     FROM wms_stock_lots sl
     JOIN wms_stock_balances sb ON sb.balance_id = sl.balance_id
     JOIN wms_items i ON i.item_id = sb.item_id AND i.site_id = sb.site_id
     JOIN wms_lots wl ON wl.lot_id = sl.lot_id AND wl.site_id = sb.site_id
     JOIN wms_locations l ON l.location_id = sb.location_id AND l.site_id = sb.site_id
     WHERE sb.site_id = $1 AND l.location_code = $2
       AND (
         COALESCE(sl.available_qty, 0)
         + COALESCE(sl.reserved_qty, 0)
         + COALESCE(sl.in_production_qty, 0)
         + COALESCE(sl.quarantine_qty, 0)
       ) > 0
     ORDER BY COALESCE(wl.expiry_at, wl.best_before_at) NULLS LAST, i.item_code
     LIMIT 80`,
    [siteId, code]
  )

  const codes = await client.query<CellScanCodeRow>(
    `SELECT
       c.code_id::text AS "codeId",
       i.item_code AS "itemCode",
       i.name AS "itemName",
       c.ai01_gtin AS gtin,
       c.ai21_serial AS serial,
       rs.name AS "statusName",
       ('01' || COALESCE(c.ai01_gtin, '') || '21' || COALESCE(c.ai21_serial, '')) AS display
     FROM wms_item_codes wc
     JOIN codes c ON c.code_id = wc.code_id
     JOIN code_state cs ON cs.code_id = c.code_id AND cs.site_id = wc.current_site_id
     JOIN ref_status rs ON rs.status_id = cs.status_id
     JOIN wms_items i ON i.item_id = wc.item_id AND i.site_id = wc.current_site_id
     JOIN wms_locations l ON l.location_id = wc.current_location_id AND l.site_id = wc.current_site_id
     WHERE wc.current_site_id = $1
       AND wc.unlinked_at IS NULL
       AND l.location_code = $2
     ORDER BY i.name, c.code_id DESC
     LIMIT 80`,
    [siteId, code]
  )

  const slotProfile = parseSlotProfileFromAttrs(loc.rows[0].locationAttrsJson)
  return {
    locationCode: loc.rows[0].locationCode,
    displayName: loc.rows[0].displayName,
    locationStatus: loc.rows[0].locationStatus,
    warehouseCode: loc.rows[0].warehouseCode,
    zoneCode: loc.rows[0].zoneCode,
    slotProfile,
    slotTitle: buildSlotDisplayName(slotProfile),
    stock: stock.rows,
    lots: lots.rows,
    codes: codes.rows,
  }
}
