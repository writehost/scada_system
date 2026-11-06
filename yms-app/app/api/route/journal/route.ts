import { withRoute } from "@/lib/route/http"
import { taskEvents } from "@/lib/route/tasks"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Журнал событий заданий: кто, когда, из какого статуса в какой, состояние WMS. */
export async function GET(req: Request) {
  return withRoute(req, "route.read", async (ctx) => ({
    events: await taskEvents(ctx.client, ctx.siteId, {
      taskId: ctx.url.searchParams.get("taskId"),
      limit: Number(ctx.url.searchParams.get("limit") || 200),
    }),
  }))
}
