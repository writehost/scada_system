import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { completeTask } from "@/lib/wms/tasks";
import { runIdempotentWrite } from "@/lib/wms/idempotency";
import { parseRequestId } from "@/lib/wms/uuid";
import { WmsHttpError } from "@/lib/wms/errors";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  segmentData: { params: Promise<{ id: string }> }
) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  const params = await segmentData.params;
  const taskId = params.id ?? "";
  let body: {
    requestId?: string;
    siteCode?: string;
    confirmedQty?: number;
    targetLocationCode?: string;
    note?: string;
  };
  try {
    body = (await req.json()) as {
      requestId?: string;
      siteCode?: string;
      confirmedQty?: number;
      targetLocationCode?: string;
      note?: string;
    };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const requestId = parseRequestId(body.requestId);
  const siteCode = typeof body.siteCode === "string" ? body.siteCode : "";
  if (!requestId || !siteCode.trim() || !taskId.trim()) {
    return NextResponse.json(
      { error: "requestId, siteCode and task id are required" },
      { status: 400 }
    );
  }
  const probe = await pool.connect();
  let siteId: number;
  try {
    const sid = await getSiteId(probe, siteCode);
    if (sid == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    siteId = sid;
  } finally {
    probe.release();
  }
  try {
    const result = await runIdempotentWrite(
      pool,
      requestId,
      siteId,
      "task_complete",
      { ...body, taskId },
      (client) =>
        completeTask(client, siteId, taskId, {
          confirmedQty:
            typeof body.confirmedQty === "number" && Number.isFinite(body.confirmedQty)
              ? body.confirmedQty
              : undefined,
          targetLocationCode: body.targetLocationCode,
          note: body.note,
        })
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json(
        { error: error.message, code: error.code, disposition: "failed" },
        { status: error.status }
      );
    }
    console.error(error);
    return NextResponse.json({ error: "internal error", disposition: "failed" }, { status: 500 });
  }
}
