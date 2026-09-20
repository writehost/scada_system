import { NextResponse } from "next/server"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { updateCodeListEntryComment } from "@/lib/wms/code-lists"
import { WmsHttpError } from "@/lib/wms/errors"
import { requireWmsActor } from "@/lib/wms/require-actor"
import { resolveMissingNomenclature } from "@/lib/wms/receiving-rules"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(
  req: Request,
  segmentData: { params: Promise<{ id: string }> }
) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true })
  if ("error" in actorGate) return actorGate.error

  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    )
  }
  const params = await segmentData.params
  const codeListId = params.id ?? ""
  let body: {
    siteCode?: string
    comment?: string | null
    action?: "bind" | "create" | "hold"
    itemCode?: string
    itemName?: string
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const siteCode = typeof body.siteCode === "string" ? body.siteCode.trim() : ""
  if (!siteCode || !codeListId.trim()) {
    return NextResponse.json({ error: "siteCode and id are required" }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    }
    if (body.action === "bind" || body.action === "create" || body.action === "hold") {
      const result = await resolveMissingNomenclature(client, siteId, codeListId, {
        comment: body.comment,
        action: body.action,
        itemCode: body.itemCode,
        itemName: body.itemName,
      })
      return NextResponse.json(result)
    }
    const comment =
      body.comment == null ? null : typeof body.comment === "string" ? body.comment : null
    const result = await updateCodeListEntryComment(client, siteId, codeListId, comment)
    return NextResponse.json(result)
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
