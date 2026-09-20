import { NextResponse } from "next/server";
import { tryConnect, tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import {
  endDeviceSupportSession,
  postDeviceSupportTelemetry,
  respondDeviceSupport,
  uploadDeviceSupportScreenshot,
} from "@/lib/wms/device-support";
import { WmsHttpError } from "@/lib/wms/errors";
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message";
import { guardDeviceRequest } from "@/lib/wms/device-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }

  let body: {
    siteCode?: string;
    deviceUid?: string;
    sessionId?: string;
    action?: string;
    accept?: boolean;
    currentScreen?: string | null;
    events?: Array<{
      level?: string;
      eventType?: string;
      message: string;
      details?: Record<string, unknown> | null;
    }>;
    reason?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = (body.siteCode ?? "").trim();
  const deviceUid = (body.deviceUid ?? "").trim();
  const sessionId = (body.sessionId ?? "").trim();
  const action = (body.action ?? "").trim();
  if (!siteCode || !deviceUid || !action) {
    return NextResponse.json({ error: "siteCode, deviceUid and action are required" }, { status: 400 });
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

    if (action === "respond") {
      if (!sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
      const data = await respondDeviceSupport(client, siteId, deviceUid, sessionId, body.accept === true);
      return NextResponse.json(data);
    }
    if (action === "telemetry") {
      if (!sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
      const data = await postDeviceSupportTelemetry(client, siteId, deviceUid, sessionId, {
        currentScreen: body.currentScreen,
        events: body.events,
      });
      return NextResponse.json(data);
    }
    if (action === "screenshot") {
      if (!sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
      const data = await uploadDeviceSupportScreenshot(
        client,
        siteId,
        deviceUid,
        sessionId,
        body.screenshotBase64 ?? ""
      );
      return NextResponse.json(data);
    }
    if (action === "end") {
      if (!sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
      const data = await endDeviceSupportSession(
        client,
        siteId,
        deviceUid,
        sessionId,
        body.reason ?? "Завершено на ТСД"
      );
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    const errCode = typeof (e as { code?: string })?.code === "string" ? (e as { code: string }).code : "";
    if (errCode === "42P01" || errCode === "42703") {
      return NextResponse.json(
        { error: "support tables missing", code: "db_schema_outdated" },
        { status: 503 }
      );
    }
    if (e instanceof WmsHttpError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e), code: "db_query_failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
