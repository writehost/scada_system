import { NextResponse } from "next/server";
import { createItemAlias, listItemAliases } from "@/lib/wms/item-aliases";
import { logWmsOperationEvent } from "@/lib/wms/operation-events";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { WmsHttpError } from "@/lib/wms/errors";
import { requireWmsSession } from "@/lib/wms/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  segmentData: { params: Promise<{ itemCode: string }> }
) {
  const auth = await requireWmsSession(req);
  if ("error" in auth) return auth.error;

  const pool = tryGetPool();
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 });

  const params = await segmentData.params;
  const itemCode = decodeURIComponent(params.itemCode ?? "");
  const url = new URL(req.url);
  const siteCode = (url.searchParams.get("siteCode") ?? "").trim();
  if (!siteCode || !itemCode.trim()) {
    return NextResponse.json({ error: "siteCode and itemCode are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    return NextResponse.json({ aliases: await listItemAliases(client, siteId, itemCode) });
  } finally {
    client.release();
  }
}

export async function POST(
  req: Request,
  segmentData: { params: Promise<{ itemCode: string }> }
) {
  const auth = await requireWmsSession(req);
  if ("error" in auth) return auth.error;

  const pool = tryGetPool();
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 });

  const params = await segmentData.params;
  const itemCode = decodeURIComponent(params.itemCode ?? "");
  let body: {
    siteCode?: string;
    supplierCode?: string | null;
    supplierName?: string | null;
    aliasName?: string;
    aliasSku?: string | null;
    gtin?: string | null;
    source?: string | null;
    actorUserId?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = typeof body.siteCode === "string" ? body.siteCode.trim() : "";
  if (!siteCode || !itemCode.trim()) {
    return NextResponse.json({ error: "siteCode and itemCode are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const alias = await createItemAlias(client, siteId, {
      itemCode,
      supplierCode: typeof body.supplierCode === "string" ? body.supplierCode : null,
      supplierName: typeof body.supplierName === "string" ? body.supplierName : null,
      aliasName: typeof body.aliasName === "string" ? body.aliasName : "",
      aliasSku: typeof body.aliasSku === "string" ? body.aliasSku : null,
      gtin: typeof body.gtin === "string" ? body.gtin : null,
      source: typeof body.source === "string" ? body.source : "manual",
      createdByUserId: typeof body.actorUserId === "string" ? body.actorUserId : null,
    });
    await logWmsOperationEvent(client, {
      siteId,
      eventType: "item.alias.created",
      actorUserId: body.actorUserId ?? null,
      payload: { itemCode, alias },
    });
    return NextResponse.json({ alias });
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  } finally {
    client.release();
  }
}
