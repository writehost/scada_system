import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { createProductionPlanLink } from "@/lib/wms/production-plan-directory";
import { wmsErrorResponse } from "@/lib/wms/errors";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PostBody = {
  siteCode?: string;
  sourcePlanId?: string;
  targetPlanId?: string;
  type?: string;
  lagDays?: number;
};

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = (body.siteCode ?? "").trim();
  const sourcePlanId = (body.sourcePlanId ?? "").trim();
  const targetPlanId = (body.targetPlanId ?? "").trim();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!sourcePlanId || !targetPlanId) {
    return NextResponse.json({ error: "sourcePlanId and targetPlanId are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });

    const link = await createProductionPlanLink(client, siteId, {
      sourcePlanId,
      targetPlanId,
      type: body.type as "s2s" | "s2e" | "e2s" | "e2e" | undefined,
      lagDays: body.lagDays,
    });
    return NextResponse.json({ link }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("duplicate key")) {
      return NextResponse.json({ error: "такая связь уже есть", code: "duplicate" }, { status: 409 });
    }
    return wmsErrorResponse(e);
  } finally {
    client.release();
  }
}
