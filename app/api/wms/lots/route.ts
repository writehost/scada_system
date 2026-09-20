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
    const q = url.searchParams.get("query") ?? "";
    const r = await client.query(
      `SELECT
         wl.lot_id::text AS "lotId",
         i.item_code AS "itemCode",
         i.name AS "itemName",
         wl.lot_code AS "lotCode",
         wl.batch_label AS "batchLabel",
         wl.supplier_lot_code AS "supplierLotCode",
         wl.received_at AS "receivedAt",
       wl.manufactured_at AS "manufacturedAt",
         wl.best_before_at AS "bestBeforeAt",
         wl.expiry_at AS "expiryAt",
         wl.qa_status_code AS "qaStatusCode",
         wl.is_blocked AS "isBlocked",
         COALESCE(SUM(sl.available_qty), 0)::float8 AS "availableQty",
         COALESCE(SUM(sl.reserved_qty), 0)::float8 AS "reservedQty",
         COALESCE(SUM(sl.in_transit_qty), 0)::float8 AS "inTransitQty",
         COALESCE(SUM(sl.quarantine_qty), 0)::float8 AS "quarantineQty",
         COALESCE(SUM(sl.rejected_qty), 0)::float8 AS "rejectedQty"
       FROM wms_lots wl
       JOIN wms_items i ON i.item_id = wl.item_id
       LEFT JOIN wms_stock_lots sl ON sl.lot_id = wl.lot_id
       WHERE wl.site_id = $1
         AND ($2::text = '' OR i.item_code = $2)
         AND ($3::text = '' OR wl.lot_code ILIKE $4 OR COALESCE(wl.batch_label, '') ILIKE $4)
       GROUP BY wl.lot_id, i.item_code, i.name
       ORDER BY wl.expiry_at NULLS LAST, wl.received_at DESC
       LIMIT 200`,
      [siteId, itemCode.trim(), q.trim(), `%${q.trim()}%`]
    );
    return NextResponse.json({ lots: r.rows });
  } finally {
    client.release();
  }
}
