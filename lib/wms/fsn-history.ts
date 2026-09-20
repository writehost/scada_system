import type { PoolClient } from "pg"
import {
  classifyFsn,
  normalizeFsnDays,
  type FsnItemClass,
  type FsnMovementStat,
  type FsnPeriodDays,
} from "@/lib/wms/fsn"

const OUTBOUND = [
  "shipping",
  "picking",
  "issue",
  "interwarehouse_ship",
  "ship",
  "pick",
  "shipment",
]

export async function loadFsnMovementStats(
  client: PoolClient,
  siteId: number,
  days: FsnPeriodDays,
  itemCodes: string[]
): Promise<FsnMovementStat[]> {
  if (itemCodes.length === 0) return []
  try {
    const r = await client.query<{ itemCode: string; moves: string; qty: string }>(
      `SELECT i.item_code AS "itemCode",
              COUNT(*)::text AS moves,
              COALESCE(SUM(ABS(m.qty)), 0)::text AS qty
       FROM wms_stock_movements m
       JOIN wms_items i ON i.item_id = m.item_id AND i.site_id = m.site_id
       LEFT JOIN ref_wms_movement_type mt ON mt.movement_type_id = m.movement_type_id
       WHERE m.site_id = $1
         AND m.movement_at >= now() - make_interval(days => $2::int)
         AND i.item_code = ANY($3::text[])
         AND (
           mt.code IS NULL
           OR mt.code <> 'revision_adjustment'
         )
       GROUP BY i.item_code`,
      [siteId, days, itemCodes]
    )
    const fromMoves = r.rows.map((row) => ({
      itemCode: row.itemCode,
      moves: Number(row.moves) || 0,
      qty: Number(row.qty) || 0,
    }))
    if (fromMoves.some((row) => row.moves > 0)) return fromMoves
  } catch (error) {
    console.error("[fsn] stock movements", error)
  }

  try {
    const r = await client.query<{ itemCode: string; moves: string; qty: string }>(
      `SELECT i.item_code AS "itemCode",
              COUNT(*)::text AS moves,
              COALESCE(SUM(ABS(COALESCE(t.planned_qty, 0))), 0)::text AS qty
       FROM wms_tasks t
       JOIN wms_items i ON i.item_id = t.item_id
       JOIN ref_wms_task_type tt ON tt.task_type_id = t.task_type_id
       WHERE t.site_id = $1
         AND i.item_code = ANY($3::text[])
         AND t.completed_at >= now() - make_interval(days => $2::int)
         AND LOWER(tt.code) = ANY($4::text[])
       GROUP BY i.item_code`,
      [siteId, days, itemCodes, OUTBOUND]
    )
    return r.rows.map((row) => ({
      itemCode: row.itemCode,
      moves: Number(row.moves) || 0,
      qty: Number(row.qty) || 0,
    }))
  } catch (error) {
    console.error("[fsn] tasks fallback", error)
    return []
  }
}

export async function classifyFgFsn(
  client: PoolClient,
  siteId: number,
  itemCodes: string[],
  daysRaw?: unknown
): Promise<Map<string, FsnItemClass>> {
  const days = normalizeFsnDays(daysRaw)
  const stats = await loadFsnMovementStats(client, siteId, days, itemCodes)
  return classifyFsn(stats, itemCodes, days)
}
