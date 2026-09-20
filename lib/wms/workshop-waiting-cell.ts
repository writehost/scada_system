import type { PoolClient } from "pg";
import { WmsHttpError } from "@/lib/wms/errors";
import {
  parseSlotProfileFromAttrs,
  type StorageSlotProfile,
} from "@/lib/wms/storage-slot";
import {
  compareSequentialCellCodes,
  sortSequentialCellCodes,
} from "@/lib/storage-slot-ui";

export { compareSequentialCellCodes, sortSequentialCellCodes };

export const WAITING_STORAGE_PURPOSE = "WAITING";

export const DEFAULT_RECEIVING_CATEGORY_CODE = "stickers";

export const DEFAULT_STICKERS_ITEM_GROUPS = ["softdrinks", "water"];

export function buildWaitingSlotProfile(input?: {
  receivingCategoryCode?: string | null;
  allowedItemGroupCodes?: string[] | null;
  materialType?: string | null;
}): StorageSlotProfile {
  const category = input?.receivingCategoryCode?.trim() || DEFAULT_RECEIVING_CATEGORY_CODE;
  const groups =
    input?.allowedItemGroupCodes?.map((g) => g.trim()).filter(Boolean) ??
    DEFAULT_STICKERS_ITEM_GROUPS;
  return {
    storagePurpose: WAITING_STORAGE_PURPOSE,
    materialType: input?.materialType?.trim() || "ST",
    processType: "STORE",
    stickerShape: "ANY",
    productGroup: "ANY",
    receivingCategoryCode: category,
    allowedItemGroupCodes: groups,
    allowMixedNomenclature: false,
    allowMixedBatches: true,
  };
}

export const DEFAULT_WAITING_SLOT_PROFILE: StorageSlotProfile = buildWaitingSlotProfile();

/** Зона цеха по умолчанию: LINE, не RECV (приёмка). */
export function defaultWorkshopZoneCode(zones: Array<{ zoneCode: string }>): string {
  for (const prefer of ["LINE", "WAIT"]) {
    const hit = zones.find((z) => z.zoneCode.trim().toUpperCase() === prefer);
    if (hit) return hit.zoneCode;
  }
  const nonRecv = zones.find((z) => z.zoneCode.trim().toUpperCase() !== "RECV");
  return nonRecv?.zoneCode ?? zones[0]?.zoneCode ?? "LINE";
}

export function isWaitingPointCell(
  profile: StorageSlotProfile | null | undefined
): boolean {
  return (profile?.storagePurpose ?? "").toUpperCase() === WAITING_STORAGE_PURPOSE;
}

export type WorkshopCellOccupancy = {
  isEmpty: boolean;
  itemIds: string[];
  primaryItemCode: string | null;
  primaryItemName: string | null;
  inProductionQty: number;
  codeCount: number;
};

