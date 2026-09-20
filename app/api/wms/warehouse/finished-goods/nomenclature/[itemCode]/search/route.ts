import { NextResponse } from "next/server"
import { searchFgNomenclatureMarkingCodes } from "@/lib/wms/finished-goods-warehouse"
import { withFgSite } from "@/lib/wms/finished-goods-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  ctx: { params: Promise<{ itemCode: string }> }
) {
  const { itemCode } = await ctx.params
  const url = new URL(req.url)
  const q = url.searchParams.get("q") ?? url.searchParams.get("query") ?? ""
  const limit = Number(url.searchParams.get("limit") ?? "25")

  return withFgSite(req, async (client, siteId) => {
    const hits = await searchFgNomenclatureMarkingCodes(
      client,
      siteId,
      decodeURIComponent(itemCode),
      q,
      limit
    )
    return NextResponse.json({ hits })
  })
}
