import { NextResponse } from "next/server"
import { listFgPallets } from "@/lib/wms/finished-goods-warehouse"
import { withFgSite } from "@/lib/wms/finished-goods-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withFgSite(req, async (client, siteId) => {
    const url = new URL(req.url)
    const query = url.searchParams.get("query") ?? ""
    const pallets = await listFgPallets(client, siteId, query)
    return NextResponse.json({ pallets })
  })
}
