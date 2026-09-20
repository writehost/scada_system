import type { PoolClient } from "pg";
import {
  createDocumentWithTasks,
  type CreateDocumentInput,
  type CreateDocumentLineInput,
} from "@/lib/wms/documents";
import { requireDeviceByUid } from "@/lib/wms/devices";
import { WmsHttpError } from "@/lib/wms/errors";
import { notifyWmsTaskEvent } from "@/lib/wms/events";
import { fetchBalanceSnapshot } from "@/lib/wms/query";
import { resolveLocation, resolveTaskById } from "@/lib/wms/resolve";
import {
  buildFgPickPlanForTask,
  defaultWarehouseLocationCode,
  isFgShipTaskType,
  scanBelongsToFgPickPlan,
} from "@/lib/wms/fg-pick-plan";
import {
  WMS_DOCUMENT_STATUS,
  WMS_MOVEMENT_TYPE,
  WMS_STOCK_BUCKET,
  WMS_TASK_STATUS,
  WMS_TASK_TYPE,
} from "@/lib/wms/ref";

function parseCursor(cursor?: string | null): number | null {
  if (!cursor) return null;
  const value = Number(cursor);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return 50;
  return Math.min(Math.max(Math.trunc(limit ?? 50), 1), 100);
}

type QtyField =
  | "available_qty"
  | "reserved_qty"
  | "in_production_qty"
  | "in_transit_qty"
  | "quarantine_qty"
  | "rejected_qty";

export type CreateOperationalTasksInput = {
  requestId: string;
  siteCode: string;
  operationType: "receipt" | "shipment" | "revision";
  priorityCode?: "low" | "normal" | "high" | "urgent";
  documentNo?: string;
  externalRef?: string;
  comment?: string;
  sourceWarehouseCode?: string;
  targetWarehouseCode?: string;
  sourceLocationCode?: string;
  targetLocationCode?: string;
  assignUserId?: string;
  lines: Array<{
    itemCode: string;
    qty?: number;
    uomCode?: string;
    palletsQty?: number;
    blocksQty?: number;
    unitsQty?: number;
    sourceLocationCode?: string;
    targetLocationCode?: string;
    lotCode?: string;
    batchLabel?: string;
    manufacturedAt?: string;
    bestBeforeAt?: string;
    expiryAt?: string;
    loadUnitCode?: string;
    loadUnitLabel?: string;
    loadUnitType?: string;
    mixedItemsAllowed?: boolean;
    comment?: string;
  }>;
};

type ItemUomRow = {
  uom_code: string;
  qty_in_base: string;
  is_base: boolean;
  level_no: number;
};

type ItemPackagingSnapshot = {
  baseUomCode: string;
  palletUomCode: string | null;
  blockUomCode: string | null;
  unitUomCode: string;
  byCode: Map<string, number>;
};

async function getItemPackagingSnapshot(
  client: PoolClient,
  siteId: number,
  itemCode: string
): Promise<ItemPackagingSnapshot> {
  const item = await client.query<{ item_id: string; uom_code: string }>(
    `SELECT item_id::text AS item_id, uom_code
     FROM wms_items
     WHERE site_id = $1 AND item_code = $2`,
    [siteId, itemCode.trim()]
  );
  const itemId = item.rows[0]?.item_id;
  const baseUomCode = item.rows[0]?.uom_code ?? "pcs";
  if (!itemId) {
    throw new WmsHttpError(404, `item not found: ${itemCode}`, "item_not_found");
  }

  const uoms = await client.query<ItemUomRow>(
    `SELECT uom_code, qty_in_base::text AS qty_in_base, is_base, level_no
     FROM wms_item_uoms
     WHERE item_id = $1::bigint
     ORDER BY qty_in_base DESC, level_no DESC, uom_code`,
    [itemId]
  );

  const byCode = new Map<string, number>();
  byCode.set(baseUomCode, 1);
  for (const row of uoms.rows) {
    byCode.set(row.uom_code, Number(row.qty_in_base));
  }

  const sorted = Array.from(byCode.entries()).sort((a, b) => b[1] - a[1]);
  const palletUomCode = sorted[0]?.[0] ?? null;
  const unitUomCode =
    Array.from(byCode.entries()).sort((a, b) => a[1] - b[1])[0]?.[0] ?? baseUomCode;
  const middle = sorted.filter(([code]) => code !== palletUomCode && code !== unitUomCode);
  const blockUomCode = middle[0]?.[0] ?? (palletUomCode !== unitUomCode ? unitUomCode : null);

  return {
    baseUomCode,
    palletUomCode,
    blockUomCode,
    unitUomCode,
    byCode,
  };
}

async function resolveItemRotation(
  client: PoolClient,
  siteId: number,
  itemCode: string
): Promise<{
  itemId: string;
  isPerishable: boolean;
  rotationPolicy: string;
  expiryWarningDays: number | null;
}> {
  const r = await client.query<{
    item_id: string;
    is_perishable: boolean;
    rotation_policy: string;
    expiry_warning_days: number | null;
  }>(
    `SELECT
       item_id::text AS item_id,
       is_perishable,
       rotation_policy,
       expiry_warning_days
     FROM wms_items
     WHERE site_id = $1 AND item_code = $2`,
    [siteId, itemCode.trim()]
  );
  const row = r.rows[0];
  if (!row) {
    throw new WmsHttpError(404, `item not found: ${itemCode}`, "item_not_found");
  }
  return {
    itemId: row.item_id,
    isPerishable: Boolean(row.is_perishable),
    rotationPolicy: row.rotation_policy || "fifo",
    expiryWarningDays:
      row.expiry_warning_days == null ? null : Number(row.expiry_warning_days),
  };
}

async function suggestLotForShipment(
  client: PoolClient,
  siteId: number,
  itemCode: string,
  sourceLocationCode?: string
) {
  const rotation = await resolveItemRotation(client, siteId, itemCode);
  if (rotation.rotationPolicy === "manual") {
    return null;
  }

  const params: Array<string | number | null> = [siteId, rotation.itemId];
  let locationFilter = "";
  if (sourceLocationCode?.trim()) {
    params.push(sourceLocationCode.trim());
    locationFilter = `AND l.location_code = $3`;
  }

  const orderBy =
    rotation.rotationPolicy === "fefo"
      ? `wl.expiry_at NULLS LAST, wl.best_before_at NULLS LAST, wl.received_at NULLS LAST, wl.lot_code`
      : `wl.received_at NULLS LAST, wl.lot_code`;

  const query = `
    SELECT
      wl.lot_id::text AS "lotId",
      wl.lot_code AS "lotCode",
      wl.batch_label AS "batchLabel",
      wl.manufactured_at AS "manufacturedAt",
      wl.best_before_at AS "bestBeforeAt",
      wl.expiry_at AS "expiryAt",
      l.location_code AS "locationCode",
      SUM(sl.available_qty)::float8 AS "availableQty"
    FROM wms_stock_lots sl
    JOIN wms_stock_balances sb ON sb.balance_id = sl.balance_id
    JOIN wms_locations l ON l.location_id = sb.location_id
    JOIN wms_lots wl ON wl.lot_id = sl.lot_id
    WHERE sb.site_id = $1
      AND sb.item_id = $2::bigint
      AND sl.available_qty > 0
      ${locationFilter}
    GROUP BY wl.lot_id, l.location_code
    ORDER BY ${orderBy}
    LIMIT 1`;

  const r = await client.query<{
    lotId: string;
    lotCode: string;
    batchLabel: string | null;
    manufacturedAt: string | null;
    bestBeforeAt: string | null;
    expiryAt: string | null;
    locationCode: string | null;
    availableQty: number;
  }>(query, params);

  return r.rows[0] ?? null;
}

