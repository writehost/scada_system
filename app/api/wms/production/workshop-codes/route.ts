import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { listWorkshopCodes } from "@/lib/wms/workshop-codes";

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

  const locationCode = url.searchParams.get("locationCode") ?? undefined;
  const warehouseCode = url.searchParams.get("warehouseCode") ?? undefined;
  const itemCode = url.searchParams.get("itemCode") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "200");
  const offset = Number(url.searchParams.get("offset") ?? "0");

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const { rows, total } = await listWorkshopCodes(client, siteId, {
      locationCode,
      warehouseCode,
      itemCode,
      limit,
      offset,
    });

    return NextResponse.json({
      rows,
      total,
      limit: Math.min(Math.max(limit, 1), 2000),
      offset: Math.max(offset, 0),
      fetchedAt: new Date().toISOString(),
    });
  } finally {
    client.release();
  }
}
