import type { PoolClient } from "pg";
import { WmsHttpError } from "@/lib/wms/errors";
import {
  buildReceivingLotCode,
  emissionDayKey,
  getLotStockAtLocation,
} from "@/lib/wms/issue-stock";
import { normalizeCrptCode } from "@/lib/wms/crpt";

export type ReceivingBatchRecord = {
  batchCode: string;
  documentId: string | null;
  itemCode: string | null;
  itemName: string | null;
  gtin: string | null;
  qty: number | null;
  cellCode: string | null;
  lotCode?: string | null;
  emissionAtIso: string | null;
  expiresAtIso: string | null;
  createdAt: string;
  deviceUid: string | null;
};

function parseBatchMeta(comment: unknown): { gtin?: string; expiresAtIso?: string } {
  if (typeof comment !== "string" || !comment.trim()) return {};
  try {
    const parsed = JSON.parse(comment) as Record<string, unknown>;
    return {
      gtin: typeof parsed.gtin === "string" ? parsed.gtin : undefined,
      expiresAtIso: typeof parsed.expiresAtIso === "string" ? parsed.expiresAtIso : undefined,
    };
  } catch {
    return {};
  }
}

export async function findReceivingBatch(
  client: PoolClient,
  siteId: number,
  batchCode: string
): Promise<ReceivingBatchRecord | null> {
  const code = batchCode.trim();
  if (!code) return null;
  const r = await client.query(
    `SELECT
       code_list_id::text AS "codeListId",
       device_uid AS "deviceUid",
       created_at AS "createdAt",
       entries_json AS entries
     FROM wms_code_lists
     WHERE site_id = $1 AND list_type = 'receiving_batch_sticker'
     ORDER BY created_at DESC
     LIMIT 300`,
    [siteId]
  );
  for (const row of r.rows) {
    const entries = Array.isArray((row as { entries?: unknown[] }).entries)
      ? ((row as { entries: unknown[] }).entries)
      : [];
    for (const raw of entries) {
      const e = (raw ?? {}) as Record<string, unknown>;
      if (String(e.code ?? "").trim() !== code) continue;
      const meta = parseBatchMeta(e.comment);
      return {
        batchCode: code,
        documentId: String(e.documentId ?? "").trim() || null,
        itemCode: String(e.itemCode ?? "").trim() || null,
        itemName: String(e.itemName ?? "").trim() || null,
        gtin: meta.gtin ?? null,
        qty: Number.isFinite(Number(e.qty)) ? Number(e.qty) : null,
        cellCode: String(e.note ?? "").trim() || null,
        emissionAtIso: String(e.emissionAtIso ?? "").trim() || null,
        expiresAtIso: meta.expiresAtIso ?? null,
        createdAt: String((row as { createdAt?: string }).createdAt ?? ""),
        deviceUid: (row as { deviceUid?: string | null }).deviceUid
          ? String((row as { deviceUid: string }).deviceUid)
          : null,
      };
    }
  }

  const normalizedInput = normalizeCrptCode(code);
  const scans = await client.query(
    `SELECT
       device_uid AS "deviceUid",
       created_at AS "createdAt",
       entries_json AS entries
     FROM wms_code_lists
     WHERE site_id = $1 AND list_type = 'receiving_scan_event'
     ORDER BY created_at DESC
     LIMIT 2000`,
    [siteId]
  );
  for (const row of scans.rows) {
    const entries = Array.isArray((row as { entries?: unknown[] }).entries)
      ? ((row as { entries: unknown[] }).entries)
      : [];
    for (const raw of entries) {
      const e = (raw ?? {}) as Record<string, unknown>;
      const scannedCode = String(e.code ?? "").trim();
      if (!scannedCode || normalizeCrptCode(scannedCode) !== normalizedInput) continue;
      return {
        batchCode: code,
        documentId: String(e.documentId ?? "").trim() || null,
        itemCode: String(e.itemCode ?? "").trim() || null,
        itemName: String(e.itemName ?? "").trim() || null,
        gtin: null,
        qty: Number.isFinite(Number(e.qty)) ? Number(e.qty) : null,
        cellCode: String(e.note ?? "").trim() || null,
        emissionAtIso: String(e.emissionAtIso ?? "").trim() || null,
        expiresAtIso: null,
        createdAt: String((row as { createdAt?: string }).createdAt ?? ""),
        deviceUid: (row as { deviceUid?: string | null }).deviceUid
          ? String((row as { deviceUid: string }).deviceUid)
          : null,
      };
    }
  }
  return null;
}

