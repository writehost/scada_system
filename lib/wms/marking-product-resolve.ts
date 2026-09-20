import type { PoolClient } from "pg"
import type { MarkingPackLevel } from "@/lib/wms/marking-nest-import"

export type MarkingPackagingGtins = {
  unitGtin?: string
  blockGtin?: string
  palletGtinPrefix?: string
  productGtin?: string
}

export function packagingGtinsFromAttrs(attrs: unknown): MarkingPackagingGtins {
  if (!attrs || typeof attrs !== "object") return {}
  const root = attrs as Record<string, unknown>
  const nom =
    root.markingPackaging && typeof root.markingPackaging === "object"
      ? (root.markingPackaging as Record<string, unknown>)
      : root.nomenclature && typeof root.nomenclature === "object"
        ? ((root.nomenclature as Record<string, unknown>).markingPackaging as Record<string, unknown>)
        : null
  if (!nom || typeof nom !== "object") {
    const gtin = String(
      (root.nomenclature as Record<string, unknown> | undefined)?.gtin ?? root.gtin ?? ""
    ).trim()
    return gtin ? { productGtin: gtin.padStart(14, "0").slice(-14) } : {}
  }
  const pick = (k: string) => {
    const v = nom[k]
    return typeof v === "string" && v.trim() ? v.trim().padStart(14, "0").slice(-14) : undefined
  }
  return {
    unitGtin: pick("unitGtin"),
    blockGtin: pick("blockGtin"),
    palletGtinPrefix: pick("palletGtinPrefix"),
    productGtin: pick("productGtin") ?? pick("gtin"),
  }
}

export function inferPackLevelFromGtin(gtin: string, packaging?: MarkingPackagingGtins): MarkingPackLevel {
  const g = gtin.trim()
  if (/^00\d/.test(g) || g.startsWith("003")) return "pallet"
  if (packaging?.blockGtin && g === packaging.blockGtin) return "block"
  if (packaging?.unitGtin && g === packaging.unitGtin) return "unit"
  if (g.startsWith("046070171623")) return "block"
  if (g.startsWith("046070171614")) return "unit"
  return "unit"
}

export async function findFinishedGoodsProductByPackagingGtin(
  client: PoolClient,
  siteId: number,
  gtin: string
): Promise<{ itemId: string; itemCode: string; name: string; packaging: MarkingPackagingGtins } | null> {
  const g = gtin.padStart(14, "0").slice(-14)
  const r = await client.query<{
    itemId: string
    itemCode: string
    name: string
    itemAttrs: unknown
  }>(
    `
    SELECT i.item_id::text AS "itemId", i.item_code AS "itemCode", i.name,
           i.item_attrs_json AS "itemAttrs"
    FROM wms_items i
    WHERE i.site_id = $1
      AND i.is_active
      AND i.item_type_code = 'finished_goods'
      AND COALESCE(i.item_subgroup, 'product') NOT IN ('unit', 'block', 'pallet')
      AND (
        COALESCE(i.item_attrs_json->'markingPackaging'->>'unitGtin', '') IN ($2, $3)
        OR COALESCE(i.item_attrs_json->'markingPackaging'->>'blockGtin', '') IN ($2, $3)
        OR COALESCE(i.item_attrs_json->'markingPackaging'->>'palletGtinPrefix', '') IN ($2, $3)
        OR COALESCE(i.item_attrs_json->'nomenclature'->>'gtin', '') IN ($2, $3)
        OR EXISTS (
          SELECT 1 FROM wms_item_barcodes b
          WHERE b.item_id = i.item_id AND b.barcode IN ($2, $3, $4)
        )
      )
    ORDER BY i.item_id
    LIMIT 1
    `,
    [siteId, g, gtin, gtin.replace(/^0+/, "")]
  )
  const row = r.rows[0]
  if (!row) return null
  return {
    itemId: row.itemId,
    itemCode: row.itemCode,
    name: row.name,
    packaging: packagingGtinsFromAttrs(row.itemAttrs),
  }
}

