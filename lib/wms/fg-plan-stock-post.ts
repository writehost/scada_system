import type { PoolClient } from "pg"
import { ensureWmsLot } from "@/lib/wms/documents"
import { WmsHttpError } from "@/lib/wms/errors"
import {
  readFgPlanInventory,
  writeFgPlanInventory,
  type FgPlanInventorySlot,
} from "@/lib/wms/fg-plan-inventory-storage"
import { canonicalPlanRowId } from "@/lib/wms/fg-plan-location-codes"
import { attachSessionCodesToFgLocation, resolveOrCreateFgPlanLocation } from "@/lib/wms/fg-plan-locations"
import {
  slotBottleQty,
  slotExpiryIso,
  slotEffectiveProductionDateIso,
  slotLotCode,
  slotPostDelta,
  summarizePlanStock,
  type FgPlanPostedMarker,
} from "@/lib/wms/fg-plan-stock-helpers"
import { commercialGtin, ensureFinishedGoodsCard } from "@/lib/wms/fg-product-from-label"
import { resolveItemByCodeOrBarcode } from "@/lib/wms/resolve"

export type FgPlanStockPreview = {
  occupiedSlots: number
  pendingSlots: number
  postedSlots: number
  pendingPallets: number
  pendingBottles: number
}

export type FgPlanStockPostLine = {
  address: string
  planRowId: string
  locationCode: string
  itemCode: string
  itemName: string
  gtin: string
  qty: number
  lotCode: string
  skipped: boolean
  reason?: string
}

export type FgPlanStockPostResult = {
  posted: number
  skipped: number
  failed: number
  bottles: number
  pallets: number
  lines: FgPlanStockPostLine[]
  preview: FgPlanStockPreview
}