export async function getWorkshopCellOccupancy(
  client: PoolClient,
  siteId: number,
  locationId: string
): Promise<WorkshopCellOccupancy> {
  const stockR = await client.query<{
    itemId: string;
    itemCode: string;
    itemName: string;
    qty: string;
  }>(
    `SELECT
       sb.item_id::text AS "itemId",
       i.item_code AS "itemCode",
       i.name AS "itemName",
       (
         COALESCE(sb.in_production_qty, 0)
         + COALESCE(sb.available_qty, 0)
         + COALESCE(sb.reserved_qty, 0)
       )::float8 AS qty
     FROM wms_stock_balances sb
     JOIN wms_items i ON i.item_id = sb.item_id AND i.site_id = sb.site_id
     WHERE sb.site_id = $1
       AND sb.location_id = $2::bigint
       AND (
         COALESCE(sb.in_production_qty, 0)
         + COALESCE(sb.available_qty, 0)
         + COALESCE(sb.reserved_qty, 0)
       ) > 0
     ORDER BY sb.in_production_qty DESC, sb.available_qty DESC`,
    [siteId, locationId]
  );

  const codeR = await client.query<{
    itemId: string;
    itemCode: string;
    itemName: string;
    cnt: string;
  }>(
    `SELECT
       i.item_id::text AS "itemId",
       i.item_code AS "itemCode",
       i.name AS "itemName",
       COUNT(*)::text AS cnt
     FROM wms_item_codes wc
     JOIN wms_items i ON i.item_id = wc.item_id AND i.site_id = wc.current_site_id
     WHERE wc.current_site_id = $1
       AND wc.current_location_id = $2::bigint
       AND wc.unlinked_at IS NULL
     GROUP BY i.item_id, i.item_code, i.name`,
    [siteId, locationId]
  );

  const itemIds = new Set<string>();
  for (const row of stockR.rows) itemIds.add(row.itemId);
  for (const row of codeR.rows) itemIds.add(row.itemId);

  const codeCount = codeR.rows.reduce((sum, row) => sum + Number(row.cnt ?? "0"), 0);
  const inProductionQty = stockR.rows.reduce(
    (sum, row) => sum + Number(row.qty ?? "0"),
    0
  );

  const primary =
    stockR.rows[0] ??
    (codeR.rows.length === 1
      ? { itemCode: codeR.rows[0].itemCode, itemName: codeR.rows[0].itemName }
      : null);

  return {
    isEmpty: itemIds.size === 0 && codeCount === 0,
    itemIds: [...itemIds],
    primaryItemCode: primary?.itemCode ?? null,
    primaryItemName: primary?.itemName ?? null,
    inProductionQty,
    codeCount,
  };
}

export async function assertWaitingCellAcceptsItemByLocationId(
  client: PoolClient,
  siteId: number,
  locationId: string,
  itemId: string,
  itemCode: string
): Promise<void> {
  const attrsR = await client.query<{ location_attrs_json: unknown }>(
    `SELECT location_attrs_json
     FROM wms_locations
     WHERE site_id = $1 AND location_id = $2::bigint`,
    [siteId, locationId]
  );
  const profile = parseSlotProfileFromAttrs(attrsR.rows[0]?.location_attrs_json);
  if (!isWaitingPointCell(profile)) return;

  const occ = await getWorkshopCellOccupancy(client, siteId, locationId);
  if (occ.isEmpty) return;

  if (occ.itemIds.length > 1) {
    throw new WmsHttpError(
      409,
      "Точка ожидания занята несколькими номенклатурами — сначала освободите ячейку",
      "waiting_cell_mixed"
    );
  }

  if (!occ.itemIds.includes(itemId)) {
    const occupied = occ.primaryItemName ?? occ.primaryItemCode ?? "другая";
    throw new WmsHttpError(
      409,
      `Точка ожидания занята «${occupied}». Положите ту же номенклатуру (${itemCode}) или выберите пустую ячейку.`,
      "waiting_cell_wrong_item"
    );
  }
}

const RANDOM_SUFFIX_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomWaitingCellSuffix(length = 4): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += RANDOM_SUFFIX_CHARS[Math.floor(Math.random() * RANDOM_SUFFIX_CHARS.length)];
  }
  return out;
}

const WAITING_NAME_TEMPLATES = ["Ожидание", "Буфер", "Пункт", "Зона", "Стол"];

export function randomWaitingDisplayName(prefix?: string): string {
  const base =
    prefix?.trim() ||
    WAITING_NAME_TEMPLATES[Math.floor(Math.random() * WAITING_NAME_TEMPLATES.length)];
  const n = Math.floor(Math.random() * 90) + 10;
  return `${base} ${n}`;
}

export const MAX_WAITING_BATCH_COUNT = 200;

export function sanitizeWaitingCodePrefix(raw: string): string {
  const p = raw.trim().toUpperCase().replace(/\s+/g, "-");
  if (!p) return "A";
  if (!/^[0-9A-ZА-ЯЁ._/-]+$/u.test(p)) {
    throw new Error("prefix contains unsupported characters");
  }
  return p.slice(0, 24);
}

export function buildSequentialWaitingCellCode(prefix: string, index: number): string {
  return `${prefix}-${index}`;
}

