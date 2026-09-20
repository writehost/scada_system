import { NextResponse } from "next/server"
import { tryConnect, tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message"
import {
  listWarehouseRows,
  normalizeWarehouseStatus,
  statusToIsActive,
  warehouseMetaFromBody,
  getWarehouseRow,
} from "@/lib/wms/warehouse-directory-query"
import type { WarehouseMeta } from "@/lib/wms/warehouse-directory-meta"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 })
  }
  const siteCode = new URL(req.url).searchParams.get("siteCode") ?? ""
  if (!siteCode.trim()) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })

  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status })
  try {
    const siteId = await getSiteId(conn.client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const warehouses = await listWarehouseRows(conn.client, siteId)
    return NextResponse.json({ warehouses })
  } catch (e) {
    console.error("[directories/warehouses GET]", e)
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e) }, { status: 500 })
  } finally {
    conn.client.release()
  }
}

type PostBody = {
  siteCode?: string
  code?: string
  name?: string
  shortName?: string | null
  description?: string | null
  status?: string
  warehouseType?: string
  meta?: Partial<WarehouseMeta>
}

export async function POST(req: Request) {
  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 })
  }
  let body: PostBody
  try {
    body = (await req.json()) as PostBody
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }

  const siteCode = (body.siteCode ?? "").trim()
  const code = (body.code ?? "").trim()
  const name = (body.name ?? "").trim()
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  if (!code) return NextResponse.json({ error: "code is required" }, { status: 400 })
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })

  const statusCode = normalizeWarehouseStatus(body.status)
  const warehouseType = (body.warehouseType ?? "MAIN").trim() || "MAIN"
  const meta = warehouseMetaFromBody(body.meta)

  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status })
  try {
    const siteId = await getSiteId(conn.client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const dup = await conn.client.query(
      `SELECT warehouse_id::text FROM wms_warehouses WHERE site_id = $1 AND warehouse_code = $2`,
      [siteId, code]
    )
    if (dup.rows.length > 0) {
      return NextResponse.json({ error: "warehouse code already exists" }, { status: 409 })
    }
    const ins = await conn.client.query<{ warehouse_id: string }>(
      `INSERT INTO wms_warehouses (
         site_id, warehouse_code, name, short_name, description,
         status_code, warehouse_type, is_active, meta_json, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now(), now())
       RETURNING warehouse_id::text`,
      [
        siteId,
        code,
        name,
        body.shortName?.trim() || null,
        body.description?.trim() || null,
        statusCode,
        warehouseType,
        statusToIsActive(statusCode),
        JSON.stringify(meta),
      ]
    )
    const id = ins.rows[0]?.warehouse_id
    if (!id) return NextResponse.json({ error: "insert failed" }, { status: 500 })
    const warehouse = await getWarehouseRow(conn.client, siteId, id)
    return NextResponse.json({ warehouse })
  } catch (e) {
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e) }, { status: 500 })
  } finally {
    conn.client.release()
  }
}
