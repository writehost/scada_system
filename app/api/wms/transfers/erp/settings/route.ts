import { NextResponse } from "next/server"
import { readAuthTokenFromRequest } from "@/lib/auth/request-token"
import { verifySessionToken } from "@/lib/auth/session"
import { tryConnect, tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import {
  getTransferSyncSettings,
  listErpTransferOrders,
  saveTransferSyncSettings,
  syncTransferCatalogsFromOneC,
  type TransferSyncSettings,
} from "@/lib/wms/one-c-transfer-orders"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 180

async function requireSession(req: Request) {
  const token = await readAuthTokenFromRequest(req)
  return token ? await verifySessionToken(token) : null
}

export async function GET(req: Request) {
  const session = await requireSession(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const url = new URL(req.url)
  const siteCode = url.searchParams.get("siteCode")?.trim() || ""
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })

  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message }, { status: conn.status })

  try {
    const siteId = await getSiteId(conn.client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const data = await listErpTransferOrders(conn.client, siteId, { limit: 1 })
    return NextResponse.json({
      defaults: data.defaults,
      catalogs: data.catalogs,
      warehouses: data.warehouses,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "не удалось прочитать настройки перемещения"
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    conn.client.release()
  }
}

export async function POST(req: Request) {
  const session = await requireSession(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    siteCode?: string
    syncCatalogs?: boolean
    defaults?: Partial<TransferSyncSettings>
  }
  const siteCode = String(body.siteCode || "").trim()
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })

  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message }, { status: conn.status })

  try {
    const siteId = await getSiteId(conn.client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })

    let defaults = await getTransferSyncSettings(conn.client, siteId)
    if (body.defaults && typeof body.defaults === "object") {
      defaults = await saveTransferSyncSettings(conn.client, siteId, body.defaults)
    }
    const catalogs = body.syncCatalogs
      ? (await syncTransferCatalogsFromOneC(conn.client, siteId)).catalogs
      : (await listErpTransferOrders(conn.client, siteId, { limit: 1 })).catalogs
    const listed = await listErpTransferOrders(conn.client, siteId, { limit: 1 })
    return NextResponse.json({
      ok: true,
      defaults,
      catalogs: body.syncCatalogs ? catalogs : listed.catalogs,
      warehouses: listed.warehouses,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "не удалось сохранить настройки перемещения"
    return NextResponse.json({ error: message }, { status: 502 })
  } finally {
    conn.client.release()
  }
}
