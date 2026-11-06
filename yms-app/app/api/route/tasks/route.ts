import { actorLabel } from "@/lib/route/auth"
import { fail, num, str, withRoute, withRouteTx } from "@/lib/route/http"
import { createTask, listTasks, offerNext } from "@/lib/route/tasks"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withRoute(req, "route.read", async (ctx) => ({
    tasks: await listTasks(ctx.client, ctx.siteId, {
      status: ctx.url.searchParams.get("status"),
      open: ctx.url.searchParams.get("all") !== "1",
      limit: Number(ctx.url.searchParams.get("limit") || 200),
    }),
  }))
}

/** Создать задание диспетчером/интеграцией. Палета проверяется в WMS, данные груза — из WMS. */
export async function POST(req: Request) {
  return withRouteTx(req, "route.dispatch", async (ctx) => {
    const b = ctx.body
    const { task, created } = await createTask(
      ctx.client,
      ctx.siteId,
      ctx.siteCode,
      {
        type: str(b, "type", 40),
        sourceCode: str(b, "sourceCode", 80),
        destCode: str(b, "destCode", 80),
        huCode: str(b, "huCode", 80),
        priority: num(b, "priority"),
        wmsRefKind: str(b, "wmsRefKind", 40) || null,
        wmsRefId: str(b, "wmsRefId", 80) || null,
        note: str(b, "note", 240) || null,
        forkliftTypes: Array.isArray(b.forkliftTypes) ? (b.forkliftTypes as unknown[]).map(String) : null,
        simulation: b.simulation === true,
      },
      actorLabel(ctx.actor)
    )
    const karaId = str(b, "karaId", 64)
    if (karaId) fail(400, "Назначение — отдельной командой dispatch/assign", "use_assign")
    return { ok: true, created, task }
  })
}
