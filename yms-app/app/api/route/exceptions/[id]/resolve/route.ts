import { actorLabel } from "@/lib/route/auth"
import { str, withRouteTx } from "@/lib/route/http"
import { resolveException } from "@/lib/route/tasks"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Решение диспетчера по проблемной палете/операции. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withRouteTx(req, "route.dispatch", async (ctx) => {
    const action = str(ctx.body, "action", 20)
    return resolveException(ctx.client, ctx.siteId, id, {
      resolution: str(ctx.body, "resolution", 500),
      action: (["unblock", "requeue", "cancel"].includes(action) ? action : "none") as "none",
      actor: actorLabel(ctx.actor),
    })
  })
}
