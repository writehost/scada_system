import type { PoolClient } from "pg"
import { FG_WAREHOUSE_CODE } from "@/lib/wms/fg-plan-location-codes"

const LABEL_NAME_RE = /^(стикер|этикетка)\b/i
const DRINK_NAME_RE = /^(напиток|вода|сок)\b/i

export function isLabelCardName(name: string | null | undefined): boolean {
  return LABEL_NAME_RE.test(String(name || "").trim())
}

export function productNameFromLabelCard(name: string): string {
  return String(name || "")
    .trim()
    .replace(/^(стикер|этикетка)\s+/i, "")
    .trim()
}

/** Коммерческий GTIN (13/14 цифр). Внутренние коды 1С вида 00-00001029 не считаем GTIN. */
export function commercialGtin(raw: string | null | undefined): string | null {
  const d = String(raw || "").replace(/\D/g, "")
  if (d.length !== 13 && d.length !== 14) return null
  const g = d.padStart(14, "0")
  if (g === "00000000000000") return null
  if (/^0000/.test(g)) return null
  return g
}

type LabelRow = {
  itemId: string
  itemCode: string
  name: string
  sku: string | null
  gtin: string | null
  shelfLifeDays: number | null
}

async function findLabelCards(
  client: PoolClient,
  siteId: number,
  query: string
): Promise<LabelRow[]> {
  const q = query.trim()
  if (q.length < 3) return []
  const r = await client.query<LabelRow>(
    `
    SELECT
      i.item_id::text AS "itemId",
      i.item_code AS "itemCode",
      i.name,
      i.sku,
      COALESCE(
        NULLIF(i.item_attrs_json->'nomenclature'->>'gtin', ''),
        CASE WHEN i.item_code ~ '^[0-9]{13,14}$' THEN lpad(i.item_code, 14, '0') END,
        CASE WHEN i.item_code ~ '^FG-[0-9]{13,14}$' THEN lpad(substr(i.item_code, 4), 14, '0') END
      ) AS gtin,
      i.shelf_life_days AS "shelfLifeDays"
    FROM wms_items i
    WHERE i.site_id = $1
      AND i.is_active
      AND (
        i.name ~* '^(стикер|этикетка)\\b'
        OR COALESCE(i.item_group_code, i.product_group, '') IN ('stickers', 'labels')
        OR COALESCE(i.item_type_code, '') = 'stickers'
      )
      AND (
        i.name ILIKE $2
        OR i.item_code ILIKE $2
        OR COALESCE(i.sku, '') ILIKE $2
      )
    ORDER BY i.item_id DESC
    LIMIT 20
    `,
    [siteId, `%${q}%`]
  )
  return r.rows
}

async function findExistingFg(
  client: PoolClient,
  siteId: number,
  gtin: string,
  productName: string
): Promise<{ itemCode: string } | null> {
  const gtin13 = gtin ? gtin.replace(/^0/, "") : ""
  const r = await client.query<{ itemCode: string }>(
    `SELECT i.item_code AS "itemCode"
     FROM wms_items i
     WHERE i.site_id = $1
       AND COALESCE(i.item_type_code, '') IN ('finished_goods', 'fg', 'goods')
       AND i.name !~* '^(стикер|этикетка)\\b'
       AND (
         ($2 <> '' AND (
           i.item_code = $2 OR i.item_code = $3 OR i.item_code = $5
           OR COALESCE(i.sku, '') = $2
           OR (i.item_attrs_json->'nomenclature'->>'gtin') = $2
           OR EXISTS (
             SELECT 1 FROM wms_item_barcodes b
             WHERE b.item_id = i.item_id AND b.barcode IN ($2, $6)
           )
         ))
         OR ($4 <> '' AND lower(i.name) = lower($4))
       )
     ORDER BY CASE
       WHEN $2 <> '' AND i.item_code = $2 THEN 0
       WHEN COALESCE(i.item_type_code, '') = 'finished_goods' THEN 1
       ELSE 2
     END
     LIMIT 1`,
    [siteId, gtin, gtin ? `FG-${gtin}` : "", productName, gtin ? `00-${gtin.slice(-8)}` : "", gtin13]
  )
  return r.rows[0] ?? null
}

function shouldPromoteLabel(label: LabelRow, productName: string, gtin: string | null): boolean {
  if (!productName || productName === label.name.trim()) return false
  if (gtin) return true
  return DRINK_NAME_RE.test(productName)
}

/**
 * Этикетка/стикер на складе материалов и напиток на ГП — разные карточки.
 * GTIN напитка не должен оставаться у стикера, иначе в отгрузке видна только этикетка.
 */
