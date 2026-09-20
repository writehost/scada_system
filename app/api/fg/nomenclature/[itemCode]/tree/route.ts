import { NextResponse } from "next/server"
import { getFgNomenclatureTree } from "@/lib/wms/finished-goods-warehouse"
import { withFgSite } from "@/lib/wms/finished-goods-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  ctx: { params: Promise<{ itemCode: string }> }
) {
  const { itemCode } = await ctx.params
  return withFgSite(req, async (client, siteId) => {
    const tree = await getFgNomenclatureTree(client, siteId, decodeURIComponent(itemCode))
    return NextResponse.json({ tree })
  })
}