async function loadPostedMarkers(
  client: PoolClient,
  siteId: number
): Promise<Record<string, FgPlanPostedMarker>> {
  const r = await client.query<{ posted: unknown }>(
    `
    SELECT l.location_attrs_json->'fgPlanPosted' AS posted
    FROM wms_locations l
    JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
    WHERE l.site_id = $1
      AND (
        w.warehouse_code ILIKE 'FG%'
        OR COALESCE(w.warehouse_type, '') ILIKE '%FINISH%'
        OR COALESCE(w.name, '') ILIKE '%готов%'
        OR COALESCE(l.location_attrs_json->>'fgRow', '') = 'true'
      )
      AND l.location_attrs_json ? 'fgPlanPosted'
    `,
    [siteId]
  )
  const out: Record<string, FgPlanPostedMarker> = {}
  for (const row of r.rows) {
    const raw = row.posted
    if (!raw || typeof raw !== "object") continue
    for (const [address, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue
      const rec = value as Record<string, unknown>
      const qty = Number(rec.qty)
      if (!Number.isFinite(qty) || qty <= 0) continue
      out[address] = {
        qty,
        palletId: rec.palletId ? String(rec.palletId) : undefined,
        itemCode: rec.itemCode ? String(rec.itemCode) : undefined,
        at: rec.at ? String(rec.at) : undefined,
      }
    }
  }
  return out
}

async function writePostedMarker(
  client: PoolClient,
  locationId: string,
  address: string,
  marker: FgPlanPostedMarker
) {
  await client.query(
    `
    UPDATE wms_locations
    SET
      location_attrs_json = jsonb_set(
        COALESCE(location_attrs_json, '{}'::jsonb),
        '{fgPlanPosted}',
        COALESCE(location_attrs_json->'fgPlanPosted', '{}'::jsonb) || $2::jsonb
      ),
      updated_at = now()
    WHERE location_id = $1::bigint
    `,
    [locationId, JSON.stringify({ [address]: marker })]
  )
}

async function receiveQty(
  client: PoolClient,
  siteId: number,
  input: {
    itemId: string
    locationId: string
    qty: number
    lotCode: string
    batchLabel?: string
    manufacturedAt?: string | null
    expiryAt?: string | null
  }
) {
  await client.query(
    `INSERT INTO wms_stock_balances (site_id, location_id, item_id, accuracy_status_id)
     VALUES ($1, $2::bigint, $3::bigint, 1)
     ON CONFLICT (site_id, location_id, item_id) DO NOTHING`,
    [siteId, input.locationId, input.itemId]
  )
  const balance = await client.query<{ balance_id: string }>(
    `SELECT balance_id::text AS balance_id
     FROM wms_stock_balances
     WHERE site_id = $1 AND location_id = $2::bigint AND item_id = $3::bigint`,
    [siteId, input.locationId, input.itemId]
  )
  const balanceId = balance.rows[0]?.balance_id
  if (!balanceId) {
    throw new WmsHttpError(500, "Не удалось создать остаток", "fg_plan_balance_failed")
  }
  await client.query(
    `UPDATE wms_stock_balances
     SET available_qty = available_qty + $1, updated_at = now()
     WHERE balance_id = $2::bigint`,
    [input.qty, balanceId]
  )
  const lotId = await ensureWmsLot(
    client,
    siteId,
    input.itemId,
    input.lotCode,
    input.batchLabel,
    input.manufacturedAt ?? undefined,
    undefined,
    input.expiryAt ?? undefined
  )
  if (!lotId) {
    throw new WmsHttpError(500, "Не удалось создать партию", "fg_plan_lot_failed")
  }
  await client.query(
    `INSERT INTO wms_stock_lots (balance_id, lot_id, lot_code)
     VALUES ($1::bigint, $2::bigint, $3)
     ON CONFLICT (balance_id, lot_code) DO NOTHING`,
    [balanceId, lotId, input.lotCode]
  )
  await client.query(
    `UPDATE wms_stock_lots
     SET available_qty = available_qty + $1, updated_at = now()
     WHERE balance_id = $2::bigint AND lot_id = $3::bigint`,
    [input.qty, balanceId, lotId]
  )
}

export async function previewFgPlanStock(
  client: PoolClient,
  siteId: number
): Promise<FgPlanStockPreview> {
  const snapshot = await readFgPlanInventory(siteId)
  const posted = await loadPostedMarkers(client, siteId)
  return summarizePlanStock(Object.values(snapshot.inventory || {}), posted)
}

export async function postFgPlanInventoryToStock(
  client: PoolClient,
  siteId: number,
  options?: { addresses?: string[] }
): Promise<FgPlanStockPostResult> {
  await client.query("BEGIN")
  try {
  const snapshot = await readFgPlanInventory(siteId)
  const inventory = { ...snapshot.inventory }
  const postedMap = await loadPostedMarkers(client, siteId)
  const wanted = new Set((options?.addresses ?? []).map((a) => a.trim()).filter(Boolean))
  const lines: FgPlanStockPostLine[] = []
  let bottles = 0
  let pallets = 0
  let posted = 0
  let skipped = 0
  let failed = 0
  let inventoryDirty = false

  const slots = Object.values(inventory).filter((slot) => {
    if (slot.status !== "occupied") return false
    if (wanted.size > 0 && !wanted.has(slot.address)) return false
    return true
  })

  for (const slot of slots) {
    const gtin = commercialGtin(slot.gtin)
    const name = String(slot.nomenclature || "").trim() || (gtin ? `GTIN ${gtin}` : slot.address)
    const planRowId = canonicalPlanRowId(slot.address) || slot.address
    const qty = slotPostDelta(slot, postedMap[slot.address])
    if (!gtin) {
      skipped += 1
      lines.push({
        address: slot.address,
        planRowId,
        locationCode: "",
        itemCode: "",
        itemName: name,
        gtin: String(slot.gtin || ""),
        qty: 0,
        lotCode: "",
        skipped: true,
        reason: "Нет GTIN у палеты на плане",
      })
      continue
    }
    if (qty <= 0) {
      skipped += 1
      lines.push({
        address: slot.address,
        planRowId,
        locationCode: "",
        itemCode: slot.stockPostedItemCode || "",
        itemName: name,
        gtin,
        qty: 0,
        lotCode: "",
        skipped: true,
        reason: "Уже на складе",
      })
      continue
    }

    try {
      await client.query("SAVEPOINT fg_plan_slot")
      const card = await ensureFinishedGoodsCard(client, siteId, gtin, name)
      const item = await resolveItemByCodeOrBarcode(client, siteId, card?.itemCode || gtin)
      if (!item) {
        throw new WmsHttpError(404, `Нет карточки ГП для ${gtin}`, "fg_item_missing")
      }
      const loc = await resolveOrCreateFgPlanLocation(client, siteId, planRowId)
      const manufacturedAt = slotEffectiveProductionDateIso(slot)
      const shelf = await client.query<{ shelfLifeDays: number | null }>(
        `SELECT shelf_life_days AS "shelfLifeDays" FROM wms_items WHERE item_id = $1::bigint`,
        [item.item_id]
      )
      const expiryAt = slotExpiryIso(manufacturedAt, shelf.rows[0]?.shelfLifeDays)
      const lotCode = slotLotCode(slot)
      await receiveQty(client, siteId, {
        itemId: item.item_id,
        locationId: loc.locationId,
        qty,
        lotCode,
        batchLabel: String(slot.batch || "").trim() || `План ${slot.address}`,
        manufacturedAt,
        expiryAt,
      })
      if (slot.palletId) {
        try {
          await attachSessionCodesToFgLocation(client, siteId, loc.locationId, {
            codes: [],
            pallets: [
              {
                index: 1,
                palletId: slot.palletId,
                palletCode: slot.palletId,
                itemCode: item.item_code,
                itemName: item.name,
                gtin,
                productionDate: slot.productionDate ?? null,
                bottles: qty,
              },
            ],
          })
        } catch (error) {
          console.error("postFgPlanInventoryToStock attach", slot.address, error)
        }
      }
      const now = new Date().toISOString()
      const marker: FgPlanPostedMarker = {
        qty: slotBottleQty(slot),
        palletId: slot.palletId,
        itemCode: item.item_code,
        at: now,
      }
      await writePostedMarker(client, loc.locationId, slot.address, marker)
      postedMap[slot.address] = marker
      const next: FgPlanInventorySlot = {
        ...slot,
        stockPostedQty: marker.qty,
        stockPostedAt: now,
        stockPostedItemCode: item.item_code,
      }
      inventory[slot.address] = next
      inventoryDirty = true
      posted += 1
      pallets += 1
      bottles += qty
      await client.query("RELEASE SAVEPOINT fg_plan_slot")
      lines.push({
        address: slot.address,
        planRowId: loc.planRowId,
        locationCode: loc.locationCode,
        itemCode: item.item_code,
        itemName: item.name,
        gtin,
        qty,
        lotCode,
        skipped: false,
      })
    } catch (error) {
      try {
        await client.query("ROLLBACK TO SAVEPOINT fg_plan_slot")
      } catch {
        /* no savepoint if BEGIN failed earlier */
      }
      failed += 1
      const reason =
        error instanceof WmsHttpError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Не удалось оприходовать слот"
      console.error("postFgPlanInventoryToStock", slot.address, error)
      lines.push({
        address: slot.address,
        planRowId,
        locationCode: "",
        itemCode: "",
        itemName: name,
        gtin,
        qty,
        lotCode: slotLotCode(slot),
        skipped: true,
        reason,
      })
    }
  }

  if (inventoryDirty) {
    await writeFgPlanInventory(siteId, inventory)
  }

  await client.query("COMMIT")
  return {
    posted,
    skipped,
    failed,
    bottles,
    pallets,
    lines,
    preview: summarizePlanStock(Object.values(inventory), postedMap),
  }
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }
}
