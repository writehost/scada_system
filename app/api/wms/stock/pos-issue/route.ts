import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId, resolveItemByCodeOrBarcode } from "@/lib/wms/resolve";
import { WmsHttpError } from "@/lib/wms/errors";
import { issueToProduction } from "@/lib/wms/issue-stock";
import { buildPosPickPlan } from "@/lib/wms/pos-pick-plan";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true });
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 });
  }

  let body: {
    requestId?: string;
    siteCode?: string;
    itemCode?: string;
    qty?: number;
    recipientName?: string;
    targetLocationCode?: string;
    lineName?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = typeof body.siteCode === "string" ? body.siteCode.trim() : "";
  const itemCode = typeof body.itemCode === "string" ? body.itemCode.trim() : "";
  const qty = Number(body.qty);
  const recipientName = typeof body.recipientName === "string" ? body.recipientName.trim() : "";
  const targetLocationCode = typeof body.targetLocationCode === "string" ? body.targetLocationCode.trim() : "";
  const lineName = typeof body.lineName === "string" ? body.lineName.trim() : "";

  if (!siteCode || !itemCode) return NextResponse.json({ error: "siteCode and itemCode are required" }, { status: 400 });
  if (!Number.isFinite(qty) || qty <= 0) return NextResponse.json({ error: "qty must be positive" }, { status: 400 });
  if (!recipientName) return NextResponse.json({ error: "recipientName is required" }, { status: 400 });
  if (!targetLocationCode) return NextResponse.json({ error: "targetLocationCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const item = await resolveItemByCodeOrBarcode(client, siteId, itemCode);
    if (!item) return NextResponse.json({ error: "item not found" }, { status: 404 });

    const pickBody = await buildPosPickPlan(client, siteCode, itemCode, qty);
    if (!pickBody) return NextResponse.json({ error: "item not found" }, { status: 404 });
    if (!pickBody.enough) {
      return NextResponse.json(
        { error: "insufficient stock", code: "insufficient_stock", plan: pickBody.plan ?? [] },
        { status: 409 }
      );
    }

    const selected = (pickBody.plan ?? []).filter((row) => Number(row.takeQty) > 0);
    if (selected.length === 0) {
      return NextResponse.json({ error: "empty pick plan", code: "empty_pick_plan" }, { status: 409 });
    }

    await client.query("BEGIN");
    const documents = [];
    for (const row of selected) {
      const takeQty = Number(row.takeQty);
      const result = await issueToProduction(client, siteId, {
        requestId: randomUUID(),
        itemCode: item.item_code,
        sourceLocationCode: row.locationCode,
        targetLocationCode,
        qty: takeQty,
        recipientName,
        lineName: lineName || targetLocationCode,
        lotCode: row.lotCode || null,
        emissionAtIso: row.emissionAtIso || null,
      });
      documents.push({
        documentId: result.documentId,
        itemCode: item.item_code,
        itemName: item.name,
        sourceLocationCode: row.locationCode,
        targetLocationCode: result.targetLocationCode,
        lotCode: result.lotCode,
        qty: takeQty,
        recipientName,
        lineName: lineName || targetLocationCode,
      });
    }
    await client.query("COMMIT");

    return NextResponse.json({
      itemCode: item.item_code,
      itemName: item.name,
      requestedQty: qty,
      issuedQty: documents.reduce((sum, row) => sum + row.qty, 0),
      targetLocationCode,
      recipientName,
      lineName: lineName || targetLocationCode,
      documents,
      disposition: "applied",
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: error.status });
    }
    console.error("[POST /api/wms/stock/pos-issue]", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "issue failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