function numericOrZero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function normalizeOperationalLine(
  client: PoolClient,
  siteId: number,
  operationType: CreateOperationalTasksInput["operationType"],
  line: CreateOperationalTasksInput["lines"][number],
  index: number
): Promise<CreateDocumentLineInput> {
  const packaging = await getItemPackagingSnapshot(client, siteId, line.itemCode);
  const rotation = await resolveItemRotation(client, siteId, line.itemCode);
  const explicitQty = numericOrZero(line.qty);
  const palletsQty = numericOrZero(line.palletsQty);
  const blocksQty = numericOrZero(line.blocksQty);
  const unitsQty = numericOrZero(line.unitsQty);

  let qty = explicitQty;
  let requestedUomCode = line.uomCode?.trim() || undefined;

  if (operationType === "shipment") {
    const palletFactor = packaging.palletUomCode
      ? packaging.byCode.get(packaging.palletUomCode) ?? 0
      : 0;
    const blockFactor = packaging.blockUomCode
      ? packaging.byCode.get(packaging.blockUomCode) ?? 0
      : 0;
    const unitFactor = packaging.byCode.get(packaging.unitUomCode) ?? 1;

    const breakdownQty =
      palletsQty * palletFactor + blocksQty * blockFactor + unitsQty * unitFactor;
    if (breakdownQty > 0) {
      qty = breakdownQty;
      if (!requestedUomCode) {
        requestedUomCode =
          palletsQty > 0 && blocksQty === 0 && unitsQty === 0
            ? packaging.palletUomCode ?? packaging.baseUomCode
            : blocksQty > 0 && unitsQty === 0
              ? packaging.blockUomCode ?? packaging.baseUomCode
              : packaging.unitUomCode;
      }
    } else if (requestedUomCode) {
      const factor = packaging.byCode.get(requestedUomCode);
      if (!factor) {
        throw new WmsHttpError(
          400,
          `unknown shipping uom for ${line.itemCode}: ${requestedUomCode}`,
          "bad_uom"
        );
      }
      qty = explicitQty * factor;
    }
  } else if (requestedUomCode) {
    const factor = packaging.byCode.get(requestedUomCode);
    if (factor) {
      qty = explicitQty * factor;
    }
  }

  if (!Number.isFinite(qty) || qty <= 0) {
    throw new WmsHttpError(400, `bad qty for ${line.itemCode}`, "bad_qty");
  }

  const generatedLoadUnitCode =
    operationType === "shipment"
      ? line.loadUnitCode?.trim() || `PALLET-${index + 1}`
      : line.loadUnitCode?.trim() || undefined;

  const suggestedLot =
    operationType === "shipment" && !line.lotCode?.trim()
      ? await suggestLotForShipment(client, siteId, line.itemCode, line.sourceLocationCode)
      : null;

  const effectiveLotCode = line.lotCode?.trim() || suggestedLot?.lotCode || undefined;
  const effectiveBatchLabel = line.batchLabel || suggestedLot?.batchLabel || undefined;
  const effectiveManufacturedAt =
    line.manufacturedAt || suggestedLot?.manufacturedAt || undefined;
  const effectiveBestBeforeAt =
    line.bestBeforeAt || suggestedLot?.bestBeforeAt || undefined;
  const effectiveExpiryAt = line.expiryAt || suggestedLot?.expiryAt || undefined;
  const effectiveSourceLocationCode =
    line.sourceLocationCode || suggestedLot?.locationCode || undefined;

  return {
    itemCode: line.itemCode,
    qty,
    requestedUomCode: requestedUomCode ?? packaging.baseUomCode,
    sourceLocationCode: effectiveSourceLocationCode,
    targetLocationCode: line.targetLocationCode,
    lotCode: effectiveLotCode,
    batchLabel: effectiveBatchLabel,
    manufacturedAt: effectiveManufacturedAt,
    bestBeforeAt: effectiveBestBeforeAt,
    expiryAt: effectiveExpiryAt,
    loadUnitCode: generatedLoadUnitCode,
    loadUnitLabel: line.loadUnitLabel ?? generatedLoadUnitCode,
    loadUnitType: line.loadUnitType ?? "pallet",
    mixedItemsAllowed: line.mixedItemsAllowed ?? true,
    loadUnitMaxBaseQty:
      operationType === "shipment" && packaging.palletUomCode
        ? packaging.byCode.get(packaging.palletUomCode) ?? undefined
        : undefined,
    comment: line.comment,
    taskPayload: {
      operationType,
      createdFrom: "wms_tasks_workbench",
      qtyByUom: {
        pallets: palletsQty,
        blocks: blocksQty,
        units: unitsQty,
      },
      packaging: {
        baseUomCode: packaging.baseUomCode,
        palletUomCode: packaging.palletUomCode,
        blockUomCode: packaging.blockUomCode,
        unitUomCode: packaging.unitUomCode,
      },
      rotation: {
        isPerishable: rotation.isPerishable,
        rotationPolicy: rotation.rotationPolicy,
        expiryWarningDays: rotation.expiryWarningDays,
      },
      selectedLot: suggestedLot
        ? {
            lotCode: suggestedLot.lotCode,
            batchLabel: suggestedLot.batchLabel,
            manufacturedAt: suggestedLot.manufacturedAt,
            bestBeforeAt: suggestedLot.bestBeforeAt,
            expiryAt: suggestedLot.expiryAt,
            locationCode: suggestedLot.locationCode,
          }
        : null,
      loadUnitCode: generatedLoadUnitCode ?? null,
    },
  };
}

async function ensureBalance(
  client: PoolClient,
  siteId: number,
  locationId: string,
  itemId: string
) {
  await client.query(
    `INSERT INTO wms_stock_balances (site_id, location_id, item_id, accuracy_status_id)
     VALUES ($1, $2::bigint, $3::bigint, 1)
     ON CONFLICT (site_id, location_id, item_id) DO NOTHING`,
    [siteId, locationId, itemId]
  );
}

async function getBalanceId(
  client: PoolClient,
  siteId: number,
  locationId: string,
  itemId: string
) {
  const r = await client.query<{ balance_id: string }>(
    `SELECT balance_id::text AS balance_id
     FROM wms_stock_balances
     WHERE site_id = $1 AND location_id = $2::bigint AND item_id = $3::bigint`,
    [siteId, locationId, itemId]
  );
  return r.rows[0]?.balance_id ?? null;
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
  lotId: string | null,
  field: QtyField,
  delta: number
) {
  if (!lotId) return;
  const lot = await client.query<{ lot_code: string }>(
    `SELECT lot_code FROM wms_lots WHERE lot_id = $1::bigint`,
    [lotId]
  );
  const lotCode = lot.rows[0]?.lot_code;
  if (!lotCode) return;
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

async function getTaskPayloadDocumentType(
  client: PoolClient,
  taskId: string
): Promise<string> {
  const r = await client.query<{ task_payload: unknown }>(
    `SELECT task_payload FROM wms_tasks WHERE task_id = $1::bigint`,
    [taskId]
  );
  const payload = r.rows[0]?.task_payload as Record<string, unknown> | undefined;
  return typeof payload?.documentType === "string" ? payload.documentType : "";
}

async function insertMovement(
  client: PoolClient,
  siteId: number,
  input: {
    movementTypeId: number;
    documentId: string | null;
    documentLineId: string | null;
    itemId: string;
    fromLocationId?: string | null;
    toLocationId?: string | null;
    fromBucketId?: number | null;
    toBucketId?: number | null;
    qty: number;
    requestId?: string | null;
  }
) {
  await client.query(
    `INSERT INTO wms_stock_movements (
       site_id, movement_type_id, document_id, document_line_id, item_id,
       from_location_id, to_location_id, from_bucket_id, to_bucket_id, qty, request_id
     ) VALUES (
       $1, $2, $3::bigint, $4::bigint, $5::bigint,
       $6::bigint, $7::bigint, $8, $9, $10, $11::uuid
     )`,
    [
      siteId,
      input.movementTypeId,
      input.documentId,
      input.documentLineId,
      input.itemId,
      input.fromLocationId ?? null,
      input.toLocationId ?? null,
      input.fromBucketId ?? null,
      input.toBucketId ?? null,
      input.qty,
      input.requestId ?? null,
    ]
  );
}

function mapOperationToDocumentType(input: CreateOperationalTasksInput): CreateDocumentInput["documentType"] {
  switch (input.operationType) {
    case "receipt":
      return "receiving";
    case "shipment":
      return "picking";
    case "revision":
      return "revision";
    default:
      return "receiving";
  }
}

export async function createOperationalTasks(
  client: PoolClient,
  siteId: number,
  input: CreateOperationalTasksInput
) {
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new WmsHttpError(400, "lines must be non-empty", "bad_lines");
  }

  const documentType = mapOperationToDocumentType(input);
  const lines: CreateDocumentLineInput[] = [];
  for (const [index, line] of input.lines.entries()) {
    lines.push(await normalizeOperationalLine(client, siteId, input.operationType, line, index));
  }

  const result = await createDocumentWithTasks(client, siteId, {
    requestId: input.requestId,
    siteCode: input.siteCode,
    documentType,
    sourceWarehouseCode: input.sourceWarehouseCode,
    targetWarehouseCode: input.targetWarehouseCode,
    sourceLocationCode: input.sourceLocationCode,
    targetLocationCode: input.targetLocationCode,
    priorityCode: input.priorityCode,
    documentNo: input.documentNo,
    externalRef: input.externalRef,
    comment: input.comment,
    assignUserId: input.assignUserId,
    lines,
  });

  return {
    ...result,
    operationType: input.operationType,
    documentType,
  };
}

