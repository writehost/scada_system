import { actorLabel } from "@/lib/route/auth"
import { validateMap } from "@/lib/route/graph"
import { num, str, withRoute, withRouteTx } from "@/lib/route/http"
import { getMapVersion, mapChanges, saveDraft } from "@/lib/route/maps"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withRoute(req, "route.read", async (ctx) => {
    const map = await getMapVersion(ctx.client, ctx.siteId, id)
    return { map, validation: validateMap(map.geometry), changes: await mapChanges(ctx.client, ctx.siteId, id) }
  })
}

/** Сохранить черновик. Каждое сохранение — запись в журнал изменений с диффом. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withRouteTx(req, "route.map.write", async (ctx) => {
    const res = await saveDraft(
      ctx.client,
      ctx.siteId,
      id,
      { geometry: ctx.body.geometry, expectedRevision: num(ctx.body, "expectedRevision"), summary: str(ctx.body, "summary", 300) },
      actorLabel(ctx.actor)
    )
    return { map: res.map, validation: validateMap(res.map.geometry) }
  })
}
