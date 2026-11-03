import { actorLabel } from "@/lib/route/auth"
import { fail, num, requestId, str, withRouteTx } from "@/lib/route/http"
import { assignTask, dispatcherAction, recheckRoutesAfterBlock } from "@/lib/route/tasks"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ACTIONS = new Set(["assign", "pause", "resume", "cancel", "block", "unblock", "requeue", "priority"])

/** Команды диспетчера: назначить, переназначить, приоритет, пауза, отмена, блокировка (с причиной). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withRouteTx(req, "route.dispatch", async (ctx) => {
    const action = str(ctx.body, "action", 20)
    if (!ACTIONS.has(action)) fail(400, "неизвестное действие", "bad_action")
    const actor = actorLabel(ctx.actor)
    const reason = str(ctx.body, "reason", 500)
    const expectedVersion = num(ctx.body, "expectedVersion")
    if (action === "assign") {
      const karaId = str(ctx.body, "karaId", 64)
      if (!karaId) fail(400, "karaId обязателен", "kara_required")
      const task = await assignTask(ctx.client, ctx.siteId, id, karaId, actor, reason, expectedVersion)
      return { ok: true, task }
    }
    const res = await dispatcherAction(ctx.client, ctx.siteId, id, action as "pause", {
      reason,
      priority: num(ctx.body, "priority"),
      expectedVersion,
      actor,
      clientRequestId: requestId(ctx.body, false),
    })
    if (action === "unblock") await recheckRoutesAfterBlock(ctx.client, ctx.siteId, actor)
    return { ok: true, ...res }
  })
}
