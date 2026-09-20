import { NextResponse } from "next/server";
import { tryConnect, tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import {
  endDeviceSupportSession,
  getDeviceSupportStatus,
  requestDeviceSupportScreenshot,
  requestDeviceSupportSession,
} from "@/lib/wms/device-support";
import { WmsHttpError } from "@/lib/wms/errors";
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function supportSchemaError(e: unknown) {
  const code = typeof (e as { code?: string })?.code === "string" ? (e as { code: string }).code : "";
  if (code === "42P01" || code === "42703") {
    return NextResponse.json(
      {
        error:
          "Таблицы режима поддержки не установлены. Выполните патч db/patches/2026-06-12_device_support_sessions.sql",
        code: "db_schema_outdated",
      },
      { status: 503 }
    );
  }
  return null;
}

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

  const conn = await tryConnect(pool);
  if (!conn.ok) {
    return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status });
  }

  const client = conn.client;
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const data = await getDeviceSupportStatus(client, siteId, deviceUid, sessionId);
    return NextResponse.json(data);
  } catch (e) {
    const schema = supportSchemaError(e);
    if (schema) return schema;
    if (e instanceof WmsHttpError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e), code: "db_query_failed" }, { status: 500 });
  } finally {
    client.release();
  }
}

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
    requestedBy?: string | null;
    reason?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = (body.siteCode ?? "").trim();
  const deviceUid = (body.deviceUid ?? "").trim();
  const action = (body.action ?? "").trim();
  const sessionId = (body.sessionId ?? "").trim();
  if (!siteCode || !deviceUid || !action) {
    return NextResponse.json({ error: "siteCode, deviceUid and action are required" }, { status: 400 });
  }

  const conn = await tryConnect(pool);
  if (!conn.ok) {
    return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status });
  }

  const client = conn.client;
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });

    if (action === "request") {
      const data = await requestDeviceSupportSession(client, siteId, deviceUid, body.requestedBy);
      return NextResponse.json(data);
    }
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required for this action" }, { status: 400 });
    }
    if (action === "end") {
      const data = await endDeviceSupportSession(client, siteId, deviceUid, sessionId, body.reason);
      return NextResponse.json(data);
    }
    if (action === "request_screenshot") {
      const data = await requestDeviceSupportScreenshot(client, siteId, deviceUid, sessionId);
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    const schema = supportSchemaError(e);
    if (schema) return schema;
    if (e instanceof WmsHttpError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e), code: "db_query_failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
