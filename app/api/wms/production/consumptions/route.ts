import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 40), 1), 200);
  const since = url.searchParams.get("since")?.trim() || null;
  const stickersOnly = url.searchParams.get("stickersOnly") === "1";

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const r = await client.query<{
      consumptionId: string;
      createdAt: string;
      locationCode: string;
      displayName: string;
      lineCode: string | null;
      itemCode: string;
      itemName: string;
      packagingProfile: string | null;
      qty: number;
      mode: string;
      sourceSystem: string;
      codeValue: string | null;
    }>(
      `SELECT
         c.consumption_id::text AS "consumptionId",
         c.created_at::text AS "createdAt",
         l.location_code AS "locationCode",
         l.display_name AS "displayName",
         c.line_code AS "lineCode",
         i.item_code AS "itemCode",
         i.name AS "itemName",
         i.packaging_profile AS "packagingProfile",
         c.qty::float8 AS "qty",
         c.mode AS "mode",
         c.source_system AS "sourceSystem",
         c.code_value AS "codeValue"
       FROM wms_production_consumptions c
       JOIN wms_locations l ON l.location_id = c.location_id
       JOIN wms_items i ON i.item_id = c.item_id AND i.site_id = c.site_id
       WHERE c.site_id = $1
         AND c.status = 'applied'
         AND ($2::timestamptz IS NULL OR c.created_at >= $2::timestamptz)
         AND ($3::boolean = false OR i.packaging_profile = 'stickers')
       ORDER BY c.created_at DESC
       LIMIT $4`,
      [siteId, since, stickersOnly, limit]
    );

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayQty = await client.query<{ total: number }>(
      `SELECT COALESCE(SUM(c.qty), 0)::float8 AS total
       FROM wms_production_consumptions c
       JOIN wms_items i ON i.item_id = c.item_id AND i.site_id = c.site_id
       WHERE c.site_id = $1
         AND c.status = 'applied'
         AND c.created_at >= $2::timestamptz
         AND ($3::boolean = false OR i.packaging_profile = 'stickers')`,
      [siteId, todayStart.toISOString(), stickersOnly]
    );

    return NextResponse.json({
      consumptions: r.rows.map((row) => ({
        ...row,
        isSticker: row.packagingProfile === "stickers",
      })),
      summary: {
        todayQty: todayQty.rows[0]?.total ?? 0,
      },
      fetchedAt: new Date().toISOString(),
    });
  } finally {
    client.release();
  }
}
