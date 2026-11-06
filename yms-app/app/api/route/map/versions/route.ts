import { actorLabel } from "@/lib/route/auth"
import { fail, str, withRoute, withRouteTx } from "@/lib/route/http"
import { createDraft, listMapVersions, mapChanges, seedDraftIfEmpty } from "@/lib/route/maps"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withRouteTx(req, "route.read", async (ctx) => {
    await seedDraftIfEmpty(ctx.client, ctx.siteId)
    return { versions: await listMapVersions(ctx.client, ctx.siteId), changes: await mapChanges(ctx.client, ctx.siteId, null) }
  })
}

/** Новый черновик на основе существующей версии. */
export async function POST(req: Request) {
  return withRouteTx(req, "route.map.write", async (ctx) => {
    const from = str(ctx.body, "fromMapId", 20)
    if (!from) fail(400, "fromMapId обязателен", "from_required")
    return { map: await createDraft(ctx.client, ctx.siteId, from, actorLabel(ctx.actor)) }
  })
}
void withRoute
