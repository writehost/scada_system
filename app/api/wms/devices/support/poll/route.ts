import { NextResponse } from "next/server";
import { tryConnect, tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { pollDeviceSupport } from "@/lib/wms/device-support";
import { WmsHttpError } from "@/lib/wms/errors";
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message";
import { guardDeviceRequest } from "@/lib/wms/device-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }

  const url = new URL(req.url);
  const siteCode = (url.searchParams.get("siteCode") ?? "").trim();
  const deviceUid = (url.searchParams.get("deviceUid") ?? "").trim();
  const sessionId = url.searchParams.get("sessionId") ?? "";
  if (!siteCode || !deviceUid) {
    return NextResponse.json({ error: "siteCode and deviceUid are required" }, { status: 400 });
  }
  const deviceAuthError = await guardDeviceRequest(req, { siteCode, deviceUid });
  if (deviceAuthError) return deviceAuthError;

  const conn = await tryConnect(pool);
  if (!conn.ok) {
    return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status });
  }

  const client = conn.client;
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const data = await pollDeviceSupport(client, siteId, deviceUid, sessionId);
    return NextResponse.json(data);
  } catch (e) {
    const code = typeof (e as { code?: string })?.code === "string" ? (e as { code: string }).code : "";
    if (code === "42P01" || code === "42703") {
      return NextResponse.json({ session: null, screenshotRequested: false, tableMissing: true });
    }
    if (e instanceof WmsHttpError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e), code: "db_query_failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
