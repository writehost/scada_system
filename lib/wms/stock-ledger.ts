import type { PoolClient } from "pg";
import { WmsHttpError } from "@/lib/wms/errors";
import { logWmsOperationEvent } from "@/lib/wms/operation-events";
import { WMS_MOVEMENT_TYPE, WMS_STOCK_BUCKET } from "@/lib/wms/ref";

type QtyField = "available_qty" | "in_production_qty" | "quarantine_qty";

export type StockLedgerEventInput = {
  siteId: number;
  eventType: string;
  actorUserId?: string | number | null;
  deviceUid?: string | null;
  documentId?: string | number | null;
  itemId?: string | number | null;
  locationId?: string | number | null;
  payload?: Record<string, unknown> | null;
};

export type StockMovementInput = {
  siteId: number;
  movementTypeId: number;
  itemId: string;
  qty: number;
  documentId?: string | null;
  documentLineId?: string | null;
  lotId?: string | null;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  fromBucketId?: number | null;
  toBucketId?: number | null;
  requestId?: string | null;
  payload?: Record<string, unknown> | null;
  event: StockLedgerEventInput;
};

export async function ensureStockBalance(
  client: PoolClient,
  siteId: number,
  locationId: string,
  itemId: string,
  initialAvailable = 0
): Promise<string> {
  await client.query(
    `INSERT INTO wms_stock_balances (site_id, location_id, item_id, available_qty, accuracy_status_id)
     VALUES ($1, $2::bigint, $3::bigint, $4, 1)
     ON CONFLICT (site_id, location_id, item_id) DO NOTHING`,
    [siteId, locationId, itemId, initialAvailable]
  );
  const r = await client.query<{ balance_id: string }>(
    `SELECT balance_id::text FROM wms_stock_balances
     WHERE site_id = $1 AND location_id = $2::bigint AND item_id = $3::bigint`,
    [siteId, locationId, itemId]
  );
  const id = r.rows[0]?.balance_id;
  if (!id) throw new WmsHttpError(500, "balance missing", "balance_missing");
  return id;
}

