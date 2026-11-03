import { actorLabel } from "@/lib/route/auth"
import { str, withRouteTx } from "@/lib/route/http"
import { publishMap } from "@/lib/route/maps"
import { recheckRoutesAfterBlock } from "@/lib/route/tasks"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Публикация: только черновик без ошибок проверки (нет проездов сквозь стеллажи/стены). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withRouteTx(req, "route.map.write", async (ctx) => {
    const actor = actorLabel(ctx.actor)
    const res = await publishMap(ctx.client, ctx.siteId, id, actor, str(ctx.body, "note", 300))
    const rechecked = await recheckRoutesAfterBlock(ctx.client, ctx.siteId, actor)
    return { ok: true, map: { ...res.map, geometry: undefined }, issues: res.issues, rechecked }
  })
}
