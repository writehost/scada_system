import type { PoolClient } from "pg";
import { WmsHttpError } from "@/lib/wms/errors";
import {
  WMS_DOCUMENT_STATUS,
  WMS_DOCUMENT_TYPE,
  WMS_MOVEMENT_TYPE,
  WMS_STOCK_BUCKET,
} from "@/lib/wms/ref";
import { applyStockWriteoff } from "@/lib/wms/stock-ledger";
import {
  buildTorg16AutoFields,
  getTorg16Settings,
  saveTorg16DocumentForm,
  type Torg16Fields,
} from "@/lib/wms/torg16";
import { getWriteoffReasonDef, seedDefaultWriteoffReasons } from "@/lib/wms/writeoff-reasons";

export type WriteoffLineInput = {
  itemCode: string;
  lotCode?: string | null;
  qty?: number | null;
};

export type ApplyLocationWriteoffInput = {
  requestId: string;
  locationCode: string;
  reasonCode: string;
  comment?: string | null;
  lines?: WriteoffLineInput[] | null;
  actorUserId?: string | null;
};

export type WriteoffPreviewLine = {
  itemCode: string;
  itemName: string;
  lotCode: string | null;
  lotId: string | null;
  uom: string;
  availableQty: number;
  inProductionQty: number;
  quarantineQty: number;
  qty: number;
  manufacturedAt: string | null;
  expiryAt: string | null;
  expired: boolean;
};

export type WriteoffPreviewCode = {
  codeId: string;
  itemCode: string;
  value: string;
};

export type WriteoffPreview = {
  locationCode: string;
  locationName: string | null;
  warehouseCode: string | null;
  warehouseName: string | null;
  lines: WriteoffPreviewLine[];
  codes: WriteoffPreviewCode[];
};

type StockLotRow = {
  itemId: string;
  itemCode: string;
  itemName: string;
  uomCode: string;
  lotId: string | null;
  lotCode: string | null;
  availableQty: string;
  inProductionQty: string;
  quarantineQty: string;
  manufacturedAt: string | null;
  expiryAt: string | null;
};

function uomLabel(code: string | null | undefined): string {
  const c = (code || "").trim().toLowerCase();
  if (!c || c === "pcs" || c === "pc") return "шт";
  return code || "шт";
}

