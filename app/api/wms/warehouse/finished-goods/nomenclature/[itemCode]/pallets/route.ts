import { NextResponse } from "next/server"
import { listFgNomenclaturePalletNodes } from "@/lib/wms/finished-goods-warehouse"
import { withFgSite } from "@/lib/wms/finished-goods-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  ctx: { params: Promise<{ itemCode: string }> }
) {
  const { itemCode } = await ctx.params
  const url = new URL(req.url)
  const query = url.searchParams.get("query") ?? ""
  const page = Number(url.searchParams.get("page") ?? "1")
  const pageSize = Number(url.searchParams.get("pageSize") ?? "50")

  return withFgSite(req, async (client, siteId) => {
    const data = await listFgNomenclaturePalletNodes(client, siteId, decodeURIComponent(itemCode), {
      query,
      page,
      pageSize,
    })
    return NextResponse.json(data)
  })
}
