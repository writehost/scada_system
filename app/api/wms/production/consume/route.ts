import { randomUUID } from "crypto";
import type { Pool, PoolClient } from "pg";
import { NextResponse } from "next/server";
import { normalizeCrptCode } from "@/lib/wms/crpt";
import { WmsHttpError } from "@/lib/wms/errors";
import { tryGetPool } from "@/lib/wms/pool";
import { WMS_DOCUMENT_STATUS, WMS_DOCUMENT_TYPE, WMS_MOVEMENT_TYPE, WMS_STOCK_BUCKET } from "@/lib/wms/ref";
import { getSiteId, resolveItemByCodeOrBarcode, resolveLocation } from "@/lib/wms/resolve";
import { parseRequestId } from "@/lib/wms/uuid";
import { parseSlotProfileFromAttrs } from "@/lib/wms/storage-slot";
import { isWaitingPointCell } from "@/lib/wms/workshop-waiting-cell";
import { requireLineApi } from "@/lib/wms/line-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConsumeBody = {
  requestId?: string;
  siteCode?: string;
  locationCode?: string;
  itemCode?: string;
  datamatrix?: string;
  qty?: number;
  sourceSystem?: string;
  externalEventId?: string;
  lineCode?: string;
  lotCode?: string;
  batchLabel?: string;
  operatorName?: string;
  dryRun?: boolean;
};

type ResolvedItem = {
  item_id: string;
  item_code: string;
  name: string;
};

type ResolvedCode = {
  codeId: string | null;
  codeValue: string | null;
  gtin: string | null;
  serial: string | null;
};

