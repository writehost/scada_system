import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { getItemWhereUsed } from "@/lib/wms/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  segmentData: { params: Promise<{ itemCode: string }> }
) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  const params = await segmentData.params;
  const itemCode = decodeURIComponent(params.itemCode ?? "");
  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  if (!siteCode.trim() || !itemCode.trim()) {
    return NextResponse.json(
      { error: "siteCode and itemCode are required" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const data = await getItemWhereUsed(client, siteId, itemCode);
    if (!data) {
      return NextResponse.json({ error: "item not found" }, { status: 404 });
    }
    return NextResponse.json(data);
  } finally {
    client.release();
  }
}

