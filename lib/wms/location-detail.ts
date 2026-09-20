import type { PoolClient } from "pg";
import {
  buildSlotDisplayName,
  mergeSlotIntoLocationAttrs,
  parseSlotProfileFromAttrs,
  type StorageSlotProfile,
} from "@/lib/wms/storage-slot";

export async function fetchLocationDetail(
  client: PoolClient,
  siteId: number,
  locationCode: string
) {
  const loc = await client.query(
    `SELECT
       l.location_code AS "locationCode",
       l.display_name AS "displayName",
       rls.code AS "locationStatus",
       ras.code AS "accuracyStatus",
       w.warehouse_code AS "warehouseCode",
       z.zone_code AS "zoneCode",
       l.is_pick_face AS "isPickFace",
       l.location_attrs_json AS "locationAttrsJson"
     FROM wms_locations l
     JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
     JOIN wms_zones z ON z.zone_id = l.zone_id
     JOIN ref_wms_location_status rls ON rls.location_status_id = l.location_status_id
     JOIN ref_wms_accuracy_status ras ON ras.accuracy_status_id = l.accuracy_status_id
     WHERE l.site_id = $1 AND l.location_code = $2`,
    [siteId, locationCode.trim()]
  );
  if (loc.rows.length === 0) return null;

  const stock = await client.query(
    `SELECT
       i.item_code AS "itemCode",
       pb.barcode AS "barcode",
       i.name AS "name",
       sb.available_qty::float8 AS "availableQty",
       sb.reserved_qty::float8 AS "reservedQty",
       sb.in_production_qty::float8 AS "inProductionQty",
       sb.quarantine_qty::float8 AS "quarantineQty",
       sb.rejected_qty::float8 AS "rejectedQty",
       ras.code AS "accuracyStatus"
     FROM wms_stock_balances sb
     JOIN wms_items i ON i.item_id = sb.item_id
     JOIN wms_locations l ON l.location_id = sb.location_id
     JOIN ref_wms_accuracy_status ras ON ras.accuracy_status_id = sb.accuracy_status_id
     LEFT JOIN LATERAL (
       SELECT b.barcode
       FROM wms_item_barcodes b
       WHERE b.item_id = i.item_id
       ORDER BY b.is_primary DESC, b.item_barcode_id
       LIMIT 1
     ) pb ON true
     WHERE sb.site_id = $1 AND l.location_code = $2
     ORDER BY i.item_code`,
    [siteId, locationCode.trim()]
  );

  const history = await client.query(
    `SELECT
       m.movement_at AS "at",
       mt.code AS "movementType",
       m.qty::float8 AS "qty",
       i.item_code AS "itemCode",
       fl.location_code AS "fromLocationCode",
       tl.location_code AS "toLocationCode"
     FROM wms_stock_movements m
     JOIN ref_wms_movement_type mt ON mt.movement_type_id = m.movement_type_id
     JOIN wms_items i ON i.item_id = m.item_id
     LEFT JOIN wms_locations fl ON fl.location_id = m.from_location_id
     LEFT JOIN wms_locations tl ON tl.location_id = m.to_location_id
     JOIN wms_locations loc ON loc.site_id = m.site_id AND loc.location_code = $2
     WHERE m.site_id = $1
       AND (m.from_location_id = loc.location_id OR m.to_location_id = loc.location_id)
     ORDER BY m.movement_at DESC
     LIMIT 40`,
    [siteId, locationCode.trim()]
  );

  const lots = await client.query(
    `SELECT
       wl.lot_id::text AS "lotId",
       wl.lot_code AS "lotCode",
       wl.batch_label AS "batchLabel",
       wl.qa_status_code AS "qaStatusCode",
       wl.note AS "note",
       wl.is_blocked AS "isBlocked",
       i.item_code AS "itemCode",
       i.name AS "itemName",
       sl.available_qty::float8 AS "availableQty",
       sl.reserved_qty::float8 AS "reservedQty",
       0::float8 AS "inProductionQty",
       sl.in_transit_qty::float8 AS "inTransitQty",
       sl.quarantine_qty::float8 AS "quarantineQty",
       sl.rejected_qty::float8 AS "rejectedQty",
       wl.manufactured_at AS "manufacturedAt"
     FROM wms_stock_lots sl
     JOIN wms_stock_balances sb ON sb.balance_id = sl.balance_id
     JOIN wms_items i ON i.item_id = sb.item_id AND i.site_id = sb.site_id
     JOIN wms_lots wl ON wl.lot_id = sl.lot_id AND wl.site_id = sb.site_id
     JOIN wms_locations l ON l.location_id = sb.location_id AND l.site_id = sb.site_id
     WHERE sb.site_id = $1 AND l.location_code = $2
     ORDER BY i.item_code, wl.lot_code`,
    [siteId, locationCode.trim()]
  );

  const locationRow = loc.rows[0] as Record<string, unknown>;
  const slotProfile = parseSlotProfileFromAttrs(locationRow.locationAttrsJson);
  return {
    location: {
      ...locationRow,
      slotProfile,
      slotTitle: buildSlotDisplayName(slotProfile),
    },
    stock: stock.rows,
    lots: lots.rows,
    history: history.rows,
  };
}

export async function patchLocationProfile(
  client: PoolClient,
  siteId: number,
  locationCode: string,
  body: { displayName?: unknown; slotProfile?: StorageSlotProfile }
) {
  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim() : "";
  const hasSlot = body.slotProfile != null && typeof body.slotProfile === "object";

  const cur = await client.query<{ location_attrs_json: unknown; display_name: string }>(
    `SELECT location_attrs_json, display_name FROM wms_locations WHERE site_id = $1 AND location_code = $2`,
    [siteId, locationCode.trim()]
  );
  if (cur.rows.length === 0) return null;

  const mergedAttrs = hasSlot
    ? mergeSlotIntoLocationAttrs(cur.rows[0].location_attrs_json, body.slotProfile!)
    : cur.rows[0].location_attrs_json;
  const finalDisplay =
    displayName ||
    (hasSlot ? buildSlotDisplayName(body.slotProfile!) : cur.rows[0].display_name);

  await client.query(
    `UPDATE wms_locations
     SET display_name = $3,
         location_attrs_json = $4::jsonb,
         updated_at = now()
     WHERE site_id = $1 AND location_code = $2`,
    [siteId, locationCode.trim(), finalDisplay, JSON.stringify(mergedAttrs)]
  );

  const slotProfile = parseSlotProfileFromAttrs(mergedAttrs);
  return {
    ok: true as const,
    locationCode: locationCode.trim(),
    displayName: finalDisplay,
    slotProfile,
    slotTitle: buildSlotDisplayName(slotProfile),
  };
}
