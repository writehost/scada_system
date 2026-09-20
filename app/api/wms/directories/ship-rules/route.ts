import { NextResponse } from "next/server"
import { tryConnect, tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message"
import type { PoolClient } from "pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SEED = [
  {
    code: "x5",
    name: "Пятёрочка / X5",
    groupCode: "water",
    layers: 4,
    minRemainingDays: 20,
    note: "Часто 4 слоя и свежая продукция. Партию помечаем под этого контрагента.",
  },
]

async function ensureTable(client: PoolClient) {
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
}

async function seedDefaults(client: PoolClient, siteId: number) {
  for (const row of SEED) {
    await client.query(
      `INSERT INTO wms_ship_rules (
         site_id, rule_code, name, group_code, required_layers, min_remaining_days, note, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,10)
       ON CONFLICT (site_id, rule_code) DO NOTHING`,
      [siteId, row.code, row.name, row.groupCode, row.layers, row.minRemainingDays, row.note]
    )
  }
}

function mapRow(row: Record<string, unknown>) {
  return {
    code: row.rule_code ?? row.code,
    name: row.name,
    groupCode: row.group_code ?? row.groupCode ?? null,
    requiredLayers: row.required_layers ?? row.requiredLayers ?? null,
    minRemainingDays: row.min_remaining_days ?? row.minRemainingDays ?? null,
    note: row.note ?? null,
    isActive: row.is_active ?? row.isActive ?? true,
    sortOrder: row.sort_order ?? row.sortOrder ?? 100,
  }
}

export async function GET(req: Request) {
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const siteCode = new URL(req.url).searchParams.get("siteCode") ?? ""
  if (!siteCode.trim()) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status })
  try {
    const siteId = await getSiteId(conn.client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    await ensureTable(conn.client)
    await seedDefaults(conn.client, siteId)
    const r = await conn.client.query(
      `SELECT rule_code, name, group_code, required_layers, min_remaining_days, note, is_active, sort_order
       FROM wms_ship_rules WHERE site_id = $1
       ORDER BY sort_order, name`,
      [siteId]
    )
    return NextResponse.json({ rules: r.rows.map((row) => mapRow(row)) })
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
  const code = String(body.code ?? "").trim().toLowerCase()
  const name = String(body.name ?? "").trim()
  if (!siteCode || !code || !name) {
    return NextResponse.json({ error: "siteCode, code and name are required" }, { status: 400 })
  }
  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status })
  try {
    const siteId = await getSiteId(conn.client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    await ensureTable(conn.client)
    await conn.client.query(
      `INSERT INTO wms_ship_rules (
         site_id, rule_code, name, group_code, required_layers, min_remaining_days, note, is_active, sort_order, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       ON CONFLICT (site_id, rule_code) DO UPDATE SET
         name = EXCLUDED.name,
         group_code = EXCLUDED.group_code,
         required_layers = EXCLUDED.required_layers,
         min_remaining_days = EXCLUDED.min_remaining_days,
         note = EXCLUDED.note,
         is_active = EXCLUDED.is_active,
         sort_order = EXCLUDED.sort_order,
         updated_at = now()`,
      [
        siteId,
        code,
        name,
        String(body.groupCode ?? "").trim() || null,
        body.requiredLayers != null ? Number(body.requiredLayers) : null,
        body.minRemainingDays != null ? Number(body.minRemainingDays) : null,
        String(body.note ?? "").trim() || null,
        body.isActive !== false,
        Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 100,
      ]
    )
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e) }, { status: 500 })
  } finally {
    conn.client.release()
  }
}

export async function PATCH(req: Request) {
  return POST(req)
}

export async function DELETE(req: Request) {
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const url = new URL(req.url)
  const siteCode = url.searchParams.get("siteCode") ?? ""
  const code = url.searchParams.get("code") ?? ""
  if (!siteCode.trim() || !code.trim()) {
    return NextResponse.json({ error: "siteCode and code are required" }, { status: 400 })
  }
  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status })
  try {
    const siteId = await getSiteId(conn.client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    await ensureTable(conn.client)
    await conn.client.query(`DELETE FROM wms_ship_rules WHERE site_id = $1 AND rule_code = $2`, [
      siteId,
      code.trim(),
    ])
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e) }, { status: 500 })
  } finally {
    conn.client.release()
  }
}
