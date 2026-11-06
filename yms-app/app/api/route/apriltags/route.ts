import { actorLabel } from "@/lib/route/auth"
import { fail, withRoute, withRouteTx } from "@/lib/route/http"
import { importWmsPlanTags, listMarkers, upsertMarkers } from "@/lib/route/apriltags"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withRoute(req, "route.read", async (ctx) => ({ markers: await listMarkers(ctx.client, ctx.siteId) }))
}

/** Реестр меток: семейство, ID, зона, координаты/ориентация, размер, высота, активность, дата калибровки. */
export async function PUT(req: Request) {
  return withRouteTx(req, "route.map.write", async (ctx) => {
    if (!Array.isArray(ctx.body.markers)) fail(400, "markers[] обязателен", "markers_required")
    const res = await upsertMarkers(ctx.client, ctx.siteId, ctx.body.markers as unknown[], actorLabel(ctx.actor))
    return { ...res, markers: await listMarkers(ctx.client, ctx.siteId) }
  })
}

/** Импорт координат меток с плана WMS (fg-plan-apriltags). Размер/высоту нужно подтвердить. */
export async function POST(req: Request) {
  return withRouteTx(req, "route.map.write", async (ctx) => ({
    ...(await importWmsPlanTags(ctx.client, ctx.siteId, actorLabel(ctx.actor))),
    markers: await listMarkers(ctx.client, ctx.siteId),
  }))
}
