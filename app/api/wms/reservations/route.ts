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
  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const itemCode = url.searchParams.get("itemCode") ?? "";
    const r = await client.query(
      `SELECT
         r.reservation_id::text AS "reservationId",
         i.item_code AS "itemCode",
         i.name AS "itemName",
         l.location_code AS "locationCode",
         d.document_id::text AS "documentId",
         d.document_no AS "documentNo",
         sb.code AS "stockBucket",
         r.reserved_for AS "reservedFor",
         r.reserved_qty::float8 AS "reservedQty",
         r.is_active AS "isActive",
         r.expires_at AS "expiresAt",
         r.created_at AS "createdAt"
       FROM wms_reservations r
       JOIN wms_items i ON i.item_id = r.item_id
       LEFT JOIN wms_locations l ON l.location_id = r.location_id
       LEFT JOIN wms_documents d ON d.document_id = r.document_id
       JOIN ref_wms_stock_bucket sb ON sb.stock_bucket_id = r.stock_bucket_id
       WHERE r.site_id = $1
         AND ($2::text = '' OR i.item_code = $2)
       ORDER BY r.is_active DESC, r.created_at DESC
       LIMIT 200`,
      [siteId, itemCode.trim()]
    );
    return NextResponse.json({ reservations: r.rows });
  } finally {
    client.release();
  }
}
