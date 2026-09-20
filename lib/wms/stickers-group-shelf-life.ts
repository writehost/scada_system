import type { PoolClient } from "pg";
import { DEFAULT_STICKER_SHELF_LIFE_DAYS } from "@/lib/wms/expiry-sticker";

export const STICKERS_ITEM_GROUP_CODE = "stickers";
/** Устаревшее значение при автосоздании номенклатуры стикеров. */
export const LEGACY_STICKER_SHELF_LIFE_DAYS = 30;

/**
 * DDL и посев значения по умолчанию нужны один раз, а справочник групп читается
 * на каждой загрузке номенклатуры. Держим отметку в памяти процесса, чтобы не
 * платить лишние round-trip к базе на заводе и не брать блокировку на таблицу.
 */
let shelfLifeColumnReady = false;
const shelfLifeSeededSites = new Set<number>();

export async function ensureItemGroupsShelfLifeColumn(client: PoolClient): Promise<void> {
  if (shelfLifeColumnReady) return;
  await client.query(
    `ALTER TABLE wms_item_groups ADD COLUMN IF NOT EXISTS default_shelf_life_days INT`
  );
  shelfLifeColumnReady = true;
}

export async function getItemGroupDefaultShelfLifeDays(
  client: PoolClient,
  siteId: number,
  groupCode: string
): Promise<number | null> {
  await ensureItemGroupsShelfLifeColumn(client);
  const r = await client.query<{ default_shelf_life_days: number | null }>(
    `SELECT default_shelf_life_days
     FROM wms_item_groups
     WHERE site_id = $1 AND group_code = $2`,
    [siteId, groupCode]
  );
  const v = r.rows[0]?.default_shelf_life_days;
  if (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0) return null;
  return Math.trunc(Number(v));
}

export async function getStickersGroupShelfLifeDays(
  client: PoolClient,
  siteId: number
): Promise<number> {
  const fromGroup = await getItemGroupDefaultShelfLifeDays(
    client,
    siteId,
    STICKERS_ITEM_GROUP_CODE
  );
  return fromGroup ?? DEFAULT_STICKER_SHELF_LIFE_DAYS;
}

export async function seedStickersGroupShelfLifeDefault(
  client: PoolClient,
  siteId: number
): Promise<void> {
  if (shelfLifeSeededSites.has(siteId)) return;
  await ensureItemGroupsShelfLifeColumn(client);
  shelfLifeSeededSites.add(siteId);
  await client.query(
    `UPDATE wms_item_groups
     SET default_shelf_life_days = $3, updated_at = now()
     WHERE site_id = $1 AND group_code = $2 AND default_shelf_life_days IS NULL`,
    [siteId, STICKERS_ITEM_GROUP_CODE, DEFAULT_STICKER_SHELF_LIFE_DAYS]
  );
}

export async function applyGroupShelfLifeToItems(
  client: PoolClient,
  siteId: number,
  groupCode: string,
  shelfLifeDays: number
): Promise<number> {
  const days = Math.max(1, Math.trunc(shelfLifeDays));
  const r = await client.query<{ count: string }>(
    `WITH upd AS (
       UPDATE wms_items
       SET shelf_life_days = $3, updated_at = now()
       WHERE site_id = $1
         AND (item_group_code = $2 OR product_group = $2)
       RETURNING item_id
     )
     SELECT COUNT(*)::text AS count FROM upd`,
    [siteId, groupCode, days]
  );
  return Number(r.rows[0]?.count ?? 0);
}
