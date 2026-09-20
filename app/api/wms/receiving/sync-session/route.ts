import { NextResponse } from "next/server"
import { syncReceivingSessionQuantities } from "@/lib/wms/code-lists"
import { WmsHttpError } from "@/lib/wms/errors"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { requireWmsActor } from "@/lib/wms/require-actor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true });
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 })
  }

  let body: {
    siteCode?: string
    documentId?: string
    lines?: Array<{ code?: string; qty?: number; scanEventId?: string | null }>
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }

  const siteCode = String(body.siteCode ?? "").trim()
  const documentId = String(body.documentId ?? "").trim()
  const lines = Array.isArray(body.lines) ? body.lines : []
  if (!siteCode || !documentId) {
    return NextResponse.json({ error: "siteCode and documentId are required" }, { status: 400 })
  }
  if (lines.length === 0) {
    return NextResponse.json({ error: "lines are required" }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const result = await syncReceivingSessionQuantities(
      client,
      siteId,
      documentId,
      lines.map((line) => ({
        code: String(line.code ?? ""),
        qty: Number(line.qty),
        scanEventId: line.scanEventId ?? null,
      }))
    )
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
