import { actorLabel } from "@/lib/route/auth"
import { getDemandSettings, saveDemandSettings, syncDemand } from "@/lib/route/demand"
import { withRoute, withRouteTx } from "@/lib/route/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withRoute(req, "route.read", async (ctx) => ({ settings: await getDemandSettings(ctx.client, ctx.siteId) }))
}

/** Забрать потребности WMS и сформировать задания YMS. */
export async function POST(req: Request) {
  return withRouteTx(req, "route.dispatch", async (ctx) => ({
    report: await syncDemand(ctx.client, ctx.siteId, ctx.siteCode, actorLabel(ctx.actor)),
  }))
}

export async function PUT(req: Request) {
  return withRouteTx(req, "route.dispatch", async (ctx) => ({
    settings: await saveDemandSettings(ctx.client, ctx.siteId, ctx.body as Record<string, boolean>, actorLabel(ctx.actor)),
  }))
}
