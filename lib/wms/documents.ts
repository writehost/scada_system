import type { PoolClient } from "pg";
import { resolveItemByCodeOrBarcode, resolveLocation, resolveWarehouse } from "@/lib/wms/resolve";
import {
  WMS_DOCUMENT_STATUS,
  WMS_DOCUMENT_TYPE,
  WMS_TASK_PRIORITY,
  WMS_TASK_STATUS,
  WMS_TASK_TYPE,
} from "@/lib/wms/ref";
import { WmsHttpError } from "@/lib/wms/errors";

function parseCursor(cursor?: string | null): number | null {
  if (!cursor) return null;
  const value = Number(cursor);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return 50;
  return Math.min(Math.max(Math.trunc(limit ?? 50), 1), 100);
}

type DocumentTypeCode = keyof typeof WMS_DOCUMENT_TYPE;
type PriorityCode = keyof typeof WMS_TASK_PRIORITY;

export type CreateDocumentLineInput = {
  itemCode: string;
  qty: number;
  requestedUomCode?: string;
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
  loadUnitMaxBaseQty?: number;
  comment?: string;
  taskPayload?: Record<string, unknown>;
};

export type CreateDocumentInput = {
  requestId: string;
  siteCode: string;
  documentType: DocumentTypeCode;
  sourceWarehouseCode?: string;
  targetWarehouseCode?: string;
  sourceLocationCode?: string;
  targetLocationCode?: string;
  priorityCode?: PriorityCode;
  documentNo?: string;
  externalRef?: string;
  comment?: string;
  assignUserId?: string;
  lines: CreateDocumentLineInput[];
};

function getTaskTypeForDocument(documentType: DocumentTypeCode): number {
  switch (documentType) {
    case "receiving":
      return WMS_TASK_TYPE.receipt;
    case "putaway":
      return WMS_TASK_TYPE.putaway;
    case "replenishment":
      return WMS_TASK_TYPE.replenishment;
    case "transfer":
      return WMS_TASK_TYPE.internal_transfer;
    case "interwarehouse_transfer":
      return WMS_TASK_TYPE.interwarehouse_transfer;
    case "issue":
      return WMS_TASK_TYPE.issue_to_line;
    case "return":
      return WMS_TASK_TYPE.return_from_line;
    case "revision":
      return WMS_TASK_TYPE.revision;
    case "picking":
      return WMS_TASK_TYPE.pick;
    case "shipping":
      return WMS_TASK_TYPE.ship;
    case "writeoff":
      return WMS_TASK_TYPE.revision;
    default:
      return WMS_TASK_TYPE.internal_transfer;
  }
}

/** Создаёт/обновляет строку в `wms_lots` (партия для FEFO и отчётов). */
export async function ensureWmsLot(
  client: PoolClient,
  siteId: number,
  itemId: string,
  lotCode: string,
  batchLabel?: string,
  manufacturedAt?: string,
  bestBeforeAt?: string,
  expiryAt?: string
) {
  const r = await client.query<{ lot_id: string }>(
    `INSERT INTO wms_lots (
       site_id, item_id, lot_code, batch_label, received_at, manufactured_at, best_before_at, expiry_at, updated_at
     ) VALUES ($1, $2::bigint, $3, $4, now(), $5, $6, $7, now())
     ON CONFLICT (site_id, item_id, lot_code)
     DO UPDATE SET
       batch_label = COALESCE(EXCLUDED.batch_label, wms_lots.batch_label),
       manufactured_at = COALESCE(EXCLUDED.manufactured_at, wms_lots.manufactured_at),
       best_before_at = COALESCE(EXCLUDED.best_before_at, wms_lots.best_before_at),
       expiry_at = COALESCE(EXCLUDED.expiry_at, wms_lots.expiry_at),
       updated_at = now()
     RETURNING lot_id::text`,
    [
      siteId,
      itemId,
      lotCode,
      batchLabel ?? null,
      manufacturedAt ? new Date(manufacturedAt) : null,
      bestBeforeAt ? new Date(bestBeforeAt) : null,
      expiryAt ? new Date(expiryAt) : null,
    ]
  );
  return r.rows[0]?.lot_id ?? null;
}

