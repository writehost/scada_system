import { NextResponse } from "next/server"
import { isLocalRequest } from "@/lib/wms/local-request"
import { upsertPrintTerminal } from "@/lib/wms/print-terminal"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Body = {
  siteCode?: string
  deviceId?: string
  device_id?: string
  deviceName?: string
  device_name?: string
  appVersion?: string
  app_version?: string
}

export async function POST(req: Request) {
  if (!isLocalRequest(req)) {
    return NextResponse.json({ error: "printer heartbeat is local-only" }, { status: 403 })
  }

  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    )
  }

  let body: Body = {}
  try {
    body = (await req.json()) as Body
  } catch {
    body = {}
  }

  const siteCode = String(body.siteCode || "DEFAULT").trim() || "DEFAULT"
  const rawDeviceId = String(body.deviceId || body.device_id || "").trim()
  if (!rawDeviceId) {
    return NextResponse.json({ error: "deviceId is required" }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    }
    const device = await upsertPrintTerminal(client, siteId, {
      rawDeviceId,
      deviceName: String(body.deviceName || body.device_name || "").trim() || undefined,
      appVersion: String(body.appVersion || body.app_version || "").trim() || undefined,
    })
    return NextResponse.json({ ok: true, device })
  } finally {
    client.release()
  }
}
