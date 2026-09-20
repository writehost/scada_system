import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { emptyTorg1Fields, parseTorg1FieldsPartial, saveTorg1DocumentForm, type Torg1Fields } from "@/lib/wms/torg1";
import { computeTorg1Overrides, loadTorg1ForDocument } from "@/lib/wms/torg1-load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function coalesceFields(base: Torg1Fields, partial: Partial<Torg1Fields>): Torg1Fields {
  return {
    ...base,
    ...partial,
    lines: partial.lines ?? base.lines,
  };
}

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
    const form = await loadTorg1ForDocument(client, siteId, id);
    if (!form) return NextResponse.json({ error: "document not found" }, { status: 404 });
    return NextResponse.json({ form });
  } finally {
    client.release();
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const pool = tryGetPool();
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 });

  let body: {
    siteCode?: string;
    fields?: unknown;
    overrides?: unknown;
    title?: string;
  };
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
    const current = await loadTorg1ForDocument(client, siteId, id);
    if (!current) return NextResponse.json({ error: "document not found" }, { status: 404 });

    let overrides = parseTorg1FieldsPartial(body.overrides ?? {});
    if (body.fields && typeof body.fields === "object") {
      const partial = parseTorg1FieldsPartial(body.fields);
      const next = coalesceFields(current.fields, partial);
      // Ensure all keys present for diff
      const full = coalesceFields(emptyTorg1Fields(), next);
      overrides = computeTorg1Overrides(current.auto, full);
    }

    const saved = await saveTorg1DocumentForm(
      client,
      siteId,
      id,
      overrides,
      body.title || current.title
    );
    const form = await loadTorg1ForDocument(client, siteId, id);
    return NextResponse.json({ form, saved });
  } finally {
    client.release();
  }
}
