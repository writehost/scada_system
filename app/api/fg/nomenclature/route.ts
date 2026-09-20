import { NextResponse } from "next/server"
import { listFgNomenclature } from "@/lib/wms/finished-goods-warehouse"
import { withFgSite } from "@/lib/wms/finished-goods-route"
import { normalizeFsnDays } from "@/lib/wms/fsn"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withFgSite(req, async (client, siteId) => {
    const url = new URL(req.url)
    const query = url.searchParams.get("query") ?? ""
    const fsnDays = normalizeFsnDays(url.searchParams.get("fsnDays"))
    const rows = await listFgNomenclature(client, siteId, query, fsnDays)
    return NextResponse.json({ rows })
  })
}
