import type { PoolClient } from "pg";
import { ensureWmsStockLotColumns } from "@/lib/wms/ensure-stock-lot-columns";
import { getSiteId, resolveItemByCodeOrBarcode } from "@/lib/wms/resolve";
import { sortLotsForRotation, type RotationPolicy } from "@/lib/wms/lot-rotation";

type PickRow = {
  locationCode: string;
  locationName: string | null;
  warehouseCode: string | null;
  zoneCode: string | null;
  locationAttrsJson: unknown;
  lotId: string;
  lotCode: string;
  manufacturedAt: string | null;
  bestBeforeAt: string | null;
  expiryAt: string | null;
  receivedAt: string | null;
  availableQty: number;
};

function readAttr(attrs: unknown, key: string): string | null {
  if (!attrs || typeof attrs !== "object") return null;
  const value = (attrs as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function fallbackRack(locationCode: string): string {
  const match = locationCode.match(/(?:^|-)(\d+)(?:-|$)/);
  return match?.[1] ?? "—";
}

function fallbackShelf(locationCode: string): string {
  const match = locationCode.match(/ПОЛКА[-_ ]?(\d+)/i) ?? locationCode.match(/SHELF[-_ ]?(\d+)/i);
  return match?.[1] ?? "—";
}

export type PosPickPlanResult = {
  item: {
    itemCode: string;
    itemName: string;
    rotationPolicy: RotationPolicy;
    isPerishable: boolean;
  };
  requestedQty: number;
  totalAvailable: number;
  enough: boolean;
  plan: Array<{
    locationCode: string;
    locationName: string | null;
    warehouseCode: string | null;
    zoneCode: string | null;
    rack: string;
    shelf: string;
    address: string;
    lotId: string;
    lotCode: string;
    emissionAtIso: string | null;
    bestBeforeAt: string | null;
    expiryAt: string | null;
    receivedAt: string | null;
    availableQty: number;
    takeQty: number;
    selected: boolean;
  }>;
};

export async function buildPosPickPlan(
  client: PoolClient,
  siteCode: string,
  itemCode: string,
  requestedQty: number
): Promise<PosPickPlanResult | null> {
  await ensureWmsStockLotColumns(client);
  const siteId = await getSiteId(client, siteCode);
  if (siteId == null) return null;

  const item = await resolveItemByCodeOrBarcode(client, siteId, itemCode);
  if (!item) return null;

  const rot = await client.query<{ rotation_policy: string; is_perishable: boolean }>(
    `SELECT rotation_policy, is_perishable FROM wms_items WHERE item_id = $1::bigint`,
    [item.item_id]
  );
  const rotationPolicy = (rot.rows[0]?.rotation_policy || "fifo") as RotationPolicy;
  const isPerishable = Boolean(rot.rows[0]?.is_perishable);

  const rows = await client.query<PickRow>(
    `SELECT
       l.location_code AS "locationCode",
       l.display_name AS "locationName",
       w.warehouse_code AS "warehouseCode",
       z.zone_code AS "zoneCode",
       l.location_attrs_json AS "locationAttrsJson",
       wl.lot_id::text AS "lotId",
       wl.lot_code AS "lotCode",
       wl.manufactured_at AS "manufacturedAt",
       wl.best_before_at AS "bestBeforeAt",
       COALESCE(wl.expiry_at, sl.expiry_at) AS "expiryAt",
       COALESCE(wl.received_at, sl.received_at, sl.created_at) AS "receivedAt",
       COALESCE(sl.available_qty, 0)::float8 AS "availableQty"
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

  let remaining = requestedQty;
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
  const plan = sorted.map((row) => {
    const takeQty = remaining > 0 ? Math.min(row.availableQty, remaining) : 0;
    remaining -= takeQty;
    return {
      locationCode: row.locationCode,
      locationName: row.locationName,
      warehouseCode: row.warehouseCode,
      zoneCode: row.zoneCode,
      rack: readAttr(row.locationAttrsJson, "rack") ?? fallbackRack(row.locationCode),
      shelf: readAttr(row.locationAttrsJson, "shelf") ?? fallbackShelf(row.locationCode),
      address: row.locationCode,
      lotId: row.lotId,
      lotCode: row.lotCode,
      emissionAtIso: row.manufacturedAt,
      bestBeforeAt: row.bestBeforeAt,
      expiryAt: row.expiryAt,
      receivedAt: row.receivedAt,
      availableQty: row.availableQty,
      takeQty,
      selected: takeQty > 0,
    };
  });

  const totalAvailable = sorted.reduce((sum, row) => sum + Number(row.availableQty || 0), 0);
  return {
    item: {
      itemCode: item.item_code,
      itemName: item.name,
      rotationPolicy,
      isPerishable,
    },
    requestedQty,
    totalAvailable,
    enough: requestedQty <= 0 || totalAvailable + 1e-9 >= requestedQty,
    plan,
  };
}
