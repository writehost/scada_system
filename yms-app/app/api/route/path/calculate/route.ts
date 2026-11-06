import { getForklift } from "@/lib/route/fleet"
import { findRoute, nodeForAddress } from "@/lib/route/graph"
import { fail, num, str, withRoute } from "@/lib/route/http"
import { blockedEdgeSet, requirePublishedMap } from "@/lib/route/maps"
import { getPosition } from "@/lib/route/positions"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Расчёт маршрута по графу проездов опубликованной карты (A*).
 * from: { nodeId } | { x, y } | { karaId }; to: { nodeId } | { locationCode }.
 */
export async function POST(req: Request) {
  return withRoute(req, "route.read", async (ctx) => {
    const map = await requirePublishedMap(ctx.client, ctx.siteId)
    const g = map.geometry
    const b = ctx.body
    const from = (b.from && typeof b.from === "object" ? b.from : {}) as Record<string, unknown>
    const to = (b.to && typeof b.to === "object" ? b.to : {}) as Record<string, unknown>
    const karaId = str(b, "karaId", 64) || str(from, "karaId", 64)
    const kara = karaId ? await getForklift(ctx.client, ctx.siteId, karaId) : null
    const toNode = str(to, "nodeId", 64) || nodeForAddress(g, str(to, "locationCode", 80))
    if (!toNode) fail(404, "точка назначения не привязана к карте", "dest_unknown")
    let start: { nodeId: string } | { point: { x: number; y: number }; snapMaxM: number }
    if (str(from, "nodeId", 64)) start = { nodeId: str(from, "nodeId", 64) }
    else if (num(from, "x") != null && num(from, "y") != null) start = { point: { x: num(from, "x")!, y: num(from, "y")! }, snapMaxM: 6 }
    else if (str(from, "locationCode", 80)) {
      const n = nodeForAddress(g, str(from, "locationCode", 80))
      if (!n) fail(404, "точка отправления не привязана к карте", "source_unknown")
      start = { nodeId: n }
    } else if (karaId) {
      const pos = await getPosition(ctx.client, ctx.siteId, karaId)
      if (!pos || pos.state === "lost" || pos.state === "none") fail(409, "Позиция погрузчика не определена", "position_unknown")
      start = { point: { x: pos.x, y: pos.y }, snapMaxM: 6 }
    } else fail(400, "нужна точка отправления", "from_required")
    const t0 = performance.now()
    const route = findRoute(g, start, toNode, {
      loaded: b.loaded === true,
      forkliftType: kara?.forkliftType ?? null,
      widthM: kara?.widthM ?? null,
      heightM: kara?.heightM ?? null,
      blockedEdgeIds: await blockedEdgeSet(ctx.client, ctx.siteId),
    })
    return { route, mapVersion: map.version, computeMs: Math.round((performance.now() - t0) * 10) / 10 }
  })
}