async function upsertLoadUnit(
  client: PoolClient,
  siteId: number,
  documentId: string,
  input: {
    loadUnitCode: string;
    loadUnitLabel?: string;
    loadUnitType?: string;
    sourceLocationId?: string | null;
    targetLocationId?: string | null;
    mixedItemsAllowed?: boolean;
    loadUnitMaxBaseQty?: number;
  }
) {
  const r = await client.query<{ load_unit_id: string; load_unit_code: string }>(
    `INSERT INTO wms_load_units (
       site_id, document_id, load_unit_code, load_unit_type, status_code, label,
       source_location_id, target_location_id, mixed_items_allowed, max_base_qty, updated_at
     ) VALUES (
       $1, $2::bigint, $3, $4, 'planned', $5,
       $6::bigint, $7::bigint, $8, $9, now()
     )
     ON CONFLICT (site_id, load_unit_code)
     DO UPDATE SET
       document_id = COALESCE(EXCLUDED.document_id, wms_load_units.document_id),
       label = COALESCE(EXCLUDED.label, wms_load_units.label),
       source_location_id = COALESCE(EXCLUDED.source_location_id, wms_load_units.source_location_id),
       target_location_id = COALESCE(EXCLUDED.target_location_id, wms_load_units.target_location_id),
       mixed_items_allowed = EXCLUDED.mixed_items_allowed,
       max_base_qty = COALESCE(EXCLUDED.max_base_qty, wms_load_units.max_base_qty),
       updated_at = now()
     RETURNING load_unit_id::text AS load_unit_id, load_unit_code`,
    [
      siteId,
      documentId,
      input.loadUnitCode,
      input.loadUnitType ?? "pallet",
      input.loadUnitLabel ?? null,
      input.sourceLocationId ?? null,
      input.targetLocationId ?? null,
      input.mixedItemsAllowed ?? true,
      input.loadUnitMaxBaseQty ?? null,
    ]
  );
  return r.rows[0] ?? null;
}

export async function listDocuments(
  client: PoolClient,
  siteId: number,
  options: {
    cursor?: string | null;
    limit?: number;
    documentType?: string;
    status?: string;
  }
) {
  const limit = parseLimit(options.limit);
  const cursor = parseCursor(options.cursor);
  const documentType = options.documentType?.trim() ?? "";
  const status = options.status?.trim() ?? "";

  const r = await client.query(
    `SELECT
       d.document_id::text AS cursor,
       d.document_id::text AS "documentId",
       dt.code AS "documentType",
       ds.code AS "documentStatus",
       d.document_no AS "documentNo",
       sw.warehouse_code AS "sourceWarehouseCode",
       tw.warehouse_code AS "targetWarehouseCode",
       COALESCE(
         NULLIF(trim(MAX(d.payload_json #>> '{erpTransfer,sourceWarehouseName}')), ''),
         MAX(sw.name)
       ) AS "sourceWarehouseName",
       COALESCE(
         NULLIF(trim(MAX(d.payload_json #>> '{erpTransfer,targetWarehouseName}')), ''),
         MAX(tw.name)
       ) AS "targetWarehouseName",
       sl.location_code AS "sourceLocationCode",
       tl.location_code AS "targetLocationCode",
       NULLIF(trim(d.line_name), '') AS "lineName",
       NULLIF(trim(d.operator_name), '') AS "operatorName",
       MAX(NULLIF(trim(d.payload_json->>'externalRef1c'), '')) AS "externalRef",
       d.comment AS "comment",
       tp.code AS "priorityCode",
       d.created_at AS "createdAt",
       d.released_at AS "releasedAt",
       COUNT(dl.document_line_id)::int AS "lineCount",
       COUNT(t.task_id)::int AS "taskCount"
     FROM wms_documents d
     JOIN ref_wms_document_type dt ON dt.document_type_id = d.document_type_id
     JOIN ref_wms_document_status ds ON ds.document_status_id = d.document_status_id
     LEFT JOIN ref_wms_task_priority tp ON tp.task_priority_id = d.task_priority_id
     LEFT JOIN wms_warehouses sw ON sw.warehouse_id = d.source_warehouse_id
     LEFT JOIN wms_warehouses tw ON tw.warehouse_id = d.target_warehouse_id
     LEFT JOIN wms_locations sl ON sl.location_id = d.source_location_id
     LEFT JOIN wms_locations tl ON tl.location_id = d.target_location_id
     LEFT JOIN wms_document_lines dl ON dl.document_id = d.document_id
     LEFT JOIN wms_tasks t ON t.document_id = d.document_id
     WHERE d.site_id = $1
       AND ($2::text = '' OR dt.code = $2)
       AND ($3::text = '' OR ds.code = $3)
       AND ($4::bigint IS NULL OR d.document_id < $4::bigint)
     GROUP BY d.document_id, dt.code, ds.code, sw.warehouse_code, tw.warehouse_code, sl.location_code, tl.location_code, tp.code, d.line_name, d.operator_name, d.comment
     ORDER BY d.document_id DESC
     LIMIT $5`,
    [siteId, documentType, status, cursor, limit + 1]
  );
  const rows = r.rows.slice(0, limit);
  const nextCursor =
    r.rows.length > limit ? (rows[rows.length - 1]?.cursor as string | undefined) : "";
  return { documents: rows, nextCursor };
}

