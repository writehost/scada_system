import { searchWmsOrders } from "@/lib/wms/yms/wms-link"
import { withYms } from "@/lib/wms/yms/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withYms(req, "yms.read", async (ctx) => {
    const q = ctx.url.searchParams.get("q") || ""
    const limit = Math.min(30, Math.max(1, Number(ctx.url.searchParams.get("limit") || 15)))
    const orders = await searchWmsOrders(ctx.client, ctx.siteId, q, limit)
    return { orders }
  })
}
