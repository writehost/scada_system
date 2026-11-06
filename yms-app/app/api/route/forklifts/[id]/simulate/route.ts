import { autoArrive } from "@/lib/route/arrive"
import { actorCan, actorLabel } from "@/lib/route/auth"
import { forkliftMode, getForklift } from "@/lib/route/fleet"
import { fail, num, withRouteTx } from "@/lib/route/http"
import { karaGoto } from "@/lib/route/kara-commands"
import { getPublishedMap } from "@/lib/route/maps"
import { ingestPosition } from "@/lib/route/positions"
import { currentSession } from "@/lib/route/tasks"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Учебная позиция (симулятор). Принимается ТОЛЬКО для кары в режиме SIMULATION — от её водителя
 * (активная смена на этой каре) или от диспетчера. Источник помечается simulation; реальной каре
 * такие координаты записать нельзя.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withRouteTx(req, "route.read", async (ctx) => {
    const a = ctx.actor
    if (a.kind !== "user") fail(403, "учебную позицию задаёт водитель или диспетчер", "user_required")
    const kara = await getForklift(ctx.client, ctx.siteId, id)
    if (!kara) fail(404, "погрузчик не найден во флоте WMS", "kara_not_found")
    if ((await forkliftMode(ctx.client, ctx.siteId, id)) !== "SIMULATION") {
      fail(409, `${kara.name} в режиме REAL — учебные координаты не принимаются`, "not_simulation")
    }
    if (!actorCan(a, "route.dispatch")) {
      if (!actorCan(a, "route.drive")) fail(403, "недостаточно прав", "permission_denied")
      const s = await currentSession(ctx.client, ctx.siteId, a.login)
      if (!s || s.karaId !== id) fail(403, "у вас нет смены на этом погрузчике", "not_your_kara")
    }
    const map = await getPublishedMap(ctx.client, ctx.siteId)
    const mpu = map?.geometry.coord.metersPerUnit ?? 0.8 / 12
    const res = await ingestPosition(
      ctx.client,
      ctx.siteId,
      {
        karaId: id,
        x: num(ctx.body, "x") ?? NaN,
        y: num(ctx.body, "y") ?? NaN,
        headingDeg: num(ctx.body, "headingDeg"),
        quality: 1,
        measuredAt: new Date().toISOString(),
        source: "simulation",
        state: "ok",
        setBy: actorLabel(a),
      },
      mpu
    )
    if (!res.accepted) return { accepted: false, code: res.code, reason: res.reason }
    const p = res.position
    await ctx.client.query(`SELECT pg_notify('route_events', $1)`, [
      JSON.stringify({ id: 0, siteId: ctx.siteId, pos: { karaId: id, x: p.x, y: p.y, headingDeg: p.headingDeg, state: p.state, quality: p.quality, source: p.source } }),
    ])
    const arrived = await autoArrive(ctx.client, ctx.siteId, id, p, map, mpu)
    // Модель кары на плане WMS — только если явно включено (ROUTE_KARA_GOTO_IN_SIMULATION=1)
    let plan: { ok: boolean; message?: string } | null = null
    const tagId = num(ctx.body, "gotoTagId")
    if (tagId != null) {
      const r = await karaGoto(ctx.siteCode, id, tagId, { mode: "SIMULATION" })
      plan = r.ok ? { ok: true } : { ok: false, message: r.message }
    }
    return { accepted: true, position: p, arrived, plan }
  })
}
