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
import type { PoolClient } from "pg";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureBalance(
  client: PoolClient,
  siteId: number,
  locationId: string,
  itemId: string
) {
  await client.query(
    `INSERT INTO wms_stock_balances (site_id, location_id, item_id, available_qty, accuracy_status_id)
     VALUES ($1, $2::bigint, $3::bigint, 0, 1)
     ON CONFLICT (site_id, location_id, item_id) DO NOTHING`,
    [siteId, locationId, itemId]
  );
}

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
    sourceLocationCode?: string;
    targetLocationCode?: string;
    qty?: number;
    operatorName?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const requestId = parseRequestId(body.requestId);
  const siteCode = typeof body.siteCode === "string" ? body.siteCode : "";
  const itemCode = typeof body.itemCode === "string" ? body.itemCode : "";
  const sourceLocationCode =
    typeof body.sourceLocationCode === "string" ? body.sourceLocationCode : "";
  const targetLocationCode =
    typeof body.targetLocationCode === "string" ? body.targetLocationCode : "";
  const qty = Number(body.qty);
  const operatorName =
    typeof body.operatorName === "string" ? body.operatorName.trim() : "";

  if (!requestId) {
    return NextResponse.json({ error: "requestId must be a UUID" }, { status: 400 });
  }
  if (!siteCode.trim() || !itemCode.trim()) {
    return NextResponse.json(
      { error: "siteCode and itemCode are required" },
      { status: 400 }
    );
  }
  if (!sourceLocationCode.trim() || !targetLocationCode.trim()) {
    return NextResponse.json(
      { error: "sourceLocationCode and targetLocationCode are required" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ error: "qty must be a positive number" }, { status: 400 });
  }
  if (!operatorName) {
    return NextResponse.json({ error: "operatorName is required" }, { status: 400 });
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
      "return",
      body,
      (client) =>
        returnWork(client, siteId, {
          requestId,
          itemCode,
          sourceLocationCode,
          targetLocationCode,
          qty,
          operatorName,
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

async function returnWork(
  client: PoolClient,
  siteId: number,
  p: {
    requestId: string;
    itemCode: string;
    sourceLocationCode: string;
    targetLocationCode: string;
    qty: number;
    operatorName: string;
  }
) {
  const item = await resolveItemByCodeOrBarcode(client, siteId, p.itemCode);
  if (!item) {
    throw new WmsHttpError(404, "item not found", "item_not_found");
  }
  const src = await resolveLocation(client, siteId, p.sourceLocationCode);
  const tgt = await resolveLocation(client, siteId, p.targetLocationCode);
  if (!src || !tgt) {
    throw new WmsHttpError(404, "location not found", "location_not_found");
  }
  if (src.location_status_id === 2 || tgt.location_status_id === 2) {
    throw new WmsHttpError(409, "location is blocked", "location_blocked");
  }

  await ensureBalance(client, siteId, tgt.location_id, item.item_id);

  const uniqueLocIds = [...new Set([src.location_id, tgt.location_id])].sort(
    (a, b) => a.localeCompare(b)
  );
  for (const lid of uniqueLocIds) {
    await client.query(
      `SELECT 1 FROM wms_stock_balances
       WHERE site_id = $1 AND location_id = $2::bigint AND item_id = $3::bigint
       FOR UPDATE`,
      [siteId, lid, item.item_id]
    );
  }

  const srcBal = await client.query<{
    balance_id: string;
    in_production_qty: string;
  }>(
    `SELECT balance_id::text, in_production_qty::text
     FROM wms_stock_balances
     WHERE site_id = $1 AND location_id = $2::bigint AND item_id = $3::bigint`,
    [siteId, src.location_id, item.item_id]
  );
  if (srcBal.rows.length === 0) {
    throw new WmsHttpError(404, "no stock at source location", "no_balance");
  }
  const inProd = Number(srcBal.rows[0].in_production_qty);
  if (inProd + 1e-9 < p.qty) {
    throw new WmsHttpError(409, "insufficient in_production qty", "insufficient_stock");
  }

  if (src.location_id === tgt.location_id) {
    await client.query(
      `UPDATE wms_stock_balances SET
         in_production_qty = in_production_qty - $1,
         available_qty = available_qty + $1,
         updated_at = now()
       WHERE balance_id = $2::bigint`,
      [p.qty, srcBal.rows[0].balance_id]
    );
  } else {
    await client.query(
      `UPDATE wms_stock_balances SET
         in_production_qty = in_production_qty - $1,
         updated_at = now()
       WHERE balance_id = $2::bigint`,
      [p.qty, srcBal.rows[0].balance_id]
    );
    await client.query(
      `UPDATE wms_stock_balances SET
         available_qty = available_qty + $1,
         updated_at = now()
       WHERE site_id = $2 AND location_id = $3::bigint AND item_id = $4::bigint`,
      [p.qty, siteId, tgt.location_id, item.item_id]
    );
  }

  const doc = await client.query<{ document_id: string }>(
    `INSERT INTO wms_documents (
       site_id, document_type_id, document_status_id, request_id,
       source_location_id, target_location_id, applied_at
     ) VALUES ($1, 7, 3, $2::uuid, $3::bigint, $4::bigint, now())
     RETURNING document_id::text`,
    [siteId, p.requestId, src.location_id, tgt.location_id]
  );
  const documentId = doc.rows[0].document_id;

  const line = await client.query<{ document_line_id: string }>(
    `INSERT INTO wms_document_lines (
       document_id, line_no, item_id, source_location_id, target_location_id, requested_qty, confirmed_qty
     ) VALUES ($1::bigint, 1, $2::bigint, $3::bigint, $4::bigint, $5, $5)
     RETURNING document_line_id::text`,
    [documentId, item.item_id, src.location_id, tgt.location_id, p.qty]
  );
  const documentLineId = line.rows[0].document_line_id;

  await client.query(
    `INSERT INTO wms_stock_movements (
       site_id, movement_type_id, document_id, document_line_id, item_id,
       from_location_id, to_location_id, from_bucket_id, to_bucket_id, qty, request_id
     ) VALUES (
       $1, 7, $2::bigint, $3::bigint, $4::bigint,
       $5::bigint, $6::bigint, 3, 1, $7, $8::uuid
     )`,
    [
      siteId,
      documentId,
      documentLineId,
      item.item_id,
      src.location_id,
      tgt.location_id,
      p.qty,
      p.requestId,
    ]
  );

  await client.query(
    `INSERT INTO wms_operator_returns (document_id, operator_name)
     VALUES ($1::bigint, $2)`,
    [documentId, p.operatorName]
  );

  const stockTarget = await fetchBalanceSnapshot(
    client,
    siteId,
    tgt.location_id,
    item.item_id
  );

  return { documentId, documentType: "return", stock: stockTarget };
}
