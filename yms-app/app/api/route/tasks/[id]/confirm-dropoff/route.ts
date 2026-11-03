import { cmdOf } from "@/lib/route/api"
import { driverState } from "@/lib/route/driver-state"
import { withRoute } from "@/lib/route/http"
import { confirmDropoff } from "@/lib/route/tasks"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Подтвердить постановку. COMPLETED — только после подтверждения перемещения в WMS.
 * Если WMS отклонила или недоступна — ошибка, задание остаётся у места назначения.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withRoute(req, "route.drive", async (ctx) => {
    const res = await confirmDropoff(ctx.client, cmdOf(ctx, id))
    await ctx.client.query("BEGIN")
    try {
      const state = await driverState(ctx.client, ctx.siteId, ctx.actor, { allowOffer: true })
      await ctx.client.query("COMMIT")
      return { ok: true, replayed: Boolean(res.replayed), wms: res.wms, offered: res.next ? res.next.taskNo : null, state }
    } catch (error) {
      await ctx.client.query("ROLLBACK").catch(() => undefined)
      throw error
    }
  })
}
