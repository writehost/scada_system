import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { wmsErrorResponse } from "@/lib/wms/errors";
import { mergeTorg16Fields, parseTorg16FieldsPartial, saveTorg16DocumentForm } from "@/lib/wms/torg16";
import { loadTorg16ForDocument } from "@/lib/wms/writeoff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const pool = tryGetPool();
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 });
  const siteCode = new URL(req.url).searchParams.get("siteCode") ?? "";
  if (!siteCode.trim()) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  const { id } = await ctx.params;

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const form = await loadTorg16ForDocument(client, siteId, id);
    if (!form) return NextResponse.json({ error: "document not found" }, { status: 404 });
    return NextResponse.json({ form });
  } catch (e) {
    return wmsErrorResponse(e);
  } finally {
    client.release();
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const pool = tryGetPool();
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 });
  let body: { siteCode?: string; fields?: unknown; title?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const siteCode = String(body.siteCode ?? "").trim();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  const { id } = await ctx.params;

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const current = await loadTorg16ForDocument(client, siteId, id);
    if (!current) return NextResponse.json({ error: "document not found" }, { status: 404 });
    const next = mergeTorg16Fields(current.fields, parseTorg16FieldsPartial(body.fields ?? {}));
    await saveTorg16DocumentForm(client, siteId, id, next, body.title || current.title);
    const form = await loadTorg16ForDocument(client, siteId, id);
    return NextResponse.json({ form });
  } catch (e) {
    return wmsErrorResponse(e);
  } finally {
    client.release();
  }
}
