import type { PoolClient } from "pg"
import { ensureFinishedGoodsCard } from "@/lib/wms/fg-product-from-label"
import { blocksFromBottles } from "@/lib/wms/fg-plan-pack"
import { uniquePlantBatches } from "@/lib/wms/fg-plan-stock-helpers"
import { gtinKey } from "@/lib/wms/fg-plan-placed"
import { resolveItemByCodeOrBarcode } from "@/lib/wms/resolve"
import type { FgNomenclatureRow, FgPalletRow } from "@/lib/wms/finished-goods-types"
import { fgEmptyItemStatuses } from "@/lib/wms/finished-goods-types"

type VekasServer = "skit" | "slavda"

export type FgVekasLotAgg = {
  itemCode: string
  itemName: string
  gtin: string | null
  bottles: number
  blocks: number
  pallets: number
  batches: string[]
  palletCodes: string[]
  productionDate: string | null
}

type AdapterPallet = {
  palletId?: string | null
  quantity?: number | null
}

function adapterBase(): string {
  return (process.env.VEKAS_ADAPTER_URL || "http://127.0.0.1:8792").trim().replace(/\/$/, "")
}

async function adapterJson<T>(path: string, timeoutMs = 120_000): Promise<T> {
  const res = await fetch(`${adapterBase()}${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    throw new Error(data.error || `vekas adapter HTTP ${res.status}`)
  }
  return data
}

export async function ensureFgVekasLotsSchema(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_fg_vekas_lots (
      lot_row_id BIGSERIAL PRIMARY KEY,
      site_id INT NOT NULL REFERENCES wms_sites(site_id),
      item_id BIGINT NOT NULL REFERENCES wms_items(item_id),
      vekas_server TEXT NOT NULL,
      vekas_batch_id TEXT NOT NULL,
      batch_number TEXT NOT NULL,
      gtin TEXT NULL,
      bottles INT NOT NULL DEFAULT 0,
      blocks INT NOT NULL DEFAULT 0,
      pallet_count INT NOT NULL DEFAULT 0,
      pallet_codes TEXT[] NOT NULL DEFAULT '{}',
      pallet_qty_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      production_date DATE NULL,
      plan_id BIGINT NULL REFERENCES wms_production_plans(plan_id) ON DELETE SET NULL,
      watch_id BIGINT NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (site_id, vekas_server, vekas_batch_id)
    );
    CREATE INDEX IF NOT EXISTS ix_wms_fg_vekas_lots_item
      ON wms_fg_vekas_lots(site_id, item_id);
    CREATE INDEX IF NOT EXISTS ix_wms_fg_vekas_lots_batch
      ON wms_fg_vekas_lots(site_id, batch_number);
  `)
}

async function countBottles(server: VekasServer, batchId: string): Promise<number> {
  const validated = await adapterJson<{ total?: number }>(
    `/api/wms/vekas/batches/${encodeURIComponent(batchId)}/codes?server=${server}&validatedOnly=1&take=1`
  )
  const validatedTotal = Number(validated.total || 0)
  if (validatedTotal > 0) return validatedTotal
  const all = await adapterJson<{ total?: number }>(
    `/api/wms/vekas/batches/${encodeURIComponent(batchId)}/codes?server=${server}&validatedOnly=0&take=1`
  )
  return Number(all.total || 0)
}

async function listPallets(
  server: VekasServer,
  batchId: string
): Promise<{ codes: string[]; qtyByCode: Array<{ palletId: string; quantity: number | null }> }> {
  const data = await adapterJson<{ items?: AdapterPallet[]; total?: number }>(
    `/api/wms/vekas/batches/${encodeURIComponent(batchId)}/pallets?server=${server}`
  )
  const codes: string[] = []
  const qtyByCode: Array<{ palletId: string; quantity: number | null }> = []
  const seen = new Set<string>()
  for (const row of data.items ?? []) {
    const id = String(row.palletId || "").trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    codes.push(id)
    const qty = row.quantity == null ? null : Number(row.quantity)
    qtyByCode.push({ palletId: id, quantity: Number.isFinite(qty) ? qty : null })
  }
  return { codes, qtyByCode }
}

