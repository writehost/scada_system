import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DeleteBody = {
  siteCode?: string;
  warehouseCode?: string;
  zoneCode?: string;
  zoneId?: string;
};

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 });
  }

  let body: DeleteBody;
  try {
    body = (await req.json()) as DeleteBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = (body.siteCode ?? "").trim();
  const warehouseCode = (body.warehouseCode ?? "").trim();
  const zoneCode = (body.zoneCode ?? "").trim().toUpperCase();
  const zoneId = (body.zoneId ?? "").trim();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!zoneId && (!warehouseCode || !zoneCode)) {
    return NextResponse.json({ error: "warehouseCode and zoneCode (or zoneId) required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });

    const zone = await client.query<{ zone_id: string; location_count: string }>(
      zoneId
        ? `
          SELECT z.zone_id::text, (
            SELECT COUNT(*)::text FROM wms_locations l WHERE l.zone_id = z.zone_id
          ) AS location_count
          FROM wms_zones z
          JOIN wms_warehouses w ON w.warehouse_id = z.warehouse_id
          WHERE w.site_id = $1 AND z.zone_id = $2::bigint
          `
        : `
          SELECT z.zone_id::text, (
            SELECT COUNT(*)::text FROM wms_locations l WHERE l.zone_id = z.zone_id
          ) AS location_count
          FROM wms_zones z
          JOIN wms_warehouses w ON w.warehouse_id = z.warehouse_id
          WHERE w.site_id = $1 AND w.warehouse_code = $2 AND z.zone_code = $3
          `,
      zoneId ? [siteId, zoneId] : [siteId, warehouseCode, zoneCode]
    );
    const row = zone.rows[0];
    if (!row) return NextResponse.json({ error: "zone not found" }, { status: 404 });

    const locCount = Number(row.location_count) || 0;
    if (locCount > 0) {
      return NextResponse.json(
        { error: `Нельзя удалить зону: в ней ${locCount} ячеек. Сначала удалите или перенесите ячейки.` },
        { status: 409 }
      );
    }

    await client.query(`DELETE FROM wms_zones WHERE zone_id = $1::bigint`, [row.zone_id]);
    return NextResponse.json({ ok: true, zoneId: row.zone_id, warehouseCode, zoneCode });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "delete failed";
    console.error("[directories/zones/delete POST]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    client.release();
  }
}
