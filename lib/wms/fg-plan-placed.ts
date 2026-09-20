import type { PoolClient } from "pg"
import { commercialGtin, ensureFinishedGoodsCard } from "@/lib/wms/fg-product-from-label"
import { readFgPlanInventory } from "@/lib/wms/fg-plan-inventory-storage"
import {
  canonicalPlanRowId,
  fgPlanLocationCode,
  planRowZone,
} from "@/lib/wms/fg-plan-location-codes"
import { blocksFromBottles } from "@/lib/wms/fg-plan-pack"
import { plantLinesFromBatches, uniquePlantBatches } from "@/lib/wms/fg-plan-stock-helpers"
import { fgEmptyItemStatuses, type FgNomenclatureRow, type FgPlanRowRef } from "@/lib/wms/finished-goods-types"

export type FgPlacedLocation = {
  planRowId: string
  locationCode: string
  zone: string
  bottles: number
  blocks: number
  pallets: number
}

export type FgPlacedSku = {
  gtin: string
  name: string
  bottles: number
  blocks: number
  pallets: number
  batches: string[]
  locations: FgPlacedLocation[]
}

export type FgPlacedItemRef = {
  itemCode: string
  name: string
  sku: string | null
  productGroup: string
}

export function gtinKey(raw: string | null | undefined): string | null {
  const value = String(raw || "").trim()
  if (!value) return null
  return commercialGtin(value.replace(/^FG-/i, "")) || commercialGtin(value)
}

function keysOfItem(item: {
  itemCode?: string | null
  sku?: string | null
  itemAttrs?: unknown
  primaryBarcode?: string | null
}): string[] {
  const attrs = item.itemAttrs && typeof item.itemAttrs === "object" ? (item.itemAttrs as Record<string, unknown>) : {}
  const nomenclature = attrs.nomenclature && typeof attrs.nomenclature === "object"
    ? (attrs.nomenclature as Record<string, unknown>)
    : {}
  const marking = attrs.markingPackaging && typeof attrs.markingPackaging === "object"
    ? (attrs.markingPackaging as Record<string, unknown>)
    : {}
  return [
    gtinKey(item.itemCode),
    gtinKey(item.sku),
    gtinKey(item.primaryBarcode),
    gtinKey(typeof nomenclature.gtin === "string" ? nomenclature.gtin : null),
    gtinKey(typeof marking.productGtin === "string" ? marking.productGtin : null),
  ].filter((key): key is string => Boolean(key))
}

/** Создаёт карточки ГП по GTIN с плана. Остаток склада не трогает — см. postFgPlanInventoryToStock. */
export async function ensureFinishedGoodsFromPlan(
  client: PoolClient,
  siteId: number
): Promise<string[]> {
  const placed = await loadFgPlanPlaced(siteId)
  const codes: string[] = []
  for (const sku of placed) {
    try {
      const card = await ensureFinishedGoodsCard(client, siteId, sku.gtin, sku.name)
      if (card) codes.push(card.itemCode)
    } catch (error) {
      console.error("ensureFinishedGoodsFromPlan", sku.gtin, error)
    }
  }
  return [...new Set(codes)]
}

export async function loadFgPlanPlaced(siteId: number): Promise<FgPlacedSku[]> {
  const snapshot = await readFgPlanInventory(siteId)
  const byGtin = new Map<string, FgPlacedSku>()
  for (const slot of Object.values(snapshot.inventory || {})) {
    if (slot.status !== "occupied") continue
    const gtin = gtinKey(slot.gtin)
    if (!gtin) continue
    const planRowId = canonicalPlanRowId(slot.address)
    if (!planRowId) continue
    const qty = Number(slot.quantity) || 0
    const name = String(slot.nomenclature || "").trim()
    let sku = byGtin.get(gtin)
    if (!sku) {
      sku = { gtin, name, bottles: 0, blocks: 0, pallets: 0, batches: [], locations: [] }
      byGtin.set(gtin, sku)
    }
    if (!sku.name && name) sku.name = name
    sku.bottles += qty
    sku.blocks += blocksFromBottles(qty)
    sku.pallets += 1
    const batch = String(slot.batch || "").trim()
    if (batch && !sku.batches.includes(batch)) sku.batches.push(batch)
    let loc = sku.locations.find((row) => row.planRowId === planRowId)
    if (!loc) {
      loc = {
        planRowId,
        locationCode: fgPlanLocationCode(planRowId),
        zone: planRowZone(planRowId),
        bottles: 0,
        blocks: 0,
        pallets: 0,
      }
      sku.locations.push(loc)
    }
    loc.bottles += qty
    loc.blocks += blocksFromBottles(qty)
    loc.pallets += 1
  }
  return [...byGtin.values()].sort((a, b) => b.pallets - a.pallets || a.name.localeCompare(b.name, "ru"))
}