export async function resolveFinishedGoodsProductItem(
  client: PoolClient,
  siteId: number,
  options: {
    productItemCode?: string
    productName?: string
    productGtin?: string
    packaging?: MarkingPackagingGtins
    sampleUnitGtin?: string
    createMissing?: boolean
  }
): Promise<{ itemId: string; created: boolean; packaging: MarkingPackagingGtins } | null> {
  const desiredName = options.productName?.trim() || ""

  async function maybeUpgradeName(itemId: string, currentName: string, gtinHint?: string) {
    if (!desiredName) return
    const stub =
      /^ГП\s+\d{8,14}$/i.test(currentName.trim()) ||
      (gtinHint && currentName.trim() === `ГП ${gtinHint.padStart(14, "0").slice(-14)}`)
    if (!stub && currentName.trim() === desiredName) return
    if (!stub && currentName.trim() && !desiredName) return
    if (stub || !currentName.trim()) {
      await client.query(
        `UPDATE wms_items SET name = $2, updated_at = now() WHERE item_id = $1::bigint`,
        [itemId, desiredName]
      )
    }
  }

  const code = options.productItemCode?.trim()
  if (code) {
    const byCode = await client.query<{ itemId: string; itemAttrs: unknown; name: string }>(
      `SELECT item_id::text AS "itemId", item_attrs_json AS "itemAttrs", name
       FROM wms_items
       WHERE site_id = $1 AND item_code = $2 AND item_type_code = 'finished_goods'
       LIMIT 1`,
      [siteId, code]
    )
    if (byCode.rows[0]) {
      await client.query(
        `UPDATE wms_items SET is_active = TRUE, updated_at = now() WHERE item_id = $1::bigint AND NOT is_active`,
        [byCode.rows[0].itemId]
      )
      await maybeUpgradeName(byCode.rows[0].itemId, byCode.rows[0].name, options.productGtin)
      return {
        itemId: byCode.rows[0].itemId,
        created: false,
        packaging: {
          ...packagingGtinsFromAttrs(byCode.rows[0].itemAttrs),
          ...options.packaging,
        },
      }
    }
  }

  if (options.sampleUnitGtin) {
    const hit = await findFinishedGoodsProductByPackagingGtin(client, siteId, options.sampleUnitGtin)
    if (hit) {
      await client.query(
        `UPDATE wms_items SET is_active = TRUE, updated_at = now() WHERE item_id = $1::bigint AND NOT is_active`,
        [hit.itemId]
      )
      await maybeUpgradeName(hit.itemId, hit.name, options.sampleUnitGtin)
      return { itemId: hit.itemId, created: false, packaging: { ...hit.packaging, ...options.packaging } }
    }
  }

  if (!options.createMissing) return null

  const productGtin = (options.productGtin ?? options.packaging?.productGtin ?? options.sampleUnitGtin ?? "")
    .trim()
    .padStart(14, "0")
    .slice(-14)
  const itemCode = code || (productGtin ? `FG-${productGtin}` : `FG-PRODUCT-${Date.now()}`)
  const name = options.productName?.trim() || `ГП ${productGtin || itemCode}`

  const packaging: MarkingPackagingGtins = {
    productGtin: options.productGtin?.padStart(14, "0").slice(-14) || productGtin,
    unitGtin: options.packaging?.unitGtin,
    blockGtin: options.packaging?.blockGtin,
    palletGtinPrefix: options.packaging?.palletGtinPrefix,
  }

  const attrs = {
    nomenclature: {
      gtin: packaging.productGtin,
      markingControl: true,
      type: "PRODUCT",
    },
    markingPackaging: packaging,
  }

  const ins = await client.query<{ itemId: string; inserted: boolean }>(
    `INSERT INTO wms_items (
       site_id, item_code, name, item_type_code, item_subgroup, uom_code,
       is_marked, is_active, item_attrs_json, created_at, updated_at
     ) VALUES ($1, $2, $3, 'finished_goods', NULL, 'pcs', TRUE, TRUE, $4::jsonb, now(), now())
     ON CONFLICT (site_id, item_code)
     DO UPDATE SET
       name = CASE
         WHEN wms_items.name ~ '^ГП[[:space:]]+[0-9]{8,14}$'
           OR NULLIF(BTRIM(wms_items.name), '') IS NULL
           OR (
             $3 !~ '^ГП[[:space:]]+[0-9]{8,14}$'
             AND NULLIF(BTRIM($3), '') IS NOT NULL
             AND wms_items.name IS DISTINCT FROM $3
             AND wms_items.name ~ '^ГП[[:space:]]'
           )
         THEN EXCLUDED.name
         WHEN $3 !~ '^ГП[[:space:]]+[0-9]{8,14}$' AND NULLIF(BTRIM($3), '') IS NOT NULL
              AND wms_items.name ~ '^ГП[[:space:]]+[0-9]{8,14}$'
         THEN EXCLUDED.name
         ELSE wms_items.name
       END,
       is_marked = TRUE,
       is_active = TRUE,
       item_attrs_json = COALESCE(wms_items.item_attrs_json, '{}'::jsonb) || EXCLUDED.item_attrs_json,
       updated_at = now()
     RETURNING item_id::text AS "itemId", (xmax = 0) AS inserted`,
    [siteId, itemCode, name, JSON.stringify(attrs)]
  )

  const itemId = ins.rows[0]!.itemId
  if (packaging.productGtin) {
    await client.query(
      `INSERT INTO wms_item_barcodes (item_id, barcode, barcode_type, is_primary, created_at)
       VALUES ($1::bigint, $2, 'gtin', TRUE, now())
       ON CONFLICT (barcode) DO UPDATE SET item_id = EXCLUDED.item_id, is_primary = TRUE`,
      [itemId, packaging.productGtin]
    )
  }

  return { itemId, created: Boolean(ins.rows[0]!.inserted), packaging }
}

