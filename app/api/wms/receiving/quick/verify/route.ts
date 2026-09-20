import { NextResponse } from "next/server"
import { requireWmsActor } from "@/lib/wms/require-actor"
import { tryGetPool } from "@/lib/wms/pool"
import { wmsErrorResponse } from "@/lib/wms/errors"
import { verifyQuickLpn } from "@/lib/wms/quick-receiving"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const actor = await requireWmsActor(req)
  if ("error" in actor) return actor.error
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const siteCode = String(body.siteCode || "").trim()
  const receivingId = String(body.receivingId || body.receiving_id || "").trim()
  const scanned = String(body.scannedCode || body.scanned_code || "").trim()
  if (!siteCode || !receivingId || !scanned) {
    return NextResponse.json({ error: "siteCode, receivingId and scannedCode are required" }, { status: 400 })
  }
  const actorName =
    actor.actor.session?.login || actor.actor.session?.fio || actor.actor.deviceUid || "operator"
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const result = await verifyQuickLpn(client, {
      siteCode,
      receivingId,
      scannedCode: scanned,
      actor: actorName,
      device: String(body.deviceId || actor.actor.deviceUid || "tsd"),
    })
    await client.query("COMMIT")
    return NextResponse.json({
      success: true,
      lpn: result.lpn,
      status: result.status,
      next_lpn: result.nextLpn,
      receiving: result.receiving,
    })
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined)
    return wmsErrorResponse(e)
  } finally {
    client.release()
  }
}
