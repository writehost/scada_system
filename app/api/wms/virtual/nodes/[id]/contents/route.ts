import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { listVirtualNodeContents, saveVirtualNodeContents } from "@/lib/wms/virtual";
import { WmsHttpError } from "@/lib/wms/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  segmentData: { params: Promise<{ id: string }> }
) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  const params = await segmentData.params;
  const nodeId = params.id ?? "";
  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  if (!siteCode.trim() || !nodeId.trim()) {
    return NextResponse.json({ error: "siteCode and nodeId are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const data = await listVirtualNodeContents(client, siteId, nodeId);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function POST(
  req: Request,
  segmentData: { params: Promise<{ id: string }> }
) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  const params = await segmentData.params;
  const nodeId = params.id ?? "";

  let body: {
    siteCode?: string;
    contents?: Array<{
      itemCode: string;
      qty: number;
      uomCode?: string;
      lotCode?: string;
      note?: string;
      sortOrder?: number;
    }>;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const siteCode = typeof body.siteCode === "string" ? body.siteCode.trim() : "";
  if (!siteCode || !nodeId.trim()) {
    return NextResponse.json({ error: "siteCode and nodeId are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const data = await saveVirtualNodeContents(client, siteId, nodeId, Array.isArray(body.contents) ? body.contents : []);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  } finally {
    client.release();
  }
}
