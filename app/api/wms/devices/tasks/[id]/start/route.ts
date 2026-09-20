import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { startTaskByDevice } from "@/lib/wms/tasks";
import { runIdempotentWrite } from "@/lib/wms/idempotency";
import { parseRequestId } from "@/lib/wms/uuid";
import { WmsHttpError } from "@/lib/wms/errors";
import { assertDeviceMutationAllowed } from "@/lib/wms/device-operator-auth";
import { guardDeviceRequest } from "@/lib/wms/device-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  segmentData: { params: Promise<{ id: string }> }
) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  const params = await segmentData.params;
  const taskId = params.id ?? "";
  let body: { requestId?: string; siteCode?: string; deviceUid?: string; operatorUserId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const requestId = parseRequestId(body.requestId);
  const siteCode = typeof body.siteCode === "string" ? body.siteCode : "";
  const deviceUid = typeof body.deviceUid === "string" ? body.deviceUid : "";
  if (!requestId || !siteCode.trim() || !taskId.trim() || !deviceUid.trim()) {
    return NextResponse.json(
      { error: "requestId, siteCode, taskId and deviceUid are required" },
      { status: 400 }
    );
  }
  const deviceAuthError = await guardDeviceRequest(req, { siteCode, deviceUid });
  if (deviceAuthError) return deviceAuthError;

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
      "task_start_device",
      { ...body, taskId },
      (client) =>
        assertDeviceMutationAllowed(client, siteId, deviceUid, body.operatorUserId, taskId).then(() =>
          startTaskByDevice(client, siteId, taskId, deviceUid)
        )
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
