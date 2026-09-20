import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { wmsErrorResponse } from "@/lib/wms/errors";
import {
  defaultTorg16Settings,
  getTorg16Settings,
  saveTorg16Settings,
  TORG16_VARIABLE_KEYS,
} from "@/lib/wms/torg16";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 });
  const siteCode = new URL(req.url).searchParams.get("siteCode") ?? "";
  if (!siteCode.trim()) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const settings = await getTorg16Settings(client, siteId);
    return NextResponse.json({
      settings,
      defaults: defaultTorg16Settings(),
      variables: TORG16_VARIABLE_KEYS,
    });
  } catch (e) {
    return wmsErrorResponse(e);
  } finally {
    client.release();
  }
}

export async function PUT(req: Request) {
  const pool = tryGetPool();
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 });
  let body: { siteCode?: string; settings?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const siteCode = String(body.siteCode ?? "").trim();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const current = await getTorg16Settings(client, siteId);
    const raw = body.settings && typeof body.settings === "object" ? body.settings : {};
    const pick = (key: keyof typeof current) =>
      typeof raw[key] === "string" ? String(raw[key]) : current[key];
    const saved = await saveTorg16Settings(client, siteId, {
      orgName: pick("orgName"),
      orgAddress: pick("orgAddress"),
      orgPhone: pick("orgPhone"),
      okpo: pick("okpo"),
      okdp: pick("okdp"),
      approveTitle: pick("approveTitle"),
      approveName: pick("approveName"),
      commissionChair: pick("commissionChair"),
      commissionMember1: pick("commissionMember1"),
      commissionMember2: pick("commissionMember2"),
      materiallyResponsible: pick("materiallyResponsible"),
    });
    return NextResponse.json({
      settings: saved,
      defaults: defaultTorg16Settings(),
      variables: TORG16_VARIABLE_KEYS,
    });
  } catch (e) {
    return wmsErrorResponse(e);
  } finally {
    client.release();
  }
}
