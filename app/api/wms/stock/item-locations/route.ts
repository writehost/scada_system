import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId, resolveItemByCodeOrBarcode } from "@/lib/wms/resolve";
import { buildSlotDisplayName, parseSlotProfileFromAttrs } from "@/lib/wms/storage-slot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ячейки, в которых реально лежит конкретная номенклатура.
 * Перемещение раньше показывало все ячейки склада, и оператор узнавал об отсутствии
 * остатка только после выбора: список «Откуда» строится из этого ответа.
 */
export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode")?.trim() ?? "";
  const itemCode = url.searchParams.get("itemCode")?.trim() ?? "";
  if (!siteCode || !itemCode) {
    return NextResponse.json({ error: "siteCode and itemCode are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const item = await resolveItemByCodeOrBarcode(client, siteId, itemCode);
    if (!item) {
      return NextResponse.json({ error: "unknown itemCode" }, { status: 404 });
    }

    const r = await client.query(
      `SELECT
         l.location_code AS "locationCode",
         l.display_name AS "displayName",
         w.warehouse_code AS "warehouseCode",
         z.zone_code AS "zoneCode",
         z.name AS "zoneName",
         l.location_attrs_json AS "locationAttrsJson",
         COALESCE(sb.available_qty, 0)::float8 AS "availableQty",
         COALESCE(sb.in_production_qty, 0)::float8 AS "inProductionQty",
         COALESCE(sb.reserved_qty, 0)::float8 AS "reservedQty",
         (
           SELECT COUNT(*)::int
           FROM wms_stock_lots sl
           WHERE sl.balance_id = sb.balance_id
             AND (COALESCE(sl.available_qty, 0) + COALESCE(sl.in_production_qty, 0)) > 0
         ) AS "lotCount",
         (
           SELECT COUNT(DISTINCT sb2.item_id)::int
           FROM wms_stock_balances sb2
           WHERE sb2.site_id = sb.site_id
             AND sb2.location_id = sb.location_id
             AND (COALESCE(sb2.available_qty, 0) + COALESCE(sb2.in_production_qty, 0)) > 0
         ) AS "cellSkuCount"
       FROM wms_stock_balances sb
       JOIN wms_locations l ON l.location_id = sb.location_id AND l.site_id = sb.site_id
       JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
       JOIN wms_zones z ON z.zone_id = l.zone_id
       WHERE sb.site_id = $1
         AND sb.item_id = $2::bigint
         AND (COALESCE(sb.available_qty, 0) + COALESCE(sb.in_production_qty, 0)) > 0
       ORDER BY sb.available_qty DESC, l.location_code`,
      [siteId, item.item_id]
    );

    const locations = r.rows.map((row) => {
      const slot = parseSlotProfileFromAttrs((row as { locationAttrsJson?: unknown }).locationAttrsJson);
      const { locationAttrsJson: _drop, ...rest } = row as Record<string, unknown>;
      return { ...rest, slotProfile: slot, slotTitle: buildSlotDisplayName(slot) };
    });

    const totalAvailable = locations.reduce(
      (acc, l) => acc + Number((l as { availableQty?: number }).availableQty ?? 0),
      0
    );
    const totalInProduction = locations.reduce(
      (acc, l) => acc + Number((l as { inProductionQty?: number }).inProductionQty ?? 0),
      0
    );

    return NextResponse.json({
      itemCode: item.item_code,
      itemName: item.name,
      totalAvailable,
      totalInProduction,
      locations,
    });
  } catch (error) {
    console.error("[GET /api/wms/stock/item-locations]", error);
    const message = error instanceof Error ? error.message : "internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}
