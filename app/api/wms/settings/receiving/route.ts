import { NextResponse } from "next/server"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { WmsHttpError } from "@/lib/wms/errors"
import { requireWmsActor } from "@/lib/wms/require-actor"
import { requireWmsSession } from "@/lib/wms/require-session"
import { parseReceivingSiteRules } from "@/lib/receiving-scan-policy"
import { loadReceivingSiteRules, saveReceivingSiteRules } from "@/lib/wms/receiving-rules"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true })
  if ("error" in actorGate) return actorGate.error

  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 })
  }
  const url = new URL(req.url)
  const siteCode = (url.searchParams.get("siteCode") ?? "").trim()
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  }
  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const rules = await loadReceivingSiteRules(client, siteId)
    return NextResponse.json({ ok: true, rules })
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error("[GET /api/wms/settings/receiving]", error)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  } finally {
    client.release()
  }
}

export async function PUT(req: Request) {
  const auth = await requireWmsSession(req)
  if ("error" in auth) return auth.error

  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 })
  }
  let body: { siteCode?: string; rules?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }
  const siteCode = String(body.siteCode ?? "").trim()
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  }
  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const rules = await saveReceivingSiteRules(client, siteId, parseReceivingSiteRules(body.rules))
    return NextResponse.json({ ok: true, rules })
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error("[PUT /api/wms/settings/receiving]", error)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  } finally {
    client.release()
  }
}
