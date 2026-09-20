import { NextResponse } from "next/server";
import { tryConnect, tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { requireDeviceByUid, touchWmsDevice } from "@/lib/wms/devices";
import { notifyWmsTaskEvent } from "@/lib/wms/events";
import { WmsHttpError } from "@/lib/wms/errors";
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }

  let body: { siteCode?: string; deviceUid?: string; message?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = (body.siteCode ?? "").trim();
  const deviceUid = (body.deviceUid ?? "").trim();
  const message = (body.message ?? "Тестовый push с сервера WMS").trim() || "Тестовый push с сервера WMS";

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

    await requireDeviceByUid(client, siteId, deviceUid);
    await touchWmsDevice(client, siteId, deviceUid);

    await notifyWmsTaskEvent(client, {
      siteId,
      taskId: "push-test",
      eventType: "push_test",
      deviceUid,
      message,
    });

    return NextResponse.json({ ok: true, deviceUid, message });
  } catch (e) {
    if (e instanceof WmsHttpError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e), code: "db_query_failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
