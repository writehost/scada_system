import { NextResponse } from "next/server";
import { tryConnect, tryGetPool } from "@/lib/wms/pool";
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
  const groupCode = url.searchParams.get("groupCode") ?? "";

  const conn = await tryConnect(pool);
  if (!conn.ok) {
    return NextResponse.json(
      { error: conn.message, code: conn.code },
      { status: conn.status }
    );
  }
  const client = conn.client;
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const r = await client.query(
      `SELECT class_code AS code, group_code AS "groupCode", name
       FROM wms_item_classes
       WHERE site_id = $1
         AND is_active
         AND ($2::text = '' OR COALESCE(group_code, '') = $2)
       ORDER BY sort_order, class_code`,
      [siteId, groupCode.trim()]
    );
    return NextResponse.json({ classes: r.rows });
  } finally {
    client.release();
  }
}