function num(v: string | number | null | undefined): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isExpired(iso: string | null): boolean {
  if (!iso) return false;
  const end = new Date(iso);
  if (Number.isNaN(end.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return end.getTime() < today.getTime();
}

function formatCodeValue(raw: string | null, gtin: string | null, serial: string | null): string {
  const fromRaw = (raw || "").replace(/\u0000/g, "").trim();
  if (fromRaw) return fromRaw;
  const g = (gtin || "").trim();
  const s = (serial || "").trim();
  if (g && s) return `01${g}21${s}`;
  return s || g;
}

export async function ensureWriteoffRefs(client: PoolClient) {
  await client.query(
    `INSERT INTO ref_wms_document_type (document_type_id, code, name)
     VALUES (12, 'writeoff', 'Списание')
     ON CONFLICT (document_type_id) DO NOTHING`
  );
  await client.query(
    `INSERT INTO ref_wms_movement_type (movement_type_id, code, name)
     VALUES (13, 'writeoff', 'Списание')
     ON CONFLICT (movement_type_id) DO NOTHING`
  );
}

async function resolveLocationFull(
  client: PoolClient,
  siteId: number,
  locationCode: string
) {
  const r = await client.query<{
    location_id: string;
    location_code: string;
    display_name: string | null;
    warehouse_id: string | null;
    warehouse_code: string | null;
    warehouse_name: string | null;
  }>(
    `SELECT
       l.location_id::text,
       l.location_code,
       l.display_name,
       w.warehouse_id::text,
       w.warehouse_code,
       w.name AS warehouse_name
     FROM wms_locations l
     LEFT JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
     WHERE l.site_id = $1 AND lower(btrim(l.location_code)) = lower(btrim($2::text))`,
    [siteId, locationCode.trim()]
  );
  return r.rows[0] ?? null;
}

async function loadLocationStock(
  client: PoolClient,
  siteId: number,
  locationId: string
): Promise<StockLotRow[]> {
  const lots = await client.query<StockLotRow>(
    `SELECT
       i.item_id::text AS "itemId",
       i.item_code AS "itemCode",
       i.name AS "itemName",
       COALESCE(i.uom_code, 'pcs') AS "uomCode",
       sl.lot_id::text AS "lotId",
       sl.lot_code AS "lotCode",
       COALESCE(sl.available_qty, 0)::text AS "availableQty",
       COALESCE(sl.in_production_qty, 0)::text AS "inProductionQty",
       COALESCE(sl.quarantine_qty, 0)::text AS "quarantineQty",
       wl.manufactured_at::text AS "manufacturedAt",
       COALESCE(wl.expiry_at, wl.best_before_at, sl.expiry_at)::text AS "expiryAt"
     FROM wms_stock_lots sl
     JOIN wms_stock_balances sb ON sb.balance_id = sl.balance_id
     JOIN wms_items i ON i.item_id = sb.item_id AND i.site_id = sb.site_id
     LEFT JOIN wms_lots wl ON wl.lot_id = sl.lot_id AND wl.site_id = sb.site_id
     WHERE sb.site_id = $1 AND sb.location_id = $2::bigint
       AND (
         COALESCE(sl.available_qty, 0)
         + COALESCE(sl.in_production_qty, 0)
         + COALESCE(sl.quarantine_qty, 0)
       ) > 0
     ORDER BY i.item_code, sl.lot_code`,
    [siteId, locationId]
  );

  const balances = await client.query<StockLotRow>(
    `SELECT
       i.item_id::text AS "itemId",
       i.item_code AS "itemCode",
       i.name AS "itemName",
       COALESCE(i.uom_code, 'pcs') AS "uomCode",
       NULL::text AS "lotId",
       NULL::text AS "lotCode",
       GREATEST(
         COALESCE(sb.available_qty, 0) - COALESCE(lot.available_qty, 0),
         0
       )::text AS "availableQty",
       GREATEST(
         COALESCE(sb.in_production_qty, 0) - COALESCE(lot.in_production_qty, 0),
         0
       )::text AS "inProductionQty",
       GREATEST(
         COALESCE(sb.quarantine_qty, 0) - COALESCE(lot.quarantine_qty, 0),
         0
       )::text AS "quarantineQty",
       NULL::text AS "manufacturedAt",
       NULL::text AS "expiryAt"
     FROM wms_stock_balances sb
     JOIN wms_items i ON i.item_id = sb.item_id AND i.site_id = sb.site_id
     LEFT JOIN LATERAL (
       SELECT
         COALESCE(SUM(sl.available_qty), 0) AS available_qty,
         COALESCE(SUM(sl.in_production_qty), 0) AS in_production_qty,
         COALESCE(SUM(sl.quarantine_qty), 0) AS quarantine_qty
       FROM wms_stock_lots sl
       WHERE sl.balance_id = sb.balance_id
     ) lot ON TRUE
     WHERE sb.site_id = $1 AND sb.location_id = $2::bigint
       AND (
         GREATEST(COALESCE(sb.available_qty, 0) - COALESCE(lot.available_qty, 0), 0)
         + GREATEST(COALESCE(sb.in_production_qty, 0) - COALESCE(lot.in_production_qty, 0), 0)
         + GREATEST(COALESCE(sb.quarantine_qty, 0) - COALESCE(lot.quarantine_qty, 0), 0)
       ) > 0
     ORDER BY i.item_code`,
    [siteId, locationId]
  );

  return [...lots.rows, ...balances.rows];
}

function toPreviewLine(row: StockLotRow): WriteoffPreviewLine {
  const availableQty = num(row.availableQty);
  const inProductionQty = num(row.inProductionQty);
  const quarantineQty = num(row.quarantineQty);
  return {
    itemCode: row.itemCode,
    itemName: row.itemName,
    lotCode: row.lotCode,
    lotId: row.lotId,
    uom: uomLabel(row.uomCode),
    availableQty,
    inProductionQty,
    quarantineQty,
    qty: availableQty + inProductionQty + quarantineQty,
    manufacturedAt: row.manufacturedAt,
    expiryAt: row.expiryAt,
    expired: isExpired(row.expiryAt),
  };
}

function isMissingRelation(e: unknown): boolean {
  return Boolean(e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "42P01");
}

async function listLocationCodes(
  client: PoolClient,
  siteId: number,
  locationId: string,
  itemCodes?: string[]
): Promise<WriteoffPreviewCode[]> {
  const items = (itemCodes ?? []).map((c) => c.trim()).filter(Boolean);
  try {
    const r = await client.query<{
      codeId: string;
      itemCode: string;
      raw: string | null;
      gtin: string | null;
      serial: string | null;
    }>(
      `SELECT
         c.code_id::text AS "codeId",
         i.item_code AS "itemCode",
         encode(c.raw, 'escape') AS raw,
         c.ai01_gtin AS gtin,
         c.ai21_serial AS serial
       FROM wms_item_codes wc
       JOIN codes c ON c.code_id = wc.code_id
       JOIN wms_items i ON i.item_id = wc.item_id AND i.site_id = wc.current_site_id
       WHERE wc.current_site_id = $1
         AND wc.current_location_id = $2::bigint
         AND wc.unlinked_at IS NULL
         AND (cardinality($3::text[]) = 0 OR i.item_code = ANY($3::text[]))
       ORDER BY i.item_code, c.code_id
       LIMIT 5000`,
      [siteId, locationId, items]
    );
    return r.rows.map((row) => ({
      codeId: row.codeId,
      itemCode: row.itemCode,
      value: formatCodeValue(row.raw, row.gtin, row.serial),
    }));
  } catch (e) {
    if (isMissingRelation(e)) return [];
    throw e;
  }
}

export async function previewLocationWriteoff(
  client: PoolClient,
  siteId: number,
  locationCode: string
): Promise<WriteoffPreview> {
  const loc = await resolveLocationFull(client, siteId, locationCode);
  if (!loc) throw new WmsHttpError(404, "ячейка не найдена", "location_not_found");
  const stock = await loadLocationStock(client, siteId, loc.location_id);
  const lines = stock.map(toPreviewLine).filter((line) => line.qty > 1e-9);
  const codes = await listLocationCodes(
    client,
    siteId,
    loc.location_id,
    lines.map((line) => line.itemCode)
  );
  return {
    locationCode: loc.location_code,
    locationName: loc.display_name,
    warehouseCode: loc.warehouse_code,
    warehouseName: loc.warehouse_name,
    lines,
    codes,
  };
}

function matchRequested(
  row: StockLotRow,
  requested: WriteoffLineInput[] | null | undefined
): number | null {
  if (!requested || requested.length === 0) return null;
  const hits = requested.filter((line) => {
    if (line.itemCode.trim() !== row.itemCode) return false;
    const wantLot = (line.lotCode || "").trim();
    const haveLot = (row.lotCode || "").trim();
    if (wantLot && wantLot !== haveLot) return false;
    return true;
  });
  if (hits.length === 0) return 0;
  const specified = hits
    .map((line) => (line.qty == null ? null : num(line.qty)))
    .filter((q): q is number => q != null && q > 0);
  if (specified.length === 0) return null;
  return specified.reduce((a, b) => a + b, 0);
}

async function nextWriteoffDocumentNo(client: PoolClient, siteId: number): Promise<string> {
  const r = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM wms_documents
     WHERE site_id = $1
       AND document_type_id = $2
       AND created_at::date = CURRENT_DATE`,
    [siteId, WMS_DOCUMENT_TYPE.writeoff]
  );
  const n = Number(r.rows[0]?.n ?? "0") + 1;
  const day = new Date();
  const ymd = `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, "0")}${String(day.getDate()).padStart(2, "0")}`;
  return `СП-${ymd}-${String(n).padStart(3, "0")}`;
}

async function unlinkWrittenOffCodes(
  client: PoolClient,
  input: {
    siteId: number;
    locationId: string;
    documentId: string;
    reasonName: string;
    items: Array<{ itemId: string; qty: number }>;
  }
): Promise<WriteoffPreviewCode[]> {
  const collected: WriteoffPreviewCode[] = [];
  try {
  for (const item of input.items) {
    const take = Math.max(0, Math.trunc(item.qty));
    if (take <= 0) continue;
    const picked = await client.query<{
      codeId: string;
      itemCode: string;
      raw: string | null;
      gtin: string | null;
      serial: string | null;
    }>(
      `SELECT
         wc.code_id::text AS "codeId",
         i.item_code AS "itemCode",
         encode(c.raw, 'escape') AS raw,
         c.ai01_gtin AS gtin,
         c.ai21_serial AS serial
       FROM wms_item_codes wc
       JOIN codes c ON c.code_id = wc.code_id
       JOIN wms_items i ON i.item_id = wc.item_id AND i.site_id = wc.current_site_id
       WHERE wc.current_site_id = $1
         AND wc.item_id = $2::bigint
         AND wc.current_location_id = $3::bigint
         AND wc.unlinked_at IS NULL
       ORDER BY wc.linked_at NULLS LAST, wc.code_id
       LIMIT $4
       FOR UPDATE OF wc`,
      [input.siteId, item.itemId, input.locationId, take]
    );
    if (picked.rows.length === 0) continue;
    const ids = picked.rows.map((row) => row.codeId);
    await client.query(
      `UPDATE wms_item_codes
       SET unlinked_at = now(),
           current_location_id = NULL,
           last_document_id = $1::bigint,
           note = COALESCE(note, '') || CASE WHEN COALESCE(note, '') = '' THEN '' ELSE E'\\n' END || $4
       WHERE current_site_id = $2
         AND code_id = ANY($3::bigint[])`,
      [input.documentId, input.siteId, ids, `Списано: ${input.reasonName} (док. ${input.documentId})`]
    );
    for (const row of picked.rows) {
      collected.push({
        codeId: row.codeId,
        itemCode: row.itemCode,
        value: formatCodeValue(row.raw, row.gtin, row.serial),
      });
    }
  }
  return collected;
  } catch (e) {
    if (isMissingRelation(e)) return [];
    throw e;
  }
}

export async function applyLocationWriteoff(
  client: PoolClient,
  siteId: number,
  input: ApplyLocationWriteoffInput
): Promise<{
  documentId: string;
  documentNo: string;
  lineCount: number;
  codesCount: number;
  fields: Torg16Fields;
}> {
  await ensureWriteoffRefs(client);
  await seedDefaultWriteoffReasons(client, siteId);

  const loc = await resolveLocationFull(client, siteId, input.locationCode);
  if (!loc) throw new WmsHttpError(404, "ячейка не найдена", "location_not_found");

  const reason = await getWriteoffReasonDef(client, siteId, input.reasonCode);
  if (!reason || !reason.isActive) {
    throw new WmsHttpError(400, "выберите основание списания из справочника", "reason_required");
  }

  const stock = await loadLocationStock(client, siteId, loc.location_id);
  const requested = input.lines?.filter((line) => line.itemCode.trim()) ?? [];
  const plan: Array<StockLotRow & { writeQty: number }> = [];
  for (const row of stock) {
    const onHand = num(row.availableQty) + num(row.inProductionQty) + num(row.quarantineQty);
    if (onHand <= 1e-9) continue;
    const matchQty = matchRequested(row, requested.length ? requested : null);
    if (matchQty === 0) continue;
    const writeQty = matchQty == null ? onHand : Math.min(onHand, matchQty);
    if (writeQty <= 1e-9) continue;
    plan.push({ ...row, writeQty });
  }
  if (plan.length === 0) {
    throw new WmsHttpError(409, "в ячейке нет остатков для списания", "empty_writeoff");
  }

  const documentNo = await nextWriteoffDocumentNo(client, siteId);
  const comment = [
    `Списание · ${reason.displayName}`,
    loc.location_code,
    input.comment?.trim() || "",
  ]
    .filter(Boolean)
    .join(" · ");

  const header = await client.query<{ document_id: string }>(
    `INSERT INTO wms_documents (
       site_id, document_type_id, document_status_id, request_id, document_no,
       source_warehouse_id, source_location_id, comment, applied_at, payload_json
     ) VALUES (
       $1, $2, $3, $4::uuid, $5,
       $6::bigint, $7::bigint, $8, now(), $9::jsonb
     )
     RETURNING document_id::text`,
    [
      siteId,
      WMS_DOCUMENT_TYPE.writeoff,
      WMS_DOCUMENT_STATUS.applied,
      input.requestId,
      documentNo,
      loc.warehouse_id,
      loc.location_id,
      comment,
      JSON.stringify({
        kind: "writeoff",
        reasonCode: reason.code,
        reasonName: reason.displayName,
      }),
    ]
  );
  const documentId = header.rows[0].document_id;

  const formLines: Torg16Fields["lines"] = [];
  const qtyByItem = new Map<string, { itemId: string; qty: number }>();

  for (const [index, row] of plan.entries()) {
    let remaining = row.writeQty;
    const buckets: Array<{ id: number; qty: number }> = [
      { id: WMS_STOCK_BUCKET.available, qty: num(row.availableQty) },
      { id: WMS_STOCK_BUCKET.in_production, qty: num(row.inProductionQty) },
      { id: WMS_STOCK_BUCKET.quarantine, qty: num(row.quarantineQty) },
    ];

    const line = await client.query<{ document_line_id: string }>(
      `INSERT INTO wms_document_lines (
         document_id, line_no, item_id, source_location_id,
         requested_qty, confirmed_qty, lot_id, lot_code, comment, requested_uom_code
       ) VALUES (
         $1::bigint, $2, $3::bigint, $4::bigint,
         $5, $5, $6::bigint, $7, $8, $9
       )
       RETURNING document_line_id::text`,
      [
        documentId,
        index + 1,
        row.itemId,
        loc.location_id,
        row.writeQty,
        row.lotId,
        row.lotCode,
        reason.displayName,
        uomLabel(row.uomCode),
      ]
    );

    for (const bucket of buckets) {
      if (remaining <= 1e-9) break;
      const take = Math.min(bucket.qty, remaining);
      if (take <= 1e-9) continue;
      await applyStockWriteoff(client, {
        siteId,
        itemId: row.itemId,
        fromLocationId: loc.location_id,
        qty: take,
        fromBucketId: bucket.id,
        lotId: row.lotId,
        lotCode: row.lotCode,
        movementTypeId: WMS_MOVEMENT_TYPE.writeoff,
        documentId,
        documentLineId: line.rows[0].document_line_id,
        requestId: input.requestId,
        actorUserId: input.actorUserId,
        payload: { reasonCode: reason.code, reasonName: reason.displayName },
      });
      remaining -= take;
    }
    if (remaining > 1e-6) {
      throw new WmsHttpError(409, "не удалось списать весь остаток", "insufficient_stock");
    }

    const prev = qtyByItem.get(row.itemId);
    qtyByItem.set(row.itemId, {
      itemId: row.itemId,
      qty: (prev?.qty ?? 0) + row.writeQty,
    });
    formLines.push({
      lineNo: index + 1,
      name: row.itemName,
      itemCode: row.itemCode,
      uom: uomLabel(row.uomCode),
      qty: String(row.writeQty),
      lotCode: row.lotCode || "",
      expiryAt: row.expiryAt || "",
      codes: "",
      note: reason.displayName,
    });
  }

  const writtenCodes = await unlinkWrittenOffCodes(client, {
    siteId,
    locationId: loc.location_id,
    documentId,
    reasonName: reason.displayName,
    items: [...qtyByItem.values()],
  });

  const codesByItem = new Map<string, string[]>();
  for (const code of writtenCodes) {
    const list = codesByItem.get(code.itemCode) ?? [];
    list.push(code.value);
    codesByItem.set(code.itemCode, list);
  }
  for (const line of formLines) {
    line.codes = (codesByItem.get(line.itemCode) ?? []).join("\n");
  }

  await client.query(
    `UPDATE wms_documents
     SET payload_json = COALESCE(payload_json, '{}'::jsonb) || $2::jsonb
     WHERE document_id = $1::bigint`,
    [
      documentId,
      JSON.stringify({
        kind: "writeoff",
        reasonCode: reason.code,
        reasonName: reason.displayName,
        codes: writtenCodes.map((c) => c.value),
      }),
    ]
  );

  const settings = await getTorg16Settings(client, siteId);
  const fields = buildTorg16AutoFields(settings, {
    documentNo,
    composedAt: new Date().toISOString(),
    warehouseCode: loc.warehouse_code,
    warehouseName: loc.warehouse_name,
    locationCode: loc.location_code,
    locationName: loc.display_name,
    comment: input.comment,
    reasonCode: reason.code,
    reasonName: reason.displayName,
    codes: writtenCodes.map((c) => c.value),
    lines: formLines.map((line) => ({
      lineNo: line.lineNo,
      itemCode: line.itemCode,
      itemName: line.name,
      uom: line.uom,
      qty: line.qty,
      lotCode: line.lotCode,
      expiryAt: line.expiryAt,
      codes: line.codes,
      note: line.note,
    })),
  });
  await saveTorg16DocumentForm(client, siteId, documentId, fields, `ТОРГ-16 ${documentNo}`);

  return {
    documentId,
    documentNo,
    lineCount: formLines.length,
    codesCount: writtenCodes.length,
    fields,
  };
}

export async function loadTorg16ForDocument(
  client: PoolClient,
  siteId: number,
  documentId: string
): Promise<{
  formId: string | null;
  documentId: string;
  title: string;
  fields: Torg16Fields;
  overrides: Partial<Torg16Fields>;
  auto: Torg16Fields;
  updatedAt: string | null;
} | null> {
  const header = await client.query<{
    documentNo: string | null;
    createdAt: string;
    comment: string | null;
    locationCode: string | null;
    locationName: string | null;
    warehouseCode: string | null;
    warehouseName: string | null;
    payload: unknown;
  }>(
    `SELECT
       d.document_no AS "documentNo",
       d.created_at::text AS "createdAt",
       d.comment,
       sl.location_code AS "locationCode",
       sl.display_name AS "locationName",
       sw.warehouse_code AS "warehouseCode",
       sw.name AS "warehouseName",
       d.payload_json AS payload
     FROM wms_documents d
     LEFT JOIN wms_locations sl ON sl.location_id = d.source_location_id
     LEFT JOIN wms_warehouses sw ON sw.warehouse_id = d.source_warehouse_id
     WHERE d.site_id = $1 AND d.document_id = $2::bigint`,
    [siteId, documentId]
  );
  if (!header.rows[0]) return null;

  const lines = await client.query<{
    lineNo: number;
    itemCode: string;
    itemName: string;
    qty: string;
    uom: string | null;
    lotCode: string | null;
    comment: string | null;
  }>(
    `SELECT
       dl.line_no AS "lineNo",
       i.item_code AS "itemCode",
       i.name AS "itemName",
       COALESCE(dl.confirmed_qty, dl.requested_qty)::text AS qty,
       dl.requested_uom_code AS uom,
       COALESCE(dl.lot_code, wl.lot_code) AS "lotCode",
       dl.comment
     FROM wms_document_lines dl
     JOIN wms_items i ON i.item_id = dl.item_id
     LEFT JOIN wms_lots wl ON wl.lot_id = dl.lot_id
     WHERE dl.document_id = $1::bigint
     ORDER BY dl.line_no`,
    [documentId]
  );

  const payload =
    header.rows[0].payload && typeof header.rows[0].payload === "object"
      ? (header.rows[0].payload as Record<string, unknown>)
      : {};
  const codes = Array.isArray(payload.codes)
    ? payload.codes.map((c) => String(c))
    : [];

  const settings = await getTorg16Settings(client, siteId);
  const auto = buildTorg16AutoFields(settings, {
    documentNo: header.rows[0].documentNo,
    composedAt: header.rows[0].createdAt,
    warehouseCode: header.rows[0].warehouseCode,
    warehouseName: header.rows[0].warehouseName,
    locationCode: header.rows[0].locationCode,
    locationName: header.rows[0].locationName,
    comment: header.rows[0].comment,
    reasonCode: typeof payload.reasonCode === "string" ? payload.reasonCode : "",
    reasonName: typeof payload.reasonName === "string" ? payload.reasonName : "",
    codes,
    lines: lines.rows.map((line) => ({
      lineNo: line.lineNo,
      itemCode: line.itemCode,
      itemName: line.itemName,
      uom: line.uom,
      qty: line.qty,
      lotCode: line.lotCode,
      note: line.comment,
    })),
  });

  const { getTorg16DocumentForm } = await import("@/lib/wms/torg16");
  const stored = await getTorg16DocumentForm(client, siteId, documentId);
  const overrides = stored?.overrides ?? {};
  const fields = {
    ...auto,
    ...overrides,
    lines: overrides.lines ?? auto.lines,
  };
  return {
    formId: stored?.formId ?? null,
    documentId,
    title: stored?.title || `ТОРГ-16 ${header.rows[0].documentNo || documentId}`,
    fields,
    overrides,
    auto,
    updatedAt: stored?.updatedAt ?? null,
  };
}
