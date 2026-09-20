import { randomUUID } from "crypto";
import type { PoolClient } from "pg";
import { NextResponse } from "next/server";
import { WmsHttpError } from "@/lib/wms/errors";
import { tryGetPool } from "@/lib/wms/pool";
import { WMS_DOCUMENT_STATUS, WMS_DOCUMENT_TYPE } from "@/lib/wms/ref";
import { getSiteId, resolveItemByCodeOrBarcode, resolveLocation } from "@/lib/wms/resolve";
import { applyReturnFromWorkshop } from "@/lib/wms/stock-ledger";
import { parseSlotProfileFromAttrs } from "@/lib/wms/storage-slot";
import { parseRequestId } from "@/lib/wms/uuid";
import { isWaitingPointCell } from "@/lib/wms/workshop-waiting-cell";
import { requireLineApi } from "@/lib/wms/line-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReturnBody = {
  requestId?: string;
  siteCode?: string;
  fromLocationCode?: string;
  toLocationCode?: string;
  itemCode?: string;
  qty?: number;
  lotCode?: string;
  operatorName?: string;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function returnWork(client: PoolClient, siteId: number, body: ReturnBody) {
  const requestId = parseRequestId(body.requestId) ?? randomUUID();
  const fromLocationCode = cleanText(body.fromLocationCode).toUpperCase();
  const toLocationCode = cleanText(body.toLocationCode).toUpperCase();
  const itemCode = cleanText(body.itemCode);
  const lotCode = cleanText(body.lotCode) || null;
  const operatorName = cleanText(body.operatorName);
  const qty = Number(body.qty);

  if (!fromLocationCode) throw new WmsHttpError(400, "fromLocationCode is required", "location_required");
  if (!toLocationCode) throw new WmsHttpError(400, "toLocationCode is required", "location_required");
  if (!itemCode) throw new WmsHttpError(400, "itemCode is required", "item_required");
  if (!Number.isFinite(qty) || qty <= 0) throw new WmsHttpError(400, "qty must be positive", "bad_qty");
  if (fromLocationCode === toLocationCode) {
    throw new WmsHttpError(400, "from and to locations must differ", "same_location");
  }

  const item = await resolveItemByCodeOrBarcode(client, siteId, itemCode);
  if (!item) throw new WmsHttpError(404, "item not found", "item_not_found");

  const fromLoc = await resolveLocation(client, siteId, fromLocationCode);
  const toLoc = await resolveLocation(client, siteId, toLocationCode);
  if (!fromLoc || !toLoc) throw new WmsHttpError(404, "location not found", "location_not_found");
  if (fromLoc.location_status_id === 2 || toLoc.location_status_id === 2) {
    throw new WmsHttpError(409, "location is blocked", "location_blocked");
  }

  const attrsR = await client.query<{ location_attrs_json: unknown }>(
    `SELECT location_attrs_json FROM wms_locations WHERE site_id = $1 AND location_id = $2::bigint`,
    [siteId, fromLoc.location_id]
  );
  const waitingPoint = isWaitingPointCell(
    parseSlotProfileFromAttrs(attrsR.rows[0]?.location_attrs_json)
  );

  let lotId: string | null = null;
  if (lotCode) {
    const lot = await client.query<{ lot_id: string }>(
      `SELECT lot_id::text FROM wms_lots
       WHERE site_id = $1 AND item_id = $2::bigint AND lot_code = $3 LIMIT 1`,
      [siteId, item.item_id, lotCode]
    );
    lotId = lot.rows[0]?.lot_id ?? null;
  }

  const doc = await client.query<{ document_id: string }>(
    `INSERT INTO wms_documents (
       site_id, document_type_id, document_status_id, request_id,
       source_location_id, target_location_id, operator_name, comment, applied_at
     ) VALUES ($1, $2, $3, $4::uuid, $5::bigint, $6::bigint, $7, $8, now())
     RETURNING document_id::text`,
    [
      siteId,
      WMS_DOCUMENT_TYPE.return,
      WMS_DOCUMENT_STATUS.applied,
      requestId,
      fromLoc.location_id,
      toLoc.location_id,
      operatorName || null,
      "Возврат из цеха на склад материалов",
    ]
  );
  const documentId = doc.rows[0].document_id;

  const line = await client.query<{ document_line_id: string }>(
    `INSERT INTO wms_document_lines (
       document_id, line_no, item_id, source_location_id, target_location_id, requested_qty, confirmed_qty, lot_id
     ) VALUES ($1::bigint, 1, $2::bigint, $3::bigint, $4::bigint, $5, $5, $6::bigint)
     RETURNING document_line_id::text`,
    [documentId, item.item_id, fromLoc.location_id, toLoc.location_id, qty, lotId]
  );
  const documentLineId = line.rows[0].document_line_id;

  const result = await applyReturnFromWorkshop(client, {
    siteId,
    itemId: item.item_id,
    fromLocationId: fromLoc.location_id,
    toLocationId: toLoc.location_id,
    qty,
    lotId,
    lotCode,
    documentId,
    documentLineId,
    requestId,
    waitingPoint,
    payload: { waitingPoint, lotCode },
  });

  return {
    disposition: "applied" as const,
    requestId,
    documentId,
    documentLineId,
    itemCode: item.item_code,
    itemName: item.name,
    fromLocationCode,
    toLocationCode,
    qty,
    ...result,
  };
}

export async function POST(req: Request) {
  const denied = await requireLineApi(req);
  if (denied) return denied;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: ReturnBody;
  try {
    body = (await req.json()) as ReturnBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = cleanText(body.siteCode);
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) throw new WmsHttpError(404, "unknown siteCode", "unknown_site");
    const result = await returnWork(client, siteId, body);
    await client.query("COMMIT");
    return NextResponse.json(result);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (e instanceof WmsHttpError) {
      return NextResponse.json(
        { error: e.message, code: e.code, disposition: "failed" },
        { status: e.status }
      );
    }
    console.error("[POST /api/wms/production/workshop-return]", e);
    return NextResponse.json({ error: "internal error", disposition: "failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