export async function listTasks(
  client: PoolClient,
  siteId: number,
  options: {
    cursor?: string | null;
    limit?: number;
    status?: string;
    type?: string;
    query?: string;
    assignedUserId?: string;
    assignedDeviceId?: string;
    statusIn?: string[];
    onlyMine?: boolean;
  }
) {
  const limit = parseLimit(options.limit);
  const cursor = parseCursor(options.cursor);
  const status = options.status?.trim() ?? "";
  const type = options.type?.trim() ?? "";
  const query = options.query?.trim() ?? "";
  const assignedUserId =
    options.assignedUserId && Number(options.assignedUserId) > 0
      ? Number(options.assignedUserId)
      : null;
  const assignedDeviceId =
    options.assignedDeviceId && Number(options.assignedDeviceId) > 0
      ? Number(options.assignedDeviceId)
      : null;
  const statusIn = (options.statusIn ?? [])
    .map((code) => code.trim().toLowerCase())
    .filter(Boolean);

  const r = await client.query(
    `SELECT
       t.task_id::text AS cursor,
       t.task_id::text AS "taskId",
       t.task_code AS "taskCode",
       t.document_id::text AS "documentId",
       tt.code AS "taskType",
       ts.code AS "taskStatus",
       tp.code AS "priorityCode",
       i.item_code AS "itemCode",
       i.name AS "itemName",
       wl.lot_code AS "lotCode",
       sw.warehouse_code AS "sourceWarehouseCode",
       tw.warehouse_code AS "targetWarehouseCode",
       COALESCE(
         NULLIF(trim(d.payload_json #>> '{erpTransfer,sourceWarehouseName}'), ''),
         sw.name
       ) AS "sourceWarehouseName",
       COALESCE(
         NULLIF(trim(d.payload_json #>> '{erpTransfer,targetWarehouseName}'), ''),
         tw.name
       ) AS "targetWarehouseName",
       sl.location_code AS "sourceLocationCode",
       tl.location_code AS "targetLocationCode",
       t.planned_qty::float8 AS "plannedQty",
       t.confirmed_qty::float8 AS "confirmedQty",
       u.display_name AS "assignedUser",
       dv.device_name AS "assignedDevice",
       dv.device_uid AS "assignedDeviceUid",
       d.document_no AS "documentNo",
       t.due_at AS "dueAt",
       t.claimed_at AS "claimedAt",
       t.started_at AS "startedAt",
       t.completed_at AS "completedAt",
       t.exception_code AS "exceptionCode"
     FROM wms_tasks t
     JOIN ref_wms_task_type tt ON tt.task_type_id = t.task_type_id
     JOIN ref_wms_task_status ts ON ts.task_status_id = t.task_status_id
     JOIN ref_wms_task_priority tp ON tp.task_priority_id = t.task_priority_id
     LEFT JOIN wms_items i ON i.item_id = t.item_id
     LEFT JOIN wms_lots wl ON wl.lot_id = t.lot_id
     LEFT JOIN wms_warehouses sw ON sw.warehouse_id = t.source_warehouse_id
     LEFT JOIN wms_warehouses tw ON tw.warehouse_id = t.target_warehouse_id
     LEFT JOIN wms_locations sl ON sl.location_id = t.source_location_id
     LEFT JOIN wms_locations tl ON tl.location_id = t.target_location_id
     LEFT JOIN wms_users u ON u.user_id = t.assigned_user_id
     LEFT JOIN wms_devices dv ON dv.device_id = t.assigned_device_id
     LEFT JOIN wms_documents d ON d.document_id = t.document_id
     WHERE t.site_id = $1
       AND ($2::text = '' OR ts.code = $2)
       AND ($3::text = '' OR tt.code = $3)
       AND ($4::bigint IS NULL OR t.assigned_user_id = $4::bigint)
       AND ($5::bigint IS NULL OR t.assigned_device_id = $5::bigint)
       AND ($6::text = '' OR (
         t.task_code ILIKE '%' || $6 || '%'
         OR COALESCE(i.item_code, '') ILIKE '%' || $6 || '%'
         OR COALESCE(i.name, '') ILIKE '%' || $6 || '%'
         OR COALESCE(sl.location_code, '') ILIKE '%' || $6 || '%'
         OR COALESCE(tl.location_code, '') ILIKE '%' || $6 || '%'
         OR COALESCE(d.document_no, '') ILIKE '%' || $6 || '%'
       ))
       AND ($7::bigint IS NULL OR t.task_id < $7::bigint)
       AND ($9::text[] IS NULL OR ts.code = ANY($9::text[]))
     ORDER BY t.task_priority_id DESC, t.due_at NULLS LAST, t.task_id DESC
     LIMIT $8`,
    [
      siteId,
      status,
      type,
      assignedUserId,
      assignedDeviceId,
      query,
      cursor,
      limit + 1,
      statusIn.length ? statusIn : null,
    ]
  );
  const rows = r.rows.slice(0, limit);
  const nextCursor =
    r.rows.length > limit ? (rows[rows.length - 1]?.cursor as string | undefined) : "";
  return { tasks: rows, nextCursor };
}

export async function getTaskDetail(
  client: PoolClient,
  siteId: number,
  taskId: string
) {
  const task = await client.query(
    `SELECT
       t.task_id::text AS "taskId",
       t.task_code AS "taskCode",
       tt.code AS "taskType",
       ts.code AS "taskStatus",
       tp.code AS "priorityCode",
       t.planned_qty::float8 AS "plannedQty",
       t.confirmed_qty::float8 AS "confirmedQty",
       t.sequence_no AS "sequenceNo",
       t.due_at AS "dueAt",
       t.claimed_at AS "claimedAt",
       t.started_at AS "startedAt",
       t.completed_at AS "completedAt",
       t.released_at AS "releasedAt",
       t.exception_code AS "exceptionCode",
       t.exception_note AS "exceptionNote",
       t.task_payload AS "taskPayload",
       i.item_code AS "itemCode",
       i.name AS "itemName",
       wl.lot_code AS "lotCode",
       wl.batch_label AS "batchLabel",
       wl.manufactured_at AS "manufacturedAt",
       wl.expiry_at AS "expiryAt",
       d.document_id::text AS "documentId",
       d.document_no AS "documentNo",
       dt.code AS "documentType",
       ds.code AS "documentStatus",
       sw.warehouse_code AS "sourceWarehouseCode",
       tw.warehouse_code AS "targetWarehouseCode",
       COALESCE(
         NULLIF(trim(d.payload_json #>> '{erpTransfer,sourceWarehouseName}'), ''),
         sw.name
       ) AS "sourceWarehouseName",
       COALESCE(
         NULLIF(trim(d.payload_json #>> '{erpTransfer,targetWarehouseName}'), ''),
         tw.name
       ) AS "targetWarehouseName",
       sl.location_code AS "sourceLocationCode",
       tl.location_code AS "targetLocationCode",
       u.display_name AS "assignedUser",
       dv.device_name AS "assignedDevice",
       dv.device_uid AS "assignedDeviceUid"
     FROM wms_tasks t
     JOIN ref_wms_task_type tt ON tt.task_type_id = t.task_type_id
     JOIN ref_wms_task_status ts ON ts.task_status_id = t.task_status_id
     JOIN ref_wms_task_priority tp ON tp.task_priority_id = t.task_priority_id
     LEFT JOIN wms_items i ON i.item_id = t.item_id
     LEFT JOIN wms_lots wl ON wl.lot_id = t.lot_id
     LEFT JOIN wms_documents d ON d.document_id = t.document_id
     LEFT JOIN ref_wms_document_type dt ON dt.document_type_id = d.document_type_id
     LEFT JOIN ref_wms_document_status ds ON ds.document_status_id = d.document_status_id
     LEFT JOIN wms_warehouses sw ON sw.warehouse_id = t.source_warehouse_id
     LEFT JOIN wms_warehouses tw ON tw.warehouse_id = t.target_warehouse_id
     LEFT JOIN wms_locations sl ON sl.location_id = t.source_location_id
     LEFT JOIN wms_locations tl ON tl.location_id = t.target_location_id
     LEFT JOIN wms_users u ON u.user_id = t.assigned_user_id
     LEFT JOIN wms_devices dv ON dv.device_id = t.assigned_device_id
     WHERE t.site_id = $1 AND t.task_id = $2::bigint`,
    [siteId, taskId]
  );
  if (task.rows.length === 0) return null;

  const row = task.rows[0] as Record<string, unknown>
  let fgPickPlan = null
  try {
    if (isFgShipTaskType(String(row.taskType || "")) && row.itemCode) {
      fgPickPlan = await buildFgPickPlanForTask(client, siteId, {
        itemCode: String(row.itemCode),
        plannedQty: Number(row.plannedQty) || 0,
        payload: row.taskPayload,
        manufacturedAt: row.manufacturedAt instanceof Date
          ? row.manufacturedAt.toISOString()
          : row.manufacturedAt != null
            ? String(row.manufacturedAt)
            : null,
        taskType: String(row.taskType || ""),
      })
    }
  } catch (error) {
    console.error("fg pick plan failed", error)
  }

  const movements = await client.query(
    `SELECT
       movement_id::text AS "movementId",
       movement_at AS "at",
       qty::float8 AS "qty",
       mt.code AS "movementType",
       fl.location_code AS "fromLocationCode",
       tl.location_code AS "toLocationCode"
     FROM wms_stock_movements m
     JOIN ref_wms_movement_type mt ON mt.movement_type_id = m.movement_type_id
     LEFT JOIN wms_locations fl ON fl.location_id = m.from_location_id
     LEFT JOIN wms_locations tl ON tl.location_id = m.to_location_id
     WHERE m.document_id = (SELECT document_id FROM wms_tasks WHERE task_id = $1::bigint)
     ORDER BY m.movement_at DESC
     LIMIT 20`,
    [taskId]
  );

  return {
    task: { ...row, fgPickPlan },
    movements: movements.rows,
    fgPickPlan,
  };
}

