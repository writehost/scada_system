import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { listTasksForDevice } from "@/lib/wms/tasks";
import { WmsHttpError } from "@/lib/wms/errors";
import { guardDeviceRequest } from "@/lib/wms/device-auth";
import {
  filterTasksByRoleCodes,
  resolveDeviceOperatorAuth,
} from "@/lib/wms/device-operator-auth";

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
  const deviceUid = url.searchParams.get("deviceUid") ?? "";
  if (!siteCode.trim() || !deviceUid.trim()) {
    return NextResponse.json({ error: "siteCode and deviceUid are required" }, { status: 400 });
  }
  const deviceAuthError = await guardDeviceRequest(req, { siteCode, deviceUid });
  if (deviceAuthError) return deviceAuthError;

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const data = await listTasksForDevice(client, siteId, deviceUid, {
      cursor: url.searchParams.get("cursor"),
      limit: Number(url.searchParams.get("limit") ?? "50"),
      status: url.searchParams.get("status") ?? "",
      type: url.searchParams.get("type") ?? "",
      query: url.searchParams.get("query") ?? "",
    });
    const adminScope = url.searchParams.get("scope") === "admin"
    const operatorUserId = url.searchParams.get("operatorUserId") ?? "";
    let tasks = data.tasks;
    if (!adminScope) {
      const auth = await resolveDeviceOperatorAuth(
        client,
        siteId,
        deviceUid,
        operatorUserId.trim() || null
      );
      if (auth.kind === "resolved") {
        if (auth.roleCodes.length === 0) {
          throw new WmsHttpError(403, "У оператора нет ролей WMS.", "no_roles");
        }
        tasks = filterTasksByRoleCodes(tasks, auth.roleCodes);
      }
    }
    return NextResponse.json({ ...data, tasks });
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
