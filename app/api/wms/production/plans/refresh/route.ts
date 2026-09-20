import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { refreshPlanMaterials, getProductionPlan } from "@/lib/wms/production-plan-directory";
import { normalizePlanCode } from "@/lib/wms/production-plan-meta";
import { wmsErrorResponse } from "@/lib/wms/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { siteCode?: string; planCode?: string };

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = (body.siteCode ?? "").trim();
  const planCode = (body.planCode ?? "").trim();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!planCode) return NextResponse.json({ error: "planCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });

    const idRow = await client.query<{ plan_id: string }>(
      `SELECT plan_id::text FROM wms_production_plans
       WHERE site_id = $1 AND upper(plan_code) = $2`,
      [siteId, normalizePlanCode(planCode)]
    );
    const planId = idRow.rows[0]?.plan_id;
    if (!planId) return NextResponse.json({ error: "plan not found" }, { status: 404 });

    const materials = await refreshPlanMaterials(client, siteId, Number(planId));
    const plan = await getProductionPlan(client, siteId, planCode, { includeMaterials: true });
    return NextResponse.json({ materials, plan });
  } catch (e) {
    return wmsErrorResponse(e);
  } finally {
    client.release();
  }
}
