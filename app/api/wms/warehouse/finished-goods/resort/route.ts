import { NextResponse } from "next/server"
import { requireWmsActor } from "@/lib/wms/require-actor"
import { getSiteId } from "@/lib/wms/resolve"
import { tryConnect, tryGetPool } from "@/lib/wms/pool"
import { WmsHttpError } from "@/lib/wms/errors"
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message"
import {
  FG_RESORT_REASONS,
  listResortJobs,
  sendPalletsToResort,
  type FgResortReason,
} from "@/lib/wms/fg-resort"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function actorName(actor: { session: { fio?: string; login?: string } | null; deviceUid: string | null }) {
  return actor.session?.fio?.trim() || actor.session?.login?.trim() || actor.deviceUid || "оператор"
}

function isReason(value: string): value is FgResortReason {
  return (FG_RESORT_REASONS as readonly string[]).includes(value)
}

export async function GET(req: Request) {
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const url = new URL(req.url)
  const siteCode = (url.searchParams.get("siteCode") ?? "").trim()
  const statusRaw = (url.searchParams.get("status") ?? "open").trim()
  const status = statusRaw === "done" || statusRaw === "all" ? statusRaw : "open"
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })

  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status })
  try {
    const siteId = await getSiteId(conn.client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const jobs = await listResortJobs(conn.client, siteId, status)
    return NextResponse.json({ jobs })
  } catch (error) {
    console.error("[fg-resort GET]", error)
    return NextResponse.json({ error: wmsDbErrorToUserMessage(error) || "internal error" }, { status: 500 })
  } finally {
    conn.client.release()
  }
}

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req)
  if ("error" in actorGate) return actorGate.error

  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })

  let body: {
    siteCode?: string
    requestId?: string
    palletIds?: string[]
    reason?: string
    comment?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }

  const siteCode = typeof body.siteCode === "string" ? body.siteCode.trim() : ""
  const requestId = typeof body.requestId === "string" ? body.requestId.trim() : ""
  const reason = typeof body.reason === "string" ? body.reason.trim() : ""
  const comment = typeof body.comment === "string" ? body.comment.trim() : ""
  const palletIds = Array.isArray(body.palletIds)
    ? body.palletIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : []

  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  if (!requestId) return NextResponse.json({ error: "requestId is required" }, { status: 400 })
  if (!isReason(reason)) {
    return NextResponse.json({ error: "Укажите причину перебора" }, { status: 400 })
  }
  if (palletIds.length === 0) {
    return NextResponse.json({ error: "Выберите хотя бы одну палету" }, { status: 400 })
  }

  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status })
  try {
    const siteId = await getSiteId(conn.client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    await conn.client.query("BEGIN")
    const result = await sendPalletsToResort(conn.client, siteId, {
      siteCode,
      requestId,
      palletIds,
      reason,
      comment: comment || null,
      createdBy: actorName(actorGate.actor),
    })
    await conn.client.query("COMMIT")
    return NextResponse.json({
      created: result.created.length,
      skipped: result.skipped,
      documentId: result.documentId,
      jobs: result.created,
    })
  } catch (error) {
    await conn.client.query("ROLLBACK").catch(() => undefined)
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error("[fg-resort POST]", error)
    return NextResponse.json({ error: wmsDbErrorToUserMessage(error) || "internal error" }, { status: 500 })
  } finally {
    conn.client.release()
  }
}
