import { NextResponse } from "next/server"
import { readAuthTokenFromRequest } from "@/lib/auth/request-token"
import { verifySessionToken } from "@/lib/auth/session"
import { isLocalRequest } from "@/lib/wms/local-request"
import { tryConnect, tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import {
  getTransferSyncSettings,
  saveTransferSyncSettings,
  syncTransferOrdersFromOneC,
} from "@/lib/wms/one-c-transfer-orders"
import { humanizeOneCError } from "@/lib/wms/one-c-erp"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    siteCode?: string
    mode?: string
    skip?: number
    cron?: boolean
    continuous?: boolean
  }
  const cron = body.cron === true
  if (cron && !isLocalRequest(req)) {
    return NextResponse.json({ error: "cron sync is local-only" }, { status: 403 })
  }
  if (!cron) {
    const token = await readAuthTokenFromRequest(req)
    const session = token ? await verifySessionToken(token) : null
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const siteCode = String(body.siteCode || "DEFAULT").trim()
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message }, { status: conn.status })

  try {
    const siteId = await getSiteId(conn.client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })

    if (typeof body.continuous === "boolean") {
      const settings = await saveTransferSyncSettings(conn.client, siteId, { continuous: body.continuous })
      return NextResponse.json({ ok: true, settings })
    }

    const current = await getTransferSyncSettings(conn.client, siteId)
    if (cron && !current.continuous) {
      return NextResponse.json({ ok: true, skipped: true, reason: "continuous_disabled" })
    }

    const mode = body.mode === "full" ? "full" : "incremental"
    const result = await syncTransferOrdersFromOneC(conn.client, siteId, {
      mode,
      skip: Number(body.skip || 0),
      siteCode,
    })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "не удалось выгрузить заказы 1С"
    try {
      const siteId = await getSiteId(conn.client, siteCode)
      if (siteId != null) {
        await saveTransferSyncSettings(conn.client, siteId, { lastError: humanizeOneCError(error, true) })
      }
    } catch {
      /* ignore */
    }
    return NextResponse.json({ error: message }, { status: 502 })
  } finally {
    conn.client.release()
  }
}
