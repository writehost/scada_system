import type { PoolClient } from "pg";
import { WmsHttpError } from "@/lib/wms/errors";
import { ensureItemClass, ensureItemGroup } from "@/lib/wms/item-master-refs";
import { isBottledDrinkName, isStickerOrLabelName } from "@/lib/wms/physical-profile";
import { withStickerNamePrefix } from "@/lib/wms/sticker-item-name";
import {
  getStickersGroupShelfLifeDays,
  seedStickersGroupShelfLifeDefault,
} from "@/lib/wms/stickers-group-shelf-life";

const STICKERS_WMS_GROUP = "stickers";
const STICKERS_WMS_GROUP_LABEL = "Стикеры";
const STICKERS_ITEM_CLASS = "S1";
const STICKERS_ITEM_CLASS_LABEL = "S1 · Мелкоштучный";
const STICKERS_ITEM_TYPE_CODE = "materials";

export function normalizePrintedGtin(raw: string): string | null {
  const gtin = String(raw || "").replace(/\D/g, "").padStart(14, "0").slice(-14);
  if (!/^\d{14}$/.test(gtin) || gtin === "00000000000000") return null;
  return gtin;
}

function normKey(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/ё/g, "е") : "";
}

async function ensureStickersMasterRefs(client: PoolClient, siteId: number): Promise<void> {
  await ensureItemGroup(client, siteId, STICKERS_WMS_GROUP, STICKERS_WMS_GROUP_LABEL);
  await seedStickersGroupShelfLifeDefault(client, siteId);
  await ensureItemClass(
    client,
    siteId,
    STICKERS_ITEM_CLASS,
    STICKERS_WMS_GROUP,
    STICKERS_ITEM_CLASS_LABEL
  );
}

async function findItemByGtin(
  client: PoolClient,
  siteId: number,
  gtin: string
): Promise<{
  item_id: string;
  item_code: string;
  name: string;
  shelf_life_days: number | null;
  product_group: string | null;
  item_group_code: string | null;
  item_class_code: string | null;
  item_type_code: string | null;
} | null> {
  const r = await client.query<{
    item_id: string;
    item_code: string;
    name: string;
    shelf_life_days: number | null;
    product_group: string | null;
    item_group_code: string | null;
    item_class_code: string | null;
    item_type_code: string | null;
  }>(
    `SELECT
       i.item_id::text AS item_id,
       i.item_code,
       i.name,
       i.shelf_life_days,
       i.product_group,
       i.item_group_code,
       i.item_class_code,
       i.item_type_code
     FROM wms_items i
     LEFT JOIN wms_item_barcodes b ON b.item_id = i.item_id
     WHERE i.site_id = $1
       AND (
         i.item_code = $2
         OR i.item_code = $3
         OR b.barcode = $2
         OR b.barcode = $3
         OR i.nomenclature LIKE '%' || $2 || '%'
         OR i.nomenclature LIKE '%(01)' || $2 || '%'
         OR (i.item_attrs_json->'nomenclature'->>'gtin') = $2
       )
     ORDER BY
       CASE
         WHEN i.item_code = $3 THEN 0
         WHEN i.name ~* '^(стикер|этикет)' THEN 1
         WHEN coalesce(i.item_group_code, i.product_group, '') = 'stickers' THEN 2
         ELSE 3
       END
     LIMIT 1`,
    [siteId, gtin, `STK-${gtin}`]
  );
  const row = r.rows[0] ?? null;
  if (!row) return null;
  if (isBottledDrinkName(row.name) && !isStickerOrLabelName(row.name)) return null;
  return row;
}

/**
 * Карточка стикера по GTIN печатного заказа: имя «Стикер …», группа stickers, тип materials.
 * Без запроса в ЧЗ — эмиссия уже есть в заказе.
 */
