import type { PoolClient } from "pg";
import {
  normalizeCrptProductGroupCode,
  suggestItemGroupDisplayName,
} from "@/lib/wms/crpt-product-groups";

/** Пустая строка → null (для FK-полей). */
export function normalizeFkCode(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
}

export async function ensureItemGroup(
  client: PoolClient,
  siteId: number,
  groupCode: string,
  displayName?: string | null
): Promise<void> {
  const raw = groupCode.trim();
  if (!raw) return;
  const code = normalizeCrptProductGroupCode(raw) || raw;
  const name =
    (displayName?.trim() && displayName.trim() !== raw
      ? displayName.trim()
      : suggestItemGroupDisplayName(raw, code)) || code;
  await client.query(
    `INSERT INTO wms_item_groups (site_id, group_code, name, is_active, updated_at)
     VALUES ($1, $2, $3, TRUE, now())
     ON CONFLICT (site_id, group_code)
     DO UPDATE SET
       name = CASE
         WHEN EXCLUDED.name ~ '[а-яё]' AND COALESCE(wms_item_groups.name, '') !~ '[а-яё]' THEN EXCLUDED.name
         WHEN COALESCE(wms_item_groups.name, '') ~ '[а-яё]' THEN wms_item_groups.name
         WHEN COALESCE(wms_item_groups.name, '') = '' OR lower(COALESCE(wms_item_groups.name, '')) = lower(wms_item_groups.group_code)
           THEN EXCLUDED.name
         ELSE wms_item_groups.name
       END,
       is_active = TRUE,
       updated_at = now()`,
    [siteId, code, name]
  );
}

export async function ensureItemClass(
  client: PoolClient,
  siteId: number,
  classCode: string,
  groupCode: string | null,
  displayName?: string | null
): Promise<void> {
  const code = classCode.trim();
  if (!code) return;
  const grp = groupCode?.trim() || null;
  if (grp) await ensureItemGroup(client, siteId, grp, grp);
  const name = (displayName ?? code).trim() || code;
  await client.query(
    `INSERT INTO wms_item_classes (site_id, class_code, group_code, name, is_active, updated_at)
     VALUES ($1, $2, $3, $4, TRUE, now())
     ON CONFLICT (site_id, class_code)
     DO UPDATE SET
       group_code = EXCLUDED.group_code,
       name = EXCLUDED.name,
       is_active = TRUE,
       updated_at = now()`,
    [siteId, code, grp, name]
  );
}

/** Сбрасывает FK-поля, если справочник не найден (защита от старых битых данных). */
export async function sanitizeItemMasterFkCodes(
  client: PoolClient,
  siteId: number,
  itemGroupCode: string | null,
  itemClassCode: string | null
): Promise<{ itemGroupCode: string | null; itemClassCode: string | null }> {
  let group = itemGroupCode;
  let cls = itemClassCode;

  if (group) {
    const g = await client.query<{ ok: number }>(
      `SELECT 1 AS ok FROM wms_item_groups WHERE site_id = $1 AND group_code = $2`,
      [siteId, group]
    );
    if (!g.rows[0]) group = null;
  }

  if (cls) {
    const c = await client.query<{ ok: number }>(
      `SELECT 1 AS ok FROM wms_item_classes WHERE site_id = $1 AND class_code = $2`,
      [siteId, cls]
    );
    if (!c.rows[0]) cls = null;
  }

  return { itemGroupCode: group, itemClassCode: cls };
}
