import type { PoolClient } from "pg";
import { WmsHttpError } from "@/lib/wms/errors";
import { WMS_MOVEMENT_TYPE, WMS_STOCK_BUCKET } from "@/lib/wms/ref";

type QtyField =
  | "available_qty"
  | "reserved_qty"
  | "in_production_qty"
  | "quarantine_qty"
  | "rejected_qty"
  | "in_transit_qty";

function bucketToField(bucketId: number): QtyField {
  switch (bucketId) {
    case WMS_STOCK_BUCKET.available:
      return "available_qty";
    case WMS_STOCK_BUCKET.reserved:
      return "reserved_qty";
    case WMS_STOCK_BUCKET.in_production:
      return "in_production_qty";
    case WMS_STOCK_BUCKET.quarantine:
      return "quarantine_qty";
    case WMS_STOCK_BUCKET.rejected:
      return "rejected_qty";
    case WMS_STOCK_BUCKET.in_transit:
      return "in_transit_qty";
    default:
      throw new WmsHttpError(400, "unknown stock bucket", "unknown_bucket");
  }
}

async function adjustBalanceQty(
  client: PoolClient,
  balanceId: string,
  field: QtyField,
  delta: number
) {
  const r = await client.query<{ value: string }>(
    `UPDATE wms_stock_balances
     SET ${field} = ${field} + $1,
         updated_at = now()
     WHERE balance_id = $2::bigint
     RETURNING ${field}::text AS value`,
    [delta, balanceId]
  );
  const nextValue = Number(r.rows[0]?.value ?? "0");
  if (nextValue < -1e-9) {
    throw new WmsHttpError(409, `negative balance in ${field}`, "negative_balance");
  }
}

async function ensureStockLot(
  client: PoolClient,
  balanceId: string,
  lotId: string,
  lotCode: string
) {
  await client.query(
    `INSERT INTO wms_stock_lots (balance_id, lot_id, lot_code)
     VALUES ($1::bigint, $2::bigint, $3)
     ON CONFLICT (balance_id, lot_code) DO NOTHING`,
    [balanceId, lotId, lotCode]
  );
}

async function adjustLotQty(
  client: PoolClient,
  balanceId: string,
  lotId: string,
  lotCode: string,
  field: QtyField,
  delta: number
) {
  await ensureStockLot(client, balanceId, lotId, lotCode);
  const r = await client.query<{ value: string }>(
    `UPDATE wms_stock_lots
     SET ${field} = ${field} + $1,
         updated_at = now()
     WHERE balance_id = $2::bigint AND lot_id = $3::bigint
     RETURNING ${field}::text AS value`,
    [delta, balanceId, lotId]
  );
  const nextValue = Number(r.rows[0]?.value ?? "0");
  if (nextValue < -1e-9) {
    throw new WmsHttpError(409, `negative lot balance in ${field}`, "negative_lot_balance");
  }
}

async function insertMovement(
  client: PoolClient,
  siteId: number,
  input: {
    itemId: string;
    lotId: string;
    fromLocationId: string;
    toLocationId: string;
    fromBucketId: number;
    toBucketId: number;
    qty: number;
    requestId?: string | null;
  }
) {
  // NOTE: wms_stock_movements schema doesn't store lot_id directly in this project,
  // so we log item + locations + bucket transition. Lot link stays in balances/lots.
  await client.query(
    `INSERT INTO wms_stock_movements (
       site_id, movement_type_id, document_id, document_line_id, item_id,
       from_location_id, to_location_id, from_bucket_id, to_bucket_id, qty, request_id
     ) VALUES (
       $1, $2, NULL, NULL, $3::bigint,
       $4::bigint, $5::bigint, $6, $7, $8, $9::uuid
     )`,
    [
      siteId,
      WMS_MOVEMENT_TYPE.revision_adjustment,
      input.itemId,
      input.fromLocationId,
      input.toLocationId,
      input.fromBucketId,
      input.toBucketId,
      input.qty,
      input.requestId ?? null,
    ]
  );
}

