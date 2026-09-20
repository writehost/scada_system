import { NextResponse } from "next/server"
import type { PoolClient } from "pg"
import { tryConnect, tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message"
import { evaluateShipLot, remainingShelfDays, type ShipLotPreview, type ShipRuleRow } from "@/lib/wms/ship-rules"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function ensureMarks(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_ship_rules (
      site_id INT NOT NULL REFERENCES wms_sites(site_id),
      rule_code TEXT NOT NULL,
      name TEXT NOT NULL,
      group_code TEXT NULL,
      required_layers INT NULL,
      min_remaining_days INT NULL,
      note TEXT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INT NOT NULL DEFAULT 100,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, rule_code)
    )
  `)
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_lot_ship_marks (
      site_id INT NOT NULL REFERENCES wms_sites(site_id),
      item_code TEXT NOT NULL,
      lot_code TEXT NOT NULL,
      rule_code TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, item_code, lot_code)
    )
  `)
}

async function loadRule(client: PoolClient, siteId: number, code: string): Promise<ShipRuleRow | null> {
  const r = await client.query(
    `SELECT rule_code AS code, name, group_code AS "groupCode", required_layers AS "requiredLayers",
            min_remaining_days AS "minRemainingDays", note, is_active AS "isActive"
     FROM wms_ship_rules WHERE site_id = $1 AND rule_code = $2`,
    [siteId, code]
  )
  return (r.rows[0] as ShipRuleRow | undefined) ?? null
}

export async function GET(req: Request) {
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const url = new URL(req.url)
  const siteCode = url.searchParams.get("siteCode") ?? ""
  const ruleCode = (url.searchParams.get("ruleCode") ?? "").trim().toLowerCase()
  if (!siteCode.trim()) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  if (!ruleCode) return NextResponse.json({ error: "ruleCode is required" }, { status: 400 })

  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status })
  try {
    const siteId = await getSiteId(conn.client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    await ensureMarks(conn.client)
    await conn.client.query(
      `INSERT INTO wms_ship_rules (
         site_id, rule_code, name, group_code, required_layers, min_remaining_days, note, sort_order
       ) VALUES ($1, 'x5', 'Пятёрочка / X5', 'water', 4, 20,
         'Часто 4 слоя и свежая продукция. Партию помечаем под этого контрагента.', 10)
       ON CONFLICT (site_id, rule_code) DO NOTHING`,
      [siteId]
    )
    const rule = await loadRule(conn.client, siteId, ruleCode)
    if (!rule) return NextResponse.json({ error: "unknown ruleCode" }, { status: 404 })

    const lots = await conn.client.query<{
      item_code: string
      item_name: string
      lot_code: string
      bottles: string
      layers: string | null
      expiry_at: Date | null
      manufactured_at: Date | null
      reserved_rule: string | null
      reserved_name: string | null
    }>(
      `SELECT
         i.item_code,
         i.name AS item_name,
         COALESCE(wl.lot_code, sl.lot_code) AS lot_code,
         SUM(sl.available_qty)::text AS bottles,
         NULLIF(i.item_attrs_json->'nomenclature'->'packing'->>'layers', '') AS layers,
         MIN(LEAST(
           COALESCE(sl.expiry_at, 'infinity'::timestamptz),
           COALESCE(wl.expiry_at, 'infinity'::timestamptz),
           COALESCE(wl.best_before_at, 'infinity'::timestamptz)
         )) FILTER (
           WHERE LEAST(
             COALESCE(sl.expiry_at, 'infinity'::timestamptz),
             COALESCE(wl.expiry_at, 'infinity'::timestamptz),
             COALESCE(wl.best_before_at, 'infinity'::timestamptz)
           ) < 'infinity'::timestamptz
         ) AS expiry_at,
         MIN(wl.manufactured_at) AS manufactured_at,
         m.rule_code AS reserved_rule,
         sr.name AS reserved_name
       FROM wms_stock_lots sl
       JOIN wms_stock_balances sb ON sb.balance_id = sl.balance_id
       JOIN wms_items i ON i.item_id = sb.item_id AND i.site_id = sb.site_id
       LEFT JOIN wms_lots wl ON (
         (sl.lot_id IS NOT NULL AND wl.lot_id = sl.lot_id)
         OR (sl.lot_id IS NULL AND wl.site_id = sb.site_id AND wl.item_id = sb.item_id AND wl.lot_code = sl.lot_code)
       )
       LEFT JOIN wms_lot_ship_marks m
         ON m.site_id = sb.site_id AND m.item_code = i.item_code AND m.lot_code = COALESCE(wl.lot_code, sl.lot_code)
       LEFT JOIN wms_ship_rules sr ON sr.site_id = m.site_id AND sr.rule_code = m.rule_code
       WHERE sb.site_id = $1
         AND sl.available_qty > 0
         AND COALESCE(wl.lot_code, sl.lot_code) IS NOT NULL
         AND BTRIM(COALESCE(wl.lot_code, sl.lot_code)) <> ''
         AND (
           $2::text IS NULL
           OR $2 = ''
           OR i.item_group_code = $2
           OR i.item_attrs_json->'nomenclature'->>'groupId' = $2
           OR i.item_attrs_json->'nomenclature'->>'groupName' ILIKE '%' || $2 || '%'
           OR i.name ILIKE '%вод%'
           OR i.name ILIKE '%тархун%'
           OR i.name ILIKE '%шмаков%'
         )
       GROUP BY i.item_code, i.name, COALESCE(wl.lot_code, sl.lot_code),
                i.item_attrs_json->'nomenclature'->'packing'->>'layers',
                m.rule_code, sr.name
       ORDER BY i.name, COALESCE(wl.lot_code, sl.lot_code)`,
      [siteId, rule.groupCode]
    )

    const preview: ShipLotPreview[] = lots.rows.map((row) => {
      const remainingDays = remainingShelfDays(row.expiry_at)
      const layers = row.layers != null ? Number(row.layers) : null
      const judged = evaluateShipLot(
        {
          remainingDays,
          layers: Number.isFinite(layers) ? layers : null,
          reservedRuleCode: row.reserved_rule,
        },
        rule
      )
      return {
        itemCode: row.item_code,
        itemName: row.item_name,
        lotCode: row.lot_code,
        bottles: Number(row.bottles) || 0,
        layers: Number.isFinite(layers) ? layers : null,
        expiryAt: row.expiry_at ? new Date(row.expiry_at).toISOString() : null,
        manufacturedAt: row.manufactured_at ? new Date(row.manufactured_at).toISOString() : null,
        remainingDays,
        reservedRuleCode: row.reserved_rule,
        reservedRuleName: row.reserved_name,
        ...judged,
      }
    })

    return NextResponse.json({
      rule,
      lots: preview,
      eligibleCount: preview.filter((x) => x.eligible).length,
    })
  } catch (e) {
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e) }, { status: 500 })
  } finally {
    conn.client.release()
  }
}