export async function resolveFgItemsByGtins(
  client: PoolClient,
  siteId: number,
  gtins: string[]
): Promise<Map<string, FgPlacedItemRef>> {
  const wanted = [...new Set(gtins.map((g) => gtinKey(g)).filter((g): g is string => Boolean(g)))]
  const out = new Map<string, FgPlacedItemRef>()
  if (wanted.length === 0) return out
  const fgCodes = wanted.map((g) => `FG-${g}`)
  const gtin13 = wanted.map((g) => g.replace(/^0/, ""))
  const r = await client.query<{
    itemCode: string
    name: string
    sku: string | null
    productGroup: string
    itemAttrs: unknown
    barcode: string | null
  }>(
    `
    SELECT
      i.item_code AS "itemCode",
      i.name,
      i.sku,
      COALESCE(i.item_group_code, i.product_group, '') AS "productGroup",
      i.item_attrs_json AS "itemAttrs",
      b.barcode
    FROM wms_items i
    LEFT JOIN wms_item_barcodes b ON b.item_id = i.item_id
    WHERE i.site_id = $1
      AND i.is_active
      AND i.name !~* '^(стикер|этикетка)\\b'
      AND COALESCE(i.item_group_code, i.product_group, '') NOT IN ('stickers', 'labels')
      AND COALESCE(i.item_type_code, '') NOT IN ('stickers')
      AND (
        i.item_code = ANY($2::text[])
        OR i.item_code = ANY($3::text[])
        OR COALESCE(i.sku, '') = ANY($2::text[])
        OR COALESCE(i.item_attrs_json->'nomenclature'->>'gtin', '') = ANY($2::text[])
        OR COALESCE(b.barcode, '') = ANY($2::text[])
        OR COALESCE(b.barcode, '') = ANY($4::text[])
      )
    ORDER BY CASE
      WHEN COALESCE(i.item_type_code, '') = 'finished_goods' THEN 0
      WHEN COALESCE(i.item_type_code, '') IN ('fg', 'goods') THEN 1
      ELSE 2
    END, i.item_id DESC
    `,
    [siteId, wanted, fgCodes, gtin13]
  )
  for (const row of r.rows) {
    const keys = new Set(keysOfItem(row))
    if (row.barcode) {
      const fromBarcode = gtinKey(row.barcode)
      if (fromBarcode) keys.add(fromBarcode)
    }
    for (const key of keys) {
      if (!wanted.includes(key) || out.has(key)) continue
      out.set(key, {
        itemCode: row.itemCode,
        name: row.name,
        sku: row.sku,
        productGroup: row.productGroup,
      })
    }
  }
  return out
}

function placedMatchesQuery(sku: FgPlacedSku, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    sku.name.toLowerCase().includes(q) ||
    sku.gtin.includes(q) ||
    sku.gtin.replace(/^0+/, "").includes(q.replace(/^0+/, "")) ||
    sku.batches.some((batch) => batch.toLowerCase().includes(q)) ||
    sku.locations.some(
      (loc) =>
        loc.planRowId.toLowerCase().includes(q) ||
        loc.locationCode.toLowerCase().includes(q) ||
        loc.zone.toLowerCase().includes(q)
    )
  )
}

function planRowsFromSku(sku: FgPlacedSku): FgPlanRowRef[] {
  return sku.locations
    .map((loc) => ({
      planRowId: loc.planRowId,
      locationCode: loc.locationCode,
      zone: loc.zone,
      pallets: loc.pallets,
    }))
    .sort((a, b) => (b.pallets ?? 0) - (a.pallets ?? 0) || a.planRowId.localeCompare(b.planRowId, "en"))
}

