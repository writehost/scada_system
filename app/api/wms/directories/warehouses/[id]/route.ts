import { NextResponse } from "next/server"
import { tryConnect, tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message"
import {
  getWarehouseRow,
  normalizeWarehouseStatus,
  statusToIsActive,
} from "@/lib/wms/warehouse-directory-query"
import { mergeWarehouseMeta, type WarehouseMeta } from "@/lib/wms/warehouse-directory-meta"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 })
  }
  const siteCode = new URL(req.url).searchParams.get("siteCode") ?? ""
  const { id } = await ctx.params
  if (!siteCode.trim()) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  if (!id?.trim()) return NextResponse.json({ error: "id is required" }, { status: 400 })

  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status })
  try {
    const siteId = await getSiteId(conn.client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const warehouse = await getWarehouseRow(conn.client, siteId, id)
    if (!warehouse) return NextResponse.json({ error: "not found" }, { status: 404 })
    return NextResponse.json({ warehouse })
  } catch (e) {
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e) }, { status: 500 })
  } finally {
    conn.client.release()
  }
}

type PatchBody = {
  siteCode?: string
  code?: string
  name?: string
  shortName?: string | null
  description?: string | null
  status?: string
  warehouseType?: string
  meta?: Partial<WarehouseMeta>
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 })
  }
  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const siteCode = (body.siteCode ?? "").trim()
  const { id } = await ctx.params
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  if (!id?.trim()) return NextResponse.json({ error: "id is required" }, { status: 400 })

  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status })
  try {
    const siteId = await getSiteId(conn.client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const current = await getWarehouseRow(conn.client, siteId, id)
    if (!current) return NextResponse.json({ error: "not found" }, { status: 404 })

    const nextCode = body.code !== undefined ? body.code.trim() : current.code
    const nextName = body.name !== undefined ? body.name.trim() : current.name
    if (!nextCode) return NextResponse.json({ error: "code is required" }, { status: 400 })
    if (!nextName) return NextResponse.json({ error: "name is required" }, { status: 400 })
    const statusCode =
      body.status !== undefined ? normalizeWarehouseStatus(body.status) : current.status
    const warehouseType =
      body.warehouseType !== undefined ? body.warehouseType.trim() || "MAIN" : current.warehouseType
    const nextMeta = { ...mergeWarehouseMeta(current.meta), ...(body.meta ?? {}) }

    if (nextCode !== current.code) {
      const dup = await conn.client.query(
        `SELECT 1 FROM wms_warehouses WHERE site_id = $1 AND warehouse_code = $2 AND warehouse_id <> $3::bigint`,
        [siteId, nextCode, id]
      )
      if (dup.rowCount && dup.rowCount > 0) {
        return NextResponse.json({ error: "warehouse code already exists" }, { status: 409 })
      }
    }

    await conn.client.query(
      `UPDATE wms_warehouses SET
         warehouse_code = $3,
         name = $4,
         short_name = $5,
         description = $6,
         status_code = $7,
         warehouse_type = $8,
         is_active = $9,
         meta_json = $10::jsonb,
         updated_at = now()
       WHERE site_id = $1 AND warehouse_id = $2::bigint`,
      [
        siteId,
        id,
        nextCode,
        nextName,
        body.shortName !== undefined ? body.shortName?.trim() || null : current.shortName,
        body.description !== undefined ? body.description?.trim() || null : current.description,
        statusCode,
        warehouseType,
        statusToIsActive(statusCode),
        JSON.stringify(nextMeta),
      ]
    )
    const warehouse = await getWarehouseRow(conn.client, siteId, id)
    return NextResponse.json({ warehouse })
  } catch (e) {
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e) }, { status: 500 })
  } finally {
    conn.client.release()
  }
}
