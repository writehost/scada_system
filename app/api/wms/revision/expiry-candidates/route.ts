import { NextResponse } from "next/server"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { ensureWmsStockLotColumns } from "@/lib/wms/ensure-stock-lot-columns"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    )
  }

  const url = new URL(req.url)
  const siteCode = url.searchParams.get("siteCode")?.trim() ?? ""
  const query = url.searchParams.get("query")?.trim() ?? ""
  const horizonRaw = Number(url.searchParams.get("horizonDays") ?? "45")
  const horizonDays = Number.isFinite(horizonRaw)
    ? Math.max(1, Math.min(365, Math.floor(horizonRaw)))
    : 45

  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    }

    await ensureWmsStockLotColumns(client)
    const rows = await client.query(
      `WITH lots AS (
         SELECT
           i.item_code AS "itemCode",
           i.name AS "itemName",
           COALESCE(ig.name, i.product_group, i.item_group_code, 'Без группы') AS "groupName",
           i.rotation_policy AS "rotationPolicy",
           i.is_perishable AS "isPerishable",
           i.expiry_warning_days AS "itemWarningDays",
           w.warehouse_code AS "warehouseCode",
           w.name AS "warehouseName",
           z.zone_code AS "zoneCode",
           z.name AS "zoneName",
           l.location_code AS "locationCode",
           l.display_name AS "locationName",
           wl.lot_id::text AS "lotId",
           wl.lot_code AS "lotCode",
           wl.manufactured_at AS "emissionAt",
           wl.best_before_at AS "bestBeforeAt",
           COALESCE(
             wl.expiry_at,
             sl.expiry_at,
             wl.best_before_at,
             CASE
               WHEN wl.manufactured_at IS NOT NULL AND i.shelf_life_days IS NOT NULL
               THEN wl.manufactured_at + make_interval(days => i.shelf_life_days)
               ELSE NULL
             END
           ) AS "expiryAt",
           COALESCE(wl.received_at, sl.received_at, sl.created_at) AS "receivedAt",
           COALESCE(sl.available_qty, 0)::float8 AS "availableQty",
           COALESCE(sl.in_production_qty, 0)::float8 AS "inProductionQty",
           sb.last_revision_at AS "lastRevisionAt"
         FROM wms_stock_lots sl
         JOIN wms_stock_balances sb ON sb.balance_id = sl.balance_id
         JOIN wms_items i ON i.item_id = sb.item_id AND i.site_id = sb.site_id
         JOIN wms_lots wl ON wl.lot_id = sl.lot_id AND wl.site_id = sb.site_id
         JOIN wms_locations l ON l.location_id = sb.location_id AND l.site_id = sb.site_id
         JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id AND w.site_id = l.site_id
         JOIN wms_zones z ON z.zone_id = l.zone_id
         LEFT JOIN wms_item_groups ig ON ig.site_id = i.site_id AND ig.group_code = i.item_group_code
         WHERE sb.site_id = $1
           AND COALESCE(sl.available_qty, 0) > 0
           AND COALESCE(wl.is_blocked, FALSE) = FALSE
           AND (i.is_perishable = TRUE OR i.rotation_policy = 'fefo')
           AND (
             $3 = ''
             OR lower(i.item_code) LIKE lower('%' || $3 || '%')
             OR lower(i.name) LIKE lower('%' || $3 || '%')
             OR lower(l.location_code) LIKE lower('%' || $3 || '%')
             OR lower(wl.lot_code) LIKE lower('%' || $3 || '%')
           )
       )
       SELECT
         *,
         CASE
           WHEN "expiryAt" IS NULL THEN NULL
           ELSE floor(extract(epoch FROM ("expiryAt" - now())) / 86400)::int
         END AS "daysLeft",
         CASE
           WHEN "expiryAt" IS NULL THEN 'no_date'
           WHEN "expiryAt" < now() THEN 'expired'
           WHEN "expiryAt" <= now() + interval '7 days' THEN 'critical'
           WHEN "expiryAt" <= now() + ($2::int * interval '1 day') THEN 'warning'
           ELSE 'ok'
         END AS "revisionPriority",
         CASE
           WHEN "expiryAt" IS NULL THEN 'Уточнить дату эмиссии/годности'
           WHEN "expiryAt" < now() THEN 'Списать или заблокировать'
           WHEN "expiryAt" <= now() + interval '7 days' THEN 'Срочно проверить и пустить в производство, если годно'
           ELSE 'Проверить коробку и держать первой к выдаче'
         END AS "recommendation"
       FROM lots
       WHERE "expiryAt" IS NULL OR "expiryAt" <= now() + ($2::int * interval '1 day')
       ORDER BY
         CASE
           WHEN "expiryAt" IS NULL THEN 3
           WHEN "expiryAt" < now() THEN 0
           WHEN "expiryAt" <= now() + interval '7 days' THEN 1
           ELSE 2
         END,
         "expiryAt" NULLS LAST,
         "itemName",
         "locationCode"
       LIMIT 500`,
      [siteId, horizonDays, query]
    )

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      horizonDays,
      rows: rows.rows,
    })
  } catch (error) {
    console.error("[GET /api/wms/revision/expiry-candidates]", error)
    const message = error instanceof Error ? error.message : "internal error"
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    client.release()
  }
}
