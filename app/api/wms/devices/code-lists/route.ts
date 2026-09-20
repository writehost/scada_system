import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { WmsHttpError } from "@/lib/wms/errors";
import { parseRequestId } from "@/lib/wms/uuid";
import { createCodeList, listCodeListsForDevice, type CodeListEntry } from "@/lib/wms/code-lists";
import { guardDeviceRequest } from "@/lib/wms/device-auth";

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
  const deviceUid = url.searchParams.get("deviceUid") ?? "";
  if (!siteCode.trim() || !deviceUid.trim()) {
    return NextResponse.json({ error: "siteCode and deviceUid are required" }, { status: 400 });
  }
  const deviceAuthError = await guardDeviceRequest(req, { siteCode, deviceUid });
  if (deviceAuthError) return deviceAuthError;
  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const data = await listCodeListsForDevice(client, siteId, deviceUid, {
      limit: Number(url.searchParams.get("limit") ?? "20"),
    });
    return NextResponse.json(data);
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

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: {
    requestId?: string;
    siteCode?: string;
    deviceUid?: string;
    listType?: string;
    palletCode?: string | null;
    reasonCode?: string | null;
    entries?: CodeListEntry[];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const requestId = parseRequestId(body.requestId);
  const siteCode = typeof body.siteCode === "string" ? body.siteCode.trim() : "";
  const deviceUid = typeof body.deviceUid === "string" ? body.deviceUid.trim() : "";
  const listType = typeof body.listType === "string" ? body.listType.trim() : "";
  if (!requestId) {
    return NextResponse.json({ error: "requestId must be a UUID" }, { status: 400 });
  }
  if (!siteCode || !deviceUid || !listType) {
    return NextResponse.json({ error: "siteCode, deviceUid, listType are required" }, { status: 400 });
  }
  const deviceAuthError = await guardDeviceRequest(req, { siteCode, deviceUid });
  if (deviceAuthError) return deviceAuthError;

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const data = await createCodeList(client, siteId, {
      requestId,
      deviceUid,
      listType: listType as any,
      palletCode: body.palletCode ?? null,
      reasonCode: body.reasonCode ?? null,
      entries: Array.isArray(body.entries) ? body.entries : [],
    });
    return NextResponse.json(data);
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

