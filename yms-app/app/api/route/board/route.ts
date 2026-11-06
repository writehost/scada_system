import { withRouteTx } from "@/lib/route/http"
import { getDemandSettings } from "@/lib/route/demand"
import { listForklifts } from "@/lib/route/fleet"
import { activeBlocks, getPublishedMap, seedDraftIfEmpty } from "@/lib/route/maps"
import { listPositions } from "@/lib/route/positions"
import { listExceptions, listTasks, sessionsList } from "@/lib/route/tasks"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Диспетчерская: погрузчики, задания, проблемы, блокировки, очереди у линий. */
export async function GET(req: Request) {
  return withRouteTx(req, "route.read", async (ctx) => {
    await seedDraftIfEmpty(ctx.client, ctx.siteId)
    const [fleet, positions, sessions, tasks, exceptions, blocks, map, demand] = [
      await listForklifts(ctx.client, ctx.siteId),
      await listPositions(ctx.client, ctx.siteId),
      await sessionsList(ctx.client, ctx.siteId),
      await listTasks(ctx.client, ctx.siteId, { open: true }),
      await listExceptions(ctx.client, ctx.siteId, true),
      await activeBlocks(ctx.client, ctx.siteId),
      await getPublishedMap(ctx.client, ctx.siteId),
      await getDemandSettings(ctx.client, ctx.siteId),
    ]
    const lineQueues: Record<string, number> = {}
    for (const t of tasks) {
      if (t.type === "PRODUCTION_PICKUP" && !["COMPLETED", "CANCELLED"].includes(t.status)) {
        lineQueues[t.sourceCode] = (lineQueues[t.sourceCode] || 0) + 1
      }
    }
    return {
      fleet,
      positions,
      sessions,
      tasks,
      exceptions,
      blocks,
      lineQueues,
      demand,
      map: map ? { mapId: map.mapId, version: map.version, revision: map.revision } : null,
      serverTime: new Date().toISOString(),
    }
  })
}