export async function claimTask(
  client: PoolClient,
  siteId: number,
  taskId: string,
  assignedUserId?: string
) {
  const r = await client.query(
    `UPDATE wms_tasks
     SET task_status_id = $1,
         assigned_user_id = COALESCE($2::bigint, assigned_user_id),
         claimed_at = now(),
         updated_at = now()
     WHERE site_id = $3
       AND task_id = $4::bigint
       AND task_status_id = $5
     RETURNING task_id::text AS "taskId"`,
    [
      WMS_TASK_STATUS.claimed,
      assignedUserId ? Number(assignedUserId) : null,
      siteId,
      taskId,
      WMS_TASK_STATUS.open,
    ]
  );
  if (r.rows.length > 0) return { taskId };
  const exists = await resolveTaskById(client, siteId, taskId);
  if (!exists) throw new WmsHttpError(404, "task not found", "task_not_found");
  throw new WmsHttpError(409, "Задание недоступно для взятия (уже в работе или закрыто)", "bad_task_status");
}

export async function assignTaskToDevice(
  client: PoolClient,
  siteId: number,
  taskId: string,
  deviceUid: string,
  assignedUserId?: string
) {
  const device = await requireDeviceByUid(client, siteId, deviceUid);
  if (device.deviceStatus !== "active") {
    throw new WmsHttpError(409, "device is not active", "device_inactive");
  }
  const owner = await client.query<{ assigned_user_id: string | null }>(
    `SELECT assigned_user_id::text AS assigned_user_id
     FROM wms_devices
     WHERE site_id = $1 AND device_id = $2::bigint`,
    [siteId, device.deviceId]
  );
  const deviceUserId = owner.rows[0]?.assigned_user_id
    ? Number(owner.rows[0].assigned_user_id)
    : null;
  const explicitUserId = assignedUserId ? Number(assignedUserId) : null;
  const r = await client.query(
    `UPDATE wms_tasks
     SET assigned_device_id = $1::bigint,
         assigned_user_id = COALESCE($2::bigint, $6::bigint, assigned_user_id),
         task_status_id = CASE
           WHEN task_status_id = $7 THEN $8
           ELSE task_status_id
         END,
         claimed_at = COALESCE(claimed_at, now()),
         exception_code = CASE
           WHEN task_status_id = $7 AND exception_code = 'on_hold' THEN NULL
           ELSE exception_code
         END,
         updated_at = now()
     WHERE site_id = $3
       AND task_id = $4::bigint
       AND task_status_id = ANY($5::smallint[])
     RETURNING task_id::text AS "taskId"`,
    [
      device.deviceId,
      explicitUserId,
      siteId,
      taskId,
      ASSIGN_DEVICE_ALLOWED_STATUS_IDS,
      deviceUserId,
      WMS_TASK_STATUS.on_hold,
      WMS_TASK_STATUS.claimed,
    ]
  );
  if (r.rows.length > 0) {
    await notifyWmsTaskEvent(client, { siteId, taskId, deviceUid: device.deviceUid, eventType: "task_assigned" });
    return {
      taskId,
      deviceId: device.deviceId,
      deviceUid: device.deviceUid,
      deviceName: device.deviceName,
    };
  }
  const exists = await resolveTaskById(client, siteId, taskId);
  if (!exists) throw new WmsHttpError(404, "task not found", "task_not_found");
  throw new WmsHttpError(
    409,
    "Нельзя назначить терминал: задание выполнено, отменено или снято с работы",
    "bad_task_status"
  );
}

export async function listTasksForDevice(
  client: PoolClient,
  siteId: number,
  deviceUid: string,
  options: {
    cursor?: string | null;
    limit?: number;
    status?: string;
    type?: string;
    query?: string;
  }
) {
  const device = await requireDeviceByUid(client, siteId, deviceUid);
  if (device.deviceStatus !== "active") {
    throw new WmsHttpError(409, "device is not active", "device_inactive");
  }
  const requestedStatus = (options.status ?? "").trim().toLowerCase();
  const deviceInbox = requestedStatus === "" || requestedStatus === "open";
  const inboxStatuses = ["open", "claimed", "in_progress", "on_hold", "exception"];
  const queue = await listTasks(client, siteId, {
    ...options,
    status: deviceInbox ? "" : options.status,
    statusIn: deviceInbox ? inboxStatuses : undefined,
    assignedDeviceId: device.deviceId,
  });
  const owner = await client.query<{ assigned_user_id: string | null }>(
    `SELECT assigned_user_id::text AS assigned_user_id
     FROM wms_devices
     WHERE site_id = $1 AND device_id = $2::bigint`,
    [siteId, device.deviceId]
  )
  const assignedUserId = owner.rows[0]?.assigned_user_id || ""
  let tasks = queue.tasks
  if (assignedUserId) {
    const extra = await listTasks(client, siteId, {
      ...options,
      status: deviceInbox ? "" : options.status,
      statusIn: deviceInbox ? inboxStatuses : undefined,
      assignedUserId,
    })
    const seen = new Set(tasks.map((t) => t.taskId))
    for (const row of extra.tasks) {
      const extraUid = String((row as { assignedDeviceUid?: string }).assignedDeviceUid || "").trim()
      if (extraUid && extraUid !== device.deviceUid) continue
      if (!extraUid && row.assignedDevice && row.assignedDevice !== device.deviceName) continue
      if (!seen.has(row.taskId)) {
        seen.add(row.taskId)
        tasks.push(row)
      }
    }
  }
  return {
    device,
    tasks,
    nextCursor: deviceInbox ? "" : queue.nextCursor,
  };
}

async function ensureTaskAssignedToDevice(
  client: PoolClient,
  siteId: number,
  taskId: string,
  deviceUid: string
) {
  const task = await resolveTaskById(client, siteId, taskId);
  if (!task) throw new WmsHttpError(404, "task not found", "task_not_found");
  const device = await requireDeviceByUid(client, siteId, deviceUid);
  if (device.deviceStatus !== "active") {
    throw new WmsHttpError(409, "device is not active", "device_inactive");
  }
  if (task.assigned_device_id !== device.deviceId) {
    throw new WmsHttpError(409, "task is assigned to another device", "wrong_device");
  }
  return { task, device };
}

export async function startTask(client: PoolClient, siteId: number, taskId: string) {
  const current = await resolveTaskById(client, siteId, taskId);
  if (!current) throw new WmsHttpError(404, "task not found", "task_not_found");
  if (current.task_status_id === WMS_TASK_STATUS.in_progress) {
    return { taskId };
  }
  const r = await client.query(
    `UPDATE wms_tasks
     SET task_status_id = $1,
         started_at = COALESCE(started_at, now()),
         updated_at = now()
     WHERE site_id = $2
       AND task_id = $3::bigint
       AND task_status_id = ANY($4::smallint[])
     RETURNING task_id::text AS "taskId"`,
    [
      WMS_TASK_STATUS.in_progress,
      siteId,
      taskId,
      [WMS_TASK_STATUS.open, WMS_TASK_STATUS.claimed, WMS_TASK_STATUS.on_hold],
    ]
  );
  if (r.rows.length > 0) return { taskId };
  throw new WmsHttpError(
    409,
    "Перевести «в работу» можно задание из очереди, назначенное или на паузе",
    "bad_task_status"
  );
}

export type TaskShipScan = {
  code: string
  qty: number
  itemCode?: string | null
  itemName?: string | null
  expiresAt?: string | null
  manufacturedAt?: string | null
  at: string
}

function readShipScans(payload: Record<string, unknown> | null | undefined): TaskShipScan[] {
  const raw = payload?.shipScans
  if (!Array.isArray(raw)) return []
  return raw
    .map((row) => {
      if (!row || typeof row !== "object") return null
      const rec = row as Record<string, unknown>
      const code = String(rec.code || "").trim()
      const qty = Number(rec.qty)
      if (!code || !Number.isFinite(qty) || qty <= 0) return null
      return {
        code,
        qty,
        itemCode: typeof rec.itemCode === "string" ? rec.itemCode : null,
        itemName: typeof rec.itemName === "string" ? rec.itemName : null,
        expiresAt: typeof rec.expiresAt === "string" ? rec.expiresAt : null,
        manufacturedAt: typeof rec.manufacturedAt === "string" ? rec.manufacturedAt : null,
        at: typeof rec.at === "string" ? rec.at : new Date().toISOString(),
      } satisfies TaskShipScan
    })
    .filter((row): row is TaskShipScan => Boolean(row))
}

