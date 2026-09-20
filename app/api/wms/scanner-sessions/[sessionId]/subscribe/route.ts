import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { WMS_SCAN_EVENTS_CHANNEL, type WmsScannerScanEvent } from "@/lib/wms/scanner-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseEvent(payload: string | null): WmsScannerScanEvent | null {
  if (!payload) return null;
  try {
    const j = JSON.parse(payload) as Partial<WmsScannerScanEvent>;
    if (!j || typeof j !== "object") return null;
    if (typeof j.siteId !== "number") return null;
    if (typeof j.siteCode !== "string") return null;
    if (typeof j.sessionId !== "string") return null;
    if (typeof j.code !== "string") return null;
    if (typeof j.mode !== "string") return null;
    if (typeof j.source !== "string") return null;
    return {
      siteId: j.siteId,
      siteCode: j.siteCode,
      sessionId: j.sessionId,
      deviceUid: typeof j.deviceUid === "string" ? j.deviceUid : null,
      source: j.source === "serial" ? "serial" : "tsd",
      mode: j.mode === "collect" ? "collect" : "info",
      code: j.code,
      atIso: typeof j.atIso === "string" ? j.atIso : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function GET(
  req: Request,
  segmentData: { params: Promise<{ sessionId: string }> }
) {
  const pool = tryGetPool();
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 });

  const { sessionId } = await segmentData.params;
  const sid = decodeURIComponent(sessionId ?? "").trim();
  if (!sid) return NextResponse.json({ error: "sessionId is required" }, { status: 400 });

  const url = new URL(req.url);
  const siteCode = (url.searchParams.get("siteCode") ?? "").trim();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });

  const timeoutSecRaw = Number(url.searchParams.get("timeout") ?? "30");
  const timeoutSec = Number.isFinite(timeoutSecRaw)
    ? Math.min(Math.max(Math.trunc(timeoutSecRaw), 1), 60)
    : 30;

  const probe = await pool.connect();
  let siteId: number;
  try {
    const sidDb = await getSiteId(probe, siteCode);
    if (sidDb == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    siteId = sidDb;
  } finally {
    probe.release();
  }

  const client = await pool.connect();
  try {
    await client.query(`LISTEN ${WMS_SCAN_EVENTS_CHANNEL}`);
    const event = await new Promise<WmsScannerScanEvent | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutSec * 1000);
      const onAbort = () => {
        clearTimeout(timer);
        resolve(null);
      };
      const onNotify = (msg: { channel: string; payload?: string }) => {
        if (msg.channel !== WMS_SCAN_EVENTS_CHANNEL) return;
        const ev = parseEvent(msg.payload ?? null);
        if (!ev) return;
        if (ev.siteId !== siteId) return;
        if (ev.sessionId !== sid) return;
        clearTimeout(timer);
        req.signal.removeEventListener("abort", onAbort);
        client.removeListener("notification", onNotify);
        resolve(ev);
      };
      client.on("notification", onNotify);
      req.signal.addEventListener("abort", onAbort, { once: true });
    });

    return NextResponse.json({
      event: event ?? { eventType: "timeout", atIso: new Date().toISOString() },
    });
  } finally {
    client.release();
  }
}

