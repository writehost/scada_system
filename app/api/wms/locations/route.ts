import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { buildSlotDisplayName, mergeSlotIntoLocationAttrs, parseSlotProfileFromAttrs, type StorageSlotProfile } from "@/lib/wms/storage-slot";
import { workshopLocationWhere } from "@/lib/wms/workshop-directory";
import { isWaitingPointCell, parseWaitingHandoffFromAttrs, clearWaitingHandoffFromAttrs } from "@/lib/wms/workshop-waiting-cell";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateLocationBody = {
  siteCode?: unknown;
  warehouseCode?: unknown;
  zoneCode?: unknown;
  locationCode?: unknown;
  displayName?: unknown;
  slotProfile?: unknown;
  waitingPoint?: unknown;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(req: Request) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true });
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const warehouseCode = url.searchParams.get("warehouseCode") ?? "";
    const zoneCode = url.searchParams.get("zoneCode") ?? "";
    const q = url.searchParams.get("query") ?? "";
    const offset = Math.max(Number(url.searchParams.get("offset") ?? "0") || 0, 0);
    const lite = url.searchParams.get("lite") === "1";
    const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit") ?? (lite ? "2000" : "50")) || 50, 1),
      2000
    );
    const occupiedOnly = url.searchParams.get("occupiedOnly") === "1";
    const emptyOnly = url.searchParams.get("emptyOnly") === "1";
    const workshopOnly = url.searchParams.get("workshopOnly") === "1";
    const detailSelects = lite
      ? `NULL::text AS "occupiedItemCode",
           NULL::text AS "occupiedItemName",
           NULL::timestamptz AS "nearestExpiryAt"`
      : `(
             SELECT i.item_code
             FROM wms_stock_balances sb2
             JOIN wms_items i ON i.item_id = sb2.item_id AND i.site_id = sb2.site_id
             WHERE sb2.site_id = l.site_id
               AND sb2.location_id = l.location_id
               AND (COALESCE(sb2.in_production_qty, 0) + COALESCE(sb2.available_qty, 0)) > 0
             ORDER BY sb2.in_production_qty DESC, sb2.available_qty DESC
             LIMIT 1
           ) AS "occupiedItemCode",
           (
             SELECT i.name
             FROM wms_stock_balances sb2
             JOIN wms_items i ON i.item_id = sb2.item_id AND i.site_id = sb2.site_id
             WHERE sb2.site_id = l.site_id
               AND sb2.location_id = l.location_id
               AND (COALESCE(sb2.in_production_qty, 0) + COALESCE(sb2.available_qty, 0)) > 0
             ORDER BY sb2.in_production_qty DESC, sb2.available_qty DESC
             LIMIT 1
           ) AS "occupiedItemName",
           (
             SELECT MIN(exp.val)
             FROM (
               SELECT LEAST(
                 COALESCE(sl.expiry_at, 'infinity'::timestamptz),
                 COALESCE(wl.expiry_at, 'infinity'::timestamptz),
                 COALESCE(wl.best_before_at, 'infinity'::timestamptz),
                 CASE
                   WHEN COALESCE(sl.received_at, wl.received_at, wl.manufactured_at) IS NOT NULL
                     AND COALESCE(i.shelf_life_days, 0) > 0
                   THEN COALESCE(sl.received_at, wl.received_at, wl.manufactured_at)
                     + (COALESCE(i.shelf_life_days, 365)::text || ' days')::interval
                   ELSE 'infinity'::timestamptz
                 END
               ) AS val
               FROM wms_stock_balances sb2
               JOIN wms_items i ON i.item_id = sb2.item_id AND i.site_id = sb2.site_id
               LEFT JOIN wms_stock_lots sl ON sl.balance_id = sb2.balance_id
                 AND (COALESCE(sl.in_production_qty, 0) + COALESCE(sl.available_qty, 0)) > 0
               LEFT JOIN wms_lots wl ON wl.lot_id = sl.lot_id AND wl.site_id = sb2.site_id
               WHERE sb2.site_id = l.site_id
                 AND sb2.location_id = l.location_id
                 AND (COALESCE(sb2.in_production_qty, 0) + COALESCE(sb2.available_qty, 0)) > 0
               UNION ALL
               SELECT (
                 COALESCE(
                   (
                     SELECT MAX(d.applied_at)
                     FROM wms_stock_movements sm
                     JOIN wms_documents d ON d.document_id = sm.document_id
                     WHERE sm.site_id = sb2.site_id
                       AND sm.to_location_id = sb2.location_id
                       AND sm.item_id = sb2.item_id
                   ),
                   now()
                 ) + (COALESCE(i.shelf_life_days, 365)::text || ' days')::interval
               ) AS val
               FROM wms_stock_balances sb2
               JOIN wms_items i ON i.item_id = sb2.item_id AND i.site_id = sb2.site_id
               WHERE sb2.site_id = l.site_id
                 AND sb2.location_id = l.location_id
                 AND (COALESCE(sb2.in_production_qty, 0) + COALESCE(sb2.available_qty, 0)) > 0
                 AND COALESCE(i.shelf_life_days, 0) > 0
                 AND NOT EXISTS (
                   SELECT 1
                   FROM wms_stock_lots sl0
                   WHERE sl0.balance_id = sb2.balance_id
                     AND (COALESCE(sl0.in_production_qty, 0) + COALESCE(sl0.available_qty, 0)) > 0
                 )
             ) exp
             WHERE exp.val IS NOT NULL AND exp.val < 'infinity'::timestamptz
           ) AS "nearestExpiryAt"`;

    const r = await client.query(
      `WITH stock AS (
         SELECT
           location_id,
           COALESCE(SUM(available_qty), 0)::float8 AS available_qty,
           COALESCE(SUM(reserved_qty), 0)::float8 AS reserved_qty,
           COALESCE(SUM(in_production_qty), 0)::float8 AS in_production_qty,
           COALESCE(SUM(in_transit_qty), 0)::float8 AS in_transit_qty,
           COUNT(DISTINCT item_id) FILTER (
             WHERE COALESCE(in_production_qty, 0) + COALESCE(available_qty, 0) > 0
           )::int AS sku_count
         FROM wms_stock_balances
         WHERE site_id = $1
         GROUP BY location_id
       ),
       codes AS (
         SELECT current_location_id AS location_id, COUNT(*)::int AS code_count
         FROM wms_item_codes
         WHERE current_site_id = $1
           AND unlinked_at IS NULL
         GROUP BY current_location_id
       )
       SELECT
         l.location_id,
         l.location_code AS "locationCode",
         l.display_name AS "displayName",
         w.warehouse_code AS "warehouseCode",
         z.zone_id::text AS "zoneId",
         z.zone_code AS "zoneCode",
         z.name AS "zoneName",
         ls.code AS "locationStatus",
         ac.code AS "accuracyStatus",
         ${lite
           ? `jsonb_strip_nulls(jsonb_build_object('slotProfile', l.location_attrs_json->'slotProfile'))`
           : `l.location_attrs_json`} AS "locationAttrsJson",
         COALESCE(s.available_qty, 0)::float8 AS "availableQty",
         COALESCE(s.reserved_qty, 0)::float8 AS "reservedQty",
         COALESCE(s.in_production_qty, 0)::float8 AS "inProductionQty",
         COALESCE(s.in_transit_qty, 0)::float8 AS "inTransitQty",
         COALESCE(s.sku_count, 0)::int AS "skuCount",
         COALESCE(c.code_count, 0)::int AS "codeCount",
         ${detailSelects},
         COUNT(*) OVER()::int AS "total"
       FROM wms_locations l
       JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
       JOIN wms_zones z ON z.zone_id = l.zone_id
       JOIN ref_wms_location_status ls ON ls.location_status_id = l.location_status_id
       JOIN ref_wms_accuracy_status ac ON ac.accuracy_status_id = l.accuracy_status_id
       LEFT JOIN stock s ON s.location_id = l.location_id
       LEFT JOIN codes c ON c.location_id = l.location_id
       WHERE l.site_id = $1
         AND ($2::text = '' OR w.warehouse_code = $2)
         AND ($3::text = '' OR z.zone_code = $3)
         AND ($4::text = '' OR l.location_code ILIKE $5 OR l.display_name ILIKE $5)
         AND ($6::boolean IS NOT TRUE OR ${workshopLocationWhere("w", "z")})
         AND (
           ($7::boolean IS NOT TRUE AND $8::boolean IS NOT TRUE)
           OR ($7::boolean IS TRUE AND (
             COALESCE(s.in_production_qty, 0) + COALESCE(s.available_qty, 0) > 0
             OR COALESCE(c.code_count, 0) > 0
           ))
           OR ($8::boolean IS TRUE
             AND COALESCE(s.in_production_qty, 0) + COALESCE(s.available_qty, 0) <= 0
             AND COALESCE(c.code_count, 0) = 0)
         )
       ORDER BY
         CASE WHEN ${lite ? "FALSE" : `(COALESCE(s.in_production_qty, 0) + COALESCE(s.available_qty, 0)) > 0`} THEN 0 ELSE 1 END,
         w.warehouse_code, z.zone_code, l.location_code
       LIMIT $9 OFFSET $10`,
      [
        siteId,
        warehouseCode.trim(),
        zoneCode.trim(),
        q.trim(),
        `%${q.trim()}%`,
        workshopOnly,
        occupiedOnly,
        emptyOnly,
        limit,
        offset,
      ]
    );
    const total = Number((r.rows[0] as { total?: number } | undefined)?.total ?? 0);
    const locations = r.rows.map((row) => {
      const slot = parseSlotProfileFromAttrs((row as { locationAttrsJson?: unknown }).locationAttrsJson);
      const codeCount = Number((row as { codeCount?: number }).codeCount ?? 0);
      const onHand =
        Number((row as { inProductionQty?: number }).inProductionQty ?? 0) +
        Number((row as { availableQty?: number }).availableQty ?? 0);
      const waiting = isWaitingPointCell(slot);
      const waitingHandoff = parseWaitingHandoffFromAttrs(
        (row as { locationAttrsJson?: unknown }).locationAttrsJson
      );
      return {
        ...row,
        slotProfile: slot,
        slotTitle: buildSlotDisplayName(slot),
        isWaitingPoint: waiting,
        isEmpty: onHand <= 0 && codeCount === 0,
        waitingHandoff,
        isHandedToProduction: waitingHandoff?.status === "handed_to_production",
      };
    });

    if (!lite) for (const loc of locations) {
      if (!loc.isWaitingPoint || !loc.waitingHandoff || !loc.isEmpty) continue;
      const locationId = (loc as { location_id?: string | number }).location_id;
      if (locationId == null) continue;
      const cleared = clearWaitingHandoffFromAttrs(
        (loc as { locationAttrsJson?: unknown }).locationAttrsJson
      );
      await client.query(
        `UPDATE wms_locations
         SET location_attrs_json = $3::jsonb, updated_at = now()
         WHERE site_id = $1 AND location_id = $2::bigint`,
        [siteId, locationId, JSON.stringify(cleared)]
      );
      loc.waitingHandoff = null;
      loc.isHandedToProduction = false;
      (loc as { locationAttrsJson?: unknown }).locationAttrsJson = cleared;
    }

    return NextResponse.json({ locations, total, offset, limit });
  } finally {
    client.release();
  }
}

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: CreateLocationBody;
  try {
    body = (await req.json()) as CreateLocationBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = cleanText(body.siteCode);
  const warehouseCode = cleanText(body.warehouseCode);
  const zoneCode = cleanText(body.zoneCode);
  const locationCode = cleanText(body.locationCode).toUpperCase();
  const displayName = cleanText(body.displayName) || locationCode;
  const waitingPoint =
    body.waitingPoint === true ||
    body.waitingPoint === "true" ||
    body.waitingPoint === 1 ||
    body.waitingPoint === "1";

  let slotProfile: StorageSlotProfile | null = null;
  if (waitingPoint) {
    slotProfile = {
      storagePurpose: "WAITING",
      allowMixedNomenclature: false,
      allowMixedBatches: true,
    };
  } else if (body.slotProfile && typeof body.slotProfile === "object") {
    slotProfile = body.slotProfile as StorageSlotProfile;
  }
  const locationAttrsJson = slotProfile
    ? mergeSlotIntoLocationAttrs(null, slotProfile)
    : null;

  if (!siteCode || !warehouseCode || !zoneCode || !locationCode) {
    return NextResponse.json(
      { error: "siteCode, warehouseCode, zoneCode and locationCode are required" },
      { status: 400 }
    );
  }
  if (locationCode.length > 120 || !/^[0-9A-ZА-ЯЁ._/-]+$/u.test(locationCode)) {
    return NextResponse.json(
      { error: "locationCode contains unsupported characters" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const placement = await client.query<{ warehouseId: string; zoneId: string }>(
      `SELECT
         w.warehouse_id::text AS "warehouseId",
         z.zone_id::text AS "zoneId"
       FROM wms_warehouses w
       JOIN wms_zones z ON z.warehouse_id = w.warehouse_id
       WHERE w.site_id = $1
         AND w.warehouse_code = $2
         AND z.zone_code = $3
         AND w.is_active = TRUE
         AND z.is_active = TRUE`,
      [siteId, warehouseCode, zoneCode]
    );
    if (placement.rows.length === 0) {
      return NextResponse.json(
        { error: "active warehouse/zone pair not found" },
        { status: 404 }
      );
    }

    const status = await client.query<{ locationStatusId: number; accuracyStatusId: number }>(
      `SELECT
         COALESCE(
           (SELECT location_status_id FROM ref_wms_location_status WHERE code IN ('AVAILABLE', 'ACTIVE') ORDER BY code = 'AVAILABLE' DESC LIMIT 1),
           (SELECT MIN(location_status_id) FROM ref_wms_location_status)
         )::int AS "locationStatusId",
         COALESCE(
           (SELECT accuracy_status_id FROM ref_wms_accuracy_status WHERE code IN ('UNVERIFIED', 'UNKNOWN', 'OK') ORDER BY code = 'UNVERIFIED' DESC LIMIT 1),
           (SELECT MIN(accuracy_status_id) FROM ref_wms_accuracy_status)
         )::int AS "accuracyStatusId"`
    );

    const inserted = await client.query(
      `INSERT INTO wms_locations (
         site_id, warehouse_id, zone_id, location_code, display_name,
         location_status_id, accuracy_status_id, is_pick_face,
         location_attrs_json, updated_at
       ) VALUES ($1, $2::bigint, $3::bigint, $4, $5, $6, $7, FALSE, $8::jsonb, now())
       ON CONFLICT (site_id, location_code) DO NOTHING
       RETURNING location_id::text AS "locationId"`,
      [
        siteId,
        placement.rows[0].warehouseId,
        placement.rows[0].zoneId,
        locationCode,
        displayName,
        status.rows[0].locationStatusId,
        status.rows[0].accuracyStatusId,
        locationAttrsJson ? JSON.stringify(locationAttrsJson) : null,
      ]
    );
    if (inserted.rows.length === 0) {
      return NextResponse.json({ error: "location code already exists" }, { status: 409 });
    }

    return NextResponse.json(
      {
        location: {
          locationCode,
          displayName,
          warehouseCode,
          zoneCode,
          locationStatus: "AVAILABLE",
          accuracyStatus: "UNVERIFIED",
          availableQty: 0,
          reservedQty: 0,
          skuCount: 0,
          isWaitingPoint: waitingPoint,
          isEmpty: true,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[POST /api/wms/locations]", error);
    const message = error instanceof Error ? error.message : "internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}
