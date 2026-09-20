import { NextResponse } from "next/server"
import { readAuthTokenFromRequest } from "@/lib/auth/request-token"
import { verifySessionToken } from "@/lib/auth/session"
import { tryConnect, tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { getOneCSettings, syncNomenclatureFromOneC } from "@/lib/wms/one-c-erp"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function POST(req: Request) {
  const token = await readAuthTokenFromRequest(req)
  const session = token ? await verifySessionToken(token) : null
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { siteCode?: string }
  const siteCode = String(body.siteCode || "").trim()
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })

  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })

  const settings = await getOneCSettings(siteCode)
  if (!settings.baseUrl.trim() || !settings.login.trim()) {
    return NextResponse.json(
      { error: "Сначала сохраните URL, логин и пароль 1С ERP в Настройки → Интеграции" },
      { status: 400 }
    )
  }

  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message }, { status: conn.status })

  try {
    const siteId = await getSiteId(conn.client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const result = await syncNomenclatureFromOneC(conn.client, siteId, settings)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "не удалось синхронизировать 1С"
    return NextResponse.json({ error: message }, { status: 502 })
  } finally {
    conn.client.release()
  }
}
