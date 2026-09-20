import type { PoolClient } from "pg";
import {
  buildTorg1AutoFields,
  getTorg1DocumentForm,
  getTorg1SessionDraft,
  getTorg1Settings,
  mergeTorg1Fields,
  parseSupplierFromComment,
  type Torg1AutoContext,
  type Torg1Fields,
  type Torg1FormRecord,
} from "@/lib/wms/torg1";
import { listReceivingScanEventsForDocument } from "@/lib/wms/receiving-finalize";

function asText(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

export async function resolveWarehouseLabel(
  client: PoolClient,
  siteId: number,
  warehouseCode: string | null | undefined
): Promise<{ code: string; name: string }> {
  const code = asText(warehouseCode);
  if (!code) return { code: "", name: "" };
  const r = await client.query<{ name: string | null }>(
    `SELECT name FROM wms_warehouses WHERE site_id = $1 AND warehouse_code = $2 LIMIT 1`,
    [siteId, code]
  );
  return { code, name: asText(r.rows[0]?.name) || code };
}

export async function buildAutoContextForDocument(
  client: PoolClient,
  siteId: number,
  documentId: string
): Promise<Torg1AutoContext | null> {
  const r = await client.query<{
    documentNo: string | null;
    documentType: string;
    createdAt: string | null;
    receiptAt: string | null;
    appliedAt: string | null;
    comment: string | null;
    externalRef: string | null;
    sourceWarehouseCode: string | null;
    targetWarehouseCode: string | null;
    targetLocationCode: string | null;
    payload: unknown;
  }>(
    `SELECT
       d.document_no AS "documentNo",
       dt.code AS "documentType",
       d.created_at::text AS "createdAt",
       d.receipt_at::text AS "receiptAt",
       d.applied_at::text AS "appliedAt",
       d.comment,
       COALESCE(NULLIF(TRIM(d.external_ref), ''), NULLIF(TRIM(d.payload_json->>'externalRef1c'), '')) AS "externalRef",
       sw.warehouse_code AS "sourceWarehouseCode",
       tw.warehouse_code AS "targetWarehouseCode",
       tl.location_code AS "targetLocationCode",
       d.payload_json AS payload
     FROM wms_documents d
     JOIN ref_wms_document_type dt ON dt.document_type_id = d.document_type_id
     LEFT JOIN wms_warehouses sw ON sw.warehouse_id = d.source_warehouse_id
     LEFT JOIN wms_warehouses tw ON tw.warehouse_id = d.target_warehouse_id
     LEFT JOIN wms_locations tl ON tl.location_id = d.target_location_id
     WHERE d.site_id = $1 AND d.document_id = $2::bigint
     LIMIT 1`,
    [siteId, documentId]
  );
  const doc = r.rows[0];
  if (!doc) return null;

  const linesR = await client.query<{
    lineNo: number;
    itemCode: string;
    itemName: string;
    qtyReq: number | null;
    qtyConf: number | null;
    uom: string | null;
    lotCode: string | null;
    comment: string | null;
    taskPayload: unknown;
  }>(
    `SELECT
       dl.line_no AS "lineNo",
       i.item_code AS "itemCode",
       i.name AS "itemName",
       dl.requested_qty::float8 AS "qtyReq",
       dl.confirmed_qty::float8 AS "qtyConf",
       dl.requested_uom_code AS uom,
       wl.lot_code AS "lotCode",
       dl.comment,
       to_jsonb(dl)->'task_payload_json' AS "taskPayload"
     FROM wms_document_lines dl
     JOIN wms_items i ON i.item_id = dl.item_id
     LEFT JOIN wms_lots wl ON wl.lot_id = dl.lot_id
     WHERE dl.document_id = $1::bigint
     ORDER BY dl.line_no`,
    [documentId]
  );

  let supplierHint = parseSupplierFromComment(doc.comment);
  for (const line of linesR.rows) {
    const tp =
      line.taskPayload && typeof line.taskPayload === "object" && !Array.isArray(line.taskPayload)
        ? (line.taskPayload as Record<string, unknown>)
        : {};
    const fromLine = asText(tp.supplierName);
    if (fromLine) {
      supplierHint = fromLine;
      break;
    }
  }

  const whCode = doc.targetWarehouseCode || doc.sourceWarehouseCode;
  const wh = await resolveWarehouseLabel(client, siteId, whCode);

  return {
    documentNo: doc.documentNo || documentId,
    composedAt: doc.receiptAt || doc.appliedAt || doc.createdAt,
    warehouseCode: wh.code,
    warehouseName: wh.name,
    locationCode: doc.targetLocationCode,
    externalRef: doc.externalRef,
    comment: doc.comment,
    supplierHint,
    lines: linesR.rows.map((row) => ({
      lineNo: row.lineNo,
      itemCode: row.itemCode,
      itemName: row.itemName,
      uom: row.uom || "шт",
      qtyDoc: row.qtyReq,
      qtyFact: row.qtyConf ?? row.qtyReq,
      lotCode: row.lotCode,
      note: row.comment,
    })),
  };
}

export async function buildAutoContextForSession(
  client: PoolClient,
  siteId: number,
  sessionId: string,
  hints?: {
    documentNo?: string | null;
    composedAt?: string | null;
    locationCode?: string | null;
    comment?: string | null;
    externalRef?: string | null;
    warehouseCode?: string | null;
  }
): Promise<Torg1AutoContext> {
  const scans = await listReceivingScanEventsForDocument(client, siteId, sessionId);
  const byItem = new Map<
    string,
    { itemCode: string; itemName: string; qty: number }
  >();
  for (const scan of scans) {
    const code = (scan.itemCode || "").trim() || scan.code.slice(0, 32);
    if (!code) continue;
    const prev = byItem.get(code);
    const name = (scan.itemName || "").trim();
    if (prev) {
      prev.qty += scan.qty;
      if (!prev.itemName && name) prev.itemName = name;
    } else {
      byItem.set(code, { itemCode: code, itemName: name || code, qty: scan.qty });
    }
  }

  const wh = await resolveWarehouseLabel(client, siteId, hints?.warehouseCode);

  return {
    documentNo: hints?.documentNo || `Приёмка ${sessionId}`,
    composedAt: hints?.composedAt || new Date().toISOString(),
    warehouseCode: wh.code,
    warehouseName: wh.name,
    locationCode: hints?.locationCode || null,
    externalRef: hints?.externalRef || null,
    comment: hints?.comment || null,
    supplierHint: parseSupplierFromComment(hints?.comment),
    lines: Array.from(byItem.values()).map((row, i) => ({
      lineNo: i + 1,
      itemCode: row.itemCode,
      itemName: row.itemName,
      uom: "шт",
      qtyDoc: row.qty,
      qtyFact: row.qty,
      lotCode: null,
      note: null,
    })),
  };
}

export async function loadTorg1ForDocument(
  client: PoolClient,
  siteId: number,
  documentId: string
): Promise<Torg1FormRecord | null> {
  const ctx = await buildAutoContextForDocument(client, siteId, documentId);
  if (!ctx) return null;
  const settings = await getTorg1Settings(client, siteId);
  const auto = buildTorg1AutoFields(settings, ctx);
  const saved = await getTorg1DocumentForm(client, siteId, documentId);
  const overrides = saved?.overrides ?? {};
  const fields = mergeTorg1Fields(auto, overrides);
  return {
    formId: saved?.formId ?? null,
    documentId,
    sessionId: null,
    formCode: "torg1",
    title: saved?.title || `ТОРГ-1 № ${fields.documentNo || documentId}`,
    fields,
    overrides,
    auto,
    updatedAt: saved?.updatedAt ?? null,
  };
}

export async function loadTorg1ForSession(
  client: PoolClient,
  siteId: number,
  sessionId: string,
  hints?: {
    documentNo?: string | null;
    composedAt?: string | null;
    locationCode?: string | null;
    comment?: string | null;
    externalRef?: string | null;
    warehouseCode?: string | null;
  }
): Promise<Torg1FormRecord> {
  const ctx = await buildAutoContextForSession(client, siteId, sessionId, hints);
  const settings = await getTorg1Settings(client, siteId);
  const auto = buildTorg1AutoFields(settings, ctx);
  const draft = await getTorg1SessionDraft(client, siteId, sessionId);
  const overrides = draft?.overrides ?? {};
  const fields = mergeTorg1Fields(auto, overrides);
  return {
    formId: null,
    documentId: null,
    sessionId,
    formCode: "torg1",
    title: `ТОРГ-1 № ${fields.documentNo || sessionId}`,
    fields,
    overrides,
    auto,
    updatedAt: draft?.updatedAt ?? null,
  };
}

/** Diff текущих fields vs auto → только изменённые ключи (overrides). */
export function computeTorg1Overrides(
  auto: Torg1Fields,
  fields: Torg1Fields
): Partial<Torg1Fields> {
  const overrides: Partial<Torg1Fields> = {};
  const keys = Object.keys(auto) as Array<keyof Torg1Fields>;
  for (const key of keys) {
    if (key === "lines") {
      const a = JSON.stringify(auto.lines);
      const b = JSON.stringify(fields.lines);
      if (a !== b) overrides.lines = fields.lines.map((l) => ({ ...l }));
      continue;
    }
    if (String(auto[key] ?? "") !== String(fields[key] ?? "")) {
      overrides[key] = fields[key] as never;
    }
  }
  return overrides;
}