type ListItem = Record<string, unknown> & {
  itemCode?: string
  sku?: string | null
  name?: string
  itemAttrs?: unknown
  availableQty?: number
  placedQty?: number
  placedBlocks?: number
  placedPallets?: number
}

export function attachPlacedFieldsToItems(items: ListItem[], placed: FgPlacedSku[]): ListItem[] {
  return items.map((item) => {
    const keys = keysOfItem(item)
    const sku = placed.find((row) => keys.includes(row.gtin))
    if (!sku) {
      return {
        ...item,
        placedQty: Number(item.placedQty) || 0,
        placedBlocks: Number(item.placedBlocks) || 0,
        placedPallets: Number(item.placedPallets) || 0,
      }
    }
    return {
      ...item,
      placedQty: sku.bottles,
      placedBlocks: sku.blocks,
      placedPallets: sku.pallets,
    }
  })
}

export async function mergePlacedIntoItemList(
  client: PoolClient,
  siteId: number,
  items: ListItem[],
  options?: { query?: string; injectMissing?: boolean }
): Promise<ListItem[]> {
  const placed = await loadFgPlanPlaced(siteId)
  const attached = attachPlacedFieldsToItems(items, placed)
  if (!options?.injectMissing) return attached

  const query = options.query ?? ""
  const present = new Set<string>()
  for (const item of attached) {
    for (const key of keysOfItem(item)) present.add(key)
    if (item.itemCode) present.add(String(item.itemCode))
  }

  const missing = placed.filter((sku) => placedMatchesQuery(sku, query) && !present.has(sku.gtin))
  if (missing.length === 0) return attached

  const resolved = await resolveFgItemsByGtins(client, siteId, missing.map((sku) => sku.gtin))
  const extras: ListItem[] = missing.map((sku) => {
    const ref = resolved.get(sku.gtin)
    const itemCode = ref?.itemCode || sku.gtin
    return {
      cursor: `plan:${sku.gtin}`,
      itemCode,
      shortName: null,
      isActive: true,
      itemTypeCode: "finished_goods",
      sku: ref?.sku || sku.gtin,
      name: ref?.name || sku.name || `GTIN ${sku.gtin}`,
      materialType: "product",
      productGroup: ref?.productGroup || "finished_goods",
      itemGroupCode: ref?.productGroup || "finished_goods",
      itemClassCode: "F",
      itemSubgroup: "product",
      packagingFormat: null,
      packagingProfile: null,
      itemAttrs: { nomenclature: { gtin: sku.gtin, source: "fg-plan-inventory" } },
      nomenclature: ref?.name || sku.name || null,
      lineGroup: null,
      uomCode: "pcs",
      isMarked: true,
      isPerishable: true,
      rotationPolicy: "fefo",
      shelfLifeDays: null,
      expiryWarningDays: null,
      availableQty: 0,
      reservedQty: 0,
      inProductionQty: 0,
      inTransitQty: 0,
      quarantineQty: 0,
      rejectedQty: 0,
      placedQty: sku.bottles,
      placedBlocks: sku.blocks,
      placedPallets: sku.pallets,
    }
  })
  return [...extras, ...attached]
}

