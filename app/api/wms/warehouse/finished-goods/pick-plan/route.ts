import { NextResponse } from "next/server"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { buildFgPickPlanForTask } from "@/lib/wms/fg-pick-plan"
import { requireWmsSession } from "@/lib/wms/require-session"
import { WmsHttpError } from "@/lib/wms/errors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const auth = await requireWmsSession(req)
  if ("error" in auth) return auth.error
  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 })
  }
  const url = new URL(req.url)
  const siteCode = url.searchParams.get("siteCode") ?? ""
  const itemCode = url.searchParams.get("itemCode") ?? ""
  if (!siteCode.trim() || !itemCode.trim()) {
    return NextResponse.json({ error: "siteCode and itemCode are required" }, { status: 400 })
  }
  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const plan = await buildFgPickPlanForTask(client, siteId, {
      itemCode,
      plannedQty: Number(url.searchParams.get("qty") || "0") || 0,
      manufacturedAt: url.searchParams.get("manufacturedAt"),
      taskType: "ship",
    })
    return NextResponse.json({ plan })
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error(error)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  } finally {
    client.release()
  }
}
