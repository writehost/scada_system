import { NextResponse } from "next/server"
import { getFgMarkingCodeChildren } from "@/lib/wms/finished-goods-warehouse"
import { withFgSite } from "@/lib/wms/finished-goods-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  ctx: { params: Promise<{ itemCode: string; codeId: string }> }
) {
  const { itemCode, codeId } = await ctx.params
  return withFgSite(req, async (client, siteId) => {
    const children = await getFgMarkingCodeChildren(
      client,
      siteId,
      decodeURIComponent(itemCode),
      codeId
    )
    return NextResponse.json({ children })
  })
}