export async function recordTaskShipScanByDevice(
  client: PoolClient,
  siteId: number,
  taskId: string,
  deviceUid: string,
  input: {
    code: string
    qty?: number
    itemCode?: string | null
    itemName?: string | null
    expiresAt?: string | null
    manufacturedAt?: string | null
  }
) {
  const { task, device } = await ensureTaskAssignedToDevice(client, siteId, taskId, deviceUid)
  if (
    ![
      WMS_TASK_STATUS.open,
      WMS_TASK_STATUS.claimed,
      WMS_TASK_STATUS.in_progress,
      WMS_TASK_STATUS.exception,
      WMS_TASK_STATUS.on_hold,
    ].includes(task.task_status_id)
  ) {
    throw new WmsHttpError(409, "Задание уже закрыто", "bad_task_status")
  }
  if (task.task_status_id !== WMS_TASK_STATUS.in_progress) {
    await startTask(client, siteId, taskId)
  }
  const code = String(input.code || "").trim()
  if (!code) throw new WmsHttpError(400, "Пустой код", "empty_scan")
  const qty = Number(input.qty)
  let scanQty = Number.isFinite(qty) && qty > 0 ? qty : 1
  const payload = ((task.task_payload as Record<string, unknown> | null) ?? {}) as Record<string, unknown>
  const scans = readShipScans(payload)
  if (scans.some((row) => row.code === code)) {
    throw new WmsHttpError(409, "Этот код уже отсканирован", "duplicate_scan")
  }
  if (task.item_id) {
    const itemRow = await client.query<{ item_code: string; manufactured_at: string | null }>(
      `SELECT i.item_code, wl.manufactured_at
       FROM wms_items i
       LEFT JOIN wms_lots wl ON wl.lot_id = $2::bigint
       WHERE i.item_id = $1::bigint`,
      [task.item_id, task.lot_id]
    )
    const typeRow = await client.query<{ code: string }>(
      `SELECT code FROM ref_wms_task_type WHERE task_type_id = $1`,
      [task.task_type_id]
    )
    const plan = await buildFgPickPlanForTask(client, siteId, {
      itemCode: itemRow.rows[0]?.item_code,
      plannedQty: Number(task.planned_qty) || 0,
      payload,
      manufacturedAt: itemRow.rows[0]?.manufactured_at ?? null,
      taskType: typeRow.rows[0]?.code,
    })
    if (plan && !plan.enough) {
      throw new WmsHttpError(409, plan.reason || "Нет остатка на складе ГП", "no_stock")
    }
    if (plan) {
      const belong = await scanBelongsToFgPickPlan(client, siteId, code, plan)
      if (!belong.ok) {
        throw new WmsHttpError(409, belong.message, "wrong_pallet")
      }
      if (!(Number.isFinite(qty) && qty > 0)) {
        const compact = code.replace(/\s+/g, "")
        const hit = plan.pallets.find((p) => {
          const ids = [p.lpn, p.palletCode, p.palletId, ...p.codes.map((c) => c.code)]
          return ids.some((v) => String(v || "").replace(/\s+/g, "") === compact)
        })
        if (hit && hit.bottles > 1) {
          scanQty = hit.bottles
        }
      }
    }
  }
  const plannedQty = Number(task.planned_qty) || 0
  const scannedBefore = scans.reduce((sum, row) => sum + row.qty, 0)
  const remainingBefore = Math.max(0, plannedQty - scannedBefore)
  if (plannedQty > 0 && remainingBefore <= 0) {
    throw new WmsHttpError(409, "Все коды по заданию уже отсканированы", "scan_complete")
  }
  if (plannedQty > 0 && scanQty > remainingBefore) {
    throw new WmsHttpError(
      409,
      `Этот код на ${scanQty} шт, осталось отсканировать ${remainingBefore}`,
      "scan_over_qty"
    )
  }
  scans.push({
    code,
    qty: scanQty,
    itemCode: input.itemCode ?? null,
    itemName: input.itemName ?? null,
    expiresAt: input.expiresAt ?? null,
    manufacturedAt: input.manufacturedAt ?? null,
    at: new Date().toISOString(),
  })
  const nextPayload = { ...payload, shipScans: scans }
  await client.query(
    `UPDATE wms_tasks
     SET task_payload = $2::jsonb,
         confirmed_qty = $3,
         updated_at = now()
     WHERE site_id = $4 AND task_id = $1::bigint`,
    [taskId, JSON.stringify(nextPayload), scans.reduce((sum, row) => sum + row.qty, 0), siteId]
  )
  const scannedQty = scans.reduce((sum, row) => sum + row.qty, 0)
  return {
    taskId,
    deviceUid: device.deviceUid,
    plannedQty: Number(task.planned_qty) || 0,
    scannedQty,
    remainingQty: Math.max(0, (Number(task.planned_qty) || 0) - scannedQty),
    scans,
  }
}

const CANCELLABLE_STATUS_IDS: number[] = [
  WMS_TASK_STATUS.open,
  WMS_TASK_STATUS.claimed,
  WMS_TASK_STATUS.in_progress,
  WMS_TASK_STATUS.exception,
  WMS_TASK_STATUS.on_hold,
];

const RELEASABLE_TO_QUEUE_STATUS_IDS: number[] = [
  WMS_TASK_STATUS.claimed,
  WMS_TASK_STATUS.in_progress,
  WMS_TASK_STATUS.exception,
  WMS_TASK_STATUS.on_hold,
];

const SUSPENDABLE_STATUS_IDS: number[] = [WMS_TASK_STATUS.claimed, WMS_TASK_STATUS.in_progress];

/** Назначение / переназначение терминала — только пока задание не завершено и не отменено */
const ASSIGN_DEVICE_ALLOWED_STATUS_IDS: number[] = [
  WMS_TASK_STATUS.open,
  WMS_TASK_STATUS.claimed,
  WMS_TASK_STATUS.in_progress,
  WMS_TASK_STATUS.exception,
  WMS_TASK_STATUS.on_hold,
];

/** Регистрация исключения по заданию — не для финальных статусов */
const REPORT_EXCEPTION_ALLOWED_STATUS_IDS: number[] = [
  WMS_TASK_STATUS.open,
  WMS_TASK_STATUS.claimed,
  WMS_TASK_STATUS.in_progress,
  WMS_TASK_STATUS.exception,
  WMS_TASK_STATUS.on_hold,
];

export async function cancelTask(client: PoolClient, siteId: number, taskId: string, note?: string) {
  const before = await resolveTaskById(client, siteId, taskId);
  if (!before) {
    throw new WmsHttpError(404, "task not found", "task_not_found");
  }
  if (before.task_status_id === WMS_TASK_STATUS.cancelled) {
    return { taskId, alreadyCancelled: true as const };
  }
  if (!CANCELLABLE_STATUS_IDS.includes(before.task_status_id)) {
    throw new WmsHttpError(409, "task cannot be cancelled from current status", "bad_task_status");
  }
  const r = await client.query(
    `UPDATE wms_tasks
     SET task_status_id = $1,
         exception_code = 'operator_cancel',
         exception_note = $2,
         updated_at = now()
     WHERE site_id = $3
       AND task_id = $4::bigint
       AND task_status_id = ANY($5::smallint[])
     RETURNING task_id::text AS "taskId"`,
    [
      WMS_TASK_STATUS.cancelled,
      note && note.trim() ? note.trim() : "Отменено оператором (web)",
      siteId,
      taskId,
      CANCELLABLE_STATUS_IDS,
    ]
  );
  if (r.rows.length === 0) {
    const again = await resolveTaskById(client, siteId, taskId);
    if (again && again.task_status_id === WMS_TASK_STATUS.cancelled) {
      return { taskId, alreadyCancelled: true as const };
    }
    throw new WmsHttpError(409, "task cannot be cancelled from current status", "bad_task_status");
  }
  return { taskId, alreadyCancelled: false as const };
}

/** Вернуть задание в общую очередь: статус open, снять исполнителя и терминал. */
export async function releaseTaskToQueue(
  client: PoolClient,
  siteId: number,
  taskId: string,
  note?: string
) {
  const before = await resolveTaskById(client, siteId, taskId);
  if (!before) throw new WmsHttpError(404, "task not found", "task_not_found");
  if (!RELEASABLE_TO_QUEUE_STATUS_IDS.includes(before.task_status_id)) {
    throw new WmsHttpError(
      409,
      "Задание можно вернуть в очередь только из статусов: взято, в работе, исключение, приостановлено",
      "bad_task_status"
    );
  }
  const r = await client.query(
    `UPDATE wms_tasks
     SET task_status_id = $1,
         assigned_device_id = NULL,
         assigned_user_id = NULL,
         claimed_at = NULL,
         started_at = NULL,
         exception_code = NULL,
         exception_note = $2,
         updated_at = now()
     WHERE site_id = $3
       AND task_id = $4::bigint
       AND task_status_id = ANY($5::smallint[])
     RETURNING task_id::text AS "taskId"`,
    [
      WMS_TASK_STATUS.open,
      note?.trim() ? note.trim() : null,
      siteId,
      taskId,
      RELEASABLE_TO_QUEUE_STATUS_IDS,
    ]
  );
  if (r.rows.length === 0) {
    throw new WmsHttpError(409, "не удалось вернуть задание в очередь", "bad_task_status");
  }
  await notifyWmsTaskEvent(client, { siteId, taskId, eventType: "task_updated" });
  return { taskId };
}

