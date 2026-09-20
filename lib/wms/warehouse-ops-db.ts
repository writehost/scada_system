import type { PoolClient } from "pg"

/** Дни с последнего движения (кроме ревизии). Нет движения — null. */
export async function loadLastMovementDays(
  client: PoolClient,
  siteId: number,
  itemCodes: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (itemCodes.length === 0) return out
  try {
    const r = await client.query<{ itemCode: string; lastAt: Date | string }>(
      `SELECT i.item_code AS "itemCode",
              MAX(m.movement_at) AS "lastAt"
       FROM wms_stock_movements m
       JOIN wms_items i ON i.item_id = m.item_id AND i.site_id = m.site_id
       LEFT JOIN ref_wms_movement_type mt ON mt.movement_type_id = m.movement_type_id
       WHERE m.site_id = $1
         AND i.item_code = ANY($2::text[])
         AND (mt.code IS NULL OR mt.code <> 'revision_adjustment')
       GROUP BY i.item_code`,
      [siteId, itemCodes]
    )
    const now = Date.now()
    for (const row of r.rows) {
      const t = new Date(row.lastAt).getTime()
      if (Number.isNaN(t)) continue
      out.set(row.itemCode, Math.max(0, Math.round((now - t) / 86_400_000)))
    }
  } catch (error) {
    console.error("[warehouse-ops] last movement", error)
  }
  return out
}

export type OutboundUsage = {
  qty: number
  moves: number
  daysSince: number | null
}

const OUTBOUND_CODES = ["issue", "production_consume", "pick", "ship", "dispatch"]

/** Расход за период: выдача, consume, отбор, отгрузка. Приёмка не входит. */
export async function loadOutboundUsage(
  client: PoolClient,
  siteId: number,
  itemCodes: string[],
  periodDays = 90
): Promise<Map<string, OutboundUsage>> {
  const out = new Map<string, OutboundUsage>()
  if (itemCodes.length === 0) return out
  const period = periodDays > 0 ? periodDays : 90
  try {
    const r = await client.query<{ itemCode: string; qty: string | number; moves: string | number; lastAt: Date | string | null }>(
      `SELECT i.item_code AS "itemCode",
              COALESCE(SUM(ABS(m.qty)), 0) AS qty,
              COUNT(*)::int AS moves,
              MAX(m.movement_at) AS "lastAt"
       FROM wms_stock_movements m
       JOIN wms_items i ON i.item_id = m.item_id AND i.site_id = m.site_id
       LEFT JOIN ref_wms_movement_type mt ON mt.movement_type_id = m.movement_type_id
       WHERE m.site_id = $1
         AND i.item_code = ANY($2::text[])
         AND m.movement_at >= NOW() - ($3::int * INTERVAL '1 day')
         AND COALESCE(mt.code, '') = ANY($4::text[])
       GROUP BY i.item_code`,
      [siteId, itemCodes, period, OUTBOUND_CODES]
    )
    const now = Date.now()
    const seen = new Set<string>()
    for (const row of r.rows) {
      const t = row.lastAt ? new Date(row.lastAt).getTime() : NaN
      out.set(row.itemCode, {
        qty: Number(row.qty) || 0,
        moves: Number(row.moves) || 0,
        daysSince: Number.isNaN(t) ? period : Math.max(0, Math.round((now - t) / 86_400_000)),
      })
      seen.add(row.itemCode)
    }
    for (const code of itemCodes) {
      if (!seen.has(code)) out.set(code, { qty: 0, moves: 0, daysSince: period })
    }
  } catch (error) {
    console.error("[warehouse-ops] outbound usage", error)
  }
  return out
}

export async function loadItemAttrsByCode(
  client: PoolClient,
  siteId: number,
  itemCodes: string[]
): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>()
  if (itemCodes.length === 0) return out
  const r = await client.query<{ itemCode: string; itemAttrs: unknown }>(
    `SELECT item_code AS "itemCode", item_attrs_json AS "itemAttrs"
     FROM wms_items
     WHERE site_id = $1 AND item_code = ANY($2::text[])`,
    [siteId, itemCodes]
  )
  for (const row of r.rows) out.set(row.itemCode, row.itemAttrs)
  return out
}
