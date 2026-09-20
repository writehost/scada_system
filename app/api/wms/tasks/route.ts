import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { runIdempotentWrite } from "@/lib/wms/idempotency";
import { WmsHttpError } from "@/lib/wms/errors";
import { listTasks, createOperationalTasks, type CreateOperationalTasksInput } from "@/lib/wms/tasks";
import { parseRequestId } from "@/lib/wms/uuid";
import { requireWmsActor } from "@/lib/wms/require-actor";

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
  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const data = await listTasks(client, siteId, {
      cursor: url.searchParams.get("cursor"),
      limit: Number(url.searchParams.get("limit") ?? "50"),
      status: url.searchParams.get("status") ?? "",
      type: url.searchParams.get("type") ?? "",
      query: url.searchParams.get("query") ?? "",
      assignedUserId: url.searchParams.get("assignedUserId") ?? "",
    });
    return NextResponse.json(data);
  } finally {
    client.release();
  }
}

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: CreateOperationalTasksInput;
  try {
    body = (await req.json()) as CreateOperationalTasksInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const requestId = parseRequestId((body as { requestId?: string }).requestId);
  const siteCode = typeof body.siteCode === "string" ? body.siteCode.trim() : "";
  const operationType =
    typeof body.operationType === "string" ? body.operationType.trim() : "";

  if (!requestId) {
    return NextResponse.json({ error: "requestId must be a UUID" }, { status: 400 });
  }
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }
  if (!["receipt", "shipment", "revision"].includes(operationType)) {
    return NextResponse.json(
      { error: "operationType must be receipt, shipment or revision" },
      { status: 400 }
    );
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: "non-empty lines are required" }, { status: 400 });
  }

  const probe = await pool.connect();
  let siteId: number;
  try {
    const resolvedSiteId = await getSiteId(probe, siteCode);
    if (resolvedSiteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    siteId = resolvedSiteId;
  } finally {
    probe.release();
  }

  try {
    const result = await runIdempotentWrite(
      pool,
      requestId,
      siteId,
      `task_batch_${operationType}`,
      body,
      (client) => createOperationalTasks(client, siteId, body)
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
    return NextResponse.json(
      { error: "internal error", disposition: "failed" },
      { status: 500 }
    );
  }
}
