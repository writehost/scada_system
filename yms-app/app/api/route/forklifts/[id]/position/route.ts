import { actorCan, actorLabel } from "@/lib/route/auth"
import { publish } from "@/lib/route/events"
import { dist, nodeForAddress } from "@/lib/route/graph"
import { fail, num, str, withRoute, withRouteTx } from "@/lib/route/http"
import { getPublishedMap } from "@/lib/route/maps"
import { getPosition, ingestPosition } from "@/lib/route/positions"
import { activeTaskForKara, transition } from "@/lib/route/tasks"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const AUTO_ARRIVE_M = Number(process.env.ROUTE_AUTO_ARRIVE_M || 3)

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withRoute(req, "route.read", async (ctx) => ({ position: await getPosition(ctx.client, ctx.siteId, id) }))
}

/**
 * Приём позиции. Устройство (сервис AprilTag) пишет только за свой погрузчик.
 * Ручная позиция — только диспетчер, помечается source=manual и не подтверждает прибытие.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withRouteTx(req, null, async (ctx) => {
    const b = ctx.body
    const a = ctx.actor
    let source = str(b, "source", 20) as "apriltag" | "odometry" | "manual"
    if (a.kind === "device") {
      if (!actorCan(a, "route.position.write")) fail(403, "устройству не разрешена запись позиции", "permission_denied")
      if (a.karaId !== id) fail(403, "устройство привязано к другому погрузчику", "device_kara_mismatch")
      if (source !== "apriltag" && source !== "odometry") source = "apriltag"
    } else {
      if (!actorCan(a, "route.position.manual")) fail(403, "недостаточно прав: route.position.manual", "permission_denied")
      source = "manual"
    }
    const map = await getPublishedMap(ctx.client, ctx.siteId)
    const mpu = map?.geometry.coord.metersPerUnit ?? 0.8 / 12
    const state = str(b, "state", 12) as "ok" | "predicted" | "lost"
    const res = await ingestPosition(
      ctx.client,
      ctx.siteId,
      {
        karaId: id,
        x: num(b, "x") ?? NaN,
        y: num(b, "y") ?? NaN,
        z: num(b, "z"),
        headingDeg: num(b, "headingDeg"),
        quality: source === "manual" ? 1 : num(b, "quality") ?? 0,
        tagIds: Array.isArray(b.tagIds) ? (b.tagIds as unknown[]).map(Number) : [],
        reprojErrorPx: num(b, "reprojErrorPx"),
        measuredAt: source === "manual" ? new Date().toISOString() : str(b, "measuredAt", 40),
        source,
        state: state === "lost" || state === "predicted" ? state : "ok",
        setBy: a.kind === "user" ? actorLabel(a) : null,
      },
      mpu
    )
    if (!res.accepted) return { accepted: false, code: res.code, reason: res.reason }
    const p = res.position
    await ctx.client.query(`SELECT pg_notify('route_events', $1)`, [
      JSON.stringify({ id: 0, siteId: ctx.siteId, pos: { karaId: id, x: p.x, y: p.y, headingDeg: p.headingDeg, state: p.state, quality: p.quality, source: p.source } }),
    ])
    if (res.lostEvent) await publish(ctx.client, ctx.siteId, "forklift.localization.lost", { karaId: id, payload: { x: p.x, y: p.y } })
    if (source === "manual") await publish(ctx.client, ctx.siteId, "forklift.position.updated", { karaId: id, payload: { manual: true, by: actorLabel(a) } })

    // Автоприбытие — только по достоверной позиции AprilTag, не по ручной и не по прогнозу.
    let arrived: string | null = null
    if (p.state === "ok" && p.source === "apriltag" && map) {
      const t = await activeTaskForKara(ctx.client, ctx.siteId, id)
      if (t && (t.status === "EN_ROUTE_PICKUP" || t.status === "EN_ROUTE_DROPOFF")) {
        const code = t.status === "EN_ROUTE_PICKUP" ? t.sourceCode : t.destCode
        const nodeId = (t.status === "EN_ROUTE_PICKUP" ? t.sourceNodeId : t.destNodeId) || nodeForAddress(map.geometry, code)
        const node = map.geometry.nodes.find((n) => n.id === nodeId)
        if (node && dist(node, p) * mpu <= AUTO_ARRIVE_M) {
          const locked = await ctx.client.query(`SELECT 1 FROM route_tasks WHERE task_id = $1::bigint FOR UPDATE`, [t.taskId])
          void locked
          await transition(ctx.client, t, t.status === "EN_ROUTE_PICKUP" ? "arrive_pickup" : "arrive_dropoff", {
            actor: "system:position",
            reason: `позиция AprilTag в ${AUTO_ARRIVE_M} м от ${code}`,
          })
          arrived = code
        }
      }
    }
    return { accepted: true, position: p, arrived }
  })
}
