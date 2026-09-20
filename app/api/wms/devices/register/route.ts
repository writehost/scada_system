import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { registerWmsDevice } from "@/lib/wms/devices";
import { guardDeviceRequest } from "@/lib/wms/device-auth";
import { WmsHttpError } from "@/lib/wms/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: {
    siteCode?: string;
    deviceUid?: string;
    deviceName?: string;
    platform?: string;
    appVersion?: string;
    deviceInfo?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = typeof body.siteCode === "string" ? body.siteCode.trim() : "";
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }
  const deviceUid = typeof body.deviceUid === "string" ? body.deviceUid.trim() : "";
  const deviceAuthError = await guardDeviceRequest(req, {
    siteCode,
    deviceUid,
    allowUnregistered: true,
  });
  if (deviceAuthError) return deviceAuthError;

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const device = await registerWmsDevice(client, siteId, {
      deviceUid,
      deviceName: typeof body.deviceName === "string" ? body.deviceName : "",
      platform: typeof body.platform === "string" ? body.platform : undefined,
      appVersion: typeof body.appVersion === "string" ? body.appVersion : undefined,
      deviceInfo:
        body.deviceInfo && typeof body.deviceInfo === "object"
          ? (body.deviceInfo as Record<string, unknown>)
          : undefined,
    });
    return NextResponse.json({ device });
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
