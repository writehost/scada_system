import type { PoolClient } from "pg"
import { classifyFsn, normalizeFsnDays, type FsnPeriodDays } from "@/lib/wms/fsn"
import { loadFsnMovementStats } from "@/lib/wms/fsn-history"
import {
  abcxyzCell,
  classifyAbc,
  classifyXyz,
  computeCoi,
  type SkuDemandProfile,
  type WeeklyMovementStat,
} from "@/lib/wms/sku-demand"

const OUTBOUND = [
  "shipping",
  "picking",
  "issue",
  "interwarehouse_ship",
  "ship",
  "pick",
  "shipment",
]

export async function loadWeeklyMovementStats(
  client: PoolClient,
  siteId: number,
  days: FsnPeriodDays,
  itemCodes: string[]
): Promise<WeeklyMovementStat[]> {
  if (itemCodes.length === 0) return []
  try {
    const r = await client.query<{ itemCode: string; week: string; moves: string; qty: string }>(
      `SELECT i.item_code AS "itemCode",
              to_char(date_trunc('week', m.movement_at), 'YYYY-MM-DD') AS week,
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
       GROUP BY i.item_code, date_trunc('week', m.movement_at)`,
      [siteId, days, itemCodes]
    )
    const fromMoves = r.rows.map((row) => ({
      itemCode: row.itemCode,
      week: row.week,
      moves: Number(row.moves) || 0,
      qty: Number(row.qty) || 0,
    }))
    if (fromMoves.some((row) => row.moves > 0)) return fromMoves
  } catch (error) {
    console.error("[sku-demand] weekly movements", error)
  }

  try {
    const r = await client.query<{ itemCode: string; week: string; moves: string; qty: string }>(
      `SELECT i.item_code AS "itemCode",
              to_char(date_trunc('week', t.completed_at), 'YYYY-MM-DD') AS week,
              COUNT(*)::text AS moves,
              COALESCE(SUM(ABS(COALESCE(t.planned_qty, 0))), 0)::text AS qty
       FROM wms_tasks t
       JOIN wms_items i ON i.item_id = t.item_id
       JOIN ref_wms_task_type tt ON tt.task_type_id = t.task_type_id
       WHERE t.site_id = $1
         AND i.item_code = ANY($3::text[])
         AND t.completed_at >= now() - make_interval(days => $2::int)
         AND LOWER(tt.code) = ANY($4::text[])
       GROUP BY i.item_code, date_trunc('week', t.completed_at)`,
      [siteId, days, itemCodes, OUTBOUND]
    )
    return r.rows.map((row) => ({
      itemCode: row.itemCode,
      week: row.week,
      moves: Number(row.moves) || 0,
      qty: Number(row.qty) || 0,
    }))
  } catch (error) {
    console.error("[sku-demand] weekly tasks fallback", error)
    return []
  }
}

export async function classifyFgDemand(
  client: PoolClient,
  siteId: number,
  itemCodes: string[],
  daysRaw?: unknown,
  occupiedM3ByCode?: Map<string, number>
): Promise<Map<string, SkuDemandProfile>> {
  const days = normalizeFsnDays(daysRaw)
  const unique = [...new Set(itemCodes.map((c) => String(c || "").trim()).filter(Boolean))]
  const [stats, weekly] = await Promise.all([
    loadFsnMovementStats(client, siteId, days, unique),
    loadWeeklyMovementStats(client, siteId, days, unique),
  ])
  const fsnMap = classifyFsn(stats, unique, days)
  const abcMap = classifyAbc(stats, unique)
  const xyzMap = classifyXyz(weekly, unique, days)
  const out = new Map<string, SkuDemandProfile>()
  for (const itemCode of unique) {
    const fsn = fsnMap.get(itemCode)
    const abc = abcMap.get(itemCode)
    const xyz = xyzMap.get(itemCode)
    const moves = fsn?.moves ?? 0
    const occupiedM3 = occupiedM3ByCode?.get(itemCode) ?? null
    const abcCode = abc?.abc ?? "C"
    const xyzCode = xyz?.xyz ?? "Z"
    out.set(itemCode, {
      itemCode,
      periodDays: days,
      moves,
      qty: fsn?.qty ?? 0,
      fsn: fsn?.fsn ?? "N",
      abc: abcCode,
      xyz: xyzCode,
      abcxyz: abcxyzCell(abcCode, xyzCode),
      cv: xyz?.cv ?? null,
      weeksWithMoves: xyz?.weeksWithMoves ?? 0,
      occupiedM3,
      coi: computeCoi(occupiedM3, moves),
    })
  }
  return out
}
