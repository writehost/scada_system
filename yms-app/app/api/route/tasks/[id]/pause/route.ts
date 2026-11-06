import { cmdOf, scanInput, withDriverState } from "@/lib/route/api"
import { fail, str, withRouteTx } from "@/lib/route/http"
import * as T from "@/lib/route/tasks"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Пауза/продолжение своим заданием. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withRouteTx(req, "route.drive", async (ctx) => {
    void str
    void scanInput
    const { session, user } = await T.requireSession(ctx.client, ctx.siteId, ctx.actor)
    const cmd = cmdOf(ctx, id)
    const t = await T.loadTask(ctx.client, ctx.siteId, id, true)
    if (t.karaId !== session.karaId) fail(409, "Задание переназначено на другой погрузчик", "task_reassigned")
    const action = t.status === "PAUSED" ? "resume" : "pause"
    const next = await T.transition(ctx.client, t, action, {
      actor: user.login,
      expectedVersion: cmd.expectedVersion,
      clientRequestId: cmd.clientRequestId,
      reason: str(ctx.body, "reason", 240) || (action === "pause" ? "пауза водителем" : "продолжение"),
    })
    return withDriverState(ctx, { task: next })
  })
}
