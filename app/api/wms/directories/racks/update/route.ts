import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { patchRackDef } from "@/lib/wms/rack-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UpdateBody = {
  siteCode?: string;
  rackCode?: string;
  name?: string;
  addressLabel?: string | null;
  warehouseCode?: string | null;
  zoneCode?: string | null;
  isActive?: boolean;
  meta?: Record<string, unknown>;
};

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 });
  }

  let body: UpdateBody;
  try {
    body = (await req.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = (body.siteCode ?? "").trim();
  const rackCode = decodeURIComponent(body.rackCode ?? "").trim().toUpperCase();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!rackCode) return NextResponse.json({ error: "rackCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const rack = await patchRackDef(client, siteId, rackCode, body);
    if (!rack) return NextResponse.json({ error: "not found or no fields to update" }, { status: 404 });
    return NextResponse.json({ rack });
  } finally {
    client.release();
  }
}