/** Приостановить (claimed / in_progress → on_hold), назначения сохраняются. */
export async function suspendTask(client: PoolClient, siteId: number, taskId: string, note?: string) {
  const before = await resolveTaskById(client, siteId, taskId);
  if (!before) throw new WmsHttpError(404, "task not found", "task_not_found");
  if (!SUSPENDABLE_STATUS_IDS.includes(before.task_status_id)) {
    throw new WmsHttpError(
      409,
      "Приостановить можно только задание «взято» или «в работе»",
      "bad_task_status"
    );
  }
  const r = await client.query(
    `UPDATE wms_tasks
     SET task_status_id = $1,
         exception_code = 'on_hold',
         exception_note = $2,
         updated_at = now()
     WHERE site_id = $3
       AND task_id = $4::bigint
       AND task_status_id = ANY($5::smallint[])
     RETURNING task_id::text AS "taskId"`,
    [
      WMS_TASK_STATUS.on_hold,
      note?.trim() ? note.trim() : "Приостановлено",
      siteId,
      taskId,
      SUSPENDABLE_STATUS_IDS,
    ]
  );
  if (r.rows.length === 0) {
    throw new WmsHttpError(409, "не удалось приостановить задание", "bad_task_status");
  }
  await notifyWmsTaskEvent(client, { siteId, taskId, eventType: "task_updated" });
  return { taskId };
}

/** Снять приостановку (on_hold → claimed). */
export async function resumeTaskFromHold(client: PoolClient, siteId: number, taskId: string) {
  const before = await resolveTaskById(client, siteId, taskId);
  if (!before) throw new WmsHttpError(404, "task not found", "task_not_found");
  if (before.task_status_id !== WMS_TASK_STATUS.on_hold) {
    throw new WmsHttpError(409, "Задание не приостановлено", "bad_task_status");
  }
  const r = await client.query(
    `UPDATE wms_tasks
     SET task_status_id = $1,
         exception_code = NULL,
         exception_note = NULL,
         updated_at = now()
     WHERE site_id = $2 AND task_id = $3::bigint AND task_status_id = $4
     RETURNING task_id::text AS "taskId"`,
    [WMS_TASK_STATUS.claimed, siteId, taskId, WMS_TASK_STATUS.on_hold]
  );
  if (r.rows.length === 0) {
    throw new WmsHttpError(409, "не удалось возобновить задание", "bad_task_status");
  }
  await notifyWmsTaskEvent(client, { siteId, taskId, eventType: "task_updated" });
  return { taskId };
}

export async function claimTaskByDevice(
  client: PoolClient,
  siteId: number,
  taskId: string,
  deviceUid: string
) {
  const device = await requireDeviceByUid(client, siteId, deviceUid);
  if (device.deviceStatus !== "active") {
    throw new WmsHttpError(409, "device is not active", "device_inactive");
  }
  const r = await client.query(
    `UPDATE wms_tasks
     SET task_status_id = $1,
         assigned_device_id = $2::bigint,
         claimed_at = now(),
         updated_at = now()
     WHERE site_id = $3
       AND task_id = $4::bigint
       AND task_status_id = $5
       AND (
         assigned_device_id IS NULL
         OR assigned_device_id = $2::bigint
       )
     RETURNING task_id::text AS "taskId"`,
    [WMS_TASK_STATUS.claimed, device.deviceId, siteId, taskId, WMS_TASK_STATUS.open]
  );
  if (r.rows.length === 0) {
    const row = await resolveTaskById(client, siteId, taskId);
    if (!row) throw new WmsHttpError(404, "task not found", "task_not_found");
    if (row.task_status_id !== WMS_TASK_STATUS.open) {
      throw new WmsHttpError(
        409,
        "С ТСД можно взять только задание в статусе «в очереди»",
        "bad_task_status"
      );
    }
    throw new WmsHttpError(409, "task cannot be claimed by this device", "task_claim_conflict");
  }
  await notifyWmsTaskEvent(client, { siteId, taskId, deviceUid: device.deviceUid, eventType: "task_claimed" });
  return {
    taskId,
    deviceId: device.deviceId,
    deviceUid: device.deviceUid,
    deviceName: device.deviceName,
  };
}

export async function startTaskByDevice(
  client: PoolClient,
  siteId: number,
  taskId: string,
  deviceUid: string
) {
  const { device } = await ensureTaskAssignedToDevice(client, siteId, taskId, deviceUid);
  const result = await startTask(client, siteId, taskId);
  await notifyWmsTaskEvent(client, { siteId, taskId, deviceUid: device.deviceUid, eventType: "task_started" });
  return {
    ...result,
    deviceId: device.deviceId,
    deviceUid: device.deviceUid,
    deviceName: device.deviceName,
  };
}

export async function reportTaskException(
  client: PoolClient,
  siteId: number,
  taskId: string,
  exceptionCode: string,
  exceptionNote?: string
) {
  const r = await client.query(
    `UPDATE wms_tasks
     SET task_status_id = $1,
         exception_code = $2,
         exception_note = $3,
         updated_at = now()
     WHERE site_id = $4
       AND task_id = $5::bigint
       AND task_status_id = ANY($6::smallint[])
     RETURNING task_id::text AS "taskId"`,
    [
      WMS_TASK_STATUS.exception,
      exceptionCode,
      exceptionNote ?? null,
      siteId,
      taskId,
      REPORT_EXCEPTION_ALLOWED_STATUS_IDS,
    ]
  );
  if (r.rows.length > 0) return { taskId };
  const exists = await resolveTaskById(client, siteId, taskId);
  if (!exists) throw new WmsHttpError(404, "task not found", "task_not_found");
  throw new WmsHttpError(
    409,
    "Исключение можно зафиксировать только для активного задания (не завершённого и не отменённого)",
    "bad_task_status"
  );
}

export async function reportTaskExceptionByDevice(
  client: PoolClient,
  siteId: number,
  taskId: string,
  deviceUid: string,
  exceptionCode: string,
  exceptionNote?: string
) {
  const { device } = await ensureTaskAssignedToDevice(client, siteId, taskId, deviceUid);
  const result = await reportTaskException(client, siteId, taskId, exceptionCode, exceptionNote);
  await notifyWmsTaskEvent(client, { siteId, taskId, deviceUid: device.deviceUid, eventType: "task_exception" });
  return {
    ...result,
    deviceId: device.deviceId,
    deviceUid: device.deviceUid,
    deviceName: device.deviceName,
  };
}