export async function POST(req: Request) {
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const siteCode = String(body.siteCode ?? "").trim()
  const itemCode = String(body.itemCode ?? "").trim()
  const lotCode = String(body.lotCode ?? "").trim()
  const ruleCode = String(body.ruleCode ?? "").trim().toLowerCase()
  const clear = body.clear === true
  if (!siteCode || !itemCode || !lotCode) {
    return NextResponse.json({ error: "siteCode, itemCode and lotCode are required" }, { status: 400 })
  }
  if (!clear && !ruleCode) {
    return NextResponse.json({ error: "ruleCode is required" }, { status: 400 })
  }

  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status })
  try {
    const siteId = await getSiteId(conn.client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    await ensureMarks(conn.client)
    if (clear) {
      await conn.client.query(
        `DELETE FROM wms_lot_ship_marks WHERE site_id = $1 AND item_code = $2 AND lot_code = $3`,
        [siteId, itemCode, lotCode]
      )
      return NextResponse.json({ ok: true, cleared: true })
    }
    const rule = await loadRule(conn.client, siteId, ruleCode)
    if (!rule) return NextResponse.json({ error: "unknown ruleCode" }, { status: 404 })
    await conn.client.query(
      `INSERT INTO wms_lot_ship_marks (site_id, item_code, lot_code, rule_code, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (site_id, item_code, lot_code)
       DO UPDATE SET rule_code = EXCLUDED.rule_code, updated_at = now()`,
      [siteId, itemCode, lotCode, ruleCode]
    )
    return NextResponse.json({ ok: true, ruleCode })
  } catch (e) {
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e) }, { status: 500 })
  } finally {
    conn.client.release()
  }
}
