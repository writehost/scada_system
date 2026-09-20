import { NextResponse } from "next/server"
import { findReceivingBatch, lookupReceivingBatch } from "@/lib/wms/receiving-batches"
import { resolveDefaultSiteId } from "@/lib/wms/cell-scan-view"
import { getSiteId } from "@/lib/wms/resolve"
import { tryGetPool } from "@/lib/wms/pool"
import { WmsHttpError } from "@/lib/wms/errors"
import { extractItemImageUrl } from "@/lib/wms/item-image"
import type { PoolClient } from "pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function enrichItemAndStock(
  client: PoolClient,
  siteId: number,
  itemCode: string | null | undefined,
  cellCode: string | null | undefined
): Promise<{
  itemName: string | null
  imageUrl: string | null
  productGroup: string | null
  itemClassCode: string | null
  stockAvailableQty: number | null
  nearestExpiryAt: string | null
}> {
  const code = (itemCode ?? "").trim()
  if (!code) {
    return {
      itemName: null,
      imageUrl: null,
      productGroup: null,
      itemClassCode: null,
      stockAvailableQty: null,
      nearestExpiryAt: null,
    }
  }

  const item = await client.query<{
    name: string
    productGroup: string | null
    itemClassCode: string | null
    itemAttrsJson: unknown
  }>(
    `SELECT
       i.name,
       i.product_group AS "productGroup",
       i.item_class_code AS "itemClassCode",
       i.item_attrs_json AS "itemAttrsJson"
     FROM wms_items i
     WHERE i.site_id = $1 AND i.item_code = $2
     LIMIT 1`,
    [siteId, code]
  )
  const row = item.rows[0]
  const attrs =
    row?.itemAttrsJson && typeof row.itemAttrsJson === "object" && !Array.isArray(row.itemAttrsJson)
      ? (row.itemAttrsJson as Record<string, unknown>)
      : null

  let stockAvailableQty: number | null = null
  let nearestExpiryAt: string | null = null
  const cell = (cellCode ?? "").trim()
  if (cell) {
    const stock = await client.query<{
      availableQty: number
      nearestExpiryAt: string | null
    }>(
      `SELECT
         sb.available_qty::float8 AS "availableQty",
         (
           SELECT MIN(COALESCE(wl.expiry_at, wl.best_before_at))::text
           FROM wms_stock_lots sl2
           JOIN wms_lots wl ON wl.lot_id = sl2.lot_id AND wl.site_id = sb.site_id
           WHERE sl2.balance_id = sb.balance_id
             AND (COALESCE(sl2.available_qty, 0) + COALESCE(sl2.in_production_qty, 0) + COALESCE(sl2.reserved_qty, 0)) > 0
         ) AS "nearestExpiryAt"
       FROM wms_stock_balances sb
       JOIN wms_items i ON i.item_id = sb.item_id AND i.site_id = sb.site_id
       JOIN wms_locations l ON l.location_id = sb.location_id AND l.site_id = sb.site_id
       WHERE sb.site_id = $1
         AND i.item_code = $2
         AND l.location_code = $3
       LIMIT 1`,
      [siteId, code, cell]
    )
    if (stock.rows[0]) {
      stockAvailableQty = Number(stock.rows[0].availableQty)
      nearestExpiryAt = stock.rows[0].nearestExpiryAt
    }
  }

  return {
    itemName: row?.name?.trim() || null,
    imageUrl: extractItemImageUrl(attrs),
    productGroup: row?.productGroup?.trim() || null,
    itemClassCode: row?.itemClassCode?.trim() || null,
    stockAvailableQty: Number.isFinite(stockAvailableQty as number) ? stockAvailableQty : null,
    nearestExpiryAt,
  }
}

export async function GET(req: Request, segmentData: { params: Promise<{ code: string }> }) {
  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 })
  }

  const params = await segmentData.params
  const batchCode = decodeURIComponent(params.code ?? "").trim()
  if (!batchCode) {
    return NextResponse.json({ error: "batch code is required" }, { status: 400 })
  }

  const url = new URL(req.url)
  const siteCode = url.searchParams.get("siteCode")?.trim() || ""
  const fallbackCell = url.searchParams.get("cell")?.trim() || null
  const fallbackItem = url.searchParams.get("item")?.trim() || null
  const fallbackGtin = url.searchParams.get("gtin")?.trim() || null
  const fallbackQty = Number(url.searchParams.get("qty") ?? "")

  const client = await pool.connect()
  try {
    const siteId = siteCode
      ? await getSiteId(client, siteCode)
      : await resolveDefaultSiteId(client)
    if (siteId == null) {
      return NextResponse.json({ error: "site not found" }, { status: 404 })
    }

    try {
      const result = await lookupReceivingBatch(client, siteId, batchCode)
      const enrich = await enrichItemAndStock(
        client,
        siteId,
        result.batch?.itemCode ?? fallbackItem,
        result.currentLocationCode ?? result.batch?.cellCode ?? fallbackCell
      )
      return NextResponse.json({
        ...result,
        batch: result.batch
          ? {
              ...result.batch,
              itemName: result.batch.itemName || enrich.itemName || result.batch.itemCode,
              imageUrl: enrich.imageUrl,
              productGroup: enrich.productGroup,
              itemClassCode: enrich.itemClassCode,
              expiresAtIso: result.batch.expiresAtIso || enrich.nearestExpiryAt,
            }
          : result.batch,
        stockAvailableQty: result.stockAvailableQty ?? enrich.stockAvailableQty,
        source: "batch",
      })
    } catch (e) {
      if (!(e instanceof WmsHttpError) || e.status !== 404) {
        throw e
      }
      const row = await findReceivingBatch(client, siteId, batchCode)
      if (row) {
        const enrich = await enrichItemAndStock(client, siteId, row.itemCode, row.cellCode)
        return NextResponse.json({
          batch: {
            ...row,
            itemName: row.itemName || enrich.itemName || row.itemCode,
            imageUrl: enrich.imageUrl,
            productGroup: enrich.productGroup,
            itemClassCode: enrich.itemClassCode,
            expiresAtIso: row.expiresAtIso || enrich.nearestExpiryAt,
          },
          documentQty: null,
          stockAvailableQty: enrich.stockAvailableQty,
          stockInProductionQty: null,
          lotCode: null,
          currentLocationCode: row.cellCode,
          source: "batch",
        })
      }
      if (fallbackCell || fallbackItem) {
        const enrich = await enrichItemAndStock(client, siteId, fallbackItem, fallbackCell)
        const qtyFromQr = Number.isFinite(fallbackQty) && fallbackQty > 0 ? fallbackQty : null
        return NextResponse.json({
          batch: {
            batchCode,
            documentId: null,
            itemCode: fallbackItem,
            itemName: enrich.itemName || fallbackItem,
            imageUrl: enrich.imageUrl,
            productGroup: enrich.productGroup,
            itemClassCode: enrich.itemClassCode,
            gtin: fallbackGtin,
            qty: qtyFromQr ?? enrich.stockAvailableQty,
            cellCode: fallbackCell,
            emissionAtIso: null,
            expiresAtIso: enrich.nearestExpiryAt,
            createdAt: new Date().toISOString(),
            deviceUid: null,
          },
          documentQty: null,
          stockAvailableQty: enrich.stockAvailableQty,
          stockInProductionQty: null,
          lotCode: null,
          currentLocationCode: fallbackCell,
          source: "qr_fallback",
        })
      }
      return NextResponse.json({ error: "batch sticker not found" }, { status: 404 })
    }
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error("[GET /api/s/batch]", error)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  } finally {
    client.release()
  }
}
