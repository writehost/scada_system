import { NextResponse } from "next/server";
import {
  getSiteId,
  resolveItemByCodeOrBarcode,
  resolveLocation,
} from "@/lib/wms/resolve";
import { tryGetPool } from "@/lib/wms/pool";
import { runIdempotentWrite } from "@/lib/wms/idempotency";
import { fetchBalanceSnapshot } from "@/lib/wms/query";
import { parseRequestId } from "@/lib/wms/uuid";
import { WmsHttpError } from "@/lib/wms/errors";
import { applyStockTransfer } from "@/lib/wms/stock-ledger";
import { WMS_PERMISSION, requireWmsPermission } from "@/lib/wms/permissions";
import { assertWaitingCellAcceptsItemByLocationId } from "@/lib/wms/workshop-waiting-cell";
import type { PoolClient } from "pg";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: {
    requestId?: string;
    siteCode?: string;
    itemCode?: string;
    fromLocationCode?: string;
    toLocationCode?: string;
    lotCode?: string;
    qty?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const requestId = parseRequestId(body.requestId);
  const siteCode = typeof body.siteCode === "string" ? body.siteCode : "";
  const itemCode = typeof body.itemCode === "string" ? body.itemCode : "";
  const fromLocationCode =
    typeof body.fromLocationCode === "string" ? body.fromLocationCode : "";
  const toLocationCode =
    typeof body.toLocationCode === "string" ? body.toLocationCode : "";
  const qty = Number(body.qty);
  const lotCode = typeof body.lotCode === "string" ? body.lotCode.trim() : "";

  if (!requestId) {
    return NextResponse.json({ error: "requestId must be a UUID" }, { status: 400 });
  }
  if (!siteCode.trim() || !itemCode.trim()) {
    return NextResponse.json(
      { error: "siteCode and itemCode are required" },
      { status: 400 }
    );
  }
  if (!fromLocationCode.trim() || !toLocationCode.trim()) {
    return NextResponse.json(
      { error: "fromLocationCode and toLocationCode are required" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ error: "qty must be a positive number" }, { status: 400 });
  }
  if (fromLocationCode.trim() === toLocationCode.trim()) {
    return NextResponse.json(
      { error: "from and to locations must differ" },
      { status: 400 }
    );
  }

  const probe = await pool.connect();
  let siteId: number;
  try {
    const sid = await getSiteId(probe, siteCode);
    if (sid == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    siteId = sid;
  } finally {
    probe.release();
  }

  try {
    const result = await runIdempotentWrite(
      pool,
      requestId,
      siteId,
      "transfer",
      body,
      (client) =>
        transferWork(client, siteId, {
          actorUserId: actorGate.actor.userId,
          actorLogin: actorGate.actor.session?.login,
          requestId,
          itemCode,
          fromLocationCode,
          toLocationCode,
          lotCode: lotCode || null,
          qty,
        })
    );
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof WmsHttpError) {
      return NextResponse.json(
        { error: e.message, code: e.code, disposition: "failed" },
        { status: e.status }
      );
    }
    console.error(e);
    return NextResponse.json(
      { error: "internal error", disposition: "failed" },
      { status: 500 }
    );
  }
}

async function transferWork(
  client: PoolClient,
  siteId: number,
  p: {
    actorUserId?: string | null;
    actorLogin?: string | null;
    requestId: string;
    itemCode: string;
    fromLocationCode: string;
    toLocationCode: string;
    lotCode?: string | null;
    qty: number;
  }
) {
  const item = await resolveItemByCodeOrBarcode(client, siteId, p.itemCode);
  if (!item) {
    throw new WmsHttpError(404, "item not found", "item_not_found");
  }
  const fromLoc = await resolveLocation(client, siteId, p.fromLocationCode);
  const toLoc = await resolveLocation(client, siteId, p.toLocationCode);
  if (!fromLoc || !toLoc) {
    throw new WmsHttpError(404, "location not found", "location_not_found");
  }
  if (fromLoc.location_status_id === 2 || toLoc.location_status_id === 2) {
    throw new WmsHttpError(409, "location is blocked", "location_blocked");
  }

  await assertWaitingCellAcceptsItemByLocationId(
    client,
    siteId,
    toLoc.location_id,
    item.item_id,
    item.item_code
  );

  await requireWmsPermission(client, p.actorUserId, WMS_PERMISSION.stockTransfer, p.actorLogin);

  const lotCode = p.lotCode?.trim() || "";
  let lotId: string | null = null;
  if (lotCode) {
    const lot = await client.query<{ lot_id: string }>(
      `SELECT wl.lot_id::text
       FROM wms_lots wl
       WHERE wl.site_id = $1 AND wl.item_id = $2::bigint AND wl.lot_code = $3
       LIMIT 1`,
      [siteId, item.item_id, lotCode]
    );
    lotId = lot.rows[0]?.lot_id ?? null;
    if (!lotId) {
      throw new WmsHttpError(404, "lot not found", "lot_not_found");
    }
  }

  const doc = await client.query<{ document_id: string }>(
    `INSERT INTO wms_documents (
       site_id, document_type_id, document_status_id, request_id,
       source_location_id, target_location_id, applied_at
     ) VALUES ($1, 5, 3, $2::uuid, $3::bigint, $4::bigint, now())
     RETURNING document_id::text`,
    [siteId, p.requestId, fromLoc.location_id, toLoc.location_id]
  );
  const documentId = doc.rows[0].document_id;

  const line = await client.query<{ document_line_id: string }>(
    `INSERT INTO wms_document_lines (
       document_id, line_no, item_id, source_location_id, target_location_id, requested_qty, confirmed_qty, lot_id
     ) VALUES ($1::bigint, 1, $2::bigint, $3::bigint, $4::bigint, $5, $5, $6::bigint)
     RETURNING document_line_id::text`,
    [documentId, item.item_id, fromLoc.location_id, toLoc.location_id, p.qty, lotId]
  );
  const documentLineId = line.rows[0].document_line_id;

  await applyStockTransfer(client, {
    siteId,
    itemId: item.item_id,
    fromLocationId: fromLoc.location_id,
    toLocationId: toLoc.location_id,
    qty: p.qty,
    lotId,
    lotCode: lotCode || null,
    documentId,
    documentLineId,
    requestId: p.requestId,
  });

  const stock = await fetchBalanceSnapshot(
    client,
    siteId,
    toLoc.location_id,
    item.item_id
  );

  return { documentId, documentType: "transfer", lotCode: lotCode || null, stock };
}