function parseGs1Unit(raw: string): { gtin: string; serial: string } | null {
  const normalized = normalizeCrptCode(raw);
  const m = normalized.match(/^01(\d{14})21([\s\S]+)$/);
  if (!m) return null;
  const serial = m[2].split("\x1d")[0]?.trim();
  if (!serial) return null;
  return { gtin: m[1], serial };
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function getStoredResponse(
  client: PoolClient,
  requestId: string
): Promise<Record<string, unknown> | null> {
  const r = await client.query<{ response_payload: unknown }>(
    `SELECT response_payload FROM wms_request_log WHERE request_id = $1::uuid`,
    [requestId]
  );
  const payload = r.rows[0]?.response_payload;
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
}

async function resolveCode(
  client: PoolClient,
  datamatrix: string
): Promise<ResolvedCode> {
  const parsed = parseGs1Unit(datamatrix);
  if (!parsed) {
    throw new WmsHttpError(400, "cannot parse DataMatrix AI(01)+AI(21)", "bad_datamatrix");
  }

  const code = await client.query<{ code_id: string }>(
    `SELECT code_id::text
     FROM codes
     WHERE ai01_gtin = $1::char(14) AND ai21_serial = $2
     LIMIT 1`,
    [parsed.gtin, parsed.serial]
  );

  return {
    codeId: code.rows[0]?.code_id ?? null,
    codeValue: normalizeCrptCode(datamatrix),
    gtin: parsed.gtin,
    serial: parsed.serial,
  };
}

async function resolveItemForConsume(
  client: PoolClient,
  siteId: number,
  itemCode: string,
  code: ResolvedCode
): Promise<ResolvedItem> {
  if (itemCode) {
    const item = await resolveItemByCodeOrBarcode(client, siteId, itemCode);
    if (!item) throw new WmsHttpError(404, "item not found", "item_not_found");
    return item;
  }

  if (code.codeId) {
    const linked = await client.query<ResolvedItem>(
      `SELECT i.item_id::text AS item_id, i.item_code, i.name
       FROM wms_item_codes wc
       JOIN wms_items i ON i.item_id = wc.item_id AND i.site_id = wc.current_site_id
       WHERE wc.current_site_id = $1 AND wc.code_id = $2::bigint
       LIMIT 1`,
      [siteId, code.codeId]
    );
    if (linked.rows[0]) return linked.rows[0];
  }

  if (code.gtin) {
    const byGtin = await client.query<ResolvedItem>(
      `SELECT i.item_id::text AS item_id, i.item_code, i.name
       FROM wms_items i
       LEFT JOIN wms_item_barcodes b ON b.item_id = i.item_id
       WHERE i.site_id = $1
         AND (
           i.item_code = $2
           OR i.sku = $2
           OR b.barcode = $2
           OR b.barcode = ltrim($2, '0')
           OR COALESCE(i.item_attrs_json->>'internalGtin', '') = $2
           OR COALESCE(i.item_attrs_json->>'internalGtin', '') = ltrim($2, '0')
         )
       ORDER BY
         CASE WHEN i.item_code = $2 THEN 0 WHEN i.sku = $2 THEN 1 ELSE 2 END,
         i.item_id
       LIMIT 1`,
      [siteId, code.gtin]
    );
    if (byGtin.rows[0]) return byGtin.rows[0];
  }

  throw new WmsHttpError(
    404,
    "item not found for DataMatrix; pass itemCode or link GTIN to nomenclature",
    "item_not_found"
  );
}

async function findDuplicateConsumption(
  client: PoolClient,
  siteId: number,
  sourceSystem: string,
  externalEventId: string,
  codeValue: string | null
) {
  const r = await client.query<{
    consumption_id: string;
    document_id: string | null;
    movement_id: string | null;
    qty: string;
    code_value: string | null;
    created_at: string;
  }>(
    `SELECT consumption_id::text, document_id::text, movement_id::text,
       qty::text, code_value, created_at::text
     FROM wms_production_consumptions
     WHERE site_id = $1
       AND (
         ($2::text IS NOT NULL AND code_value = $2)
         OR ($3::text <> '' AND source_system = $4 AND external_event_id = $3)
       )
     ORDER BY consumption_id
     LIMIT 1`,
    [siteId, codeValue, externalEventId, sourceSystem]
  );
  return r.rows[0] ?? null;
}

async function storeRequestLog(
  client: PoolClient,
  requestId: string,
  siteId: number,
  body: ConsumeBody,
  response: Record<string, unknown>
) {
  await client.query(
    `INSERT INTO wms_request_log (
       request_id, site_id, operation_code, request_status_id,
       request_payload, response_payload, applied_at
     ) VALUES ($1::uuid, $2, 'production_consume', 1, $3::jsonb, $4::jsonb, now())
     ON CONFLICT (request_id) DO NOTHING`,
    [requestId, siteId, JSON.stringify(body ?? {}), JSON.stringify(response)]
  );
}

async function consumeWork(
  client: PoolClient,
  siteId: number,
  requestId: string,
  body: ConsumeBody
) {
  const datamatrix = cleanText(body.datamatrix);
  const itemCode = cleanText(body.itemCode);
  const sourceSystem = cleanText(body.sourceSystem) || "line";
  const externalEventId = cleanText(body.externalEventId);
  const lineCode = cleanText(body.lineCode);
  const lotCode = cleanText(body.lotCode) || cleanText(body.batchLabel);
  const locationCode = cleanText(body.locationCode);
  const operatorName = cleanText(body.operatorName);
  const mode = datamatrix ? "datamatrix" : "qty";
  const qty = datamatrix ? Number(body.qty ?? 1) : Number(body.qty);

  if (!locationCode) throw new WmsHttpError(400, "locationCode is required", "location_required");
  if (!datamatrix && !itemCode) {
    throw new WmsHttpError(400, "itemCode or datamatrix is required", "item_required");
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new WmsHttpError(400, "qty must be a positive number", "bad_qty");
  }
  if (datamatrix && Math.abs(qty - 1) > 1e-9) {
    throw new WmsHttpError(400, "DataMatrix consumption qty must be 1", "bad_qty");
  }

  const loc = await resolveLocation(client, siteId, locationCode);
  if (!loc) throw new WmsHttpError(404, "location not found", "location_not_found");
  if (loc.location_status_id === 2) {
    throw new WmsHttpError(409, "location is blocked", "location_blocked");
  }

  const code = datamatrix
    ? await resolveCode(client, datamatrix)
    : { codeId: null, codeValue: null, gtin: null, serial: null };
  const item = await resolveItemForConsume(client, siteId, itemCode, code);
  const duplicate = await findDuplicateConsumption(
    client,
    siteId,
    sourceSystem,
    externalEventId,
    code.codeValue
  );
  if (duplicate) {
    return {
      disposition: "duplicate" as const,
      consumptionId: duplicate.consumption_id,
      documentId: duplicate.document_id,
      movementId: duplicate.movement_id,
      qty: Number(duplicate.qty),
      codeValue: duplicate.code_value,
      createdAt: duplicate.created_at,
    };
  }

  if (body.dryRun) {
    return {
      disposition: "dry_run" as const,
      itemCode: item.item_code,
      itemName: item.name,
      locationCode: loc.location_code,
      qty,
      mode,
      codeValue: code.codeValue,
      gtin: code.gtin,
      serial: code.serial,
    };
  }

  const balance = await client.query<{
    balance_id: string;
    in_production_qty: string;
    available_qty: string;
  }>(
    `SELECT balance_id::text, in_production_qty::text, available_qty::text
     FROM wms_stock_balances
     WHERE site_id = $1 AND location_id = $2::bigint AND item_id = $3::bigint
     FOR UPDATE`,
    [siteId, loc.location_id, item.item_id]
  );
  const bal = balance.rows[0];
  if (!bal) throw new WmsHttpError(404, "no stock at production location", "no_balance");

  const attrsR = await client.query<{ location_attrs_json: unknown }>(
    `SELECT location_attrs_json FROM wms_locations WHERE site_id = $1 AND location_id = $2::bigint`,
    [siteId, loc.location_id]
  );
  const waitingPoint = isWaitingPointCell(
    parseSlotProfileFromAttrs(attrsR.rows[0]?.location_attrs_json)
  );

  const beforeInProduction = Number(bal.in_production_qty);
  const beforeAvailable = Number(bal.available_qty);
  const totalOnHand = beforeInProduction + beforeAvailable;

  if (totalOnHand + 1e-9 < qty) {
    throw new WmsHttpError(409, "insufficient stock at location", "insufficient_stock", {
      availableInProduction: beforeInProduction,
      availableQty: beforeAvailable,
      totalOnHand,
      requestedQty: qty,
    });
  }

  let fromAvailable = 0;
  let fromInProduction = 0;
  if (waitingPoint) {
    fromAvailable = Math.min(beforeAvailable, qty);
    fromInProduction = qty - fromAvailable;
  } else {
    if (beforeInProduction + 1e-9 < qty) {
      throw new WmsHttpError(409, "insufficient in_production qty", "insufficient_stock", {
        availableInProduction: beforeInProduction,
        requestedQty: qty,
      });
    }
    fromInProduction = qty;
  }

  const fromBucketId =
    fromInProduction > 0 ? WMS_STOCK_BUCKET.in_production : WMS_STOCK_BUCKET.available;

  if (code.codeId) {
    const codeLoc = await client.query<{ current_location_id: string | null }>(
      `SELECT current_location_id::text
       FROM wms_item_codes
       WHERE current_site_id = $1 AND code_id = $2::bigint
       FOR UPDATE`,
      [siteId, code.codeId]
    );
    const currentLocationId = codeLoc.rows[0]?.current_location_id ?? null;
    if (currentLocationId && currentLocationId !== loc.location_id) {
      throw new WmsHttpError(409, "code is not in requested production location", "code_location_mismatch", {
        currentLocationId,
        requestedLocationId: loc.location_id,
      });
    }
  }

  await client.query(
    `UPDATE wms_stock_balances
     SET in_production_qty = in_production_qty - $1,
         available_qty = available_qty - $2,
         updated_at = now(),
         snapshot_version = snapshot_version + 1
     WHERE balance_id = $3::bigint`,
    [fromInProduction, fromAvailable, bal.balance_id]
  );

  const consumePayload = {
    sourceSystem,
    externalEventId,
    mode,
    codeValue: code.codeValue,
    waitingPoint,
    lotCode: lotCode || null,
    fromAvailable,
    fromInProduction,
  };

  const doc = await client.query<{ document_id: string }>(
    `INSERT INTO wms_documents (
       site_id, document_type_id, document_status_id, request_id,
       source_location_id, operator_name, line_name, comment, payload_json, applied_at
     ) VALUES ($1, $2, $3, $4::uuid, $5::bigint, $6, $7, $8, $9::jsonb, now())
     RETURNING document_id::text`,
    [
      siteId,
      WMS_DOCUMENT_TYPE.production_consumption,
      WMS_DOCUMENT_STATUS.applied,
      requestId,
      loc.location_id,
      operatorName || null,
      lineCode || loc.location_code,
      datamatrix ? "Списание DataMatrix с линии" : "Списание количества с линии",
      JSON.stringify(consumePayload),
    ]
  );
  const documentId = doc.rows[0].document_id;

  const line = await client.query<{ document_line_id: string }>(
    `INSERT INTO wms_document_lines (
       document_id, line_no, item_id, source_location_id, requested_qty, confirmed_qty, comment
     ) VALUES ($1::bigint, 1, $2::bigint, $3::bigint, $4, $4, $5)
     RETURNING document_line_id::text`,
    [documentId, item.item_id, loc.location_id, qty, code.codeValue]
  );
  const documentLineId = line.rows[0].document_line_id;

  const movement = await client.query<{ movement_id: string }>(
    `INSERT INTO wms_stock_movements (
       site_id, movement_type_id, document_id, document_line_id, item_id,
       from_location_id, from_bucket_id, qty, request_id, payload_json
     ) VALUES ($1, $2, $3::bigint, $4::bigint, $5::bigint, $6::bigint, $7, $8, $9::uuid, $10::jsonb)
     RETURNING movement_id::text`,
    [
      siteId,
      WMS_MOVEMENT_TYPE.production_consume,
      documentId,
      documentLineId,
      item.item_id,
      loc.location_id,
      fromBucketId,
      qty,
      requestId,
      JSON.stringify(consumePayload),
    ]
  );
  const movementId = movement.rows[0].movement_id;

  if (code.codeId) {
    await client.query(
      `UPDATE wms_item_codes
       SET current_location_id = NULL,
           last_document_id = $1::bigint,
           last_movement_id = $2::bigint,
           unlinked_at = now(),
           note = COALESCE(note, '') || CASE WHEN COALESCE(note, '') = '' THEN '' ELSE E'\n' END || $3
       WHERE current_site_id = $4 AND code_id = $5::bigint`,
      [documentId, movementId, "Списан производством", siteId, code.codeId]
    );
  }

  const cons = await client.query<{ consumption_id: string }>(
    `INSERT INTO wms_production_consumptions (
       site_id, request_id, source_system, external_event_id, line_code,
       location_id, item_id, code_id, code_value, gtin, serial, qty, mode,
       status, document_id, movement_id, payload_json
     ) VALUES (
       $1, $2::uuid, $3, NULLIF($4, ''), NULLIF($5, ''),
       $6::bigint, $7::bigint, $8::bigint, $9, $10::char(14), $11, $12, $13,
       'applied', $14::bigint, $15::bigint, $16::jsonb
     )
     RETURNING consumption_id::text`,
    [
      siteId,
      requestId,
      sourceSystem,
      externalEventId,
      lineCode,
      loc.location_id,
      item.item_id,
      code.codeId,
      code.codeValue,
      code.gtin,
      code.serial,
      qty,
      mode,
      documentId,
      movementId,
      JSON.stringify({ ...body, lotCode: lotCode || null }),
    ]
  );
  const afterInProduction = beforeInProduction - fromInProduction;
  const afterAvailable = beforeAvailable - fromAvailable;

  await client.query(
    `INSERT INTO wms_operation_events (
       site_id, event_type, document_id, item_id, location_id, code_value, payload_json
     ) VALUES ($1, 'production_consume', $2::bigint, $3::bigint, $4::bigint, $5, $6::jsonb)`,
    [
      siteId,
      documentId,
      item.item_id,
      loc.location_id,
      code.codeValue,
      JSON.stringify({
        sourceSystem,
        externalEventId,
        lineCode,
        lotCode: lotCode || null,
        qty,
        beforeInProduction,
        afterInProduction,
        beforeAvailable,
        afterAvailable,
        waitingPoint,
      }),
    ]
  );

  return {
    disposition: "applied" as const,
    consumptionId: cons.rows[0].consumption_id,
    documentId,
    movementId,
    itemCode: item.item_code,
    itemName: item.name,
    locationCode: loc.location_code,
    qty,
    beforeInProductionQty: beforeInProduction,
    afterInProductionQty: afterInProduction,
    beforeAvailableQty: beforeAvailable,
    afterAvailableQty: afterAvailable,
    mode,
    codeValue: code.codeValue,
    gtin: code.gtin,
    serial: code.serial,
    lotCode: lotCode || null,
    lineCode: lineCode || null,
  };
}

async function runConsume(pool: Pool, body: ConsumeBody) {
  const requestId = parseRequestId(body.requestId) ?? randomUUID();
  const siteCode = cleanText(body.siteCode);
  if (!siteCode) throw new WmsHttpError(400, "siteCode is required", "site_required");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) throw new WmsHttpError(404, "unknown siteCode", "unknown_site");

    const lockKey =
      cleanText(body.datamatrix) ||
      `${cleanText(body.sourceSystem) || "line"}:${cleanText(body.externalEventId)}` ||
      requestId;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [
      `production-consume:${siteId}:${lockKey}`,
    ]);

    const stored = await getStoredResponse(client, requestId);
    if (stored) {
      await client.query("COMMIT");
      return { ...stored, disposition: "duplicate" };
    }

    const result = await consumeWork(client, siteId, requestId, body);
    if (result.disposition !== "dry_run") {
      await storeRequestLog(client, requestId, siteId, body, result);
    }
    await client.query("COMMIT");
    return result;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
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

  let body: ConsumeBody;
  try {
    body = (await req.json()) as ConsumeBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const result = await runConsume(pool, body);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof WmsHttpError) {
      return NextResponse.json(
        { error: e.message, code: e.code, details: e.details, disposition: "failed" },
        { status: e.status }
      );
    }
    const err = e as { code?: string; message?: string };
    if (err.code === "23505") {
      return NextResponse.json(
        { error: "duplicate production consumption", code: "duplicate", disposition: "duplicate" },
        { status: 409 }
      );
    }
    console.error("[POST /api/wms/production/consume]", e);
    return NextResponse.json(
      { error: "internal error", disposition: "failed" },
      { status: 500 }
    );
  }
}
