import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { createRackDef, listRackDefs } from "@/lib/wms/rack-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 });
  }

  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  const includeCells = url.searchParams.get("includeCells") === "1";

  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const racks = await listRackDefs(client, siteId, { includeCells });
    return NextResponse.json({ racks });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "query failed";
    if (msg.includes("wms_rack") || msg.includes("does not exist")) {
      return NextResponse.json({ racks: [] });
    }
    throw e;
  } finally {
    client.release();
  }
}

type PostBody = {
  siteCode?: string;
  code?: string;
  name?: string;
  addressLabel?: string | null;
  warehouseCode?: string | null;
  zoneCode?: string | null;
  meta?: Record<string, unknown>;
};

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = (body.siteCode ?? "").trim();
  const name = (body.name ?? "").trim();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const rack = await createRackDef(client, siteId, body);
    return NextResponse.json({ rack }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("duplicate key") || msg.includes("rack_code")) {
      return NextResponse.json({ error: "стеллаж с таким кодом уже есть", code: "duplicate" }, { status: 409 });
    }
    if (msg.includes("code:") || msg.includes("name is required")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if (msg.includes("wms_rack") || msg.includes("does not exist")) {
      return NextResponse.json({ error: "таблица стеллажей не создана — выполните миграцию БД" }, { status: 503 });
    }
    throw e;
  } finally {
    client.release();
  }
}
