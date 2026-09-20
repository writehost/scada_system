import { NextResponse } from "next/server"
import { listFgRowPallets } from "@/lib/wms/finished-goods-warehouse"
import { withFgSite } from "@/lib/wms/finished-goods-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  ctx: { params: Promise<{ rowId: string }> }
) {
  const { rowId } = await ctx.params
  return withFgSite(req, async (client, siteId) => {
    const url = new URL(req.url)
    const page = Number(url.searchParams.get("page") ?? "1")
    const pageSize = Number(url.searchParams.get("pageSize") ?? "50")
    const query = url.searchParams.get("query") ?? ""
    const result = await listFgRowPallets(client, siteId, rowId, { page, pageSize, query })
    return NextResponse.json(result)
  })
}
