import { NextResponse } from "next/server"
import { requireWmsActor } from "@/lib/wms/require-actor"
import { tryGetPool } from "@/lib/wms/pool"
import { wmsErrorResponse } from "@/lib/wms/errors"
import {
  cancelQuickLpn,
  completeQuickReceiving,
  getQuickReceiving,
  printAllQuickLpns,
  printQuickLpn,
} from "@/lib/wms/quick-receiving"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireWmsActor(req)
  if ("error" in actor) return actor.error
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const { id } = await ctx.params
  const siteCode = new URL(req.url).searchParams.get("siteCode")?.trim() || ""
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  const client = await pool.connect()
  try {
    const receiving = await getQuickReceiving(client, siteCode, id)
    return NextResponse.json({ receiving })
  } catch (e) {
    return wmsErrorResponse(e)
  } finally {
    client.release()
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireWmsActor(req)
  if ("error" in actor) return actor.error
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const { id } = await ctx.params
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const siteCode = String(body.siteCode || "").trim()
  const action = String(body.action || "").trim()
  const actorName =
    actor.actor.session?.login || actor.actor.session?.fio || actor.actor.deviceUid || "operator"
  const device = String(body.deviceId || actor.actor.deviceUid || "desktop")
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    let receiving
    if (action === "print" || action === "reprint") {
      receiving = await printQuickLpn(client, {
        siteCode,
        receivingId: id,
        lpnCode: String(body.lpnCode || ""),
        actor: actorName,
        device,
        reprint: action === "reprint",
        reason: body.reason ? String(body.reason) : undefined,
      })
    } else if (action === "print_all") {
      receiving = await printAllQuickLpns(client, {
        siteCode,
        receivingId: id,
        actor: actorName,
        device,
      })
    } else if (action === "cancel") {
      receiving = await cancelQuickLpn(client, {
        siteCode,
        receivingId: id,
        lpnCode: String(body.lpnCode || ""),
        actor: actorName,
        device,
        reason: body.reason ? String(body.reason) : undefined,
      })
    } else if (action === "complete") {
      receiving = await completeQuickReceiving(client, {
        siteCode,
        receivingId: id,
        actor: actorName,
        cancelRemaining: body.cancelRemaining === true,
      })
    } else {
      await client.query("ROLLBACK")
      return NextResponse.json({ error: "unknown action" }, { status: 400 })
    }
    await client.query("COMMIT")
    return NextResponse.json({ receiving })
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined)
    return wmsErrorResponse(e)
  } finally {
    client.release()
  }
}