export async function importVekasBatchToFg(
  client: PoolClient,
  siteId: number,
  input: {
    vekasServer: VekasServer
    vekasBatchId: string
    batchNumber?: string | null
    gtin?: string | null
    productName?: string | null
    productionDate?: string | null
    bottles?: number | null
    planId?: string | null
    watchId?: string | null
    requirePlan?: boolean
  }
): Promise<{ imported: boolean; skipped?: string; bottles?: number; pallets?: number }> {
  await ensureFgVekasLotsSchema(client)
  if (input.requirePlan !== false && !input.planId) {
    return { imported: false, skipped: "нет плана производства" }
  }
  const batchNumber = String(input.batchNumber || "").trim() || String(input.vekasBatchId).trim()
  if (!batchNumber) return { imported: false, skipped: "нет номера партии" }

  let bottles = input.bottles == null ? 0 : Math.max(0, Math.round(Number(input.bottles) || 0))
  if (bottles <= 0) {
    try {
      bottles = await countBottles(input.vekasServer, input.vekasBatchId)
    } catch {
      bottles = 0
    }
  }

  let pallets: { codes: string[]; qtyByCode: Array<{ palletId: string; quantity: number | null }> } = {
    codes: [],
    qtyByCode: [],
  }
  try {
    pallets = await listPallets(input.vekasServer, input.vekasBatchId)
  } catch {
    pallets = { codes: [], qtyByCode: [] }
  }

  const palletBottles = pallets.qtyByCode.reduce((sum, row) => sum + (row.quantity && row.quantity > 0 ? row.quantity : 0), 0)
  if (bottles <= 0 && palletBottles > 0) bottles = palletBottles
  const blocks = blocksFromBottles(bottles)
  const palletCount = pallets.codes.length

  if (bottles <= 0 && palletCount <= 0) {
    return { imported: false, skipped: "нет бутылок и палет" }
  }

  const gtin = (input.gtin || "").trim()
  const name = (input.productName || "").trim() || (gtin ? `GTIN ${gtin}` : batchNumber)
  const card = gtin ? await ensureFinishedGoodsCard(client, siteId, gtin, name) : null
  const item = await resolveItemByCodeOrBarcode(client, siteId, card?.itemCode || gtin || batchNumber)
  if (!item) {
    return { imported: false, skipped: `нет номенклатуры для ${batchNumber}` }
  }

  const prodDate = (input.productionDate || "").trim().slice(0, 10) || null
  await client.query(
    `INSERT INTO wms_fg_vekas_lots (
       site_id, item_id, vekas_server, vekas_batch_id, batch_number, gtin,
       bottles, blocks, pallet_count, pallet_codes, pallet_qty_json,
       production_date, plan_id, watch_id, imported_at, updated_at
     ) VALUES (
       $1, $2::bigint, $3, $4, $5, $6,
       $7, $8, $9, $10::text[], $11::jsonb,
       $12::date, $13::bigint, $14::bigint, now(), now()
     )
     ON CONFLICT (site_id, vekas_server, vekas_batch_id) DO UPDATE SET
       item_id = EXCLUDED.item_id,
       batch_number = EXCLUDED.batch_number,
       gtin = COALESCE(EXCLUDED.gtin, wms_fg_vekas_lots.gtin),
       bottles = EXCLUDED.bottles,
       blocks = EXCLUDED.blocks,
       pallet_count = EXCLUDED.pallet_count,
       pallet_codes = EXCLUDED.pallet_codes,
       pallet_qty_json = EXCLUDED.pallet_qty_json,
       production_date = COALESCE(EXCLUDED.production_date, wms_fg_vekas_lots.production_date),
       plan_id = COALESCE(EXCLUDED.plan_id, wms_fg_vekas_lots.plan_id),
       watch_id = COALESCE(EXCLUDED.watch_id, wms_fg_vekas_lots.watch_id),
       updated_at = now()`,
    [
      siteId,
      item.item_id,
      input.vekasServer,
      input.vekasBatchId,
      batchNumber,
      gtin || null,
      bottles,
      blocks,
      palletCount,
      pallets.codes,
      JSON.stringify(pallets.qtyByCode),
      prodDate,
      input.planId || null,
      input.watchId || null,
    ]
  )
  return { imported: true, bottles, pallets: palletCount }
}