export async function getDocumentDetail(
  client: PoolClient,
  siteId: number,
  documentId: string
) {
  const header = await client.query(
    `SELECT
       d.document_id::text AS "documentId",
       dt.code AS "documentType",
       ds.code AS "documentStatus",
       d.document_no AS "documentNo",
       NULLIF(trim(d.payload_json->>'externalRef1c'), '') AS "externalRef",
       d.comment AS "comment",
       tp.code AS "priorityCode",
       d.created_at AS "createdAt",
       d.applied_at AS "appliedAt",
       COALESCE(
         NULLIF(trim(d.payload_json->>'receiptAtIso'), '')::timestamptz,
         d.applied_at
       ) AS "receiptAt",
       d.released_at AS "releasedAt",
       d.payload_json AS "payloadJson",
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
       NULLIF(trim(d.line_name), '') AS "lineName",
       NULLIF(trim(d.operator_name), '') AS "operatorName"
     FROM wms_documents d
     JOIN ref_wms_document_type dt ON dt.document_type_id = d.document_type_id
     JOIN ref_wms_document_status ds ON ds.document_status_id = d.document_status_id
     LEFT JOIN ref_wms_task_priority tp ON tp.task_priority_id = d.task_priority_id
     LEFT JOIN wms_warehouses sw ON sw.warehouse_id = d.source_warehouse_id
     LEFT JOIN wms_warehouses tw ON tw.warehouse_id = d.target_warehouse_id
     LEFT JOIN wms_locations sl ON sl.location_id = d.source_location_id
     LEFT JOIN wms_locations tl ON tl.location_id = d.target_location_id
     WHERE d.site_id = $1 AND d.document_id = $2::bigint`,
    [siteId, documentId]
  );
  if (header.rows.length === 0) return null;

  const lines = await client.query(
    `SELECT
       dl.document_line_id::text AS "documentLineId",
       dl.line_no AS "lineNo",
       i.item_code AS "itemCode",
       i.name AS "itemName",
       dl.requested_qty::float8 AS "requestedQty",
       dl.confirmed_qty::float8 AS "confirmedQty",
       sl.location_code AS "sourceLocationCode",
       tl.location_code AS "targetLocationCode",
       dl.requested_uom_code AS "requestedUomCode",
       lu.load_unit_id::text AS "loadUnitId",
       lu.load_unit_code AS "loadUnitCode",
       lu.load_unit_type AS "loadUnitType",
       wl.lot_code AS "lotCode",
       wl.batch_label AS "batchLabel",
       wl.manufactured_at AS "manufacturedAt",
       dl.task_payload AS "taskPayload",
       dl.comment AS "comment"
     FROM wms_document_lines dl
     JOIN wms_items i ON i.item_id = dl.item_id
     LEFT JOIN wms_locations sl ON sl.location_id = dl.source_location_id
     LEFT JOIN wms_locations tl ON tl.location_id = dl.target_location_id
     LEFT JOIN wms_lots wl ON wl.lot_id = dl.lot_id
     LEFT JOIN wms_load_units lu ON lu.load_unit_id = dl.load_unit_id
     WHERE dl.document_id = $1::bigint
     ORDER BY dl.line_no`,
    [documentId]
  );

  const loadUnits = await client.query(
    `SELECT
       lu.load_unit_id::text AS "loadUnitId",
       lu.load_unit_code AS "loadUnitCode",
       lu.load_unit_type AS "loadUnitType",
       lu.status_code AS "statusCode",
       lu.label AS "label",
       lu.mixed_items_allowed AS "mixedItemsAllowed",
       COUNT(lul.load_unit_line_id)::int AS "lineCount",
       COALESCE(SUM(lul.qty_in_base), 0)::float8 AS "totalBaseQty"
     FROM wms_load_units lu
     LEFT JOIN wms_load_unit_lines lul ON lul.load_unit_id = lu.load_unit_id
     WHERE lu.document_id = $1::bigint
     GROUP BY lu.load_unit_id
     ORDER BY lu.sort_order, lu.load_unit_code`,
    [documentId]
  );

  const tasks = await client.query(
    `SELECT
       t.task_id::text AS "taskId",
       t.task_code AS "taskCode",
       tt.code AS "taskType",
       ts.code AS "taskStatus",
       tp.code AS "priorityCode",
       t.planned_qty::float8 AS "plannedQty",
       t.confirmed_qty::float8 AS "confirmedQty",
       su.display_name AS "assignedUser",
       sd.device_name AS "assignedDevice",
       t.due_at AS "dueAt",
       t.claimed_at AS "claimedAt",
       t.started_at AS "startedAt",
       t.completed_at AS "completedAt",
       t.exception_code AS "exceptionCode"
     FROM wms_tasks t
     JOIN ref_wms_task_type tt ON tt.task_type_id = t.task_type_id
     JOIN ref_wms_task_status ts ON ts.task_status_id = t.task_status_id
     JOIN ref_wms_task_priority tp ON tp.task_priority_id = t.task_priority_id
     LEFT JOIN wms_users su ON su.user_id = t.assigned_user_id
     LEFT JOIN wms_devices sd ON sd.device_id = t.assigned_device_id
     WHERE t.document_id = $1::bigint
     ORDER BY t.sequence_no, t.task_id`,
    [documentId]
  );

  return { document: header.rows[0], lines: lines.rows, loadUnits: loadUnits.rows, tasks: tasks.rows };
}

