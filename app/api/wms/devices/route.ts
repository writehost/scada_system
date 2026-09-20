import { NextResponse } from "next/server";
import { tryConnect, tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { deleteWmsDeviceById, listWmsDevices } from "@/lib/wms/devices";
import { backfillPrintTerminalsFromOrders } from "@/lib/wms/print-terminal";
import { WmsHttpError } from "@/lib/wms/errors";
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const conn = await tryConnect(pool);
  if (!conn.ok) {
    return NextResponse.json(
      { error: conn.message, code: conn.code },
      { status: conn.status }
    );
  }
  const client = conn.client;
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    try {
      await backfillPrintTerminalsFromOrders(client, siteId);
      const data = await listWmsDevices(client, siteId, {
        query: url.searchParams.get("query") ?? "",
        status: url.searchParams.get("status") ?? "",
      });
      return NextResponse.json(data);
    } catch (e) {
      console.error("[GET /api/wms/devices]", e);
      return NextResponse.json(
        { error: wmsDbErrorToUserMessage(e), code: "db_query_failed" },
        { status: 500 }
      );
    }
  } finally {
    client.release();
  }
}

export async function DELETE(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  const deviceId = url.searchParams.get("deviceId") ?? "";
  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }
  if (!deviceId.trim()) {
    return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    await deleteWmsDeviceById(client, siteId, deviceId.trim());
    return NextResponse.json({ ok: true });
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
