import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { suggestWorkshopCellsForItem } from "@/lib/wms/workshop-cell-suggest";

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
  const itemCode = url.searchParams.get("itemCode") ?? "";
  const limit = Number(url.searchParams.get("limit") ?? "10");

  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }
  if (!itemCode.trim()) {
    return NextResponse.json({ error: "itemCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const result = await suggestWorkshopCellsForItem(client, siteCode, itemCode, limit);
    if (!result) {
      return NextResponse.json({ error: "item not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[GET /api/wms/production/workshop-suggest]", error);
    const message = error instanceof Error ? error.message : "workshop suggest failed";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}