export async function relinkStubMarkingCodesToProduct(
  client: PoolClient,
  siteId: number,
  productItemId: string,
  packaging?: MarkingPackagingGtins
): Promise<{ relinked: number; stubsDeactivated: number }> {
  const pkg = packaging ?? {}
  const upd = await client.query<{ n: string }>(
    `
    WITH mapped AS (
      SELECT
        mic.wms_item_code_id,
        CASE
          WHEN c.ai01_gtin LIKE '003%' OR c.ai01_gtin LIKE '00%' THEN 'pallet'
          WHEN c.ai01_gtin = COALESCE(NULLIF($3, ''), '04607017162354') THEN 'block'
          WHEN c.ai01_gtin = COALESCE(NULLIF($4, ''), '04607017161487') THEN 'unit'
          ELSE 'unit'
        END AS pack_level
      FROM wms_item_codes mic
      JOIN codes c ON c.code_id = mic.code_id
      JOIN wms_items i ON i.item_id = mic.item_id
      WHERE mic.current_site_id = $1
        AND mic.unlinked_at IS NULL
        AND COALESCE(i.item_subgroup, '') IN ('unit', 'block', 'pallet')
    )
    UPDATE wms_item_codes mic
    SET item_id = $2::bigint,
        pack_level = mapped.pack_level
    FROM mapped
    WHERE mic.wms_item_code_id = mapped.wms_item_code_id
    RETURNING mic.wms_item_code_id
    `,
    [siteId, productItemId, pkg.blockGtin ?? "", pkg.unitGtin ?? ""]
  )

  const deact = await client.query<{ n: string }>(
    `
    UPDATE wms_items
    SET is_active = FALSE, updated_at = now()
    WHERE site_id = $1
      AND item_id <> $2::bigint
      AND item_type_code = 'finished_goods'
      AND COALESCE(item_subgroup, '') IN ('unit', 'block', 'pallet')
    RETURNING item_id
    `,
    [siteId, productItemId]
  )

  return {
    relinked: upd.rowCount ?? 0,
    stubsDeactivated: deact.rowCount ?? 0,
  }
}
