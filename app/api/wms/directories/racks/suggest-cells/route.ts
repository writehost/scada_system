import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { suggestLocationsForRack } from "@/lib/wms/rack-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 });
  }

  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  const rackCode = (url.searchParams.get("rackCode") ?? "").trim().toUpperCase();

  if (!siteCode.trim()) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!rackCode) return NextResponse.json({ error: "rackCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const cells = await suggestLocationsForRack(client, siteId, rackCode);
    return NextResponse.json({ cells });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "rack not found") return NextResponse.json({ error: "стеллаж не найден" }, { status: 404 });
    if (msg.includes("wms_rack") || msg.includes("does not exist")) {
      return NextResponse.json({ cells: [] });
    }
    throw e;
  } finally {
    client.release();
  }
}
