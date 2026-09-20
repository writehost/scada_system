import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { updateProductionPlanProgress } from "@/lib/wms/production-plan-directory";
import { wmsErrorResponse } from "@/lib/wms/errors";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  siteCode?: string;
  planCode?: string;
  percent?: number;
  doneQty?: number | null;
  source?: string | null;
};

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

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

    await client.query("BEGIN");
    const plan = await updateProductionPlanProgress(client, siteId, {
      planCode,
      percent: Number(body.percent),
      doneQty: body.doneQty,
      source: body.source,
    });
    await client.query("COMMIT");
    return NextResponse.json({ plan });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    return wmsErrorResponse(e);
  } finally {
    client.release();
  }
}
