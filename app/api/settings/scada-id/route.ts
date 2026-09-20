import { NextResponse } from "next/server"
import { readAuthTokenFromRequest } from "@/lib/auth/request-token"
import { verifySessionToken } from "@/lib/auth/session"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { WmsHttpError } from "@/lib/wms/errors"
import {
  getScadaIdSettings,
  maskScadaIdSettings,
  saveScadaIdSettings,
} from "@/lib/wms/scada-id"
import { canonicalSiteCode } from "@/lib/wms/site-code"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isAdmin(roleCodes?: string[]) {
  return Boolean(roleCodes?.includes("admin"))
}

async function requireAdmin(req: Request) {
  const token = await readAuthTokenFromRequest(req).catch(() => null)
  const session = token ? await verifySessionToken(token) : null
  if (!session) throw new WmsHttpError(401, "Нужен вход в WMS", "auth_required")
  if (!isAdmin(session.roleCodes)) {
    throw new WmsHttpError(403, "Только администратор WMS", "admin_required")
  }
  return session
}

function fail(error: unknown) {
  if (error instanceof WmsHttpError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }
  console.error(error)
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
}

export async function GET(req: Request) {
  try {
    await requireAdmin(req)
    const siteCode = canonicalSiteCode(new URL(req.url).searchParams.get("siteCode"))
    const pool = tryGetPool()
    if (!pool) throw new WmsHttpError(503, "database not configured", "no_database")
    const client = await pool.connect()
    try {
      const siteId = await getSiteId(client, siteCode)
      if (siteId == null) throw new WmsHttpError(404, "unknown siteCode", "unknown_site")
      const settings = await getScadaIdSettings(client, siteId)
      return NextResponse.json({ settings: maskScadaIdSettings(settings) })
    } finally {
      client.release()
    }
  } catch (error) {
    return fail(error)
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireAdmin(req)
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const siteCode = canonicalSiteCode(String(body.siteCode || ""))
    const pool = tryGetPool()
    if (!pool) throw new WmsHttpError(503, "database not configured", "no_database")
    const client = await pool.connect()
    try {
      const siteId = await getSiteId(client, siteCode)
      if (siteId == null) throw new WmsHttpError(404, "unknown siteCode", "unknown_site")
      const settings = await saveScadaIdSettings(client, siteId, body, {
        login: session.login,
        fio: session.fio,
      })
      return NextResponse.json({ settings: maskScadaIdSettings(settings), ok: true })
    } finally {
      client.release()
    }
  } catch (error) {
    return fail(error)
  }
}
