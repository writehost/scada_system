import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { getRackForLocation } from "@/lib/wms/rack-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 });
  }

  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  const locationCode = (url.searchParams.get("locationCode") ?? "").trim().toUpperCase();

  if (!siteCode.trim()) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!locationCode) return NextResponse.json({ error: "locationCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const rack = await getRackForLocation(client, siteId, locationCode);
    return NextResponse.json({ rack });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("wms_rack") || msg.includes("does not exist")) {
      return NextResponse.json({ rack: null });
    }
    throw e;
  } finally {
    client.release();
  }
}