export async function mergePlacedIntoFgNomenclature(
  client: PoolClient,
  siteId: number,
  rows: FgNomenclatureRow[],
  query = ""
): Promise<FgNomenclatureRow[]> {
  const placed = await loadFgPlanPlaced(siteId)
  const resolved = await resolveFgItemsByGtins(client, siteId, placed.map((sku) => sku.gtin))
  const usedGtins = new Set<string>()

  const merged = rows.map((row) => {
    const keys = [gtinKey(row.gtin), gtinKey(row.itemCode)].filter((key): key is string => Boolean(key))
    const sku = placed.find((item) => keys.includes(item.gtin))
    if (!sku) {
      return {
        ...row,
        placedBottles: row.placedBottles ?? 0,
        placedBlocks: row.placedBlocks ?? 0,
        placedPallets: row.placedPallets ?? 0,
        planRows: row.planRows ?? [],
      }
    }
    usedGtins.add(sku.gtin)
    const lotCodes = uniquePlantBatches([...(row.lotCodes ?? []), ...sku.batches])
    const fromBatch = plantLinesFromBatches(lotCodes)
    return {
      ...row,
      placedBottles: sku.bottles,
      placedBlocks: sku.blocks,
      placedPallets: sku.pallets,
      planRows: planRowsFromSku(sku),
      lotCodes,
      productionLineCode: row.productionLineCode || fromBatch.code,
      productionLineName: row.productionLineName || fromBatch.name,
    }
  })

  const extras: FgNomenclatureRow[] = []
  for (const sku of placed) {
    if (usedGtins.has(sku.gtin)) continue
    if (!placedMatchesQuery(sku, query)) continue
    const ref = resolved.get(sku.gtin)
    extras.push({
      itemCode: ref?.itemCode || sku.gtin,
      name: ref?.name || sku.name || `GTIN ${sku.gtin}`,
      gtin: sku.gtin,
      productGroup: ref?.productGroup || "finished_goods",
      bottles: 0,
      blocks: 0,
      pallets: 0,
      markingCodesCount: 0,
      placedBottles: sku.bottles,
      placedBlocks: sku.blocks,
      placedPallets: sku.pallets,
      planRows: planRowsFromSku(sku),
      productionLineCode: plantLinesFromBatches(sku.batches).code,
      productionLineName: plantLinesFromBatches(sku.batches).name,
      lotCodes: uniquePlantBatches(sku.batches),
      nearestExpiryAt: null,
      oldestProductionAt: null,
      tags: [],
      statuses: fgEmptyItemStatuses(),
      expiryCritical: 0,
      expiryWarning: 0,
      expiryOk: 0,
    })
  }

  const combined = [...extras, ...merged]
  combined.sort((a, b) => {
    const placedA = (a.placedPallets ?? 0) + (a.placedBottles ?? 0)
    const placedB = (b.placedPallets ?? 0) + (b.placedBottles ?? 0)
    if (placedA !== placedB) return placedB - placedA
    const stockA = a.bottles + a.pallets
    const stockB = b.bottles + b.pallets
    if (stockA !== stockB) return stockB - stockA
    return a.name.localeCompare(b.name, "ru")
  })
  return combined
}

export async function overlayPlacedOnStorageRows<T extends {
  rowCode: string
  palletCount: number
  bottles: number
  nomenclatureSkus: number
  fillPercent: number
}>(siteId: number, rows: T[]): Promise<T[]> {
  const placed = await loadFgPlanPlaced(siteId)
  const byRow = new Map<string, { pallets: number; bottles: number; blocks: number; skus: Set<string> }>()
  for (const sku of placed) {
    for (const loc of sku.locations) {
      const cur = byRow.get(loc.planRowId) ?? { pallets: 0, bottles: 0, blocks: 0, skus: new Set<string>() }
      cur.pallets += loc.pallets
      cur.bottles += loc.bottles
      cur.blocks += loc.blocks
      cur.skus.add(sku.gtin)
      byRow.set(loc.planRowId, cur)
    }
  }
  return rows.map((row) => {
    const id = canonicalPlanRowId(row.rowCode)
    const extra = id ? byRow.get(id) : undefined
    if (!extra) return row
    return {
      ...row,
      palletCount: Math.max(row.palletCount, extra.pallets),
      bottles: Math.max(row.bottles, extra.bottles),
      ...("blocks" in row ? { blocks: Math.max(Number(row.blocks) || 0, extra.blocks) } : {}),
      nomenclatureSkus: Math.max(row.nomenclatureSkus, extra.skus.size),
      fillPercent: row.fillPercent > 0 ? row.fillPercent : extra.pallets > 0 ? 100 : row.fillPercent,
    }
  })
}

export async function placedLocationsForItem(
  siteId: number,
  item: { itemCode?: string | null; sku?: string | null; itemAttrs?: unknown; primaryBarcode?: string | null }
): Promise<FgPlacedLocation[]> {
  const placed = await loadFgPlanPlaced(siteId)
  const keys = keysOfItem(item)
  const sku = placed.find((row) => keys.includes(row.gtin))
  return sku?.locations ?? []
}
