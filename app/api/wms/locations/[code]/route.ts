import { NextResponse } from "next/server";
import { getSiteId } from "@/lib/wms/resolve";
import { tryGetPool } from "@/lib/wms/pool";
import {
  buildSlotDisplayName,
  mergeSlotIntoLocationAttrs,
  parseSlotProfileFromAttrs,
  type StorageSlotProfile,
} from "@/lib/wms/storage-slot";
import { listWorkshopCodes } from "@/lib/wms/workshop-codes";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  segmentData: { params: Promise<{ code: string }> }
) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  const params = await segmentData.params;
  const locationCode = decodeURIComponent(params.code ?? "");
  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";

  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode query param is required" }, { status: 400 });
  }
  if (!locationCode.trim()) {
    return NextResponse.json({ error: "location code is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const loc = await client.query(
      `SELECT
         l.location_code AS "locationCode",
         l.display_name AS "displayName",
         rls.code AS "locationStatus",
         ras.code AS "accuracyStatus",
         w.warehouse_code AS "warehouseCode",
         z.zone_code AS "zoneCode",
         l.is_pick_face AS "isPickFace",
         l.location_attrs_json AS "locationAttrsJson",
         (w.warehouse_type = 'PRODUCTION'
           OR COALESCE(w.meta_json->>'isProduction', 'false') = 'true'
           OR z.zone_code IN ('LINE', 'ST-SER', 'ST-BAGG')) AS "isWorkshop"
       FROM wms_locations l
       JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
       JOIN wms_zones z ON z.zone_id = l.zone_id
       JOIN ref_wms_location_status rls ON rls.location_status_id = l.location_status_id
       JOIN ref_wms_accuracy_status ras ON ras.accuracy_status_id = l.accuracy_status_id
       WHERE l.site_id = $1 AND l.location_code = $2`,
      [siteId, locationCode.trim()]
    );
    if (loc.rows.length === 0) {
      return NextResponse.json({ error: "location not found" }, { status: 404 });
    }

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
         ras.code AS "accuracyStatus",
         lot_exp."nearestExpiryAt" AS "nearestExpiryAt",
         lot_exp."bestBeforeAt" AS "bestBeforeAt",
         lot_exp."manufacturedAt" AS "manufacturedAt"
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
       LEFT JOIN LATERAL (
         SELECT
           MIN(COALESCE(wl.expiry_at, wl.best_before_at)) AS "nearestExpiryAt",
           MIN(wl.best_before_at) AS "bestBeforeAt",
           MIN(wl.manufactured_at) AS "manufacturedAt"
         FROM wms_stock_lots sl2
         JOIN wms_lots wl ON wl.lot_id = sl2.lot_id AND wl.site_id = sb.site_id
         WHERE sl2.balance_id = sb.balance_id
           AND (
             COALESCE(sl2.available_qty, 0)
             + COALESCE(sl2.in_production_qty, 0)
             + COALESCE(sl2.reserved_qty, 0)
           ) > 0
       ) lot_exp ON true
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
         sl.in_production_qty::float8 AS "inProductionQty",
         sl.in_transit_qty::float8 AS "inTransitQty",
         sl.quarantine_qty::float8 AS "quarantineQty",
         sl.rejected_qty::float8 AS "rejectedQty",
         wl.manufactured_at AS "manufacturedAt",
         wl.best_before_at AS "bestBeforeAt",
         COALESCE(
           wl.expiry_at,
           sl.expiry_at,
           CASE
             WHEN wl.manufactured_at IS NOT NULL
               AND COALESCE(i.shelf_life_days, 0) > 0
             THEN wl.manufactured_at + make_interval(days => i.shelf_life_days)
             ELSE NULL
           END
         ) AS "expiryAt",
         i.shelf_life_days AS "shelfLifeDays"
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
           + COALESCE(sl.in_transit_qty, 0)
           + COALESCE(sl.quarantine_qty, 0)
         ) > 0
       ORDER BY COALESCE(wl.expiry_at, wl.best_before_at, wl.manufactured_at) NULLS LAST, i.item_code, wl.lot_code`,
      [siteId, locationCode.trim()]
    );

    const locationRow = loc.rows[0] as Record<string, unknown>;
    const slotProfile = parseSlotProfileFromAttrs(locationRow.locationAttrsJson);

    let markingCodes: Awaited<ReturnType<typeof listWorkshopCodes>>["rows"] = [];
    let markingCodesTotal = 0;
    if (Boolean(locationRow.isWorkshop)) {
      const codes = await listWorkshopCodes(client, siteId, {
        locationCode: locationCode.trim(),
        limit: 100,
      });
      markingCodes = codes.rows;
      markingCodesTotal = codes.total;
    }

    return NextResponse.json({
      location: {
        ...locationRow,
        slotProfile,
        slotTitle: buildSlotDisplayName(slotProfile),
      },
      stock: stock.rows,
      lots: lots.rows,
      history: history.rows,
      markingCodes,
      markingCodesTotal,
    });
  } catch (error) {
    console.error("[GET /api/wms/locations/[code]]", error);
    const message = error instanceof Error ? error.message : "internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function PATCH(
  req: Request,
  segmentData: { params: Promise<{ code: string }> }
) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  const params = await segmentData.params;
  const locationCode = decodeURIComponent(params.code ?? "");
  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";

  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode query param is required" }, { status: 400 });
  }
  if (!locationCode.trim()) {
    return NextResponse.json({ error: "location code is required" }, { status: 400 });
  }

  let body: { displayName?: unknown; slotProfile?: StorageSlotProfile };
  try {
    body = (await req.json()) as { displayName?: unknown; slotProfile?: StorageSlotProfile };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim() : "";
  const hasSlot = body.slotProfile != null && typeof body.slotProfile === "object";

  if (!displayName && !hasSlot) {
    return NextResponse.json({ error: "displayName or slotProfile required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const cur = await client.query<{ location_attrs_json: unknown; display_name: string }>(
      `SELECT location_attrs_json, display_name FROM wms_locations WHERE site_id = $1 AND location_code = $2`,
      [siteId, locationCode.trim()]
    );
    if (cur.rows.length === 0) {
      return NextResponse.json({ error: "location not found" }, { status: 404 });
    }

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
    return NextResponse.json({
      ok: true,
      locationCode: locationCode.trim(),
      displayName: finalDisplay,
      slotProfile,
      slotTitle: buildSlotDisplayName(slotProfile),
    });
  } finally {
    client.release();
  }
}