export async function lockStockBalances(
  client: PoolClient,
  siteId: number,
  itemId: string,
  locationIds: string[]
) {
  const unique = [...new Set(locationIds)].sort((a, b) => a.localeCompare(b));
  for (const lid of unique) {
    await client.query(
      `SELECT 1 FROM wms_stock_balances
       WHERE site_id = $1 AND location_id = $2::bigint AND item_id = $3::bigint
       FOR UPDATE`,
      [siteId, lid, itemId]
    );
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
     SET ${field} = ${field} + $1, updated_at = now()
     WHERE balance_id = $2::bigint
     RETURNING ${field}::text AS value`,
    [delta, balanceId]
  );
  const nextValue = Number(r.rows[0]?.value ?? "0");
  if (nextValue < -1e-9) {
    throw new WmsHttpError(409, `negative balance in ${field}`, "negative_balance");
  }
}

async function ensureStockLotRow(
  client: PoolClient,
  balanceId: string,
  lotId: string | null,
  lotCode: string,
  expiryAt?: string | null
) {
  if (lotId) {
    await client.query(
      `INSERT INTO wms_stock_lots (balance_id, lot_id, lot_code, expiry_at)
       VALUES ($1::bigint, $2::bigint, $3, $4)
       ON CONFLICT (balance_id, lot_code) DO UPDATE SET
         lot_id = COALESCE(wms_stock_lots.lot_id, EXCLUDED.lot_id),
         expiry_at = COALESCE(EXCLUDED.expiry_at, wms_stock_lots.expiry_at),
         updated_at = now()`,
      [balanceId, lotId, lotCode, expiryAt ? new Date(expiryAt) : null]
    );
    return;
  }
  await client.query(
    `INSERT INTO wms_stock_lots (balance_id, lot_code, batch_label, available_qty, expiry_at)
     VALUES ($1::bigint, $2, $2, 0, $3)
     ON CONFLICT (balance_id, lot_code) DO UPDATE SET
       expiry_at = COALESCE(EXCLUDED.expiry_at, wms_stock_lots.expiry_at),
       updated_at = now()`,
    [balanceId, lotCode, expiryAt ? new Date(expiryAt) : null]
  );
}

async function adjustLotQty(
  client: PoolClient,
  balanceId: string,
  lotId: string | null,
  lotCode: string,
  field: QtyField,
  delta: number,
  expiryAt?: string | null
) {
  await ensureStockLotRow(client, balanceId, lotId, lotCode, expiryAt);
  const r = lotId
    ? await client.query<{ value: string }>(
        `UPDATE wms_stock_lots
         SET ${field} = ${field} + $1, updated_at = now()
         WHERE balance_id = $2::bigint AND lot_id = $3::bigint
         RETURNING ${field}::text AS value`,
        [delta, balanceId, lotId]
      )
    : await client.query<{ value: string }>(
        `UPDATE wms_stock_lots
         SET ${field} = ${field} + $1, updated_at = now()
         WHERE balance_id = $2::bigint AND lot_code = $3
         RETURNING ${field}::text AS value`,
        [delta, balanceId, lotCode]
      );
  const nextValue = Number(r.rows[0]?.value ?? "0");
  if (nextValue < -1e-9) {
    throw new WmsHttpError(409, `negative lot balance in ${field}`, "negative_lot_balance");
  }
}

export async function insertStockMovement(client: PoolClient, input: StockMovementInput) {
  if (!Number.isFinite(input.qty) || input.qty <= 0) {
    throw new WmsHttpError(400, "qty must be positive", "invalid_qty");
  }
  await client.query(
    `INSERT INTO wms_stock_movements (
       site_id, movement_type_id, document_id, document_line_id, item_id, lot_id,
       from_location_id, to_location_id, from_bucket_id, to_bucket_id, qty, request_id, payload_json
     ) VALUES (
       $1, $2, $3::bigint, $4::bigint, $5::bigint, $6::bigint,
       $7::bigint, $8::bigint, $9, $10, $11, $12::uuid, $13::jsonb
     )`,
    [
      input.siteId,
      input.movementTypeId,
      input.documentId ?? null,
      input.documentLineId ?? null,
      input.itemId,
      input.lotId ?? null,
      input.fromLocationId ?? null,
      input.toLocationId ?? null,
      input.fromBucketId ?? null,
      input.toBucketId ?? null,
      input.qty,
      input.requestId ?? null,
      JSON.stringify(input.payload ?? {}),
    ]
  );
  await logWmsOperationEvent(client, {
    siteId: input.event.siteId,
    eventType: input.event.eventType,
    actorUserId: input.event.actorUserId,
    deviceUid: input.event.deviceUid,
    documentId: input.event.documentId ?? input.documentId,
    itemId: input.event.itemId ?? input.itemId,
    locationId: input.event.locationId ?? input.toLocationId ?? input.fromLocationId,
    payload: input.event.payload ?? input.payload ?? {},
  });
}

export type StockReceiptInput = {
  siteId: number;
  itemId: string;
  toLocationId: string;
  qty: number;
  lotId?: string | null;
  lotCode?: string | null;
  lotExpiryAt?: string | null;
  documentId?: string | null;
  documentLineId?: string | null;
  requestId?: string | null;
  payload?: Record<string, unknown> | null;
  actorUserId?: string | null;
};

export async function applyStockReceipt(client: PoolClient, input: StockReceiptInput) {
  const balanceId = await ensureStockBalance(client, input.siteId, input.toLocationId, input.itemId);
  await adjustBalanceQty(client, balanceId, "available_qty", input.qty);
  if (input.lotCode?.trim()) {
    await adjustLotQty(
      client,
      balanceId,
      input.lotId ?? null,
      input.lotCode.trim(),
      "available_qty",
      input.qty,
      input.lotExpiryAt
    );
  }
  await insertStockMovement(client, {
    siteId: input.siteId,
    movementTypeId: WMS_MOVEMENT_TYPE.receiving,
    itemId: input.itemId,
    qty: input.qty,
    documentId: input.documentId,
    documentLineId: input.documentLineId,
    lotId: input.lotId,
    toLocationId: input.toLocationId,
    toBucketId: WMS_STOCK_BUCKET.available,
    requestId: input.requestId,
    payload: input.payload,
    event: {
      siteId: input.siteId,
      eventType: "stock.receipt",
      actorUserId: input.actorUserId,
      documentId: input.documentId,
      itemId: input.itemId,
      locationId: input.toLocationId,
      payload: { qty: input.qty, lotCode: input.lotCode ?? null },
    },
  });
  return { balanceId };
}

export type WorkshopDirectReceiptLedgerInput = {
  siteId: number;
  itemId: string;
  toLocationId: string;
  qty: number;
  lotId?: string | null;
  lotCode?: string | null;
  lotExpiryAt?: string | null;
  documentId?: string | null;
  documentLineId?: string | null;
  requestId?: string | null;
  operatorName?: string | null;
  payload?: Record<string, unknown> | null;
};

/** Прямой приём в ячейку цеха: +in_production без списания со склада OS. */
export async function applyWorkshopDirectReceipt(
  client: PoolClient,
  input: WorkshopDirectReceiptLedgerInput
) {
  const balanceId = await ensureStockBalance(client, input.siteId, input.toLocationId, input.itemId);
  await adjustBalanceQty(client, balanceId, "in_production_qty", input.qty);
  if (input.lotCode?.trim()) {
    await adjustLotQty(
      client,
      balanceId,
      input.lotId ?? null,
      input.lotCode.trim(),
      "in_production_qty",
      input.qty,
      input.lotExpiryAt
    );
  }
  await insertStockMovement(client, {
    siteId: input.siteId,
    movementTypeId: WMS_MOVEMENT_TYPE.receiving,
    itemId: input.itemId,
    qty: input.qty,
    documentId: input.documentId,
    documentLineId: input.documentLineId,
    lotId: input.lotId,
    toLocationId: input.toLocationId,
    toBucketId: WMS_STOCK_BUCKET.in_production,
    requestId: input.requestId,
    payload: input.payload,
    event: {
      siteId: input.siteId,
      eventType: "workshop.direct_receipt",
      documentId: input.documentId,
      itemId: input.itemId,
      locationId: input.toLocationId,
      payload: {
        qty: input.qty,
        lotCode: input.lotCode ?? null,
        operatorName: input.operatorName ?? null,
      },
    },
  });
  return { balanceId };
}

export type StockTransferInput = {
  siteId: number;
  itemId: string;
  fromLocationId: string;
  toLocationId: string;
  qty: number;
  lotId?: string | null;
  lotCode?: string | null;
  movementTypeId?: number;
  documentId?: string | null;
  documentLineId?: string | null;
  requestId?: string | null;
  payload?: Record<string, unknown> | null;
  actorUserId?: string | null;
  eventType?: string;
};

export async function applyStockTransfer(client: PoolClient, input: StockTransferInput) {
  await lockStockBalances(client, input.siteId, input.itemId, [
    input.fromLocationId,
    input.toLocationId,
  ]);
  await ensureStockBalance(client, input.siteId, input.toLocationId, input.itemId);

  const fromBal = await client.query<{ balance_id: string; available_qty: string }>(
    `SELECT balance_id::text, available_qty::text
     FROM wms_stock_balances
     WHERE site_id = $1 AND location_id = $2::bigint AND item_id = $3::bigint`,
    [input.siteId, input.fromLocationId, input.itemId]
  );
  if (fromBal.rows.length === 0) {
    throw new WmsHttpError(404, "no stock at source location", "no_balance");
  }
  const fromBalanceId = fromBal.rows[0].balance_id;
  const avail = Number(fromBal.rows[0].available_qty);
  if (avail + 1e-9 < input.qty) {
    throw new WmsHttpError(409, "insufficient available qty", "insufficient_stock");
  }

  if (input.lotId && input.lotCode) {
    const lotRow = await client.query<{ available_qty: string }>(
      `SELECT COALESCE(available_qty, 0)::text AS available_qty
       FROM wms_stock_lots
       WHERE balance_id = $1::bigint AND lot_id = $2::bigint
       FOR UPDATE`,
      [fromBalanceId, input.lotId]
    );
    const lotAvail = Number(lotRow.rows[0]?.available_qty ?? "0");
    if (lotAvail + 1e-9 < input.qty) {
      throw new WmsHttpError(409, "insufficient available qty for lot", "insufficient_lot_stock");
    }
  }

  const toBalanceId = await ensureStockBalance(
    client,
    input.siteId,
    input.toLocationId,
    input.itemId
  );

  await adjustBalanceQty(client, fromBalanceId, "available_qty", -input.qty);
  await adjustBalanceQty(client, toBalanceId, "available_qty", input.qty);

  if (input.lotCode?.trim()) {
    await adjustLotQty(
      client,
      fromBalanceId,
      input.lotId ?? null,
      input.lotCode.trim(),
      "available_qty",
      -input.qty
    );
    await adjustLotQty(
      client,
      toBalanceId,
      input.lotId ?? null,
      input.lotCode.trim(),
      "available_qty",
      input.qty
    );
  }

  const movementType = input.movementTypeId ?? WMS_MOVEMENT_TYPE.transfer;
  const eventType =
    input.eventType ??
    (movementType === WMS_MOVEMENT_TYPE.issue ? "stock.issue" : "stock.transfer");

  await insertStockMovement(client, {
    siteId: input.siteId,
    movementTypeId: movementType,
    itemId: input.itemId,
    qty: input.qty,
    documentId: input.documentId,
    documentLineId: input.documentLineId,
    lotId: input.lotId,
    fromLocationId: input.fromLocationId,
    toLocationId: input.toLocationId,
    fromBucketId: WMS_STOCK_BUCKET.available,
    toBucketId: WMS_STOCK_BUCKET.available,
    requestId: input.requestId,
    payload: input.payload,
    event: {
      siteId: input.siteId,
      eventType,
      actorUserId: input.actorUserId,
      documentId: input.documentId,
      itemId: input.itemId,
      locationId: input.fromLocationId,
      payload: {
        qty: input.qty,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        lotCode: input.lotCode ?? null,
      },
    },
  });

  return { fromBalanceId, toBalanceId };
}

/** Выдача со склада в цех: available (источник) → in_production (ячейка линии). */
export async function applyIssueToWorkshop(client: PoolClient, input: StockTransferInput) {
  await lockStockBalances(client, input.siteId, input.itemId, [
    input.fromLocationId,
    input.toLocationId,
  ]);
  const toBalanceId = await ensureStockBalance(
    client,
    input.siteId,
    input.toLocationId,
    input.itemId
  );

  const fromBal = await client.query<{ balance_id: string; available_qty: string }>(
    `SELECT balance_id::text, available_qty::text
     FROM wms_stock_balances
     WHERE site_id = $1 AND location_id = $2::bigint AND item_id = $3::bigint`,
    [input.siteId, input.fromLocationId, input.itemId]
  );
  if (fromBal.rows.length === 0) {
    throw new WmsHttpError(404, "no stock at source location", "no_balance");
  }
  const fromBalanceId = fromBal.rows[0].balance_id;
  const avail = Number(fromBal.rows[0].available_qty);
  if (avail + 1e-9 < input.qty) {
    throw new WmsHttpError(409, "insufficient available qty", "insufficient_stock");
  }

  if (input.lotId && input.lotCode) {
    const lotRow = await client.query<{ available_qty: string }>(
      `SELECT COALESCE(available_qty, 0)::text AS available_qty
       FROM wms_stock_lots
       WHERE balance_id = $1::bigint AND lot_id = $2::bigint
       FOR UPDATE`,
      [fromBalanceId, input.lotId]
    );
    const lotAvail = Number(lotRow.rows[0]?.available_qty ?? "0");
    if (lotAvail + 1e-9 < input.qty) {
      throw new WmsHttpError(409, "insufficient available qty for lot", "insufficient_lot_stock");
    }
  }

  await adjustBalanceQty(client, fromBalanceId, "available_qty", -input.qty);
  await adjustBalanceQty(client, toBalanceId, "in_production_qty", input.qty);

  if (input.lotCode?.trim()) {
    await adjustLotQty(
      client,
      fromBalanceId,
      input.lotId ?? null,
      input.lotCode.trim(),
      "available_qty",
      -input.qty
    );
    await adjustLotQty(
      client,
      toBalanceId,
      input.lotId ?? null,
      input.lotCode.trim(),
      "in_production_qty",
      input.qty
    );
  }

  await insertStockMovement(client, {
    siteId: input.siteId,
    movementTypeId: input.movementTypeId ?? WMS_MOVEMENT_TYPE.issue,
    itemId: input.itemId,
    qty: input.qty,
    documentId: input.documentId,
    documentLineId: input.documentLineId,
    lotId: input.lotId,
    fromLocationId: input.fromLocationId,
    toLocationId: input.toLocationId,
    fromBucketId: WMS_STOCK_BUCKET.available,
    toBucketId: WMS_STOCK_BUCKET.in_production,
    requestId: input.requestId,
    payload: input.payload,
    event: {
      siteId: input.siteId,
      eventType: input.eventType ?? "issue.to_production",
      actorUserId: input.actorUserId,
      documentId: input.documentId,
      itemId: input.itemId,
      locationId: input.toLocationId,
      payload: {
        qty: input.qty,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        lotCode: input.lotCode ?? null,
      },
    },
  });

  return { fromBalanceId, toBalanceId };
}

/** Возврат из цеха на склад материалов: in_production/available (ячейка) → available (склад). */
export async function applyReturnFromWorkshop(
  client: PoolClient,
  input: StockTransferInput & { waitingPoint?: boolean }
) {
  await lockStockBalances(client, input.siteId, input.itemId, [
    input.fromLocationId,
    input.toLocationId,
  ]);

  const fromBal = await client.query<{
    balance_id: string;
    in_production_qty: string;
    available_qty: string;
  }>(
    `SELECT balance_id::text, in_production_qty::text, available_qty::text
     FROM wms_stock_balances
     WHERE site_id = $1 AND location_id = $2::bigint AND item_id = $3::bigint
     FOR UPDATE`,
    [input.siteId, input.fromLocationId, input.itemId]
  );
  if (fromBal.rows.length === 0) {
    throw new WmsHttpError(404, "no stock at workshop location", "no_balance");
  }
  const fromBalanceId = fromBal.rows[0].balance_id;
  const beforeInProduction = Number(fromBal.rows[0].in_production_qty);
  const beforeAvailable = Number(fromBal.rows[0].available_qty);
  const totalOnHand = beforeInProduction + beforeAvailable;
  if (totalOnHand + 1e-9 < input.qty) {
    throw new WmsHttpError(409, "insufficient stock at workshop location", "insufficient_stock");
  }

  let fromAvailable = 0;
  let fromInProduction = 0;
  if (input.waitingPoint) {
    fromAvailable = Math.min(beforeAvailable, input.qty);
    fromInProduction = input.qty - fromAvailable;
  } else {
    if (beforeInProduction + 1e-9 < input.qty) {
      throw new WmsHttpError(409, "insufficient in_production qty", "insufficient_stock");
    }
    fromInProduction = input.qty;
  }

  const toBalanceId = await ensureStockBalance(
    client,
    input.siteId,
    input.toLocationId,
    input.itemId
  );

  await client.query(
    `UPDATE wms_stock_balances
     SET in_production_qty = in_production_qty - $1,
         available_qty = available_qty - $2,
         updated_at = now(),
         snapshot_version = snapshot_version + 1
     WHERE balance_id = $3::bigint`,
    [fromInProduction, fromAvailable, fromBalanceId]
  );
  await adjustBalanceQty(client, toBalanceId, "available_qty", input.qty);

  if (input.lotCode?.trim()) {
    if (fromAvailable > 0) {
      await adjustLotQty(
        client,
        fromBalanceId,
        input.lotId ?? null,
        input.lotCode.trim(),
        "available_qty",
        -fromAvailable
      );
    }
    if (fromInProduction > 0) {
      await adjustLotQty(
        client,
        fromBalanceId,
        input.lotId ?? null,
        input.lotCode.trim(),
        "in_production_qty",
        -fromInProduction
      );
    }
    await adjustLotQty(
      client,
      toBalanceId,
      input.lotId ?? null,
      input.lotCode.trim(),
      "available_qty",
      input.qty
    );
  }

  const fromBucketId =
    fromInProduction > 0 ? WMS_STOCK_BUCKET.in_production : WMS_STOCK_BUCKET.available;

  await insertStockMovement(client, {
    siteId: input.siteId,
    movementTypeId: input.movementTypeId ?? WMS_MOVEMENT_TYPE.return,
    itemId: input.itemId,
    qty: input.qty,
    documentId: input.documentId,
    documentLineId: input.documentLineId,
    lotId: input.lotId,
    fromLocationId: input.fromLocationId,
    toLocationId: input.toLocationId,
    fromBucketId,
    toBucketId: WMS_STOCK_BUCKET.available,
    requestId: input.requestId,
    payload: input.payload,
    event: {
      siteId: input.siteId,
      eventType: input.eventType ?? "workshop.return_to_warehouse",
      actorUserId: input.actorUserId,
      documentId: input.documentId,
      itemId: input.itemId,
      locationId: input.fromLocationId,
      payload: {
        qty: input.qty,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        lotCode: input.lotCode ?? null,
        waitingPoint: input.waitingPoint ?? false,
        fromAvailable,
        fromInProduction,
      },
    },
  });

  return {
    fromBalanceId,
    toBalanceId,
    beforeInProduction,
    afterInProduction: beforeInProduction - fromInProduction,
    beforeAvailable,
    afterAvailable: beforeAvailable - fromAvailable,
  };
}

function writeoffBucketField(bucketId: number): QtyField {
  switch (bucketId) {
    case WMS_STOCK_BUCKET.available:
      return "available_qty";
    case WMS_STOCK_BUCKET.in_production:
      return "in_production_qty";
    case WMS_STOCK_BUCKET.quarantine:
      return "quarantine_qty";
    default:
      throw new WmsHttpError(400, "нельзя списать этот статус остатка", "bad_writeoff_bucket");
  }
}

export type StockWriteoffInput = {
  siteId: number;
  itemId: string;
  fromLocationId: string;
  qty: number;
  fromBucketId: number;
  lotId?: string | null;
  lotCode?: string | null;
  movementTypeId?: number;
  documentId?: string | null;
  documentLineId?: string | null;
  requestId?: string | null;
  payload?: Record<string, unknown> | null;
  actorUserId?: string | null;
};

/** Списание со склада: остаток уходит из ячейки, без ячейки назначения. */
export async function applyStockWriteoff(client: PoolClient, input: StockWriteoffInput) {
  if (!(input.qty > 0)) {
    throw new WmsHttpError(400, "qty must be > 0", "bad_qty");
  }
  const field = writeoffBucketField(input.fromBucketId);
  await lockStockBalances(client, input.siteId, input.itemId, [input.fromLocationId]);

  const fromBal = await client.query<{ balance_id: string; qty: string }>(
    `SELECT balance_id::text, ${field}::text AS qty
     FROM wms_stock_balances
     WHERE site_id = $1 AND location_id = $2::bigint AND item_id = $3::bigint
     FOR UPDATE`,
    [input.siteId, input.fromLocationId, input.itemId]
  );
  if (fromBal.rows.length === 0) {
    throw new WmsHttpError(404, "в ячейке нет остатка", "no_balance");
  }
  const fromBalanceId = fromBal.rows[0].balance_id;
  const avail = Number(fromBal.rows[0].qty);
  if (avail + 1e-9 < input.qty) {
    throw new WmsHttpError(409, "недостаточно остатка для списания", "insufficient_stock");
  }

  if (input.lotId && input.lotCode) {
    const lotRow = await client.query<{ qty: string }>(
      `SELECT COALESCE(${field}, 0)::text AS qty
       FROM wms_stock_lots
       WHERE balance_id = $1::bigint AND lot_id = $2::bigint
       FOR UPDATE`,
      [fromBalanceId, input.lotId]
    );
    const lotAvail = Number(lotRow.rows[0]?.qty ?? "0");
    if (lotAvail + 1e-9 < input.qty) {
      throw new WmsHttpError(409, "недостаточно остатка партии для списания", "insufficient_lot_stock");
    }
  }

  await adjustBalanceQty(client, fromBalanceId, field, -input.qty);
  if (input.lotCode?.trim()) {
    await adjustLotQty(
      client,
      fromBalanceId,
      input.lotId ?? null,
      input.lotCode.trim(),
      field,
      -input.qty
    );
  }

  await insertStockMovement(client, {
    siteId: input.siteId,
    movementTypeId: input.movementTypeId ?? WMS_MOVEMENT_TYPE.writeoff,
    itemId: input.itemId,
    qty: input.qty,
    documentId: input.documentId,
    documentLineId: input.documentLineId,
    lotId: input.lotId,
    fromLocationId: input.fromLocationId,
    fromBucketId: input.fromBucketId,
    requestId: input.requestId,
    payload: input.payload,
    event: {
      siteId: input.siteId,
      eventType: "stock.writeoff",
      actorUserId: input.actorUserId,
      documentId: input.documentId,
      itemId: input.itemId,
      locationId: input.fromLocationId,
      payload: {
        qty: input.qty,
        lotCode: input.lotCode ?? null,
        fromBucketId: input.fromBucketId,
      },
    },
  });

  return { fromBalanceId };
}
