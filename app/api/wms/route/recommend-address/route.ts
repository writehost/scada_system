import { NextResponse } from "next/server"
import { WmsHttpError, wmsErrorResponse } from "@/lib/wms/errors"
import { tryGetPool } from "@/lib/wms/pool"
import { requireWmsActor } from "@/lib/wms/require-actor"
import { WMS_PERMISSION, requireWmsPermission } from "@/lib/wms/permissions"
import { getSiteId } from "@/lib/wms/resolve"
import { recommendRouteAddress } from "@/lib/wms/route-integration"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = (await req.json()) as unknown
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const s = (b: Record<string, unknown>, k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "")

/** SCADA Route: другой адрес, если назначенный занят. */
export async function POST(req: Request) {
  const b = await body(req)
  const gate = await requireWmsActor(req, { siteCode: s(b, "siteCode") })
  if ("error" in gate) return gate.error
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const client = await pool.connect()
  try {
    await requireWmsPermission(client, gate.actor.userId, WMS_PERMISSION.stockTransfer, gate.actor.session?.login)
    const siteId = await getSiteId(client, s(b, "siteCode"))
    if (siteId == null) throw new WmsHttpError(404, "unknown siteCode", "unknown_site")
    const exclude = Array.isArray(b.excludeLocationCodes) ? (b.excludeLocationCodes as unknown[]).map(String) : []
    return NextResponse.json(await recommendRouteAddress(client, siteId, s(b, "palletCode"), exclude))
  } catch (error) {
    return wmsErrorResponse(error)
  } finally {
    client.release()
  }
}
