import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import {
  getIssueActSettings,
  saveIssueActSettings,
  DEFAULT_ISSUE_ACT_TEMPLATE,
} from "@/lib/wms/issue-act";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveSite(req: Request) {
  const pool = tryGetPool();
  if (!pool) return { pool: null, siteId: null, error: "database not configured" };
  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  if (!siteCode.trim()) return { pool, siteId: null, error: "siteCode is required" };
  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return { pool, siteId: null, error: "unknown siteCode" };
    return { pool, siteId, error: null };
  } finally {
    client.release();
  }
}

export async function GET(req: Request) {
  const resolved = await resolveSite(req);
  if (!resolved.pool) return NextResponse.json({ error: resolved.error }, { status: 503 });
  if (resolved.siteId == null) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.error === "unknown siteCode" ? 404 : 400 });
  }
  const client = await resolved.pool.connect();
  try {
    const settings = await getIssueActSettings(client, resolved.siteId);
    return NextResponse.json({ ...settings, defaultTemplate: DEFAULT_ISSUE_ACT_TEMPLATE });
  } finally {
    client.release();
  }
}

export async function PATCH(req: Request) {
  const resolved = await resolveSite(req);
  if (!resolved.pool) return NextResponse.json({ error: resolved.error }, { status: 503 });
  if (resolved.siteId == null) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.error === "unknown siteCode" ? 404 : 400 });
  }

  let body: { enabled?: unknown; template?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const client = await resolved.pool.connect();
  try {
    const current = await getIssueActSettings(client, resolved.siteId);
    const settings = await saveIssueActSettings(client, resolved.siteId, {
      enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
      template: typeof body.template === "string" ? body.template : current.template,
    });
    return NextResponse.json({ ...settings, defaultTemplate: DEFAULT_ISSUE_ACT_TEMPLATE });
  } finally {
    client.release();
  }
}
