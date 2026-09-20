import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { upsertExternalProductionPlan } from "@/lib/wms/production-plan-directory";
import { wmsErrorResponse } from "@/lib/wms/errors";
import { requireLineApi } from "@/lib/wms/line-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  siteCode?: string;
  externalId?: string;
  planDate?: string;
  planDateTo?: string | null;
  itemCode?: string;
  plannedQty?: number;
  workshopCode?: string | null;
  lineCode?: string | null;
  note?: string | null;
  code?: string;
};

export async function POST(req: Request) {
  const denied = await requireLineApi(req);
  if (denied) return denied;

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
  const externalId = (body.externalId ?? "").trim();
  const planDate = (body.planDate ?? "").trim();
  const itemCode = (body.itemCode ?? "").trim();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!externalId) return NextResponse.json({ error: "externalId is required" }, { status: 400 });
  if (!planDate) return NextResponse.json({ error: "planDate is required" }, { status: 400 });
  if (!itemCode) return NextResponse.json({ error: "itemCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });

    const plan = await upsertExternalProductionPlan(client, siteId, {
      externalId,
      planDate,
      planDateTo: body.planDateTo,
      itemCode,
      plannedQty: Number(body.plannedQty),
      workshopCode: body.workshopCode,
      lineCode: body.lineCode,
      note: body.note,
      code: body.code,
    });
    return NextResponse.json({ plan });
  } catch (e) {
    return wmsErrorResponse(e);
  } finally {
    client.release();
  }
}
