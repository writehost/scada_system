import { NextResponse } from "next/server"
import { tryConnect, tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type DeleteBody = {
  siteCode?: string
  id?: string
  code?: string
}

export async function POST(req: Request) {
  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 })
  }

  let body: DeleteBody
  try {
    body = (await req.json()) as DeleteBody
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }

  const siteCode = (body.siteCode ?? "").trim()
  const id = (body.id ?? "").trim()
  const code = (body.code ?? "").trim()
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  if (!id && !code) return NextResponse.json({ error: "id or code is required" }, { status: 400 })

  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status })
  try {
    const siteId = await getSiteId(conn.client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })

    const wh = await conn.client.query<{ warehouse_id: string; warehouse_code: string }>(
      id
        ? `SELECT warehouse_id::text, warehouse_code FROM wms_warehouses WHERE site_id = $1 AND warehouse_id = $2::bigint`
        : `SELECT warehouse_id::text, warehouse_code FROM wms_warehouses WHERE site_id = $1 AND warehouse_code = $2`,
      id ? [siteId, id] : [siteId, code]
    )
    const row = wh.rows[0]
    if (!row) return NextResponse.json({ error: "warehouse not found" }, { status: 404 })

    const usage = await conn.client.query<{ zone_count: string; location_count: string }>(
      `
      SELECT
        (SELECT COUNT(*)::text FROM wms_zones z WHERE z.warehouse_id = $1::bigint) AS zone_count,
        (SELECT COUNT(*)::text FROM wms_locations l WHERE l.warehouse_id = $1::bigint) AS location_count
      `,
      [row.warehouse_id]
    )
    const zoneCount = Number(usage.rows[0]?.zone_count) || 0
    const locationCount = Number(usage.rows[0]?.location_count) || 0
    if (locationCount > 0) {
      return NextResponse.json(
        { error: `Нельзя удалить: ${locationCount} ячеек привязано к складу/цеху.` },
        { status: 409 }
      )
    }
    if (zoneCount > 0) {
      await conn.client.query(`DELETE FROM wms_zones WHERE warehouse_id = $1::bigint`, [row.warehouse_id])
    }

    await conn.client.query(
      `UPDATE wms_warehouses SET is_active = FALSE, status_code = 'ARCHIVED', updated_at = now() WHERE warehouse_id = $1::bigint`,
      [row.warehouse_id]
    )
    return NextResponse.json({ ok: true, id: row.warehouse_id, code: row.warehouse_code })
  } catch (e) {
    console.error("[directories/warehouses/delete POST]", e)
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e) }, { status: 500 })
  } finally {
    conn.client.release()
  }
}
