import { withRoute } from "@/lib/route/http"
import { activeBlocks, getPublishedMap } from "@/lib/route/maps"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Опубликованная версия карты — её использует водитель. */
export async function GET(req: Request) {
  return withRoute(req, "route.read", async (ctx) => {
    const map = await getPublishedMap(ctx.client, ctx.siteId)
    const blocks = await activeBlocks(ctx.client, ctx.siteId)
    if (!map) return { map: null, blocks, message: "Карта не опубликована" }
    const etag = `"map-${map.mapId}-${map.revision}"`
    if (ctx.req.headers.get("if-none-match") === etag && ctx.url.searchParams.get("blocksOnly") !== "1") {
      return new Response(null, { status: 304, headers: { etag } })
    }
    return Response.json({ map, blocks }, { headers: { etag, "cache-control": "private, no-cache" } })
  })
}
