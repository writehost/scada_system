import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { requireWmsActor } from "@/lib/wms/require-actor";
import {
  WMS_SCAN_EVENTS_CHANNEL,
  type WmsScannerMode,
  type WmsScannerScanEvent,
  type WmsScannerSource,
} from "@/lib/wms/scanner-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  segmentData: { params: Promise<{ sessionId: string }> }
) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true });
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 });

  const { sessionId } = await segmentData.params;
  const sid = decodeURIComponent(sessionId ?? "").trim();
  if (!sid) return NextResponse.json({ error: "sessionId is required" }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const siteCode = typeof b.siteCode === "string" ? b.siteCode.trim() : "";
  const code = typeof b.code === "string" ? b.code.trim() : "";
  const deviceUid = typeof b.deviceUid === "string" ? b.deviceUid.trim() : "";
  const mode = (typeof b.mode === "string" ? b.mode : "info") as WmsScannerMode;
  const source = (typeof b.source === "string" ? b.source : "tsd") as WmsScannerSource;

  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!code) return NextResponse.json({ error: "code is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });

    const ev: WmsScannerScanEvent = {
      siteId,
      siteCode,
      sessionId: sid,
      deviceUid: deviceUid || null,
      source: source === "serial" ? "serial" : "tsd",
      mode: mode === "collect" ? "collect" : "info",
      code,
      atIso: new Date().toISOString(),
    };

    // NOTIFY payload <= 8000 bytes; держим минимальным.
    await client.query(`SELECT pg_notify($1::text, $2::text)`, [
      WMS_SCAN_EVENTS_CHANNEL,
      JSON.stringify(ev),
    ]);
    return NextResponse.json({ ok: true });
  } finally {
    client.release();
  }
}

