import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Сводка заполненности: сколько ячеек, сколько непустых, сумма количества.
 * capacityQty из location_attrs_json — задекларированная ёмкость (если задана в импорте).
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
  const siteCode = url.searchParams.get("siteCode") ?? "";
  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode.trim());
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const zones = await client.query<{
      warehouseCode: string;
      zoneCode: string;
      locationCount: string;
      nonEmptyCount: string;
      totalAvailableQty: string;
      declaredCapacityQtySum: string;
    }>(
      `
      SELECT
        w.warehouse_code AS "warehouseCode",
        z.zone_code AS "zoneCode",
        COUNT(*)::text AS "locationCount",
        SUM(CASE WHEN COALESCE(sb.sumq, 0) > 0 THEN 1 ELSE 0 END)::text AS "nonEmptyCount",
        COALESCE(SUM(sb.sumq), 0)::text AS "totalAvailableQty",
        COALESCE(SUM(
          CASE
            WHEN NULLIF(TRIM(l.location_attrs_json->>'capacityQty'), '') IS NOT NULL
            THEN NULLIF(TRIM(l.location_attrs_json->>'capacityQty'), '')::float8
            ELSE NULL
          END
        ), 0)::text AS "declaredCapacityQtySum"
      FROM wms_locations l
      JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
      JOIN wms_zones z ON z.zone_id = l.zone_id
      LEFT JOIN (
        SELECT location_id, SUM(available_qty) AS sumq
        FROM wms_stock_balances
        WHERE site_id = $1
        GROUP BY location_id
      ) sb ON sb.location_id = l.location_id
      WHERE l.site_id = $1
      GROUP BY w.warehouse_code, z.zone_code
      ORDER BY w.warehouse_code, z.zone_code
      `,
      [siteId]
    );

    const rows = zones.rows.map((r) => ({
      warehouseCode: r.warehouseCode,
      zoneCode: r.zoneCode,
      locationCount: Number(r.locationCount),
      nonEmptyCount: Number(r.nonEmptyCount),
      emptyCount: Number(r.locationCount) - Number(r.nonEmptyCount),
      totalAvailableQty: Number(r.totalAvailableQty),
      declaredCapacityQtySum: Number(r.declaredCapacityQtySum),
      fillRatioDeclared:
        Number(r.declaredCapacityQtySum) > 0
          ? Number(r.totalAvailableQty) / Number(r.declaredCapacityQtySum)
          : null,
    }));

    const totals = rows.reduce(
      (a, r) => ({
        locations: a.locations + r.locationCount,
        nonEmpty: a.nonEmpty + r.nonEmptyCount,
        qty: a.qty + r.totalAvailableQty,
        cap: a.cap + r.declaredCapacityQtySum,
      }),
      { locations: 0, nonEmpty: 0, qty: 0, cap: 0 }
    );

    return NextResponse.json({
      siteCode: siteCode.trim(),
      zones: rows,
      totals: {
        locationCount: totals.locations,
        nonEmptyCount: totals.nonEmpty,
        emptyCount: totals.locations - totals.nonEmpty,
        totalAvailableQty: totals.qty,
        declaredCapacityQtySum: totals.cap,
        fillRatioDeclared:
          totals.cap > 0 ? totals.qty / totals.cap : null,
      },
    });
  } finally {
    client.release();
  }
}
