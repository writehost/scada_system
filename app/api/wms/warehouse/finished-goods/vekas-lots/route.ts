import { NextResponse } from "next/server"
import { withFgSite } from "@/lib/wms/finished-goods-route"
import { listFgVekasLotsForItem } from "@/lib/wms/fg-vekas-lots"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withFgSite(req, async (client, siteId) => {
    const url = new URL(req.url)
    const itemCode = (url.searchParams.get("itemCode") ?? "").trim()
    const gtin = (url.searchParams.get("gtin") ?? "").trim()
    if (!itemCode && !gtin) {
      return NextResponse.json({ error: "itemCode is required" }, { status: 400 })
    }
    const lots = await listFgVekasLotsForItem(client, siteId, itemCode, gtin)
    return NextResponse.json({ lots })
  })
}
