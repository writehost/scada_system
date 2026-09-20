import { NextResponse } from "next/server"
import { withFgSite } from "@/lib/wms/finished-goods-route"
import {
  createOpsReplenish,
  loadWarehouseOpsInbox,
  logFefoException,
  tagOpsWave,
} from "@/lib/wms/warehouse-ops-inbox"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withFgSite(req, async (client, siteId) => {
    const inbox = await loadWarehouseOpsInbox(client, siteId)
    return NextResponse.json({ inbox })
  })
}

export async function POST(req: Request) {
  return withFgSite(req, async (client, siteId) => {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string
      itemCodes?: string[]
      itemCode?: string
      lotCode?: string
      reason?: string
      taskIds?: string[]
      comment?: string
    }
    const action = (body.action ?? "").trim()
    if (action === "replenish") {
      const created = await createOpsReplenish(client, siteId, {
        itemCodes: body.itemCodes ?? (body.itemCode ? [body.itemCode] : []),
        comment: body.comment,
      })
      return NextResponse.json({ ok: true, created })
    }
    if (action === "milk-run") {
      const created = await createOpsReplenish(client, siteId, { milkRun: true, comment: body.comment })
      return NextResponse.json({ ok: true, created })
    }
    if (action === "tugger") {
      const created = await createOpsReplenish(client, siteId, { tugger: true, comment: body.comment })
      return NextResponse.json({ ok: true, created })
    }
    if (action === "wave") {
      const tagged = await tagOpsWave(client, siteId, body.taskIds ?? [])
      return NextResponse.json({ ok: true, ...tagged })
    }
    if (action === "fefo-exception") {
      if (!body.itemCode) {
        return NextResponse.json({ error: "itemCode required" }, { status: 400 })
      }
      const logged = await logFefoException(client, siteId, {
        itemCode: body.itemCode,
        lotCode: body.lotCode,
        reason: body.reason ?? "",
      })
      return NextResponse.json(logged)
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 })
  })
}