export async function loadFgVekasLotAggs(client: PoolClient, siteId: number): Promise<FgVekasLotAgg[]> {
  await ensureFgVekasLotsSchema(client)
  const r = await client.query<{
    itemCode: string
    itemName: string
    gtin: string | null
    bottles: string
    blocks: string
    pallets: string
    batches: string[] | null
    productionDate: string | null
  }>(
    `SELECT
       i.item_code AS "itemCode",
       i.name AS "itemName",
       COALESCE(
         (
           SELECT b.barcode FROM wms_item_barcodes b
           WHERE b.item_id = i.item_id AND b.is_primary
           ORDER BY b.created_at DESC LIMIT 1
         ),
         MAX(l.gtin)
       ) AS gtin,
       SUM(l.bottles)::text AS bottles,
       SUM(l.blocks)::text AS blocks,
       SUM(l.pallet_count)::text AS pallets,
       array_agg(DISTINCT l.batch_number) FILTER (WHERE l.batch_number IS NOT NULL AND BTRIM(l.batch_number) <> '') AS batches,
       MIN(l.production_date)::text AS "productionDate"
     FROM wms_fg_vekas_lots l
     JOIN wms_items i ON i.item_id = l.item_id
     WHERE l.site_id = $1
     GROUP BY i.item_id, i.item_code, i.name`,
    [siteId]
  )
  return r.rows.map((row) => ({
    itemCode: row.itemCode,
    itemName: row.itemName,
    gtin: row.gtin,
    bottles: Number(row.bottles) || 0,
    blocks: Number(row.blocks) || 0,
    pallets: Number(row.pallets) || 0,
    batches: (row.batches ?? []).map((b) => String(b).trim()).filter(Boolean),
    palletCodes: [],
    productionDate: row.productionDate,
  }))
}

export type FgVekasLotDetail = {
  batchNumber: string
  gtin: string | null
  bottles: number
  blocks: number
  palletCount: number
  palletCodes: string[]
  palletQty: Array<{ palletId: string; quantity: number | null }>
  productionDate: string | null
  vekasServer: string
}

export async function listFgVekasLotsForItem(
  client: PoolClient,
  siteId: number,
  itemCode: string,
  gtin?: string | null
): Promise<FgVekasLotDetail[]> {
  await ensureFgVekasLotsSchema(client)
  const code = String(itemCode || "").trim()
  const g = gtinKey(gtin) || gtinKey(code)
  if (!code && !g) return []
  const r = await client.query<{
    batchNumber: string
    gtin: string | null
    bottles: string
    blocks: string
    palletCount: string
    palletCodes: string[] | null
    palletQtyJson: unknown
    productionDate: string | null
    vekasServer: string
  }>(
    `SELECT
       l.batch_number AS "batchNumber",
       l.gtin,
       l.bottles::text AS bottles,
       l.blocks::text AS blocks,
       l.pallet_count::text AS "palletCount",
       l.pallet_codes AS "palletCodes",
       l.pallet_qty_json AS "palletQtyJson",
       l.production_date::text AS "productionDate",
       l.vekas_server AS "vekasServer"
     FROM wms_fg_vekas_lots l
     JOIN wms_items i ON i.item_id = l.item_id
     WHERE l.site_id = $1
       AND (
         i.item_code = $2
         OR ($3 <> '' AND regexp_replace(COALESCE(l.gtin, ''), '\\D', '', 'g') = $3)
         OR ($3 <> '' AND regexp_replace(COALESCE(i.item_code, ''), '\\D', '', 'g') = $3)
       )
     ORDER BY l.production_date DESC NULLS LAST, l.batch_number, l.lot_row_id`,
    [siteId, code, g || ""]
  )
  return r.rows.map((row) => {
    const qtyRaw = Array.isArray(row.palletQtyJson) ? row.palletQtyJson : []
    const palletQty: Array<{ palletId: string; quantity: number | null }> = []
    for (const elem of qtyRaw) {
      if (!elem || typeof elem !== "object") continue
      const rec = elem as { palletId?: unknown; quantity?: unknown }
      const palletId = String(rec.palletId || "").trim()
      if (!palletId) continue
      const qty = rec.quantity == null ? null : Number(rec.quantity)
      palletQty.push({ palletId, quantity: Number.isFinite(qty) ? qty : null })
    }
    const palletCodes = (row.palletCodes ?? []).map((c) => String(c).trim()).filter(Boolean)
    return {
      batchNumber: String(row.batchNumber || "").trim(),
      gtin: row.gtin,
      bottles: Number(row.bottles) || 0,
      blocks: Number(row.blocks) || 0,
      palletCount: Number(row.palletCount) || palletCodes.length,
      palletCodes,
      palletQty,
      productionDate: row.productionDate,
      vekasServer: row.vekasServer,
    }
  })
}

