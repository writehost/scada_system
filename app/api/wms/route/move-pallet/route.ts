import { NextResponse } from "next/server"
import { WmsHttpError, wmsErrorResponse } from "@/lib/wms/errors"
import { tryGetPool } from "@/lib/wms/pool"
import { requireWmsActor } from "@/lib/wms/require-actor"
import { WMS_PERMISSION, requireWmsPermission } from "@/lib/wms/permissions"
import { getSiteId } from "@/lib/wms/resolve"
import { runIdempotentWrite } from "@/lib/wms/idempotency"
import { moveRoutePallet } from "@/lib/wms/route-integration"
import { parseRequestId } from "@/lib/wms/uuid"

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

/**
 * SCADA Route: перемещение палеты после подтверждения постановки водителем.
 * Идемпотентно по requestId: повтор возвращает сохранённый результат (disposition = duplicate),
 * второго движения не создаётся.
 */
export async function POST(req: Request) {
  const b = await body(req)
  const gate = await requireWmsActor(req, { siteCode: s(b, "siteCode") })
  if ("error" in gate) return gate.error
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const requestId = parseRequestId(b.requestId)
  if (!requestId) return NextResponse.json({ error: "requestId must be a UUID", code: "request_id_invalid" }, { status: 400 })
  let siteId: number | null
  const probe = await pool.connect()
  try {
    await requireWmsPermission(probe, gate.actor.userId, WMS_PERMISSION.stockTransfer, gate.actor.session?.login)
    siteId = await getSiteId(probe, s(b, "siteCode"))
  } catch (error) {
    probe.release()
    return wmsErrorResponse(error)
  }
  probe.release()
  if (siteId == null) return NextResponse.json({ error: "unknown siteCode", code: "unknown_site" }, { status: 404 })
  if (!s(b, "palletCode") || !s(b, "toLocationCode") || !s(b, "taskRef")) {
    return NextResponse.json({ error: "palletCode, toLocationCode, taskRef обязательны", code: "fields_required" }, { status: 400 })
  }
  const ref = b.wmsRef && typeof b.wmsRef === "object" ? (b.wmsRef as { kind?: string; id?: string }) : null
  try {
    const result = await runIdempotentWrite(pool, requestId, siteId, "route_pallet_move", b, (client) =>
      moveRoutePallet(client, siteId!, {
        requestId,
        palletCode: s(b, "palletCode"),
        fromLocationCode: s(b, "fromLocationCode") || null,
        toLocationCode: s(b, "toLocationCode"),
        taskRef: s(b, "taskRef"),
        actorLogin: s(b, "actorLogin") || gate.actor.session?.login || "route",
        actorUserId: gate.actor.userId,
        wmsRef: ref?.kind && ref?.id ? { kind: String(ref.kind), id: String(ref.id) } : null,
      })
    )
    return NextResponse.json(result)
  } catch (error) {
    return wmsErrorResponse(error)
  }
}
