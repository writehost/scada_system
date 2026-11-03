import { withRoute } from "@/lib/route/http"
import { listExceptions } from "@/lib/route/tasks"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withRoute(req, "route.read", async (ctx) => ({
    exceptions: await listExceptions(ctx.client, ctx.siteId, ctx.url.searchParams.get("all") !== "1"),
  }))
}
