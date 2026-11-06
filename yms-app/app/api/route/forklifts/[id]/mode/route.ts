import { actorLabel } from "@/lib/route/auth"
import { publish } from "@/lib/route/events"
import { forkliftMode, getForklift, setForkliftMode } from "@/lib/route/fleet"
import { fail, str, withRouteTx } from "@/lib/route/http"
import { clearPosition } from "@/lib/route/positions"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Режим кары: REAL (реальная эксплуатация) или SIMULATION (учебный).
 * Переключение — только администратором, с причиной, когда у кары нет предложенного или активного задания.
 * Позиция сбрасывается: учебная точка не должна продолжить реальную и наоборот.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withRouteTx(req, "route.mode.write", async (ctx) => {
    const kara = await getForklift(ctx.client, ctx.siteId, id)
    if (!kara) fail(404, "погрузчик не найден во флоте WMS", "kara_not_found")
    const mode = str(ctx.body, "mode", 20).toUpperCase()
    if (mode !== "REAL" && mode !== "SIMULATION") fail(400, "mode: REAL или SIMULATION", "bad_mode")
    const reason = str(ctx.body, "reason", 240)
    if (!reason) fail(400, "Укажите причину смены режима", "reason_required")
    const prev = await forkliftMode(ctx.client, ctx.siteId, id)
    if (prev === mode) return { forklift: kara, changed: false }
    const busy = await ctx.client.query<{ task_no: string; status: string }>(
      `SELECT task_no, status FROM route_tasks WHERE site_id = $1 AND kara_id = $2 AND status NOT IN ('QUEUED','COMPLETED','CANCELLED') LIMIT 1`,
      [ctx.siteId, id]
    )
    if (busy.rows[0]) {
      fail(409, `У ${kara.name} есть задание ${busy.rows[0].task_no} (${busy.rows[0].status}) — завершите или снимите его перед сменой режима`, "kara_busy")
    }
    await setForkliftMode(ctx.client, ctx.siteId, id, mode, actorLabel(ctx.actor))
    await clearPosition(ctx.client, ctx.siteId, id)
    await publish(ctx.client, ctx.siteId, "forklift.mode.changed", {
      karaId: id,
      payload: { from: prev, to: mode, reason, by: actorLabel(ctx.actor) },
    })
    return { forklift: await getForklift(ctx.client, ctx.siteId, id), changed: true }
  })
}
