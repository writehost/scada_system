import type { PoolClient } from "pg";
import { getSiteId, resolveItemByCodeOrBarcode } from "@/lib/wms/resolve";
import { parseSlotProfileFromAttrs } from "@/lib/wms/storage-slot";
import { workshopLocationWhere } from "@/lib/wms/workshop-directory";

export type WorkshopCellSuggestRow = {
  locationCode: string;
  displayName: string;
  zoneCode: string;
  score: number;
  reasons: string[];
  preferredMatch: boolean;
  hasSameItem: boolean;
  isEmpty: boolean;
  inProductionQty: number;
  rememberNomenclature: boolean;
};

export type WorkshopCellSuggestResult = {
  itemCode: string;
  itemName: string;
  suggestions: WorkshopCellSuggestRow[];
};

const SCORE = {
  preferred: 100,
  sameItem: 45,
  empty: 12,
  blockedOther: -120,
} as const;

export async function suggestWorkshopCellsForItem(
  client: PoolClient,
  siteCode: string,
  itemCode: string,
  limit = 10
): Promise<WorkshopCellSuggestResult | null> {
  const siteId = await getSiteId(client, siteCode);
  if (siteId == null) return null;

  const item = await resolveItemByCodeOrBarcode(client, siteId, itemCode.trim());
  if (!item) return null;

  const rows = await client.query<{
    locationCode: string;
    displayName: string;
    zoneCode: string;
    locationStatusId: number;
    locationAttrsJson: unknown;
    inProductionQty: string;
    hasSameItem: boolean;
    skuCount: number;
  }>(
    `SELECT
       l.location_code AS "locationCode",
       l.display_name AS "displayName",
       z.zone_code AS "zoneCode",
       l.location_status_id AS "locationStatusId",
       l.location_attrs_json AS "locationAttrsJson",
       COALESCE(SUM(
         COALESCE(sb.in_production_qty, 0)
         + COALESCE(sb.available_qty, 0)
         + COALESCE(sb.reserved_qty, 0)
       ), 0)::float8 AS "inProductionQty",
       COALESCE(BOOL_OR(sb.item_id = $2::bigint), FALSE) AS "hasSameItem",
       COUNT(DISTINCT sb.item_id) FILTER (
         WHERE (
           COALESCE(sb.in_production_qty, 0)
           + COALESCE(sb.available_qty, 0)
           + COALESCE(sb.reserved_qty, 0)
         ) > 0
       )::int AS "skuCount"
     FROM wms_locations l
     JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id AND w.site_id = l.site_id
     JOIN wms_zones z ON z.zone_id = l.zone_id
     LEFT JOIN wms_stock_balances sb ON sb.location_id = l.location_id AND sb.site_id = l.site_id
     WHERE l.site_id = $1
       AND ${workshopLocationWhere("w", "z")}
     GROUP BY l.location_id, l.location_code, l.display_name, z.zone_code, l.location_status_id, l.location_attrs_json
     ORDER BY l.location_code`,
    [siteId, item.item_id]
  );

  const suggestions: WorkshopCellSuggestRow[] = [];

  for (const row of rows.rows) {
    if (row.locationStatusId === 2) continue;

    const profile = parseSlotProfileFromAttrs(row.locationAttrsJson);
    const remember = Boolean(profile.rememberNomenclature);
    const preferredCode = (profile.preferredItemCode ?? "").trim();
    const preferredMatch = remember && preferredCode !== "" && preferredCode === item.item_code;
    const hasSameItem = Boolean(row.hasSameItem);
    const qty = Number(row.inProductionQty) || 0;
    const isEmpty = row.skuCount === 0 && qty <= 0;
    const reasons: string[] = [];
    let score = profile.priority ?? 0;

    if (remember && preferredCode && preferredCode !== item.item_code && !hasSameItem) {
      score += SCORE.blockedOther;
      reasons.push(`Закреплена за ${profile.preferredItemName || preferredCode}`);
      suggestions.push({
        locationCode: row.locationCode,
        displayName: row.displayName || row.locationCode,
        zoneCode: row.zoneCode,
        score,
        reasons,
        preferredMatch: false,
        hasSameItem,
        isEmpty,
        inProductionQty: qty,
        rememberNomenclature: remember,
      });
      continue;
    }

    if (preferredMatch) {
      score += SCORE.preferred;
      reasons.push(`Закреплённая номенклатура: ${profile.preferredItemName || preferredCode}`);
    }
    if (hasSameItem) {
      score += SCORE.sameItem;
      reasons.push("Уже лежала эта номенклатура");
    }
    if (isEmpty && remember) {
      score += SCORE.empty;
      reasons.push("Пустая ячейка с закреплением");
    } else if (isEmpty) {
      score += SCORE.empty / 2;
      reasons.push("Пустая ячейка");
    }

    if (!remember && !hasSameItem && !isEmpty) continue;

    suggestions.push({
      locationCode: row.locationCode,
      displayName: row.displayName || row.locationCode,
      zoneCode: row.zoneCode,
      score,
      reasons,
      preferredMatch,
      hasSameItem,
      isEmpty,
      inProductionQty: qty,
      rememberNomenclature: remember,
    });
  }

  suggestions.sort((a, b) => b.score - a.score);

  return {
    itemCode: item.item_code,
    itemName: item.name,
    suggestions: suggestions.slice(0, Math.min(Math.max(limit, 1), 20)),
  };
}
