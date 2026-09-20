import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { getTaskDetail } from "@/lib/wms/tasks";
import { assertDeviceTaskReadAllowed } from "@/lib/wms/device-operator-auth";
import { WmsHttpError } from "@/lib/wms/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
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
  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  const deviceUid = url.searchParams.get("deviceUid") ?? "";
  const operatorUserId = url.searchParams.get("operatorUserId") ?? "";
  if (!siteCode.trim() || !taskId.trim()) {
    return NextResponse.json(
      { error: "siteCode and task id are required" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    if (deviceUid.trim()) {
      await assertDeviceTaskReadAllowed(
        client,
        siteId,
        deviceUid,
        operatorUserId.trim() || null,
        taskId
      );
    }
    const detail = await getTaskDetail(client, siteId, taskId);
    if (!detail) {
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  } finally {
    client.release();
  }
}