export async function createDocumentWithTasks(
  client: PoolClient,
  siteId: number,
  input: CreateDocumentInput
) {
  if (input.lines.length === 0) {
    throw new WmsHttpError(400, "lines must be non-empty", "bad_lines");
  }

  const documentTypeId = WMS_DOCUMENT_TYPE[input.documentType];
  const taskTypeId = getTaskTypeForDocument(input.documentType);
  const priorityId = WMS_TASK_PRIORITY[input.priorityCode ?? "normal"];

  const sourceWarehouse = input.sourceWarehouseCode
    ? await resolveWarehouse(client, siteId, input.sourceWarehouseCode)
    : null;
  const targetWarehouse = input.targetWarehouseCode
    ? await resolveWarehouse(client, siteId, input.targetWarehouseCode)
    : null;
  const sourceLocation = input.sourceLocationCode
    ? await resolveLocation(client, siteId, input.sourceLocationCode)
    : null;
  const targetLocation = input.targetLocationCode
    ? await resolveLocation(client, siteId, input.targetLocationCode)
    : null;

  const headerPayload =
    input.externalRef?.trim() != null && input.externalRef.trim() !== ""
      ? JSON.stringify({ externalRef1c: input.externalRef.trim() })
      : null;

  const header = await client.query<{ document_id: string }>(
    `INSERT INTO wms_documents (
       site_id, document_type_id, document_status_id, request_id, document_no,
       source_warehouse_id, target_warehouse_id, source_location_id, target_location_id,
       task_priority_id, comment, released_at, payload_json
     ) VALUES (
       $1, $2, $3, $4::uuid, $5,
       $6::bigint, $7::bigint, $8::bigint, $9::bigint,
       $10, $11, now(), $12::jsonb
     )
     RETURNING document_id::text`,
    [
      siteId,
      documentTypeId,
      WMS_DOCUMENT_STATUS.in_progress,
      input.requestId,
      input.documentNo ?? null,
      sourceWarehouse?.warehouse_id ?? null,
      targetWarehouse?.warehouse_id ?? null,
      sourceLocation?.location_id ?? null,
      targetLocation?.location_id ?? null,
      priorityId,
      input.comment ?? null,
      headerPayload,
    ]
  );
  const documentId = header.rows[0].document_id;

  const createdLines: Array<{ documentLineId: string; taskId: string }> = [];
  const loadUnitCache = new Map<string, string>();
  const createdLoadUnits: Array<{ loadUnitId: string; loadUnitCode: string }> = [];
  for (const [index, line] of input.lines.entries()) {
    const item = await resolveItemByCodeOrBarcode(client, siteId, line.itemCode);
    if (!item) {
      throw new WmsHttpError(404, `item not found: ${line.itemCode}`, "item_not_found");
    }
    const parsedQty = Number(line.qty);
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
      throw new WmsHttpError(400, "line qty must be positive", "bad_qty");
    }
    const srcLocation = line.sourceLocationCode
      ? await resolveLocation(client, siteId, line.sourceLocationCode)
      : sourceLocation;
    const tgtLocation = line.targetLocationCode
      ? await resolveLocation(client, siteId, line.targetLocationCode)
      : targetLocation;

    const lotId =
      line.lotCode && line.lotCode.trim()
        ? await ensureWmsLot(
            client,
            siteId,
            item.item_id,
            line.lotCode.trim(),
            line.batchLabel,
            line.manufacturedAt,
            line.bestBeforeAt,
            line.expiryAt
          )
        : null;

    const effectiveLoadUnitCode =
      line.loadUnitCode?.trim() || (input.documentType === "picking" ? `LU-${documentId}-${index + 1}` : "");
    let loadUnitId: string | null = null;
    if (effectiveLoadUnitCode) {
      loadUnitId = loadUnitCache.get(effectiveLoadUnitCode) ?? null;
      if (!loadUnitId) {
        const loadUnit = await upsertLoadUnit(client, siteId, documentId, {
          loadUnitCode: effectiveLoadUnitCode,
          loadUnitLabel: line.loadUnitLabel,
          loadUnitType: line.loadUnitType,
          sourceLocationId: srcLocation?.location_id ?? null,
          targetLocationId: tgtLocation?.location_id ?? null,
          mixedItemsAllowed: line.mixedItemsAllowed,
          loadUnitMaxBaseQty: line.loadUnitMaxBaseQty,
        });
        loadUnitId = loadUnit?.load_unit_id ?? null;
        if (loadUnitId && loadUnit) {
          loadUnitCache.set(effectiveLoadUnitCode, loadUnitId);
          createdLoadUnits.push({
            loadUnitId,
            loadUnitCode: loadUnit.load_unit_code,
          });
        }
      }
    }

    const createdLine = await client.query<{ document_line_id: string }>(
      `INSERT INTO wms_document_lines (
         document_id, line_no, item_id, source_location_id, target_location_id,
         requested_qty, confirmed_qty, lot_id, lot_code, comment, task_payload, requested_uom_code, load_unit_id
       ) VALUES (
         $1::bigint, $2, $3::bigint, $4::bigint, $5::bigint,
         $6, 0, $7::bigint, $8, $9, $10::jsonb, $11, $12::bigint
       )
       RETURNING document_line_id::text`,
      [
        documentId,
        index + 1,
        item.item_id,
        srcLocation?.location_id ?? null,
        tgtLocation?.location_id ?? null,
        parsedQty,
        lotId,
        line.lotCode ?? null,
        line.comment ?? null,
        JSON.stringify(line.taskPayload ?? {}),
        line.requestedUomCode ?? null,
        loadUnitId,
      ]
    );
    const documentLineId = createdLine.rows[0].document_line_id;

    const createdTask = await client.query<{ task_id: string }>(
      `INSERT INTO wms_tasks (
         site_id, task_type_id, task_status_id, task_priority_id, task_code,
         document_id, document_line_id, item_id, lot_id,
         source_warehouse_id, target_warehouse_id, source_location_id, target_location_id,
         planned_qty, confirmed_qty, assigned_user_id, sequence_no, due_at, released_at, task_payload,
         requested_uom_code, load_unit_id
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6::bigint, $7::bigint, $8::bigint, $9::bigint,
         $10::bigint, $11::bigint, $12::bigint, $13::bigint,
         $14, 0, $15::bigint, $16, now() + interval '2 hours', now(), $17::jsonb, $18, $19::bigint
       )
       RETURNING task_id::text`,
      [
        siteId,
        taskTypeId,
        WMS_TASK_STATUS.open,
        priorityId,
        `${input.documentType.toUpperCase()}-${documentId}-${index + 1}`,
        documentId,
        documentLineId,
        item.item_id,
        lotId,
        sourceWarehouse?.warehouse_id ?? null,
        targetWarehouse?.warehouse_id ?? null,
        srcLocation?.location_id ?? null,
        tgtLocation?.location_id ?? null,
        parsedQty,
        input.assignUserId ? Number(input.assignUserId) : null,
        (index + 1) * 10,
        JSON.stringify({
          ...(line.taskPayload ?? {}),
          documentType: input.documentType,
          sourceLocationCode: srcLocation?.location_code ?? null,
          targetLocationCode: tgtLocation?.location_code ?? null,
          lotCode: line.lotCode ?? null,
          batchLabel: line.batchLabel ?? null,
          manufacturedAt: line.manufacturedAt ?? null,
          bestBeforeAt: line.bestBeforeAt ?? null,
          expiryAt: line.expiryAt ?? null,
          requestedUomCode: line.requestedUomCode ?? null,
          loadUnitCode: effectiveLoadUnitCode || null,
          loadUnitLabel: line.loadUnitLabel ?? null,
        }),
        line.requestedUomCode ?? null,
        loadUnitId,
      ]
    );

    if (loadUnitId) {
      await client.query(
        `INSERT INTO wms_load_unit_lines (
           load_unit_id, document_line_id, task_id, item_id, lot_id, uom_code,
           qty_in_uom, qty_in_base, line_no, note, payload_json, updated_at
         ) VALUES (
           $1::bigint, $2::bigint, $3::bigint, $4::bigint, $5::bigint, $6,
           $7, $8, $9, $10, $11::jsonb, now()
         )`,
        [
          loadUnitId,
          documentLineId,
          createdTask.rows[0].task_id,
          item.item_id,
          lotId,
          line.requestedUomCode ?? "pcs",
          parsedQty,
          parsedQty,
          index + 1,
          line.comment ?? null,
          JSON.stringify({
            ...(line.taskPayload ?? {}),
            loadUnitCode: effectiveLoadUnitCode || null,
          }),
        ]
      );
    }

    createdLines.push({
      documentLineId,
      taskId: createdTask.rows[0].task_id,
    });
  }

  return {
    documentId,
    lineCount: createdLines.length,
    taskCount: createdLines.length,
    loadUnits: createdLoadUnits,
    createdLines,
  };
}