export async function ensurePrintedStickerItem(
  client: PoolClient,
  siteId: number,
  input: { gtin: string; productName: string }
): Promise<{ itemId: string; itemCode: string; name: string; created: boolean }> {
  const gtin = normalizePrintedGtin(input.gtin);
  if (!gtin) {
    throw new WmsHttpError(400, "Не удалось определить GTIN для карточки стикера", "printed_sticker_no_gtin");
  }
  const name = withStickerNamePrefix(input.productName || `GTIN ${gtin}`);
  await ensureStickersMasterRefs(client, siteId);
  const shelfLifeDays = await getStickersGroupShelfLifeDays(client, siteId);
  const existing = await findItemByGtin(client, siteId, gtin);
  if (existing) {
    const needsReclass =
      normKey(existing.item_group_code || existing.product_group) !== STICKERS_WMS_GROUP ||
      normKey(existing.item_class_code) !== STICKERS_ITEM_CLASS.toLowerCase() ||
      normKey(existing.item_type_code) !== STICKERS_ITEM_TYPE_CODE;
    const needsNameFix = existing.name !== name;
    const needsShelf = existing.shelf_life_days !== shelfLifeDays;
    if (needsReclass || needsNameFix || needsShelf) {
      await client.query(
        `UPDATE wms_items
         SET name = $1,
             material_type = $2,
             product_group = $3,
             item_group_code = $3,
             item_class_code = $4,
             item_type_code = $5,
             shelf_life_days = COALESCE(shelf_life_days, $6),
             updated_at = now()
         WHERE item_id = $7::bigint`,
        [
          name,
          STICKERS_WMS_GROUP_LABEL,
          STICKERS_WMS_GROUP,
          STICKERS_ITEM_CLASS,
          STICKERS_ITEM_TYPE_CODE,
          shelfLifeDays,
          existing.item_id,
        ]
      );
    }
    return {
      itemId: existing.item_id,
      itemCode: existing.item_code,
      name,
      created: false,
    };
  }

  const itemCode = `STK-${gtin}`;
  const sku = `${gtin.slice(0, 11)}-${gtin.slice(11)}`;
  const itemAttrs = {
    nomenclature: {
      gtin,
      productGroup: STICKERS_WMS_GROUP,
      packagingKind: "unit",
      requiresCzCheck: true,
      expirationControl: true,
      blockExpired: true,
      source: "printed-label-order",
    },
  };
  const up = await client.query<{ item_id: string }>(
    `INSERT INTO wms_items (
       site_id, item_code, sku, name, material_type, product_group, item_group_code,
       item_class_code, item_type_code, item_subgroup, nomenclature, item_attrs_json, uom_code,
       is_marked, is_perishable, rotation_policy, shelf_life_days, expiry_warning_days,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, 'unit', $10, $11::jsonb, 'pcs',
       TRUE, TRUE, 'fefo', $12, 0,
       now(), now()
     )
     ON CONFLICT (site_id, item_code) DO UPDATE SET
       name = EXCLUDED.name,
       material_type = EXCLUDED.material_type,
       product_group = EXCLUDED.product_group,
       item_group_code = EXCLUDED.item_group_code,
       item_class_code = EXCLUDED.item_class_code,
       item_type_code = EXCLUDED.item_type_code,
       updated_at = now()
     RETURNING item_id::text AS item_id`,
    [
      siteId,
      itemCode,
      sku,
      name,
      STICKERS_WMS_GROUP_LABEL,
      STICKERS_WMS_GROUP,
      STICKERS_WMS_GROUP,
      STICKERS_ITEM_CLASS,
      STICKERS_ITEM_TYPE_CODE,
      `(01)${gtin}`,
      JSON.stringify(itemAttrs),
      shelfLifeDays,
    ]
  );
  const itemId = up.rows[0]!.item_id;
  await client.query(
    `INSERT INTO wms_item_barcodes (item_id, barcode, barcode_type, is_primary, created_at)
     VALUES ($1::bigint, $2, 'sku', TRUE, now())
     ON CONFLICT (barcode) DO NOTHING`,
    [itemId, itemCode]
  );
  return { itemId, itemCode, name, created: true };
}
