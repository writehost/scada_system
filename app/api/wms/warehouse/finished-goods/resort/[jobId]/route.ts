import { NextResponse } from "next/server"
import { requireWmsActor } from "@/lib/wms/require-actor"
import { getSiteId } from "@/lib/wms/resolve"
import { tryConnect, tryGetPool } from "@/lib/wms/pool"
import { WmsHttpError } from "@/lib/wms/errors"
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message"
import { cancelResortJob, completeResortJob, type FgResortOutcome } from "@/lib/wms/fg-resort"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function actorName(actor: { session: { fio?: string; login?: string } | null; deviceUid: string | null }) {
  return actor.session?.fio?.trim() || actor.session?.login?.trim() || actor.deviceUid || "оператор"
}

function isOutcome(value: string): value is FgResortOutcome {
  return value === "confirmed" || value === "found_extra" || value === "found_missing"
}

export async function POST(
  req: Request,
  context: { params: Promise<{ jobId: string }> | { jobId: string } }
) {
  const actorGate = await requireWmsActor(req)
  if ("error" in actorGate) return actorGate.error

  const { jobId } = await Promise.resolve(context.params)
  if (!jobId?.trim()) return NextResponse.json({ error: "jobId is required" }, { status: 400 })

  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })

  let body: { siteCode?: string; action?: string; note?: string; outcome?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }

  const siteCode = typeof body.siteCode === "string" ? body.siteCode.trim() : ""
  const action = typeof body.action === "string" ? body.action.trim() : "complete"
  const note = typeof body.note === "string" ? body.note.trim() : ""
  const outcome = typeof body.outcome === "string" ? body.outcome.trim() : "confirmed"
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })

  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status })
  try {
    const siteId = await getSiteId(conn.client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    await conn.client.query("BEGIN")
    const job =
      action === "cancel"
        ? await cancelResortJob(conn.client, siteId, jobId, {
            completedBy: actorName(actorGate.actor),
            note: note || null,
          })
        : await completeResortJob(conn.client, siteId, jobId, {
            completedBy: actorName(actorGate.actor),
            note: note || null,
            outcome: isOutcome(outcome) ? outcome : "confirmed",
          })
    await conn.client.query("COMMIT")
    return NextResponse.json({ job })
  } catch (error) {
    await conn.client.query("ROLLBACK").catch(() => undefined)
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error("[fg-resort job POST]", error)
    return NextResponse.json({ error: wmsDbErrorToUserMessage(error) || "internal error" }, { status: 500 })
  } finally {
    conn.client.release()
  }
}