export async function ensureFinishedGoodsFromLabel(
  client: PoolClient,
  siteId: number,
  label: LabelRow
): Promise<{ itemCode: string; name: string } | null> {
  const productName = productNameFromLabelCard(label.name)
  const gtin =
    commercialGtin(label.gtin) || commercialGtin(label.itemCode) || commercialGtin(label.sku)
  if (!shouldPromoteLabel(label, productName, gtin)) return null

  const existing = await findExistingFg(client, siteId, gtin || "", productName)
  if (existing) {
    if (gtin) await relinkFgLocatedCodes(client, siteId, label.itemId, existing.itemCode)
    return { itemCode: existing.itemCode, name: productName }
  }
  if (!gtin) return null

  const stickerCode = `FG-${gtin}`
  if (label.itemCode === gtin) {
    const taken = await client.query(
      `SELECT 1 FROM wms_items WHERE site_id = $1 AND item_code = $2 LIMIT 1`,
      [siteId, stickerCode]
    )
    if (taken.rows.length === 0) {
      await client.query(
        `UPDATE wms_items SET item_code = $2, updated_at = now()
         WHERE site_id = $1 AND item_id = $3::bigint`,
        [siteId, stickerCode, label.itemId]
      )
    } else {
      return null
    }
  }

  const attrs = {
    nomenclature: { gtin, source: "from-label-card", productGroup: "finished_goods" },
    markingPackaging: { productGtin: gtin },
    fromLabelItemId: label.itemId,
  }
  const ins = await client.query<{ item_code: string }>(
    `INSERT INTO wms_items (
       site_id, item_code, sku, name, item_type_code,
       uom_code, is_marked, is_perishable, is_active, rotation_policy,
       shelf_life_days, item_attrs_json, created_at, updated_at
     ) VALUES (
       $1, $2, $2, $3, 'finished_goods',
       'pcs', TRUE, TRUE, TRUE, 'fefo',
       $4, $5::jsonb, now(), now()
     )
     ON CONFLICT (site_id, item_code) DO UPDATE SET
       is_active = TRUE,
       item_type_code = CASE
         WHEN wms_items.name ~* '^(стикер|этикетка)\\b' THEN wms_items.item_type_code
         ELSE COALESCE(NULLIF(wms_items.item_type_code, ''), 'finished_goods')
       END,
       name = CASE
         WHEN wms_items.name ~* '^(стикер|этикетка)\\b' THEN wms_items.name
         WHEN NULLIF(BTRIM(wms_items.name), '') IS NULL THEN EXCLUDED.name
         ELSE wms_items.name
       END,
       updated_at = now()
     RETURNING item_code`,
    [siteId, gtin, productName, label.shelfLifeDays, JSON.stringify(attrs)]
  )
  const itemCode = ins.rows[0]?.item_code
  if (!itemCode) return null

  const stillLabel = await client.query<{ name: string }>(
    `SELECT name FROM wms_items WHERE site_id = $1 AND item_code = $2 LIMIT 1`,
    [siteId, itemCode]
  )
  if (isLabelCardName(stillLabel.rows[0]?.name)) {
    return null
  }

  await reassignGtinBarcode(client, siteId, label.itemId, itemCode, gtin)
  await relinkFgLocatedCodes(client, siteId, label.itemId, itemCode)
  return { itemCode, name: productName }
}

async function reassignGtinBarcode(
  client: PoolClient,
  siteId: number,
  stickerItemId: string,
  fgItemCode: string,
  gtin: string
) {
  const fg = await client.query<{ item_id: string }>(
    `SELECT item_id::text FROM wms_items WHERE site_id = $1 AND item_code = $2 LIMIT 1`,
    [siteId, fgItemCode]
  )
  const fgId = fg.rows[0]?.item_id
  if (!fgId) return
  const gtin13 = gtin.replace(/^0/, "")
  await client.query(
    `UPDATE wms_item_barcodes
     SET item_id = $1::bigint
     WHERE item_id = $2::bigint
       AND barcode IN ($3, $4)`,
    [fgId, stickerItemId, gtin, gtin13]
  )
  await client.query(
    `INSERT INTO wms_item_barcodes (item_id, barcode, barcode_type, is_primary, created_at)
     SELECT $1::bigint, $2, 'gtin', TRUE, now()
     WHERE NOT EXISTS (SELECT 1 FROM wms_item_barcodes b WHERE b.barcode = $2)`,
    [fgId, gtin]
  )
}

