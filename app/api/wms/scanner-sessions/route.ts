import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type WmsScannerSessionCreateResponse = {
  sessionId: string;
  expiresAtIso: string;
};

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true });
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const siteCode = typeof b.siteCode === "string" ? b.siteCode.trim() : "";
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });

  // Привязываем сессию к существующему site_id (чтобы на клиенте не было "пустых" сессий).
  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });

    const sessionId = crypto.randomUUID();
    const expiresAtIso = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 минут
    const res: WmsScannerSessionCreateResponse = { sessionId, expiresAtIso };
    return NextResponse.json(res);
  } finally {
    client.release();
  }
}

