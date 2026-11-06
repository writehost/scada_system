import { listMarkers } from "@/lib/route/apriltags"
import { listForklifts } from "@/lib/route/fleet"
import { withRoute } from "@/lib/route/http"
import { fetchKaraCatalog, karaCommandsConfig, reconcileCatalog } from "@/lib/route/kara-commands"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Диагностика интеграции с kara-commands (администратор): настроен ли токен, отвечает ли WMS,
 * совпадают ли кары и теги WMS с погрузчиками и метками Route. Только чтение (GET каталога).
 * Токен в ответ не попадает.
 */
export async function GET(req: Request) {
  return withRoute(req, "route.map.write", async (ctx) => {
    const cfg = karaCommandsConfig()
    const base = {
      configured: !!cfg,
      baseUrl: cfg?.baseUrl ?? null,
      gotoInSimulation: cfg?.gotoInSimulation ?? false,
      pickupPlace: "не используются: реализация на production не проверена (см. docs/FORKLIFT.md)",
    }
    if (!cfg) return { ...base, reachable: false, message: "WMS_KARA_API_URL / WMS_KARA_API_TOKEN не заданы" }
    const cat = await fetchKaraCatalog(ctx.siteCode, cfg)
    if (!cat.ok) return { ...base, reachable: false, message: cat.message, httpStatus: cat.status }
    const fleet = await listForklifts(ctx.client, ctx.siteId)
    const markers = await listMarkers(ctx.client, ctx.siteId)
    return {
      ...base,
      reachable: true,
      counts: { karas: cat.data.karas.length, tags: cat.data.tags.length, items: cat.data.items.length },
      karas: cat.data.karas.map((k) => ({ id: k.id, name: k.name })),
      tags: cat.data.tags.map((t) => ({ tagId: t.tagId, rows: t.rows })),
      reconcile: reconcileCatalog(
        cat.data,
        fleet.units.map((u) => u.id),
        markers.map((m) => m.tagId)
      ),
    }
  })
}
