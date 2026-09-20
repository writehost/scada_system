import { NextResponse } from "next/server"
import { tryConnect, tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import {
  readFgPlanInventory,
  writeFgPlanInventory,
  type FgPlanInventorySlot,
} from "@/lib/wms/fg-plan-inventory-storage"
import { postFgPlanInventoryToStock, previewFgPlanStock } from "@/lib/wms/fg-plan-stock-post"
import { summarizePlanStock } from "@/lib/wms/fg-plan-stock-helpers"
import { requireWmsActor } from "@/lib/wms/require-actor"
import { WmsHttpError } from "@/lib/wms/errors"
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseInventory(raw: unknown): Record<string, FgPlanInventorySlot> | null {
  if (!raw || typeof raw !== "object") return null
  const inventory: Record<string, FgPlanInventorySlot> = {}
  for (const [address, slot] of Object.entries(raw as Record<string, unknown>)) {
    if (!slot || typeof slot !== "object") continue
    const s = slot as Record<string, unknown>
    inventory[address] = {
      address,
      status:
        s.status === "occupied" || s.status === "reserved" || s.status === "blocked"
          ? s.status
          : "free",
      palletId: typeof s.palletId === "string" ? s.palletId : undefined,
      nomenclature: typeof s.nomenclature === "string" ? s.nomenclature : undefined,
      gtin: typeof s.gtin === "string" ? s.gtin : undefined,
      batch: typeof s.batch === "string" ? s.batch : undefined,
      productionDate: typeof s.productionDate === "string" ? s.productionDate : undefined,
      quantity: typeof s.quantity === "number" ? s.quantity : undefined,
      unit: typeof s.unit === "string" ? s.unit : undefined,
      stockPostedQty: typeof s.stockPostedQty === "number" ? s.stockPostedQty : undefined,
      stockPostedAt: typeof s.stockPostedAt === "string" ? s.stockPostedAt : undefined,
      stockPostedItemCode: typeof s.stockPostedItemCode === "string" ? s.stockPostedItemCode : undefined,
    }
  }
  return inventory
}

export async function GET(req: Request) {
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const url = new URL(req.url)
  const siteCode = url.searchParams.get("siteCode") ?? ""
  if (!siteCode.trim()) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  }
  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status })
  try {
    const siteId = await getSiteId(conn.client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    const snapshot = await readFgPlanInventory(siteId)
    let stock
    try {
      stock = await previewFgPlanStock(conn.client, siteId)
    } catch (error) {
      console.error("[fg plan-inventory preview]", error)
      stock = summarizePlanStock(Object.values(snapshot.inventory || {}), {})
    }
    return NextResponse.json({
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
      inventory: snapshot.inventory,
      stock,
    })
  } catch (error) {
    console.error("[fg plan-inventory GET]", error)
    return NextResponse.json({ error: wmsDbErrorToUserMessage(error) || "internal error" }, { status: 500 })
  } finally {
    conn.client.release()
  }
}

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req, { allowLocal: true })
  if ("error" in actorGate) return actorGate.error
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })

  let body: { siteCode?: string; action?: string; addresses?: unknown; inventory?: unknown } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    body = {}
  }
  const url = new URL(req.url)
  const siteCode = String(url.searchParams.get("siteCode") || body.siteCode || "").trim()
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })

  const action = String(body.action || "").trim()
  const parsedInventory = parseInventory(body.inventory)
  const conn = await tryConnect(pool)
  if (!conn.ok) return NextResponse.json({ error: conn.message, code: conn.code }, { status: conn.status })
  try {
    const siteId = await getSiteId(conn.client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })

    if (action === "post-to-stock" || (!parsedInventory && action !== "save-inventory")) {
      const addresses = Array.isArray(body.addresses)
        ? body.addresses.map((value) => String(value || "").trim()).filter(Boolean)
        : undefined
      const result = await postFgPlanInventoryToStock(conn.client, siteId, { addresses })
      return NextResponse.json(result)
    }

    if (!parsedInventory) {
      return NextResponse.json({ error: "inventory object is required" }, { status: 400 })
    }
    const existing = await readFgPlanInventory(siteId)
    const merged: Record<string, FgPlanInventorySlot> = { ...existing.inventory }
    for (const [address, slot] of Object.entries(parsedInventory)) {
      if (slot.status === "occupied" || slot.status === "reserved" || slot.status === "blocked") {
        merged[address] = { ...merged[address], ...slot, address }
      } else {
        delete merged[address]
      }
    }
    const snapshot = await writeFgPlanInventory(siteId, merged)
    return NextResponse.json(snapshot)
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error("[fg plan-inventory POST]", error)
    return NextResponse.json({ error: wmsDbErrorToUserMessage(error) || "internal error" }, { status: 500 })
  } finally {
    conn.client.release()
  }
}
