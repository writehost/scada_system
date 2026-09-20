import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { buildPosPickPlan } from "@/lib/wms/pos-pick-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 });
  }

  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode")?.trim() ?? "";
  const itemCode = url.searchParams.get("itemCode")?.trim() ?? "";
  const requestedQty = Math.max(0, Number(url.searchParams.get("qty") ?? "0") || 0);
  if (!siteCode || !itemCode) {
    return NextResponse.json({ error: "siteCode and itemCode are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const result = await buildPosPickPlan(client, siteCode, itemCode, requestedQty);
    if (!result) return NextResponse.json({ error: "item not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[GET /api/wms/stock/pos-pick]", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "internal error" }, { status: 500 });
  } finally {
    client.release();
  }
}
