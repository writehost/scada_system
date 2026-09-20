import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { ZONE_LABELS } from "@/lib/storage-slot-ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

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
  const warehouseCode = cleanText(url.searchParams.get("warehouseCode"));
  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const params: unknown[] = [siteId];
    let whFilter = "";
    if (warehouseCode) {
      params.push(warehouseCode);
      whFilter = `AND w.warehouse_code = $${params.length}`;
    }

    const r = await client.query<{
      zoneId: string;
      warehouseCode: string;
      warehouseName: string;
      zoneCode: string;
      zoneName: string;
      isActive: boolean;
      locationCount: number;
    }>(
      `SELECT
         z.zone_id::text AS "zoneId",
         w.warehouse_code AS "warehouseCode",
         w.name AS "warehouseName",
         z.zone_code AS "zoneCode",
         z.name AS "zoneName",
         z.is_active AS "isActive",
         COUNT(l.location_id)::int AS "locationCount"
       FROM wms_zones z
       JOIN wms_warehouses w ON w.warehouse_id = z.warehouse_id
       LEFT JOIN wms_locations l ON l.zone_id = z.zone_id AND l.warehouse_id = w.warehouse_id AND l.site_id = w.site_id
       WHERE w.site_id = $1
         ${whFilter}
       GROUP BY z.zone_id, w.warehouse_code, w.name, z.zone_code, z.name, z.is_active
       ORDER BY w.warehouse_code, z.zone_code`,
      params
    );

    return NextResponse.json({ zones: r.rows });
  } finally {
    client.release();
  }
}

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: { siteCode?: unknown; warehouseCode?: unknown; zoneCode?: unknown; name?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = cleanText(body.siteCode);
  const warehouseCode = cleanText(body.warehouseCode);
  const zoneCode = cleanText(body.zoneCode).toUpperCase();
  const name = cleanText(body.name) || ZONE_LABELS[zoneCode] || zoneCode;

  if (!siteCode || !warehouseCode || !zoneCode) {
    return NextResponse.json(
      { error: "siteCode, warehouseCode and zoneCode are required" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const wh = await client.query<{ warehouseId: string }>(
      `SELECT warehouse_id::text AS "warehouseId"
       FROM wms_warehouses
       WHERE site_id = $1 AND warehouse_code = $2 AND is_active = TRUE`,
      [siteId, warehouseCode]
    );
    if (wh.rows.length === 0) {
      return NextResponse.json({ error: "warehouse not found" }, { status: 404 });
    }

    const r = await client.query<{
      zoneId: string;
      warehouseCode: string;
      zoneCode: string;
      zoneName: string;
    }>(
      `INSERT INTO wms_zones (warehouse_id, zone_code, name, is_active)
       VALUES ($1::bigint, $2, $3, TRUE)
       ON CONFLICT (warehouse_id, zone_code) DO UPDATE SET name = EXCLUDED.name, is_active = TRUE
       RETURNING zone_id::text AS "zoneId"`,
      [wh.rows[0].warehouseId, zoneCode, name]
    );

    return NextResponse.json(
      {
        zone: {
          zoneId: r.rows[0].zoneId,
          warehouseCode,
          zoneCode,
          zoneName: name,
          isActive: true,
          locationCount: 0,
        },
      },
      { status: 201 }
    );
  } finally {
    client.release();
  }
}