function placementOf(produced: number, placed: number): "unplaced" | "partial" | "placed" | undefined {
  if (produced <= 0 && placed <= 0) return undefined
  if (placed <= 0 && produced > 0) return "unplaced"
  const slack = Math.max(6, Math.round(produced * 0.05))
  if (produced - placed > slack) return "partial"
  return "placed"
}

export function mergeVekasLotsIntoFgNomenclature(
  rows: FgNomenclatureRow[],
  lots: FgVekasLotAgg[],
  query = ""
): FgNomenclatureRow[] {
  const used = new Set<string>()
  const merged = rows.map((row) => {
    const keys = [gtinKey(row.gtin), gtinKey(row.itemCode), row.itemCode].filter(Boolean) as string[]
    const lot = lots.find(
      (item) =>
        item.itemCode === row.itemCode ||
        keys.includes(gtinKey(item.gtin) || "") ||
        keys.includes(item.itemCode)
    )
    if (!lot) {
      const placedBottles = row.placedBottles ?? 0
      return {
        ...row,
        placement: placementOf(row.bottles, placedBottles),
        unplacedBottles: Math.max(0, row.bottles - placedBottles),
        unplacedBlocks: Math.max(0, row.blocks - (row.placedBlocks ?? 0)),
        unplacedPallets: Math.max(0, row.pallets - (row.placedPallets ?? 0)),
      }
    }
    used.add(lot.itemCode)
    const bottles = Math.max(row.bottles, lot.bottles)
    const blocks = Math.max(row.blocks, lot.blocks)
    const pallets = Math.max(row.pallets, lot.pallets)
    const placedBottles = row.placedBottles ?? 0
    const placedBlocks = row.placedBlocks ?? 0
    const placedPallets = row.placedPallets ?? 0
    const lotCodes = uniquePlantBatches([...(row.lotCodes ?? []), ...lot.batches])
    return {
      ...row,
      bottles,
      blocks,
      pallets,
      lotCodes,
      oldestProductionAt: row.oldestProductionAt || (lot.productionDate ? `${lot.productionDate}T00:00:00.000Z` : null),
      placement: placementOf(bottles, placedBottles),
      unplacedBottles: Math.max(0, bottles - placedBottles),
      unplacedBlocks: Math.max(0, blocks - placedBlocks),
      unplacedPallets: Math.max(0, pallets - placedPallets),
    }
  })

  const q = query.trim().toLowerCase()
  const extras: FgNomenclatureRow[] = []
  for (const lot of lots) {
    if (used.has(lot.itemCode)) continue
    if (
      q &&
      !lot.itemName.toLowerCase().includes(q) &&
      !lot.itemCode.toLowerCase().includes(q) &&
      !(lot.gtin || "").toLowerCase().includes(q) &&
      !lot.batches.some((b) => b.toLowerCase().includes(q))
    ) {
      continue
    }
    extras.push({
      itemCode: lot.itemCode,
      name: lot.itemName,
      gtin: lot.gtin || lot.itemCode,
      productGroup: "finished_goods",
      bottles: lot.bottles,
      blocks: lot.blocks,
      pallets: lot.pallets,
      markingCodesCount: 0,
      placedBottles: 0,
      placedBlocks: 0,
      placedPallets: 0,
      planRows: [],
      productionLineCode: null,
      productionLineName: null,
      lotCodes: uniquePlantBatches(lot.batches),
      nearestExpiryAt: null,
      oldestProductionAt: lot.productionDate ? `${lot.productionDate}T00:00:00.000Z` : null,
      tags: [],
      statuses: fgEmptyItemStatuses(),
      expiryCritical: 0,
      expiryWarning: 0,
      expiryOk: lot.bottles,
      placement: lot.bottles > 0 || lot.pallets > 0 ? "unplaced" : undefined,
      unplacedBottles: lot.bottles,
      unplacedBlocks: lot.blocks,
      unplacedPallets: lot.pallets,
    })
  }

  const combined = [...extras, ...merged]
  combined.sort((a, b) => {
    const ua = a.unplacedBottles ?? 0
    const ub = b.unplacedBottles ?? 0
    if (ua !== ub && (ua > 0 || ub > 0)) return ub - ua
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

export async function overlayVekasLotsOnPallets(
  client: PoolClient,
  siteId: number,
  rows: FgPalletRow[],
  query = ""
): Promise<FgPalletRow[]> {
  await ensureFgVekasLotsSchema(client)
  const existing = new Set(rows.map((row) => row.palletCode.replace(/\s+/g, "")))
  const q = query.trim().toLowerCase()
  const cap = q ? 400 : 120
  const r = await client.query<{
    palletCode: string
    itemCode: string
    itemName: string
    bottles: string
    blocks: string
    productionDate: string | null
    batchNumber: string
  }>(
    `SELECT
       code AS "palletCode",
       i.item_code AS "itemCode",
       i.name AS "itemName",
       COALESCE((
         SELECT (elem->>'quantity')::int
         FROM jsonb_array_elements(l.pallet_qty_json) elem
         WHERE elem->>'palletId' = code
         LIMIT 1
       ), 0)::text AS bottles,
       l.blocks::text AS blocks,
       l.production_date::text AS "productionDate",
       l.batch_number AS "batchNumber"
     FROM wms_fg_vekas_lots l
     JOIN wms_items i ON i.item_id = l.item_id
     CROSS JOIN LATERAL unnest(l.pallet_codes) AS code
     WHERE l.site_id = $1
       AND BTRIM(code) <> ''
       AND (
         $2::text = ''
         OR lower(code) LIKE $3
         OR lower(i.name) LIKE $3
         OR lower(i.item_code) LIKE $3
         OR lower(l.batch_number) LIKE $3
       )
     ORDER BY l.imported_at DESC NULLS LAST, l.lot_row_id DESC
     LIMIT $4`,
    [siteId, q, q ? `%${q}%` : "", cap]
  )
  const extras: FgPalletRow[] = []
  for (const row of r.rows) {
    const code = String(row.palletCode || "").trim()
    if (!code || existing.has(code.replace(/\s+/g, ""))) continue
    if (
      q &&
      !code.toLowerCase().includes(q) &&
      !row.itemName.toLowerCase().includes(q) &&
      !row.itemCode.toLowerCase().includes(q) &&
      !row.batchNumber.toLowerCase().includes(q)
    ) {
      continue
    }
    const bottles = Number(row.bottles) || 0
    extras.push({
      palletId: `vekas:${code}`,
      palletCode: code,
      itemCode: row.itemCode,
      itemName: row.itemName,
      locationCode: "—",
      rowLabel: "Не размещена",
      blocks: bottles > 0 ? blocksFromBottles(bottles) : Number(row.blocks) || 0,
      bottles,
      markingCodesCount: 0,
      producedAt: row.productionDate ? `${row.productionDate}T00:00:00.000Z` : null,
      expiresAt: null,
      tags: [],
      statuses: fgEmptyItemStatuses(),
    })
    existing.add(code.replace(/\s+/g, ""))
  }
  return extras.length ? [...extras, ...rows] : rows
}
