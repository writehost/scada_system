import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { getItemStockAvailability } from "@/lib/wms/issue-stock";

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
  const siteCode = url.searchParams.get("siteCode")?.trim() ?? "";
  const itemCode = url.searchParams.get("itemCode")?.trim() ?? "";
  const locationCode = url.searchParams.get("locationCode")?.trim() ?? "";

  if (!siteCode || !itemCode || !locationCode) {
    return NextResponse.json(
      { error: "siteCode, itemCode and locationCode are required" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const availability = await getItemStockAvailability(
      client,
      siteId,
      itemCode,
      locationCode
    );
    if (!availability) {
      return NextResponse.json({ error: "item or location not found" }, { status: 404 });
    }
    return NextResponse.json(availability);
  } catch (error) {
    console.error("[GET /api/wms/stock/availability]", error);
    const message = error instanceof Error ? error.message : "internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}
