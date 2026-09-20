import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import {
  defaultTorg1Settings,
  getTorg1Settings,
  saveTorg1Settings,
  TORG1_VARIABLE_HELP,
} from "@/lib/wms/torg1";

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
    const settings = await getTorg1Settings(client, siteId);
    return NextResponse.json({
      settings,
      defaults: defaultTorg1Settings(),
      variables: TORG1_VARIABLE_HELP,
    });
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
    const current = await getTorg1Settings(client, siteId);
    const raw = body.settings && typeof body.settings === "object" ? body.settings : {};
    const saved = await saveTorg1Settings(client, siteId, {
      orgName: typeof raw.orgName === "string" ? raw.orgName : current.orgName,
      orgAddress: typeof raw.orgAddress === "string" ? raw.orgAddress : current.orgAddress,
      orgPhone: typeof raw.orgPhone === "string" ? raw.orgPhone : current.orgPhone,
      okpo: typeof raw.okpo === "string" ? raw.okpo : current.okpo,
      okdp: typeof raw.okdp === "string" ? raw.okdp : current.okdp,
      approveTitle: typeof raw.approveTitle === "string" ? raw.approveTitle : current.approveTitle,
      approveName: typeof raw.approveName === "string" ? raw.approveName : current.approveName,
    });
    return NextResponse.json({
      settings: saved,
      defaults: defaultTorg1Settings(),
      variables: TORG1_VARIABLE_HELP,
    });
  } finally {
    client.release();
  }
}
