import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRODUCTION_ZONE_CODES = ["LINE", "ST-SER", "ST-BAGG"];

export async function GET(req: Request) {
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
  const stickersOnly = url.searchParams.get("stickersOnly") === "1";

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const r = await client.query<{
      locationCode: string;
      displayName: string;
      warehouseCode: string;
      warehouseName: string;
      warehouseType: string;
      warehouseMeta: unknown;
      zoneCode: string;
      zoneName: string;
      itemCode: string;
      itemName: string;
      packagingProfile: string | null;
      materialType: string | null;
      storagePurpose: string | null;
      inProductionQty: number;
      availableQty: number;
      markingCodesCount: number;
    }>(
      `SELECT
         l.location_code AS "locationCode",
         l.display_name AS "displayName",
         w.warehouse_code AS "warehouseCode",
         w.name AS "warehouseName",
         w.warehouse_type AS "warehouseType",
         w.meta_json AS "warehouseMeta",
         z.zone_code AS "zoneCode",
         z.name AS "zoneName",
         i.item_code AS "itemCode",
         i.name AS "itemName",
         i.packaging_profile AS "packagingProfile",
         UPPER(COALESCE(l.location_attrs_json #>> '{slotProfile,materialType}', '')) AS "materialType",
         UPPER(COALESCE(l.location_attrs_json #>> '{slotProfile,storagePurpose}', '')) AS "storagePurpose",
         sb.in_production_qty::float8 AS "inProductionQty",
         sb.available_qty::float8 AS "availableQty",
         COALESCE(codes.cnt, 0)::int AS "markingCodesCount"
       FROM wms_stock_balances sb
       JOIN wms_locations l ON l.location_id = sb.location_id AND l.site_id = sb.site_id
       JOIN wms_items i ON i.item_id = sb.item_id AND i.site_id = sb.site_id
       JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
       JOIN wms_zones z ON z.zone_id = l.zone_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS cnt
         FROM wms_item_codes wc
         WHERE wc.current_site_id = sb.site_id
           AND wc.current_location_id = l.location_id
           AND wc.item_id = sb.item_id
           AND wc.unlinked_at IS NULL
       ) codes ON true
       WHERE sb.site_id = $1
         AND (sb.in_production_qty > 0 OR sb.available_qty > 0)
         AND (
           w.warehouse_type = 'PRODUCTION'
           OR COALESCE(w.meta_json->>'isProduction', 'false') = 'true'
           OR z.zone_code = ANY($2::text[])
           -- A-1 и др. часто висят в зоне RECV / материалах, но qty уже «в цеху»
           OR sb.in_production_qty > 0
           OR UPPER(COALESCE(l.location_attrs_json #>> '{slotProfile,storagePurpose}', '')) = 'WAITING'
           OR UPPER(COALESCE(l.location_attrs_json #>> '{slotProfile,materialType}', '')) IN ('ST', 'LB')
         )
         AND (
           $3::boolean = false
           OR i.packaging_profile = 'stickers'
           -- профиль номенклатуры часто «custom», а стикеры лежат в ST/WAITING ячейках
           OR UPPER(COALESCE(l.location_attrs_json #>> '{slotProfile,materialType}', '')) IN ('ST', 'LB')
           OR UPPER(COALESCE(l.location_attrs_json #>> '{slotProfile,storagePurpose}', '')) = 'WAITING'
           OR COALESCE(codes.cnt, 0) > 0
         )
       ORDER BY w.warehouse_code, z.zone_code, l.location_code, i.item_code
       LIMIT 2000`,
      [siteId, PRODUCTION_ZONE_CODES, stickersOnly]
    );

    const rows = r.rows.map((row) => {
      const meta =
        row.warehouseMeta && typeof row.warehouseMeta === "object"
          ? (row.warehouseMeta as Record<string, unknown>)
          : {};
      const scada = String(meta.scadaAreaCode ?? "").trim();
      const locationName = String(meta.locationName ?? row.warehouseName ?? row.warehouseCode).trim();
      const lineLabel = scada
        ? `${locationName} · ${scada}`
        : `${locationName} · ${row.zoneName || row.zoneCode}`;

      const material = (row.materialType ?? "").toUpperCase();
      const purpose = (row.storagePurpose ?? "").toUpperCase();
      const isSticker =
        row.packagingProfile === "stickers" ||
        material === "ST" ||
        material === "LB" ||
        purpose === "WAITING" ||
        row.markingCodesCount > 0;

      return {
        locationCode: row.locationCode,
        displayName: row.displayName,
        warehouseCode: row.warehouseCode,
        warehouseName: row.warehouseName,
        zoneCode: row.zoneCode,
        zoneName: row.zoneName,
        lineLabel,
        itemCode: row.itemCode,
        itemName: row.itemName,
        packagingProfile: row.packagingProfile,
        inProductionQty: row.inProductionQty,
        availableQty: row.availableQty,
        markingCodesCount: row.markingCodesCount,
        isSticker,
      };
    });

    const stickerQty = (x: { isSticker: boolean; inProductionQty: number; availableQty: number }) =>
      x.isSticker ? x.inProductionQty + x.availableQty : 0;

    const summary = {
      locationCount: new Set(rows.map((x) => x.locationCode)).size,
      itemCount: rows.length,
      totalInProduction: rows.reduce((s, x) => s + x.inProductionQty, 0),
      stickerInProduction: rows.reduce((s, x) => s + stickerQty(x), 0),
      totalMarkingCodes: rows.reduce((s, x) => s + (x.markingCodesCount ?? 0), 0),
      lowStockCells: rows.filter((x) => x.isSticker && stickerQty(x) > 0 && stickerQty(x) <= 500).length,
    };

    return NextResponse.json({ rows, summary, fetchedAt: new Date().toISOString() });
  } finally {
    client.release();
  }
}