export async function updateLotMaster(
  client: PoolClient,
  siteId: number,
  lotId: string,
  patch: { qaStatusCode?: string | null; note?: string | null; isBlocked?: boolean | null }
) {
  const r = await client.query<{ lot_id: string }>(
    `SELECT lot_id::text AS lot_id
     FROM wms_lots
     WHERE site_id = $1 AND lot_id = $2::bigint`,
    [siteId, lotId]
  );
  if (!r.rows[0]?.lot_id) {
    throw new WmsHttpError(404, "lot not found", "lot_not_found");
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  if (patch.qaStatusCode !== undefined) {
    values.push(patch.qaStatusCode);
    fields.push(`qa_status_code = $${values.length}`);
  }
  if (patch.note !== undefined) {
    values.push(patch.note);
    fields.push(`note = $${values.length}`);
  }
  if (patch.isBlocked !== undefined) {
    values.push(patch.isBlocked);
    fields.push(`is_blocked = $${values.length}`);
  }

  if (fields.length === 0) return;

  values.push(siteId);
  values.push(lotId);
  await client.query(
    `UPDATE wms_lots
     SET ${fields.join(", ")},
         updated_at = now()
     WHERE site_id = $${values.length - 1} AND lot_id = $${values.length}::bigint`,
    values
  );
}

export async function moveLotQtyBetweenBuckets(
  client: PoolClient,
  siteId: number,
  lotId: string,
  input: {
    fromBucketId: number;
    toBucketId: number;
    qty: number; // total qty to move across all locations/balances
    requestId?: string | null;
  }
) {
  if (!(input.qty > 0)) {
    throw new WmsHttpError(400, "qty must be > 0", "bad_qty");
  }
  if (input.fromBucketId === input.toBucketId) {
    throw new WmsHttpError(400, "fromBucketId must differ from toBucketId", "bad_bucket");
  }

  const lotR = await client.query<{ lot_code: string; item_id: string }>(
    `SELECT lot_code, item_id::text AS item_id
     FROM wms_lots
     WHERE site_id = $1 AND lot_id = $2::bigint`,
    [siteId, lotId]
  );
  const lotCode = lotR.rows[0]?.lot_code ?? "";
  const itemId = lotR.rows[0]?.item_id ?? "";
  if (!lotCode || !itemId) {
    throw new WmsHttpError(404, "lot not found", "lot_not_found");
  }

  const fromField = bucketToField(input.fromBucketId);
  const toField = bucketToField(input.toBucketId);

  const rows = await client.query<{
    balanceId: string;
    locationId: string;
    fromQty: string;
  }>(
    `SELECT
       sb.balance_id::text AS "balanceId",
       sb.location_id::text AS "locationId",
       sl.${fromField}::text AS "fromQty"
     FROM wms_stock_lots sl
     JOIN wms_stock_balances sb ON sb.balance_id = sl.balance_id
     WHERE sb.site_id = $1
       AND sl.lot_id = $2::bigint
       AND sl.${fromField} > 0
     ORDER BY sl.${fromField} DESC, sb.balance_id ASC`,
    [siteId, lotId]
  );

  let remaining = input.qty;
  for (const row of rows.rows) {
    if (remaining <= 1e-9) break;
    const canMove = Math.max(0, Number(row.fromQty ?? "0"));
    if (canMove <= 1e-9) continue;
    const move = Math.min(canMove, remaining);

    await adjustBalanceQty(client, row.balanceId, fromField, -move);
    await adjustBalanceQty(client, row.balanceId, toField, move);
    await adjustLotQty(client, row.balanceId, lotId, lotCode, fromField, -move);
    await adjustLotQty(client, row.balanceId, lotId, lotCode, toField, move);
    await insertMovement(client, siteId, {
      itemId,
      lotId,
      fromLocationId: row.locationId,
      toLocationId: row.locationId,
      fromBucketId: input.fromBucketId,
      toBucketId: input.toBucketId,
      qty: move,
      requestId: input.requestId ?? null,
    });

    remaining -= move;
  }

  if (remaining > 1e-6) {
    throw new WmsHttpError(
      409,
      "not enough qty in source bucket for this lot",
      "insufficient_qty",
      { requested: input.qty, moved: input.qty - remaining }
    );
  }
}

