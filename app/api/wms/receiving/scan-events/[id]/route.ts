import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { deleteReceivingScanEvent, updateReceivingScanEventQty } from "@/lib/wms/code-lists";
import { WmsHttpError } from "@/lib/wms/errors";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  segmentData: { params: Promise<{ id: string }> }
) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true });
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  const params = await segmentData.params;
  const scanEventId = decodeURIComponent(params.id ?? "").trim();
  if (!scanEventId) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  let body: { siteCode?: string; qty?: number };
  try {
    body = (await req.json()) as { siteCode?: string; qty?: number };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const siteCode = String(body.siteCode ?? "").trim();
  const qty = Number(body.qty);
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ error: "qty must be a positive number" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const result = await updateReceivingScanEventQty(client, siteId, scanEventId, qty);
    return NextResponse.json(result);
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

export async function DELETE(
  req: Request,
  segmentData: { params: Promise<{ id: string }> }
) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true });
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  const params = await segmentData.params;
  const scanEventId = decodeURIComponent(params.id ?? "").trim();
  const siteCode = new URL(req.url).searchParams.get("siteCode")?.trim() ?? "";
  if (!siteCode || !scanEventId) {
    return NextResponse.json({ error: "siteCode and id are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const result = await deleteReceivingScanEvent(client, siteId, scanEventId);
    return NextResponse.json(result);
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
