import { NextResponse } from "next/server"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { WmsHttpError } from "@/lib/wms/errors"
import { requireWmsActor } from "@/lib/wms/require-actor"
import { normalizeTsdDocumentId } from "@/lib/wms/receiving-tsd-sessions"
import { getReceivingInbound, parseReceivingSplits, saveReceivingInbound } from "@/lib/wms/receiving-rules"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true })
  if ("error" in actorGate) return actorGate.error

  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 })
  }
  const url = new URL(req.url)
  const siteCode = (url.searchParams.get("siteCode") ?? "").trim()
  const documentId = normalizeTsdDocumentId(url.searchParams.get("documentId") ?? "")
  if (!siteCode || !documentId) {
    return NextResponse.json({ error: "siteCode and documentId are required" }, { status: 400 })
  }
  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const inbound = await getReceivingInbound(client, siteId, documentId)
    return NextResponse.json({ ok: true, inbound })
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error("[GET /api/wms/receiving/inbound]", error)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  } finally {
    client.release()
  }
}

export async function PUT(req: Request) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true })
  if ("error" in actorGate) return actorGate.error

  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 })
  }
  let body: {
    siteCode?: string
    documentId?: string
    supplier?: string
    expectedBatch?: string
    comment?: string
    lines?: Array<{
      itemCode?: string
      itemName?: string
      expectedQty?: number
      lotCode?: string
      targetLocationCode?: string
      splits?: unknown
    }>
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }
  const siteCode = String(body.siteCode ?? "").trim()
  const documentId = normalizeTsdDocumentId(String(body.documentId ?? ""))
  if (!siteCode || !documentId) {
    return NextResponse.json({ error: "siteCode and documentId are required" }, { status: 400 })
  }
  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const inbound = await saveReceivingInbound(client, siteId, {
      documentId,
      supplier: body.supplier,
      expectedBatch: body.expectedBatch,
      comment: body.comment,
      lines: (body.lines ?? []).map((line) => ({
        itemCode: String(line.itemCode ?? "").trim(),
        itemName: String(line.itemName ?? "").trim(),
        expectedQty: Number(line.expectedQty) || 0,
        lotCode: String(line.lotCode ?? "").trim(),
        targetLocationCode: String(line.targetLocationCode ?? "").trim(),
        splits: parseReceivingSplits(line.splits),
      })),
    })
    return NextResponse.json({ ok: true, inbound })
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error("[PUT /api/wms/receiving/inbound]", error)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  } finally {
    client.release()
  }
}