async function updateDocumentLineAndHeader(
  client: PoolClient,
  documentId: string | null,
  documentLineId: string | null,
  confirmedQty: number
) {
  if (documentLineId) {
    await client.query(
      `UPDATE wms_document_lines
       SET confirmed_qty = $1
       WHERE document_line_id = $2::bigint`,
      [confirmedQty, documentLineId]
    );
  }
  if (documentId) {
    const pending = await client.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
       FROM wms_tasks
       WHERE document_id = $1::bigint
         AND task_status_id NOT IN ($2, $3)`,
      [documentId, WMS_TASK_STATUS.completed, WMS_TASK_STATUS.cancelled]
    );
    const left = Number(pending.rows[0]?.cnt ?? "0");
    await client.query(
      `UPDATE wms_documents
       SET document_status_id = $1,
           applied_at = CASE WHEN $1::smallint = $2::smallint THEN now() ELSE applied_at END
       WHERE document_id = $3::bigint`,
      [
        left === 0 ? WMS_DOCUMENT_STATUS.applied : WMS_DOCUMENT_STATUS.in_progress,
        WMS_DOCUMENT_STATUS.applied,
        documentId,
      ]
    );
  }
}

async function completeInterwarehouseFollowUpReceipt(
  client: PoolClient,
  siteId: number,
  task: Awaited<ReturnType<typeof resolveTaskById>>,
  qty: number
) {
  if (!task?.target_location_id || !task.item_id) return null;
  const inserted = await client.query<{ task_id: string }>(
    `INSERT INTO wms_tasks (
       site_id, task_type_id, task_status_id, task_priority_id, task_code,
       document_id, document_line_id, item_id, source_warehouse_id, target_warehouse_id,
       source_location_id, target_location_id, planned_qty, confirmed_qty,
       sequence_no, due_at, released_at, task_payload
     ) VALUES (
       $1, $2, $3, 2, $4,
       $5::bigint, $6::bigint, $7::bigint, $8::bigint, $9::bigint,
       $10::bigint, $11::bigint, $12, 0,
       900, now() + interval '8 hours', now(), $13::jsonb
     )
     ON CONFLICT (task_code) DO NOTHING
     RETURNING task_id::text`,
    [
      siteId,
      WMS_TASK_TYPE.receipt,
      WMS_TASK_STATUS.open,
      `FOLLOWUP-RECEIPT-${task.task_id}`,
      task.document_id,
      task.document_line_id,
      task.item_id,
      task.source_warehouse_id,
      task.target_warehouse_id,
      task.source_location_id,
      task.target_location_id,
      qty,
      JSON.stringify({
        documentType: "interwarehouse_transfer",
        consumeInTransit: true,
      }),
    ]
  );
  return inserted.rows[0]?.task_id ?? null;
}

export async function completeTask(
  client: PoolClient,
  siteId: number,
  taskId: string,
  input: {
    confirmedQty?: number;
    sourceLocationCode?: string;
    targetLocationCode?: string;
    note?: string;
  }
) {
  const task = await resolveTaskById(client, siteId, taskId);
  if (!task) throw new WmsHttpError(404, "task not found", "task_not_found");
  if (!task.item_id) throw new WmsHttpError(400, "task has no item", "task_no_item");

  const qty =
    Number.isFinite(input.confirmedQty) && Number(input.confirmedQty) >= 0
      ? Number(input.confirmedQty)
      : Number(task.planned_qty);

  const payload = (task.task_payload as Record<string, unknown> | null) ?? {};

  if (
    !(
      [
        WMS_TASK_STATUS.open,
        WMS_TASK_STATUS.claimed,
        WMS_TASK_STATUS.in_progress,
        WMS_TASK_STATUS.exception,
      ] as number[]
    ).includes(task.task_status_id)
  ) {
    throw new WmsHttpError(409, "task cannot be completed from current status", "bad_task_status");
  }

  let sourceOverride = input.sourceLocationCode?.trim() || "";
  let targetOverride = input.targetLocationCode?.trim() || "";
  if (task.item_id) {
    const itemRow = await client.query<{ item_code: string; manufactured_at: string | null }>(
      `SELECT i.item_code, wl.manufactured_at
       FROM wms_items i
       LEFT JOIN wms_lots wl ON wl.lot_id = $2::bigint
       WHERE i.item_id = $1::bigint`,
      [task.item_id, task.lot_id]
    )
    const typeRow = await client.query<{ code: string }>(
      `SELECT code FROM ref_wms_task_type WHERE task_type_id = $1`,
      [task.task_type_id]
    )
    const plan = await buildFgPickPlanForTask(client, siteId, {
      itemCode: itemRow.rows[0]?.item_code,
      plannedQty: Number(task.planned_qty) || 0,
      payload,
      manufacturedAt: itemRow.rows[0]?.manufactured_at ?? null,
      taskType: typeRow.rows[0]?.code,
    })
    if (plan && !plan.enough) {
      throw new WmsHttpError(409, plan.reason || "Нет остатка на складе ГП", "no_stock")
    }
    if (plan?.suggested?.locationCode && !sourceOverride) {
      sourceOverride = plan.suggested.locationCode
    }
    if (!targetOverride && !task.target_location_id) {
      const inbound = await defaultWarehouseLocationCode(client, siteId, task.target_warehouse_id)
      if (inbound) targetOverride = inbound
    }
  }
  let sourceLocationId = task.source_location_id;
  let targetLocationId = task.target_location_id;
  if (sourceOverride) {
    const loc = await resolveLocation(client, siteId, sourceOverride);
    if (!loc) {
      throw new WmsHttpError(400, `Ячейка «откуда» не найдена: ${sourceOverride}`, "location_not_found");
    }
    sourceLocationId = loc.location_id;
  }
  if (targetOverride) {
    const loc = await resolveLocation(client, siteId, targetOverride);
    if (!loc) {
      throw new WmsHttpError(400, `Ячейка «куда» не найдена: ${targetOverride}`, "location_not_found");
    }
    targetLocationId = loc.location_id;
  }
  if (sourceLocationId !== task.source_location_id || targetLocationId !== task.target_location_id) {
    await client.query(
      `UPDATE wms_tasks
       SET source_location_id = $1::bigint,
           target_location_id = $2::bigint,
           updated_at = now()
       WHERE task_id = $3::bigint`,
      [sourceLocationId, targetLocationId, taskId]
    );
  }

  const lockIds = [sourceLocationId, targetLocationId]
    .filter((v): v is string => Boolean(v))
    .sort((a, b) => a.localeCompare(b));
  for (const lid of lockIds) {
    await ensureBalance(client, siteId, lid, task.item_id);
    await client.query(
      `SELECT 1 FROM wms_stock_balances
       WHERE site_id = $1 AND location_id = $2::bigint AND item_id = $3::bigint
       FOR UPDATE`,
      [siteId, lid, task.item_id]
    );
  }

  const sourceBalanceId = sourceLocationId
    ? await getBalanceId(client, siteId, sourceLocationId, task.item_id)
    : null;
  const targetBalanceId = targetLocationId
    ? await getBalanceId(client, siteId, targetLocationId, task.item_id)
    : null;

  switch (task.task_type_id) {
    case WMS_TASK_TYPE.receipt: {
      if (!targetBalanceId || !targetLocationId) {
        throw new WmsHttpError(400, "receipt task needs target location", "task_target_missing");
      }
      const consumeInTransit = Boolean(payload.consumeInTransit);
      if (consumeInTransit) {
        await adjustBalanceQty(client, targetBalanceId, "in_transit_qty", -qty);
        await adjustLotQty(client, targetBalanceId, task.lot_id, "in_transit_qty", -qty);
      }
      await adjustBalanceQty(client, targetBalanceId, "available_qty", qty);
      await adjustLotQty(client, targetBalanceId, task.lot_id, "available_qty", qty);
      await insertMovement(client, siteId, {
        movementTypeId: Boolean(payload.consumeInTransit)
          ? WMS_MOVEMENT_TYPE.interwarehouse_receive
          : WMS_MOVEMENT_TYPE.receiving,
        documentId: task.document_id,
        documentLineId: task.document_line_id,
        itemId: task.item_id,
        toLocationId: targetLocationId,
        fromBucketId: Boolean(payload.consumeInTransit)
          ? WMS_STOCK_BUCKET.in_transit
          : null,
        toBucketId: WMS_STOCK_BUCKET.available,
        qty,
      });
      break;
    }
    case WMS_TASK_TYPE.putaway:
    case WMS_TASK_TYPE.replenishment:
    case WMS_TASK_TYPE.internal_transfer: {
      if (!sourceBalanceId || !targetBalanceId || !sourceLocationId || !targetLocationId) {
        throw new WmsHttpError(400, "transfer-like task needs both locations", "task_locations_missing");
      }
      await adjustBalanceQty(client, sourceBalanceId, "available_qty", -qty);
      await adjustBalanceQty(client, targetBalanceId, "available_qty", qty);
      await adjustLotQty(client, sourceBalanceId, task.lot_id, "available_qty", -qty);
      await adjustLotQty(client, targetBalanceId, task.lot_id, "available_qty", qty);
      await insertMovement(client, siteId, {
        movementTypeId:
          task.task_type_id === WMS_TASK_TYPE.putaway
            ? WMS_MOVEMENT_TYPE.putaway
            : task.task_type_id === WMS_TASK_TYPE.replenishment
              ? WMS_MOVEMENT_TYPE.replenishment
              : WMS_MOVEMENT_TYPE.transfer,
        documentId: task.document_id,
        documentLineId: task.document_line_id,
        itemId: task.item_id,
        fromLocationId: sourceLocationId,
        toLocationId: targetLocationId,
        fromBucketId: WMS_STOCK_BUCKET.available,
        toBucketId: WMS_STOCK_BUCKET.available,
        qty,
      });
      break;
    }
    case WMS_TASK_TYPE.interwarehouse_transfer: {
      if (!sourceBalanceId || !targetBalanceId || !sourceLocationId || !targetLocationId) {
        throw new WmsHttpError(400, "interwarehouse task needs both locations", "task_locations_missing");
      }
      await adjustBalanceQty(client, sourceBalanceId, "available_qty", -qty);
      await adjustBalanceQty(client, targetBalanceId, "in_transit_qty", qty);
      await adjustLotQty(client, sourceBalanceId, task.lot_id, "available_qty", -qty);
      await adjustLotQty(client, targetBalanceId, task.lot_id, "in_transit_qty", qty);
      await insertMovement(client, siteId, {
        movementTypeId: WMS_MOVEMENT_TYPE.interwarehouse_ship,
        documentId: task.document_id,
        documentLineId: task.document_line_id,
        itemId: task.item_id,
        fromLocationId: sourceLocationId,
        toLocationId: targetLocationId,
        fromBucketId: WMS_STOCK_BUCKET.available,
        toBucketId: WMS_STOCK_BUCKET.in_transit,
        qty,
      });
      await completeInterwarehouseFollowUpReceipt(client, siteId, task, qty);
      break;
    }
    case WMS_TASK_TYPE.issue_to_line: {
      if (!sourceBalanceId || !sourceLocationId) {
        throw new WmsHttpError(400, "issue task needs source location", "task_source_missing");
      }
      await adjustBalanceQty(client, sourceBalanceId, "available_qty", -qty);
      await adjustBalanceQty(client, sourceBalanceId, "in_production_qty", qty);
      await adjustLotQty(client, sourceBalanceId, task.lot_id, "available_qty", -qty);
      await adjustLotQty(client, sourceBalanceId, task.lot_id, "in_production_qty", qty);
      await insertMovement(client, siteId, {
        movementTypeId: WMS_MOVEMENT_TYPE.issue,
        documentId: task.document_id,
        documentLineId: task.document_line_id,
        itemId: task.item_id,
        fromLocationId: sourceLocationId,
        toLocationId: sourceLocationId,
        fromBucketId: WMS_STOCK_BUCKET.available,
        toBucketId: WMS_STOCK_BUCKET.in_production,
        qty,
      });
      break;
    }
    case WMS_TASK_TYPE.return_from_line: {
      if (!sourceBalanceId || !targetBalanceId || !sourceLocationId || !targetLocationId) {
        throw new WmsHttpError(400, "return task needs both locations", "task_locations_missing");
      }
      await adjustBalanceQty(client, sourceBalanceId, "in_production_qty", -qty);
      await adjustBalanceQty(client, targetBalanceId, "available_qty", qty);
      await adjustLotQty(client, sourceBalanceId, task.lot_id, "in_production_qty", -qty);
      await adjustLotQty(client, targetBalanceId, task.lot_id, "available_qty", qty);
      await insertMovement(client, siteId, {
        movementTypeId: WMS_MOVEMENT_TYPE.return,
        documentId: task.document_id,
        documentLineId: task.document_line_id,
        itemId: task.item_id,
        fromLocationId: sourceLocationId,
        toLocationId: targetLocationId,
        fromBucketId: WMS_STOCK_BUCKET.in_production,
        toBucketId: WMS_STOCK_BUCKET.available,
        qty,
      });
      break;
    }
    case WMS_TASK_TYPE.revision: {
      const revisionLocationId = targetLocationId ?? sourceLocationId;
      const revisionBalanceId = targetBalanceId ?? sourceBalanceId;
      if (!revisionLocationId || !revisionBalanceId) {
        throw new WmsHttpError(400, "revision task needs location", "task_location_missing");
      }
      const current = await client.query<{ available_qty: string }>(
        `SELECT available_qty::text
         FROM wms_stock_balances
         WHERE balance_id = $1::bigint`,
        [revisionBalanceId]
      );
      const accounted = Number(current.rows[0]?.available_qty ?? "0");
      const variance = qty - accounted;
      await client.query(
        `UPDATE wms_stock_balances
         SET available_qty = $1,
             updated_at = now()
         WHERE balance_id = $2::bigint`,
        [qty, revisionBalanceId]
      );
      if (task.document_id && task.document_line_id) {
        const revision = await client.query<{ revision_id: string }>(
          `SELECT revision_id::text AS revision_id
           FROM wms_revisions
           WHERE document_id = $1::bigint`,
          [task.document_id]
        );
        const revisionId = revision.rows[0]?.revision_id;
        if (revisionId) {
          await client.query(
            `INSERT INTO wms_revision_lines (revision_id, item_id, accounted_qty, actual_qty, variance_qty)
             VALUES ($1::bigint, $2::bigint, $3, $4, $5)
             ON CONFLICT (revision_id, item_id)
             DO UPDATE SET
               accounted_qty = EXCLUDED.accounted_qty,
               actual_qty = EXCLUDED.actual_qty,
               variance_qty = EXCLUDED.variance_qty`,
            [revisionId, task.item_id, accounted, qty, variance]
          );
        }
      }
      if (Math.abs(variance) > 1e-9) {
        await insertMovement(client, siteId, {
          movementTypeId: WMS_MOVEMENT_TYPE.revision_adjustment,
          documentId: task.document_id,
          documentLineId: task.document_line_id,
          itemId: task.item_id,
          fromLocationId: variance < 0 ? revisionLocationId : null,
          toLocationId: variance > 0 ? revisionLocationId : null,
          fromBucketId: variance < 0 ? WMS_STOCK_BUCKET.available : null,
          toBucketId: variance > 0 ? WMS_STOCK_BUCKET.available : null,
          qty: Math.abs(variance),
        });
      }
      break;
    }
    case WMS_TASK_TYPE.pick: {
      if (!sourceBalanceId || !sourceLocationId) {
        throw new WmsHttpError(400, "pick task needs source location", "task_source_missing");
      }
      await adjustBalanceQty(client, sourceBalanceId, "available_qty", -qty);
      await adjustBalanceQty(client, sourceBalanceId, "reserved_qty", qty);
      await adjustLotQty(client, sourceBalanceId, task.lot_id, "available_qty", -qty);
      await adjustLotQty(client, sourceBalanceId, task.lot_id, "reserved_qty", qty);
      await insertMovement(client, siteId, {
        movementTypeId: WMS_MOVEMENT_TYPE.picking,
        documentId: task.document_id,
        documentLineId: task.document_line_id,
        itemId: task.item_id,
        fromLocationId: sourceLocationId,
        toLocationId: sourceLocationId,
        fromBucketId: WMS_STOCK_BUCKET.available,
        toBucketId: WMS_STOCK_BUCKET.reserved,
        qty,
      });
      break;
    }
    case WMS_TASK_TYPE.ship: {
      if (!sourceBalanceId || !sourceLocationId) {
        throw new WmsHttpError(400, "ship task needs source location", "task_source_missing");
      }
      await adjustBalanceQty(client, sourceBalanceId, "reserved_qty", -qty);
      await adjustLotQty(client, sourceBalanceId, task.lot_id, "reserved_qty", -qty);
      await insertMovement(client, siteId, {
        movementTypeId: WMS_MOVEMENT_TYPE.shipping,
        documentId: task.document_id,
        documentLineId: task.document_line_id,
        itemId: task.item_id,
        fromLocationId: sourceLocationId,
        fromBucketId: WMS_STOCK_BUCKET.reserved,
        qty,
      });
      break;
    }
    default:
      throw new WmsHttpError(400, "unsupported task type", "unsupported_task_type");
  }

  await client.query(
    `UPDATE wms_tasks
     SET task_status_id = $1,
         confirmed_qty = $2,
         completed_at = now(),
         exception_code = NULL,
         exception_note = $3,
         updated_at = now()
     WHERE site_id = $4 AND task_id = $5::bigint`,
    [WMS_TASK_STATUS.completed, qty, input.note ?? null, siteId, taskId]
  );

  await updateDocumentLineAndHeader(client, task.document_id, task.document_line_id, qty);

  const documentType = await getTaskPayloadDocumentType(client, taskId);
  const finalLocationId =
    documentType === "issue" ? sourceLocationId : targetLocationId ?? sourceLocationId;
  const stock =
    finalLocationId && task.item_id
      ? await fetchBalanceSnapshot(client, siteId, finalLocationId, task.item_id)
      : null;
  return {
    taskId,
    documentId: task.document_id,
    stock,
  };
}

const SHIP_SCAN_REQUIRED_TYPES = new Set<number>([
  WMS_TASK_TYPE.interwarehouse_transfer,
  WMS_TASK_TYPE.internal_transfer,
  WMS_TASK_TYPE.pick,
  WMS_TASK_TYPE.ship,
]);

export async function completeTaskByDevice(
  client: PoolClient,
  siteId: number,
  taskId: string,
  deviceUid: string,
  input: {
    confirmedQty?: number;
    sourceLocationCode?: string;
    targetLocationCode?: string;
    note?: string;
  }
) {
  const { task, device } = await ensureTaskAssignedToDevice(client, siteId, taskId, deviceUid);
  let nextInput = { ...input };
  if (SHIP_SCAN_REQUIRED_TYPES.has(task.task_type_id)) {
    const scans = readShipScans((task.task_payload as Record<string, unknown> | null) ?? {});
    const scannedQty = scans.reduce((sum, row) => sum + row.qty, 0);
    const plannedQty = Number(task.planned_qty) || 0;
    if (plannedQty > 0 && scannedQty + 1e-9 < plannedQty) {
      throw new WmsHttpError(
        409,
        `Сначала отсканируйте коды: ${scannedQty} из ${plannedQty}`,
        "incomplete_scan"
      );
    }
    if (nextInput.confirmedQty == null) {
      nextInput.confirmedQty = scannedQty || plannedQty;
    }
  }
  const result = await completeTask(client, siteId, taskId, nextInput);
  await notifyWmsTaskEvent(client, { siteId, taskId, deviceUid: device.deviceUid, eventType: "task_completed" });
  return {
    ...result,
    deviceId: device.deviceId,
    deviceUid: device.deviceUid,
    deviceName: device.deviceName,
  };
}
