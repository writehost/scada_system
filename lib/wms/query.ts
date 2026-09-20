import type { Pool, PoolClient } from "pg"
import { likeContains, LIKE_ESCAPE_SQL } from "@/lib/wms/sql-like"

export async function runLookup(db: Pool | PoolClient, siteId: number, q: string) {
  const trimmed = q.trim()
  if (!trimmed) {
    return { items: [] as Record<string, unknown>[] }
  }
  const pattern = likeContains(trimmed)
  const r = await db.query(
    `SELECT
       i.item_code AS "itemCode",
       pb.barcode AS "barcode",
       i.name AS "name",
       COALESCE(l.location_code, '—') AS "locationCode",
       COALESCE(sb.available_qty, 0)::float8 AS "availableQty",
       COALESCE(sb.reserved_qty, 0)::float8 AS "reservedQty",
       COALESCE(sb.in_production_qty, 0)::float8 AS "inProductionQty",
       COALESCE(sb.in_transit_qty, 0)::float8 AS "inTransitQty",
       COALESCE(sb.quarantine_qty, 0)::float8 AS "quarantineQty",
       COALESCE(sb.rejected_qty, 0)::float8 AS "rejectedQty",
       COALESCE(ras.code, 'unknown') AS "accuracyStatus",
       COALESCE(rls.code, '—') AS "locationStatus"
     FROM wms_items i
     LEFT JOIN wms_stock_balances sb ON sb.site_id = i.site_id AND sb.item_id = i.item_id
     LEFT JOIN wms_locations l ON l.location_id = sb.location_id
     LEFT JOIN ref_wms_accuracy_status ras ON ras.accuracy_status_id = sb.accuracy_status_id
     LEFT JOIN ref_wms_location_status rls ON l.location_id IS NOT NULL AND rls.location_status_id = l.location_status_id
     LEFT JOIN LATERAL (
       SELECT b.barcode
       FROM wms_item_barcodes b
       WHERE b.item_id = i.item_id
       ORDER BY b.is_primary DESC, b.item_barcode_id
       LIMIT 1
     ) pb ON true
     WHERE i.site_id = $1
       AND (
         i.item_code ILIKE $2 ${LIKE_ESCAPE_SQL}
         OR i.name ILIKE $2 ${LIKE_ESCAPE_SQL}
         OR COALESCE(i.nomenclature, '') ILIKE $2 ${LIKE_ESCAPE_SQL}
         OR EXISTS (
           SELECT 1 FROM wms_item_barcodes x
           WHERE x.item_id = i.item_id AND x.barcode ILIKE $2 ${LIKE_ESCAPE_SQL}
         )
         OR (l.location_code IS NOT NULL AND l.location_code ILIKE $2 ${LIKE_ESCAPE_SQL})
       )
     ORDER BY i.item_code, l.location_code NULLS LAST
     LIMIT 200`,
    [siteId, pattern]
  )
  return { items: r.rows }
}

export async function fetchBalanceSnapshot(
  client: PoolClient,
  siteId: number,
  locationId: string,
  itemId: string
) {
  const r = await client.query(
    `SELECT
       sb.available_qty::float8 AS "availableQty",
       sb.reserved_qty::float8 AS "reservedQty",
       sb.in_production_qty::float8 AS "inProductionQty",
       sb.quarantine_qty::float8 AS "quarantineQty",
       sb.rejected_qty::float8 AS "rejectedQty",
       ras.code AS "accuracyStatus",
       l.location_code AS "locationCode",
       rls.code AS "locationStatus"
     FROM wms_stock_balances sb
     JOIN wms_locations l ON l.location_id = sb.location_id
     JOIN ref_wms_accuracy_status ras ON ras.accuracy_status_id = sb.accuracy_status_id
     JOIN ref_wms_location_status rls ON rls.location_status_id = l.location_status_id
     WHERE sb.site_id = $1 AND sb.location_id = $2::bigint AND sb.item_id = $3::bigint`,
    [siteId, locationId, itemId]
  )
  return r.rows[0] ?? null
}