export async function resolveReceivingBatchLocation(
  client: PoolClient,
  siteId: number,
  batch: ReceivingBatchRecord
): Promise<string | null> {
  const placement = await client.query<{ locationCode: string }>(
    `SELECT l.location_code AS "locationCode"
     FROM wms_operation_events e
     JOIN wms_locations l ON l.location_id = e.location_id
     WHERE e.site_id = $1
       AND e.event_type = 'batch.putaway'
       AND e.code_value = $2
     ORDER BY e.created_at DESC, e.event_id DESC
     LIMIT 1`,
    [siteId, batch.batchCode]
  );
  if (placement.rows[0]?.locationCode) return placement.rows[0].locationCode;
  if (batch.cellCode) return batch.cellCode;
  if (!batch.itemCode) return null;

  const lotCode = buildReceivingLotCode(batch.itemCode, emissionDayKey(batch.emissionAtIso));
  const qty = Number(batch.qty);
  const stock = await client.query<{ locationCode: string; availableQty: string }>(
    `SELECT
       loc.location_code AS "locationCode",
       sl.available_qty::text AS "availableQty"
     FROM wms_stock_lots sl
     JOIN wms_stock_balances b ON b.balance_id = sl.balance_id
     JOIN wms_locations loc ON loc.location_id = b.location_id
     JOIN wms_items i ON i.item_id = b.item_id
     WHERE b.site_id = $1
       AND i.item_code = $2
       AND sl.lot_code = $3
       AND sl.available_qty > 0
       AND ($4::numeric <= 0 OR sl.available_qty >= $4::numeric)
     ORDER BY
       CASE WHEN sl.available_qty = $4::numeric THEN 0 ELSE 1 END,
       sl.available_qty ASC,
       b.updated_at DESC
     LIMIT 1`,
    [siteId, batch.itemCode, lotCode, Number.isFinite(qty) ? qty : 0]
  );
  return stock.rows[0]?.locationCode ?? null;
}

export async function sumReceivingQtyForItemInDocument(
  client: PoolClient,
  siteId: number,
  documentId: string,
  itemCode: string
): Promise<number> {
  const doc = documentId.trim();
  const item = itemCode.trim();
  if (!doc || !item) return 0;
  const r = await client.query(
    `SELECT entries_json AS entries
     FROM wms_code_lists
     WHERE site_id = $1 AND list_type = 'receiving_scan_event'
     ORDER BY created_at DESC
     LIMIT 1000`,
    [siteId]
  );
  let total = 0;
  for (const row of r.rows) {
    const entries = Array.isArray((row as { entries?: unknown[] }).entries)
      ? ((row as { entries: unknown[] }).entries)
      : [];
    for (const raw of entries) {
      const e = (raw ?? {}) as Record<string, unknown>;
      if (String(e.documentId ?? "").trim() !== doc) continue;
      if (String(e.itemCode ?? "").trim() !== item) continue;
      const qty = Number(e.qty);
      if (Number.isFinite(qty) && qty > 0) total += qty;
    }
  }
  return total;
}

export async function lookupReceivingBatch(
  client: PoolClient,
  siteId: number,
  batchCode: string
) {
  const batch = await findReceivingBatch(client, siteId, batchCode);
  if (!batch) {
    throw new WmsHttpError(404, "batch sticker not found", "batch_not_found");
  }
  const documentQty =
    batch.documentId && batch.itemCode
      ? await sumReceivingQtyForItemInDocument(client, siteId, batch.documentId, batch.itemCode)
      : null;

  let lotCode: string | null = null;
  let stockAvailableQty: number | null = null;
  let stockInProductionQty: number | null = null;
  const currentLocationCode = await resolveReceivingBatchLocation(client, siteId, batch);
  if (batch.itemCode && currentLocationCode) {
    const day = emissionDayKey(batch.emissionAtIso);
    lotCode = buildReceivingLotCode(batch.itemCode, day);
    const stock = await getLotStockAtLocation(
      client,
      siteId,
      batch.itemCode,
      currentLocationCode,
      lotCode
    );
    if (stock) {
      stockAvailableQty = stock.availableQty;
      stockInProductionQty = stock.inProductionQty;
    }
  }

  return {
    batch: { ...batch, lotCode },
    documentQty,
    stockAvailableQty,
    stockInProductionQty,
    lotCode,
    currentLocationCode,
  };
}
