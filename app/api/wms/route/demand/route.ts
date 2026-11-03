import { NextResponse } from "next/server"
import { WmsHttpError, wmsErrorResponse } from "@/lib/wms/errors"
import { tryGetPool } from "@/lib/wms/pool"
import { requireWmsActor } from "@/lib/wms/require-actor"
import { WMS_PERMISSION, requireWmsPermission } from "@/lib/wms/permissions"
import { getSiteId } from "@/lib/wms/resolve"
import { pullRouteDemand, releaseRouteDemand } from "@/lib/wms/route-integration"

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

/** SCADA Route: передача открытых заданий WMS по палетам ГП в Route (pull) и возврат (release). */
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
    await client.query("BEGIN")
    let out: unknown
    if (s(b, "action") === "release") {
      await releaseRouteDemand(client, siteId, s(b, "wmsTaskId"), s(b, "reason") || "Route не принял задание")
      out = { ok: true }
    } else {
      out = { items: await pullRouteDemand(client, siteId, Number(b.limit) || 50) }
    }
    await client.query("COMMIT")
    return NextResponse.json(out)
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined)
    return wmsErrorResponse(error)
  } finally {
    client.release()
  }
}