async function relinkFgLocatedCodes(
  client: PoolClient,
  siteId: number,
  stickerItemId: string,
  fgItemCode: string
) {
  const fg = await client.query<{ item_id: string }>(
    `SELECT item_id::text FROM wms_items WHERE site_id = $1 AND item_code = $2 LIMIT 1`,
    [siteId, fgItemCode]
  )
  const fgId = fg.rows[0]?.item_id
  if (!fgId || fgId === stickerItemId) return
  await client.query(
    `
    UPDATE wms_item_codes mic
    SET item_id = $3::bigint
    FROM wms_locations l
    JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
    WHERE mic.item_id = $2::bigint
      AND mic.unlinked_at IS NULL
      AND mic.current_location_id = l.location_id
      AND (
        w.warehouse_code ILIKE $4 || '%'
        OR COALESCE(w.warehouse_type, '') ILIKE '%FINISH%'
        OR COALESCE(w.name, '') ILIKE '%готов%'
      )
    `,
    [siteId, stickerItemId, fgId, FG_WAREHOUSE_CODE]
  )
}

/** Карточка напитка по коммерческому GTIN с плана ГП (тархун и т.п.). */
export async function ensureFinishedGoodsCard(
  client: PoolClient,
  siteId: number,
  gtinRaw: string,
  productName: string
): Promise<{ itemCode: string; name: string } | null> {
  const gtin = commercialGtin(gtinRaw)
  if (!gtin) return null
  const name = productName.trim() || `GTIN ${gtin}`
  const existing = await findExistingFg(client, siteId, gtin, name)
  if (existing) return { itemCode: existing.itemCode, name }

  const attrs = {
    nomenclature: { gtin, source: "fg-plan-inventory", productGroup: "finished_goods" },
    markingPackaging: { productGtin: gtin },
  }
  const ins = await client.query<{ item_code: string }>(
    `INSERT INTO wms_items (
       site_id, item_code, sku, name, item_type_code, material_type,
       uom_code, is_marked, is_perishable, is_active, rotation_policy,
       item_attrs_json, created_at, updated_at
     ) VALUES (
       $1, $2, $2, $3, 'finished_goods', 'product',
       'pcs', TRUE, TRUE, TRUE, 'fefo',
       $4::jsonb, now(), now()
     )
     ON CONFLICT (site_id, item_code) DO UPDATE SET
       is_active = TRUE,
       item_type_code = CASE
         WHEN wms_items.name ~* '^(стикер|этикетка)\\b' THEN wms_items.item_type_code
         ELSE COALESCE(NULLIF(wms_items.item_type_code, ''), 'finished_goods')
       END,
       material_type = COALESCE(NULLIF(wms_items.material_type, ''), 'product'),
       name = CASE
         WHEN wms_items.name ~* '^(стикер|этикетка)\\b' THEN wms_items.name
         WHEN NULLIF(BTRIM(wms_items.name), '') IS NULL THEN EXCLUDED.name
         ELSE wms_items.name
       END,
       updated_at = now()
     RETURNING item_code`,
    [siteId, gtin, name, JSON.stringify(attrs)]
  )
  const itemCode = ins.rows[0]?.item_code
  if (!itemCode) return null

  const stillLabel = await client.query<{ name: string }>(
    `SELECT name FROM wms_items WHERE site_id = $1 AND item_code = $2 LIMIT 1`,
    [siteId, itemCode]
  )
  if (isLabelCardName(stillLabel.rows[0]?.name)) return null

  const fg = await client.query<{ item_id: string }>(
    `SELECT item_id::text FROM wms_items WHERE site_id = $1 AND item_code = $2 LIMIT 1`,
    [siteId, itemCode]
  )
  const fgId = fg.rows[0]?.item_id
  if (fgId) {
    const gtin13 = gtin.replace(/^0/, "")
    await client.query(
      `INSERT INTO wms_item_barcodes (item_id, barcode, barcode_type, is_primary, created_at)
       SELECT $1::bigint, $2, 'gtin', TRUE, now()
       WHERE NOT EXISTS (SELECT 1 FROM wms_item_barcodes b WHERE b.barcode = $2)`,
      [fgId, gtin]
    )
    if (gtin13 && gtin13 !== gtin) {
      await client.query(
        `INSERT INTO wms_item_barcodes (item_id, barcode, barcode_type, is_primary, created_at)
         SELECT $1::bigint, $2, 'gtin', FALSE, now()
         WHERE NOT EXISTS (SELECT 1 FROM wms_item_barcodes b WHERE b.barcode = $2)`,
        [fgId, gtin13]
      )
    }
  }
  return { itemCode, name }
}

export async function ensureFinishedGoodsMatchingQuery(
  client: PoolClient,
  siteId: number,
  query: string
): Promise<string[]> {
  const labels = await findLabelCards(client, siteId, query)
  const codes: string[] = []
  for (const label of labels) {
    try {
      const fg = await ensureFinishedGoodsFromLabel(client, siteId, label)
      if (fg) codes.push(fg.itemCode)
    } catch (error) {
      console.error("ensureFinishedGoodsFromLabel", label.itemCode, error)
    }
  }
  return [...new Set(codes)]
}

export { isFgWarehouseCode } from "@/lib/wms/fg-plan-location-codes"
