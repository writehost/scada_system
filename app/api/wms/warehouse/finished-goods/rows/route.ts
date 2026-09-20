import { NextResponse } from "next/server"
import { listFgStorageRows } from "@/lib/wms/finished-goods-warehouse"
import { withFgSite } from "@/lib/wms/finished-goods-route"
import type { FgMarkingTag } from "@/lib/wms/finished-goods-types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withFgSite(req, async (client, siteId) => {
    const url = new URL(req.url)
    const query = url.searchParams.get("query") ?? ""
    const tag = (url.searchParams.get("tag") ?? "all") as FgMarkingTag | "all"
    const rows = await listFgStorageRows(client, siteId, { query, tag })
    return NextResponse.json({ rows })
  })
}
