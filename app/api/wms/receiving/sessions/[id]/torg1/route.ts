import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { parseTorg1FieldsPartial, saveTorg1SessionDraft } from "@/lib/wms/torg1";
import { computeTorg1Overrides, loadTorg1ForSession } from "@/lib/wms/torg1-load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const pool = tryGetPool();
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 });
  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  if (!siteCode.trim()) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  const { id } = await ctx.params;

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const form = await loadTorg1ForSession(client, siteId, id, {
      documentNo: url.searchParams.get("documentNo"),
      composedAt: url.searchParams.get("composedAt"),
      locationCode: url.searchParams.get("locationCode"),
      comment: url.searchParams.get("comment"),
      externalRef: url.searchParams.get("externalRef"),
      warehouseCode: url.searchParams.get("warehouseCode"),
    });
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
    hints?: {
      documentNo?: string;
      composedAt?: string;
      locationCode?: string;
      comment?: string;
      externalRef?: string;
      warehouseCode?: string;
    };
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
    const current = await loadTorg1ForSession(client, siteId, id, body.hints);
    let overrides = parseTorg1FieldsPartial(body.overrides ?? {});
    if (body.fields && typeof body.fields === "object") {
      const partial = parseTorg1FieldsPartial(body.fields);
      overrides = computeTorg1Overrides(current.auto, {
        ...current.fields,
        ...partial,
        lines: partial.lines ?? current.fields.lines,
      });
    }
    await saveTorg1SessionDraft(client, siteId, id, overrides);
    const form = await loadTorg1ForSession(client, siteId, id, body.hints);
    return NextResponse.json({ form });
  } finally {
    client.release();
  }
}
