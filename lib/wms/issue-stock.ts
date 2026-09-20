import type { PoolClient } from "pg";
import { WmsHttpError } from "@/lib/wms/errors";
import { ensureWmsStockLotColumns } from "@/lib/wms/ensure-stock-lot-columns";
import { ensureWmsLot } from "@/lib/wms/documents";
import { fetchBalanceSnapshot } from "@/lib/wms/query";
import { resolveItemByCodeOrBarcode, resolveLocation } from "@/lib/wms/resolve";
import { WMS_MOVEMENT_TYPE } from "@/lib/wms/ref";
import { applyIssueToWorkshop } from "@/lib/wms/stock-ledger";
import {
  assertWorkshopTargetLocation,
  transferItemCodesToWorkshop,
} from "@/lib/wms/workshop-codes";
import { assertWaitingCellAcceptsItemByLocationId } from "@/lib/wms/workshop-waiting-cell";
import {
  pickRecommendedIssueLot,
  sortLotsForRotation,
  type RotationPolicy,
} from "@/lib/wms/lot-rotation";

type QtyField = "available_qty" | "in_production_qty";

export function emissionDayKey(emissionAtIso: string | Date | null | undefined): string {
  const raw =
    emissionAtIso == null
      ? ""
      : emissionAtIso instanceof Date
        ? emissionAtIso.toISOString()
        : String(emissionAtIso).trim();
  if (!raw) return "unknown";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "unknown";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function buildReceivingLotCode(itemCode: string, emissionDay: string): string {
  const safeItem = itemCode.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "ITEM";
  return `RCV-${emissionDay}-${safeItem}`;
}

export type StockLotRow = {
  lotId: string;
  lotCode: string;
  emissionDay: string;
  emissionAtIso: string | null;
  availableQty: number;
  inProductionQty: number;
  bestBeforeAt?: string | null;
  expiryAt?: string | null;
  manufacturedAt?: string | null;
  receivedAt?: string | null;
};

export type ItemStockAvailability = {
  itemCode: string;
  itemName: string;
  locationCode: string;
  totalAvailable: number;
  totalInProduction: number;
  rotationPolicy: RotationPolicy;
  isPerishable: boolean;
  recommendedLotId: string | null;
  lots: StockLotRow[];
};

export type ItemFefoPickRecommendation = {
  itemCode: string;
  itemName: string;
  rotationPolicy: RotationPolicy;
  isPerishable: boolean;
  locationCode: string;
  locationName: string | null;
  warehouseCode: string | null;
  zoneCode: string | null;
  lotId: string;
  lotCode: string;
  emissionAtIso: string | null;
  bestBeforeAt: string | null;
  expiryAt: string | null;
  receivedAt: string | null;
  availableQty: number;
} | null;

async function ensureBalance(
  client: PoolClient,
  siteId: number,
  locationId: string,
  itemId: string
): Promise<string> {
  await client.query(
    `INSERT INTO wms_stock_balances (site_id, location_id, item_id)
     VALUES ($1, $2::bigint, $3::bigint)
     ON CONFLICT (site_id, location_id, item_id) DO NOTHING`,
    [siteId, locationId, itemId]
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
     SET ${field} = ${field} + $1, updated_at = now()
     WHERE balance_id = $2::bigint AND lot_id = $3::bigint
     RETURNING ${field}::text AS value`,
    [delta, balanceId, lotId]
  );
  const nextValue = Number(r.rows[0]?.value ?? "0");
  if (nextValue < -1e-9) {
    throw new WmsHttpError(409, `negative lot balance in ${field}`, "negative_lot_balance");
  }
}

export async function getLotStockAtLocation(
  client: PoolClient,
  siteId: number,
  itemCode: string,
  locationCode: string,
  lotCode?: string | null
): Promise<{ availableQty: number; inProductionQty: number } | null> {
  const item = await resolveItemByCodeOrBarcode(client, siteId, itemCode);
  const loc = await resolveLocation(client, siteId, locationCode);
  if (!item || !loc) return null;

  if (lotCode?.trim()) {
    const r = await client.query<{ available: string; inProd: string }>(
      `SELECT
         COALESCE(sl.available_qty, 0)::text AS available,
         COALESCE(sl.in_production_qty, 0)::text AS "inProd"
       FROM wms_stock_lots sl
       JOIN wms_stock_balances sb ON sb.balance_id = sl.balance_id
       JOIN wms_lots wl ON wl.lot_id = sl.lot_id AND wl.site_id = sb.site_id
       WHERE sb.site_id = $1
         AND sb.location_id = $2::bigint
         AND sb.item_id = $3::bigint
         AND wl.lot_code = $4
       LIMIT 1`,
      [siteId, loc.location_id, item.item_id, lotCode.trim()]
    );
    if (r.rows.length === 0) return { availableQty: 0, inProductionQty: 0 };
    return {
      availableQty: Number(r.rows[0].available),
      inProductionQty: Number(r.rows[0].inProd),
    };
  }

  const r = await client.query<{ available: string; inProd: string }>(
    `SELECT
       COALESCE(sb.available_qty, 0)::text AS available,
       COALESCE(sb.in_production_qty, 0)::text AS "inProd"
     FROM wms_stock_balances sb
     WHERE sb.site_id = $1 AND sb.location_id = $2::bigint AND sb.item_id = $3::bigint`,
    [siteId, loc.location_id, item.item_id]
  );
  if (r.rows.length === 0) return { availableQty: 0, inProductionQty: 0 };
  return {
    availableQty: Number(r.rows[0].available),
    inProductionQty: Number(r.rows[0].inProd),
  };
}

export async function getItemStockAvailability(
  client: PoolClient,
  siteId: number,
  itemCode: string,
  locationCode: string
): Promise<ItemStockAvailability | null> {
  await ensureWmsStockLotColumns(client);
  const item = await resolveItemByCodeOrBarcode(client, siteId, itemCode);
  const loc = await resolveLocation(client, siteId, locationCode);
  if (!item) return null;
  if (!loc) return null;

  const rotRow = await client.query<{ rotation_policy: string; is_perishable: boolean }>(
    `SELECT rotation_policy, is_perishable FROM wms_items WHERE item_id = $1::bigint`,
    [item.item_id]
  );
  const rotationPolicy = (rotRow.rows[0]?.rotation_policy || "fifo") as RotationPolicy;
  const isPerishable = Boolean(rotRow.rows[0]?.is_perishable);

  const lots = await client.query<{
    lotId: string;
    lotCode: string;
    manufacturedAt: string | null;
    bestBeforeAt: string | null;
    expiryAt: string | null;
    receivedAt: string | null;
    availableQty: number;
    inProductionQty: number;
  }>(
    `SELECT
       wl.lot_id::text AS "lotId",
       wl.lot_code AS "lotCode",
       wl.manufactured_at AS "manufacturedAt",
       wl.best_before_at AS "bestBeforeAt",
       wl.expiry_at AS "expiryAt",
       wl.received_at AS "receivedAt",
       COALESCE(sl.available_qty, 0)::float8 AS "availableQty",
       COALESCE(sl.in_production_qty, 0)::float8 AS "inProductionQty"
     FROM wms_stock_lots sl
     JOIN wms_stock_balances sb ON sb.balance_id = sl.balance_id
     JOIN wms_lots wl ON wl.lot_id = sl.lot_id AND wl.site_id = sb.site_id
     JOIN wms_locations l ON l.location_id = sb.location_id AND l.site_id = sb.site_id
     WHERE sb.site_id = $1
       AND l.location_code = $2
       AND sb.item_id = $3::bigint
       AND (sl.available_qty > 0 OR COALESCE(sl.in_production_qty, 0) > 0)`,
    [siteId, locationCode.trim(), item.item_id]
  );

  let rows: StockLotRow[] = lots.rows.map((row) => {
    const emissionAtIso = row.manufacturedAt;
    return {
      lotId: row.lotId,
      lotCode: row.lotCode,
      emissionDay: emissionDayKey(emissionAtIso),
      emissionAtIso,
      availableQty: row.availableQty,
      inProductionQty: row.inProductionQty,
      bestBeforeAt: row.bestBeforeAt,
      expiryAt: row.expiryAt,
      manufacturedAt: row.manufacturedAt,
      receivedAt: row.receivedAt,
    };
  });

  rows = sortLotsForRotation(rows, rotationPolicy, isPerishable);

  const recommended = pickRecommendedIssueLot(rows, rotationPolicy, isPerishable);

  if (rows.length === 0) {
    const bal = await client.query<{ available: number; inProd: number }>(
      `SELECT
         COALESCE(sb.available_qty, 0)::float8 AS available,
         COALESCE(sb.in_production_qty, 0)::float8 AS "inProd"
       FROM wms_stock_balances sb
       JOIN wms_locations l ON l.location_id = sb.location_id AND l.site_id = sb.site_id
       WHERE sb.site_id = $1
         AND l.location_code = $2
         AND sb.item_id = $3::bigint
       LIMIT 1`,
      [siteId, locationCode.trim(), item.item_id]
    );
    const b = bal.rows[0];
    if (b && (b.available > 0 || b.inProd > 0)) {
      rows = [
        {
          lotId: "0",
          lotCode: "Без партии",
          emissionDay: "unknown",
          emissionAtIso: null,
          availableQty: b.available,
          inProductionQty: b.inProd,
        },
      ];
    }
  }

  const totalAvailable = rows.reduce((s, r) => s + r.availableQty, 0);
  const totalInProduction = rows.reduce((s, r) => s + r.inProductionQty, 0);

  return {
    itemCode: item.item_code,
    itemName: item.name,
    locationCode: loc.location_code,
    totalAvailable,
    totalInProduction,
    rotationPolicy: rotationPolicy as RotationPolicy,
    isPerishable,
    recommendedLotId: recommended?.lotId ?? null,
    lots: rows,
  };
}

export async function getItemFefoPickRecommendation(
  client: PoolClient,
  siteId: number,
  itemCode: string
): Promise<ItemFefoPickRecommendation> {
  await ensureWmsStockLotColumns(client);
  const item = await resolveItemByCodeOrBarcode(client, siteId, itemCode);
  if (!item) return null;

  const rotRow = await client.query<{ rotation_policy: string; is_perishable: boolean }>(
    `SELECT rotation_policy, is_perishable FROM wms_items WHERE item_id = $1::bigint`,
    [item.item_id]
  );
  const rotationPolicy = (rotRow.rows[0]?.rotation_policy || "fifo") as RotationPolicy;
  const isPerishable = Boolean(rotRow.rows[0]?.is_perishable);

  const rows = await client.query<{
    lotId: string;
    lotCode: string;
    manufacturedAt: string | null;
    bestBeforeAt: string | null;
    expiryAt: string | null;
    receivedAt: string | null;
    availableQty: number;
    locationCode: string;
    locationName: string | null;
    warehouseCode: string | null;
    zoneCode: string | null;
  }>(
    `SELECT
       wl.lot_id::text AS "lotId",
       wl.lot_code AS "lotCode",
       wl.manufactured_at AS "manufacturedAt",
       wl.best_before_at AS "bestBeforeAt",
       COALESCE(wl.expiry_at, sl.expiry_at) AS "expiryAt",
       COALESCE(wl.received_at, sl.received_at, sl.created_at) AS "receivedAt",
       COALESCE(sl.available_qty, 0)::float8 AS "availableQty",
       l.location_code AS "locationCode",
       l.display_name AS "locationName",
       w.warehouse_code AS "warehouseCode",
       z.zone_code AS "zoneCode"
     FROM wms_stock_lots sl
     JOIN wms_stock_balances sb ON sb.balance_id = sl.balance_id
     JOIN wms_lots wl ON wl.lot_id = sl.lot_id AND wl.site_id = sb.site_id
     JOIN wms_locations l ON l.location_id = sb.location_id AND l.site_id = sb.site_id
     LEFT JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id AND w.site_id = l.site_id
     LEFT JOIN wms_zones z ON z.zone_id = l.zone_id
     WHERE sb.site_id = $1
       AND sb.item_id = $2::bigint
       AND COALESCE(sl.available_qty, 0) > 0
       AND COALESCE(wl.is_blocked, FALSE) = FALSE
       AND l.location_status_id <> 2
       AND COALESCE(w.warehouse_type, 'MAIN') <> 'PRODUCTION'
       AND COALESCE(w.status_code, 'ACTIVE') = 'ACTIVE'`,
    [siteId, item.item_id]
  );

  const sorted = sortLotsForRotation(
    rows.rows.map((row) => ({
      ...row,
      expiryAt: row.expiryAt,
      manufacturedAt: row.manufacturedAt,
      receivedAt: row.receivedAt,
    })),
    rotationPolicy,
    isPerishable
  );
  const pick = sorted.find((row) => row.availableQty > 0);
  if (!pick) return null;

  return {
    itemCode: item.item_code,
    itemName: item.name,
    rotationPolicy,
    isPerishable,
    locationCode: pick.locationCode,
    locationName: pick.locationName,
    warehouseCode: pick.warehouseCode,
    zoneCode: pick.zoneCode,
    lotId: pick.lotId,
    lotCode: pick.lotCode,
    emissionAtIso: pick.manufacturedAt,
    bestBeforeAt: pick.bestBeforeAt,
    expiryAt: pick.expiryAt,
    receivedAt: pick.receivedAt,
    availableQty: pick.availableQty,
  };
}

export async function issueToProduction(
  client: PoolClient,
  siteId: number,
  p: {
    requestId: string;
    itemCode: string;
    sourceLocationCode: string;
    targetLocationCode: string;
    qty: number;
    recipientName: string;
    lineName: string | null;
    lotCode?: string | null;
    emissionDay?: string | null;
    emissionAtIso?: string | null;
    codeValues?: string[];
  }
) {
  await ensureWmsStockLotColumns(client);
  const item = await resolveItemByCodeOrBarcode(client, siteId, p.itemCode);
  if (!item) {
    throw new WmsHttpError(404, "item not found", "item_not_found");
  }
  const loc = await resolveLocation(client, siteId, p.sourceLocationCode);
  if (!loc) {
    throw new WmsHttpError(404, "source location not found", "location_not_found");
  }
  if (loc.location_status_id === 2) {
    throw new WmsHttpError(409, "source location is blocked", "location_blocked");
  }

  const targetLoc = await resolveLocation(client, siteId, p.targetLocationCode);
  if (!targetLoc) {
    throw new WmsHttpError(404, "target location not found", "target_location_not_found");
  }
  if (targetLoc.location_status_id === 2) {
    throw new WmsHttpError(409, "target location is blocked", "location_blocked");
  }
  if (targetLoc.location_id === loc.location_id) {
    throw new WmsHttpError(
      400,
      "Ячейка «куда» должна отличаться от ячейки «откуда»",
      "issue_same_location"
    );
  }
  await assertWorkshopTargetLocation(client, siteId, targetLoc.location_id);
  await assertWaitingCellAcceptsItemByLocationId(
    client,
    siteId,
    targetLoc.location_id,
    item.item_id,
    item.item_code
  );

  const resolvedLotCode =
    p.lotCode?.trim() ||
    (p.emissionDay?.trim() && p.emissionDay !== "unknown"
      ? buildReceivingLotCode(item.item_code, p.emissionDay.trim())
      : null);

  const fefoPick = await getItemFefoPickRecommendation(client, siteId, item.item_code);
  if (fefoPick && (fefoPick.rotationPolicy === "fefo" || fefoPick.isPerishable)) {
    const sameLocation = fefoPick.locationCode === loc.location_code;
    const sameLot = resolvedLotCode === fefoPick.lotCode;
    if (!resolvedLotCode || !sameLocation || !sameLot) {
      throw new WmsHttpError(
        409,
        `FEFO: сначала выдайте партию ${fefoPick.lotCode} из ячейки ${fefoPick.locationCode} (${fefoPick.availableQty} шт)`,
        !resolvedLotCode ? "fefo_lot_required" : "fefo_violation",
        {
          recommended: fefoPick,
          requested: {
            sourceLocationCode: loc.location_code,
            lotCode: resolvedLotCode,
          },
        }
      );
    }
  }

  let lotId: string | null = null;
  if (resolvedLotCode) {
    const manufacturedAt = p.emissionAtIso ?? undefined;
    lotId = await ensureWmsLot(
      client,
      siteId,
      item.item_id,
      resolvedLotCode,
      `Выдача в цех · ${resolvedLotCode}`,
      manufacturedAt,
      undefined,
      undefined
    );
    if (!lotId) {
      throw new WmsHttpError(500, "lot create failed", "lot_create_failed");
    }
  }

  const inactive = await client.query<{ is_active: boolean }>(
    `SELECT COALESCE(is_active, TRUE) AS is_active FROM wms_items WHERE item_id = $1::bigint`,
    [item.item_id]
  );
  if (inactive.rows[0] && inactive.rows[0].is_active === false) {
    throw new WmsHttpError(409, "номенклатура неактивна", "item_inactive");
  }

  const lineLabel = p.lineName?.trim() || targetLoc.location_code;

  const doc = await client.query<{ document_id: string }>(
    `INSERT INTO wms_documents (
       site_id, document_type_id, document_status_id, request_id,
       source_location_id, target_location_id, recipient_name, line_name, applied_at
     ) VALUES ($1, 6, 3, $2::uuid, $3::bigint, $4::bigint, $5, $6, now())
     RETURNING document_id::text`,
    [siteId, p.requestId, loc.location_id, targetLoc.location_id, p.recipientName, lineLabel]
  );
  const documentId = doc.rows[0].document_id;

  const line = await client.query<{ document_line_id: string }>(
    `INSERT INTO wms_document_lines (
       document_id, line_no, item_id, source_location_id, requested_qty, confirmed_qty, lot_id
     ) VALUES ($1::bigint, 1, $2::bigint, $3::bigint, $4, $4, $5::bigint)
     RETURNING document_line_id::text`,
    [documentId, item.item_id, loc.location_id, p.qty, lotId]
  );
  const documentLineId = line.rows[0].document_line_id;

  await applyIssueToWorkshop(client, {
    siteId,
    itemId: item.item_id,
    fromLocationId: loc.location_id,
    toLocationId: targetLoc.location_id,
    qty: p.qty,
    lotId,
    lotCode: resolvedLotCode,
    movementTypeId: WMS_MOVEMENT_TYPE.issue,
    documentId,
    documentLineId,
    requestId: p.requestId,
    eventType: "issue.to_production",
  });

  const codesMoved = await transferItemCodesToWorkshop(client, {
    siteId,
    itemId: item.item_id,
    sourceLocationId: loc.location_id,
    targetLocationId: targetLoc.location_id,
    qty: p.qty,
    documentId,
    codeValues: p.codeValues,
  });

  await client.query(
    `INSERT INTO wms_operator_issues (document_id, recipient_name, line_name)
     VALUES ($1::bigint, $2, $3)`,
    [documentId, p.recipientName, lineLabel]
  );

  const stock = await fetchBalanceSnapshot(client, siteId, loc.location_id, item.item_id);

  return {
    documentId,
    targetLocationCode: targetLoc.location_code,
    documentType: "issue",
    lotCode: resolvedLotCode,
    markingCodesMoved: codesMoved.movedCount,
    stock,
  };
}
