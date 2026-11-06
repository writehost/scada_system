import { withRoute } from "@/lib/route/http"
import { loadTask, taskEvents, taskView } from "@/lib/route/tasks"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withRoute(req, "route.read", async (ctx) => {
    const t = await loadTask(ctx.client, ctx.siteId, id)
    return { task: await taskView(ctx.client, t), events: await taskEvents(ctx.client, ctx.siteId, { taskId: id, limit: 100 }) }
  })
}
