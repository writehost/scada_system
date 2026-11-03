import { listForklifts } from "@/lib/route/fleet"
import { withRoute } from "@/lib/route/http"
import { listPositions } from "@/lib/route/positions"
import { sessionsList } from "@/lib/route/tasks"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withRoute(req, "route.read", async (ctx) => {
    const fleet = await listForklifts(ctx.client, ctx.siteId)
    return {
      fleet,
      positions: await listPositions(ctx.client, ctx.siteId),
      sessions: await sessionsList(ctx.client, ctx.siteId),
    }
  })
}
