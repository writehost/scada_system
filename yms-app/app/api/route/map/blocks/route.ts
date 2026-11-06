import { actorLabel } from "@/lib/route/auth"
import { publish } from "@/lib/route/events"
import { fail, str, withRoute, withRouteTx } from "@/lib/route/http"
import { activeBlocks, requirePublishedMap } from "@/lib/route/maps"
import { recheckRoutesAfterBlock } from "@/lib/route/tasks"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withRoute(req, "route.read", async (ctx) => ({ blocks: await activeBlocks(ctx.client, ctx.siteId) }))
}

/** Закрыть участок маршрута. Активные маршруты пересчитываются; нет пути — задание блокируется. */
export async function POST(req: Request) {
  return withRouteTx(req, "route.dispatch", async (ctx) => {
    const edgeIds = Array.isArray(ctx.body.edgeIds) ? (ctx.body.edgeIds as unknown[]).map(String) : [str(ctx.body, "edgeId", 64)].filter(Boolean)
    const reason = str(ctx.body, "reason", 300)
    if (!edgeIds.length) fail(400, "edgeId обязателен", "edge_required")
    if (reason.length < 3) fail(400, "Укажите причину закрытия", "reason_required")
    const map = await requirePublishedMap(ctx.client, ctx.siteId)
    const known = new Set(map.geometry.edges.map((e) => e.id))
    for (const e of edgeIds) if (!known.has(e)) fail(404, `проезд ${e} не найден на карте v${map.version}`, "edge_not_found")
    const until = str(ctx.body, "untilAt", 40) || null
    const actor = actorLabel(ctx.actor)
    for (const e of edgeIds) {
      await ctx.client.query(
        `INSERT INTO route_edge_blocks (site_id, edge_id, reason, created_by, until_at) VALUES ($1,$2,$3,$4,$5::timestamptz)`,
        [ctx.siteId, e, reason, actor, until]
      )
    }
    await publish(ctx.client, ctx.siteId, "route.blocked", { payload: { edgeIds, reason } })
    const rechecked = await recheckRoutesAfterBlock(ctx.client, ctx.siteId, actor)
    return { ok: true, blocks: await activeBlocks(ctx.client, ctx.siteId), rechecked }
  })
}

export async function DELETE(req: Request) {
  return withRouteTx(req, "route.dispatch", async (ctx) => {
    const blockId = ctx.url.searchParams.get("blockId") || str(ctx.body, "blockId", 20)
    if (!/^\d+$/.test(blockId)) fail(400, "blockId обязателен", "block_required")
    const r = await ctx.client.query<{ edge_id: string }>(
      `UPDATE route_edge_blocks SET released_at = now(), released_by = $3
       WHERE site_id = $1 AND block_id = $2::bigint AND released_at IS NULL RETURNING edge_id`,
      [ctx.siteId, blockId, actorLabel(ctx.actor)]
    )
    if (!r.rows[0]) fail(404, "блокировка не найдена или уже снята", "block_not_found")
    await publish(ctx.client, ctx.siteId, "route.unblocked", { payload: { edgeId: r.rows[0].edge_id } })
    await recheckRoutesAfterBlock(ctx.client, ctx.siteId, actorLabel(ctx.actor))
    return { ok: true, blocks: await activeBlocks(ctx.client, ctx.siteId) }
  })
}
