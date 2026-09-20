import { NextResponse } from "next/server"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { WmsHttpError } from "@/lib/wms/errors"
import { requireWmsActor } from "@/lib/wms/require-actor"
import { actOnMissingCode } from "@/lib/wms/receiving-rules"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true })
  if ("error" in actorGate) return actorGate.error

  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 })
  }
  let body: {
    siteCode?: string
    code?: string
    action?: "bind" | "create" | "hold"
    itemCode?: string
    itemName?: string
    comment?: string | null
    deviceUid?: string
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const siteCode = String(body.siteCode ?? "").trim()
  const code = String(body.code ?? "").trim()
  const action = body.action
  if (!siteCode || !code || (action !== "bind" && action !== "create" && action !== "hold")) {
    return NextResponse.json({ error: "siteCode, code and action are required" }, { status: 400 })
  }
  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const result = await actOnMissingCode(client, siteId, {
      code,
      action,
      itemCode: body.itemCode,
      itemName: body.itemName,
      comment: body.comment,
      deviceUid: body.deviceUid,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error("[POST /api/wms/receiving/missing-nomenclature]", error)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  } finally {
    client.release()
  }
}
