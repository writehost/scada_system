import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { dismissEmptyReceivingSession } from "@/lib/wms/receiving-finalize";
import { normalizeOperatorDeviceUid } from "@/lib/wms/devices";
import { WmsHttpError } from "@/lib/wms/errors";
import { normalizeTsdDocumentId } from "@/lib/wms/receiving-tsd-sessions";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true });
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: {
    siteCode?: string;
    documentId?: string;
    deviceUid?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const siteCode = String(body.siteCode ?? "").trim();
  const documentId = normalizeTsdDocumentId(String(body.documentId ?? ""));
  const deviceUid = normalizeOperatorDeviceUid(String(body.deviceUid ?? "web-operator"));

  if (!siteCode || !documentId) {
    return NextResponse.json({ error: "siteCode and documentId are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const result = await dismissEmptyReceivingSession(client, siteId, {
      documentId,
      deviceUid,
    });
    return NextResponse.json({ ok: true, ...result });
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
