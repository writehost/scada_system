import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { getProductionPlan } from "@/lib/wms/production-plan-directory";
import { wmsErrorResponse } from "@/lib/wms/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 });
  }

  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  const planCode = url.searchParams.get("planCode") ?? "";
  if (!siteCode.trim()) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!planCode.trim()) return NextResponse.json({ error: "planCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });

    const plan = await getProductionPlan(client, siteId, planCode, { includeMaterials: true });
    if (!plan) return NextResponse.json({ error: "plan not found" }, { status: 404 });
    return NextResponse.json({ plan });
  } catch (e) {
    return wmsErrorResponse(e);
  } finally {
    client.release();
  }
}
