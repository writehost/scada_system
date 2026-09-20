import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { createProductionPlan, listProductionPlanLinks, listProductionPlans } from "@/lib/wms/production-plan-directory";
import { wmsErrorResponse } from "@/lib/wms/errors";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 });
  }

  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });

    const includeLinks = url.searchParams.get("includeLinks") === "1";
    const plans = await listProductionPlans(client, siteId, {
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      includeMaterials: url.searchParams.get("includeMaterials") === "1",
    });
    if (!includeLinks) return NextResponse.json({ plans });

    const links = await listProductionPlanLinks(client, siteId, {
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });
    return NextResponse.json({ plans, links });
  } catch (e) {
    return wmsErrorResponse(e);
  } finally {
    client.release();
  }
}

type PostBody = {
  siteCode?: string;
  code?: string;
  planDate?: string;
  planDateTo?: string | null;
  itemCode?: string;
  plannedQty?: number;
  workshopCode?: string | null;
  lineCode?: string | null;
  materialWarehouseCode?: string;
  note?: string | null;
  syncCalendar?: boolean;
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
  const planDate = (body.planDate ?? "").trim();
  const itemCode = (body.itemCode ?? "").trim();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!planDate) return NextResponse.json({ error: "planDate is required" }, { status: 400 });
  if (!itemCode) return NextResponse.json({ error: "itemCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });

    await client.query("BEGIN");
    const plan = await createProductionPlan(client, siteId, {
      code: body.code,
      planDate,
      planDateTo: body.planDateTo,
      itemCode,
      plannedQty: Number(body.plannedQty),
      workshopCode: body.workshopCode,
      lineCode: body.lineCode,
      materialWarehouseCode: body.materialWarehouseCode,
      note: body.note,
      syncCalendar: Boolean(body.syncCalendar),
    });
    await client.query("COMMIT");
    return NextResponse.json({ plan }, { status: 201 });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("duplicate key") || msg.includes("plan_code")) {
      return NextResponse.json({ error: "план с таким кодом уже есть", code: "duplicate" }, { status: 409 });
    }
    return wmsErrorResponse(e);
  } finally {
    client.release();
  }
}
