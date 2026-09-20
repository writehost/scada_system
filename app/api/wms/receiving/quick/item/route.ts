import { NextResponse } from "next/server"
import { requireWmsActor } from "@/lib/wms/require-actor"
import { tryGetPool } from "@/lib/wms/pool"
import { wmsErrorResponse } from "@/lib/wms/errors"
import { createQuickItem } from "@/lib/wms/quick-receiving"

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
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const item = await createQuickItem(client, {
      siteCode,
      name: String(body.name || ""),
      category: body.category ? String(body.category) : undefined,
      uom: body.uom ? String(body.uom) : undefined,
      manufacturer: body.manufacturer ? String(body.manufacturer) : undefined,
      sku: body.sku ? String(body.sku) : undefined,
      barcode: body.barcode ? String(body.barcode) : undefined,
      shelfLifeDays: body.shelfLifeDays != null ? Number(body.shelfLifeDays) : undefined,
      temp: body.temp === true,
    })
    await client.query("COMMIT")
    return NextResponse.json({ item })
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined)
    return wmsErrorResponse(e)
  } finally {
    client.release()
  }
}
