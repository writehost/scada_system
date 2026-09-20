import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { setRackCells } from "@/lib/wms/rack-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  siteCode?: string;
  rackCode?: string;
  locationCodes?: string[];
};

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = (body.siteCode ?? "").trim();
  const rackCode = decodeURIComponent(body.rackCode ?? "").trim().toUpperCase();
  const locationCodes = Array.isArray(body.locationCodes) ? body.locationCodes : [];

  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!rackCode) return NextResponse.json({ error: "rackCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const rack = await setRackCells(client, siteId, rackCode, locationCodes);
    return NextResponse.json({ rack });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "rack not found") return NextResponse.json({ error: "стеллаж не найден" }, { status: 404 });
    if (msg.startsWith("ячейки не найдены")) return NextResponse.json({ error: msg }, { status: 400 });
    throw e;
  } finally {
    client.release();
  }
}
