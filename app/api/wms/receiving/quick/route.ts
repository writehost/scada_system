import { NextResponse } from "next/server"
import { requireWmsActor } from "@/lib/wms/require-actor"
import { tryGetPool } from "@/lib/wms/pool"
import { WmsHttpError, wmsErrorResponse } from "@/lib/wms/errors"
import {
  createQuickReceiving,
  listQuickReceivings,
} from "@/lib/wms/quick-receiving"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const actor = await requireWmsActor(req)
  if ("error" in actor) return actor.error
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const url = new URL(req.url)
  const siteCode = url.searchParams.get("siteCode")?.trim() || ""
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  const client = await pool.connect()
  try {
    const rows = await listQuickReceivings(client, siteCode)
    return NextResponse.json({ rows })
  } catch (e) {
    return wmsErrorResponse(e)
  } finally {
    client.release()
  }
}

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
  const itemCode = String(body.itemCode || "").trim()
  if (!siteCode || !itemCode) {
    return NextResponse.json({ error: "siteCode and itemCode are required" }, { status: 400 })
  }
  const createdBy =
    actor.actor.session?.login || actor.actor.session?.fio || actor.actor.deviceUid || "operator"
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const row = await createQuickReceiving(client, {
      siteCode,
      supplier: String(body.supplier || ""),
      documentNumber: String(body.documentNumber || ""),
      itemCode,
      lotCode: String(body.lotCode || ""),
      productionDate: body.productionDate ? String(body.productionDate) : undefined,
      expiryDate: body.expiryDate ? String(body.expiryDate) : undefined,
      palletCount: Number(body.palletCount),
      qtyPerLpn: Number(body.qtyPerLpn),
      mode: body.mode === "batch" ? "batch" : "sequential",
      createdBy,
    })
    await client.query("COMMIT")
    return NextResponse.json({ receiving: row })
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined)
    if (e instanceof WmsHttpError) return wmsErrorResponse(e)
    return wmsErrorResponse(e)
  } finally {
    client.release()
  }
}
