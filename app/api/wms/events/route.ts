import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { requireDeviceByUid, touchWmsDevice } from "@/lib/wms/devices";
import { WMS_TASK_EVENTS_CHANNEL, type WmsTaskEvent } from "@/lib/wms/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseEvent(payload: string | null): WmsTaskEvent | null {
  if (!payload) return null;
  try {
    const j = JSON.parse(payload) as Partial<WmsTaskEvent>;
    if (!j || typeof j !== "object") return null;
    if (typeof j.siteId !== "number") return null;
    if (typeof j.taskId !== "string") return null;
    if (typeof j.eventType !== "string") return null;
    return {
      siteId: j.siteId,
      taskId: j.taskId,
      eventType: j.eventType as WmsTaskEvent["eventType"],
      deviceUid: typeof j.deviceUid === "string" ? j.deviceUid : null,
      atIso: typeof j.atIso === "string" ? j.atIso : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 });

  const url = new URL(req.url);
  const siteCode = (url.searchParams.get("siteCode") ?? "").trim();
  const deviceUid = (url.searchParams.get("deviceUid") ?? "").trim();
  if (!siteCode || !deviceUid) {
    return NextResponse.json({ error: "siteCode and deviceUid are required" }, { status: 400 });
  }

  const client = await pool.connect();
  let siteId: number;
  try {
    const sid = await getSiteId(client, siteCode);
    if (sid == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    siteId = sid;
    // ensure device exists + active
    await requireDeviceByUid(client, siteId, deviceUid);
    // touch last_seen (SSE keepalive might be long)
    await touchWmsDevice(client, siteId, deviceUid);
    await client.query(`LISTEN ${WMS_TASK_EVENTS_CHANNEL}`);
  } catch (e) {
    client.release();
    const msg = e instanceof Error ? e.message : "internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const keepAlive = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 20000);

      const onAbort = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        try {
          controller.close();
        } catch {
          // ignore
        }
        client.removeListener("notification", onNotify);
        client.release();
      };

      const onNotify = (msg: { channel: string; payload?: string }) => {
        if (closed) return;
        if (msg.channel !== WMS_TASK_EVENTS_CHANNEL) return;
        const ev = parseEvent(msg.payload ?? null);
        if (!ev) return;
        if (ev.siteId !== siteId) return;
        if (ev.deviceUid && ev.deviceUid !== deviceUid) return;
        controller.enqueue(encoder.encode(`event: ${ev.eventType}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };

      client.on("notification", onNotify);
      // initial ready
      controller.enqueue(encoder.encode(`event: ready\ndata: {"ok":true}\n\n`));
      req.signal.addEventListener("abort", onAbort, { once: true });
    },
    cancel() {
      try {
        client.release();
      } catch {
        // ignore
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