export function sequentialWaitingDisplayName(prefix: string, index: number): string {
  return `${prefix}-${index}`;
}

export type WaitingCellHandoff = {
  status: "handed_to_production";
  lineCode: string;
  batchLabel: string | null;
  itemCode: string | null;
  planId?: string | null;
  planCode?: string | null;
  planProductName?: string | null;
  handedAt: string;
};

export function parseWaitingHandoffFromAttrs(attrs: unknown): WaitingCellHandoff | null {
  if (!attrs || typeof attrs !== "object") return null;
  const raw = (attrs as Record<string, unknown>).waitingHandoff;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.status !== "handed_to_production") return null;
  const lineCode = typeof o.lineCode === "string" ? o.lineCode.trim() : "";
  if (!lineCode) return null;
  return {
    status: "handed_to_production",
    lineCode,
    batchLabel: typeof o.batchLabel === "string" ? o.batchLabel.trim() || null : null,
    itemCode: typeof o.itemCode === "string" ? o.itemCode.trim() || null : null,
    planId: typeof o.planId === "string" ? o.planId.trim() || null : null,
    planCode: typeof o.planCode === "string" ? o.planCode.trim() || null : null,
    planProductName:
      typeof o.planProductName === "string" ? o.planProductName.trim() || null : null,
    handedAt: typeof o.handedAt === "string" ? o.handedAt : new Date().toISOString(),
  };
}

/** Ячейки цеха с остатком без WAITING (A-1 после приёмки и т.п.) — поднимаем профиль. */
export function ensureWaitingSlotProfileInAttrs(attrs: unknown): Record<string, unknown> {
  const base = attrs && typeof attrs === "object" ? { ...(attrs as Record<string, unknown>) } : {};
  const existing = parseSlotProfileFromAttrs(base);
  if (isWaitingPointCell(existing)) return base;
  base.slotProfile = {
    ...buildWaitingSlotProfile({
      receivingCategoryCode: existing?.receivingCategoryCode,
      allowedItemGroupCodes: existing?.allowedItemGroupCodes ?? null,
      materialType: existing?.materialType,
    }),
    ...(existing ?? {}),
    storagePurpose: WAITING_STORAGE_PURPOSE,
  };
  return base;
}

export function mergeWaitingHandoffIntoAttrs(
  attrs: unknown,
  handoff: WaitingCellHandoff
): Record<string, unknown> {
  const base = ensureWaitingSlotProfileInAttrs(attrs);
  return { ...base, waitingHandoff: handoff };
}

export function clearWaitingHandoffFromAttrs(attrs: unknown): Record<string, unknown> {
  const base = attrs && typeof attrs === "object" ? { ...(attrs as Record<string, unknown>) } : {};
  const { waitingHandoff: _removed, ...rest } = base;
  return rest;
}

export function isWaitingCellEffectivelyEmpty(loc: {
  isEmpty?: boolean | null;
  inProductionQty?: number | null;
  availableQty?: number | null;
}): boolean {
  if (loc.isEmpty === true) return true;
  const onHand = (loc.inProductionQty ?? 0) + (loc.availableQty ?? 0);
  return onHand <= 0;
}

/**
 * Поиск кода ячейки: «A-10» не должен цеплять «A-100».
 * Совпадения: точное, префикс с разделителем (A-10-1), или подстрока без продолжения цифрой.
 */
export function locationCodeMatchesQuery(code: string, query: string): boolean {
  const c = code.trim().toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (c === q) return true;
  if (c.startsWith(`${q}-`) || c.startsWith(`${q}.`) || c.startsWith(`${q}/`)) return true;
  const idx = c.indexOf(q);
  if (idx < 0) return false;
  const after = idx + q.length < c.length ? c[idx + q.length]! : "";
  if (/\d/.test(q[q.length - 1]!) && /\d/.test(after)) return false;
  const before = idx > 0 ? c[idx - 1]! : "";
  if (/[a-z0-9]/.test(before) && /[a-z0-9]/.test(q[0]!)) return false;
  return true;
}
