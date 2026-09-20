import { NextResponse } from "next/server"
import { setFleetVisibility } from "@/lib/wms/fg-kara-fleet"
import { withFleetSite } from "@/lib/wms/fg-kara-fleet-http"
import { requireWmsActor } from "@/lib/wms/require-actor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  return withFleetSite(req, async (_client, siteId, body) => {
    const hiddenRouteIds = Array.isArray(body.hiddenRouteIds)
      ? body.hiddenRouteIds.map((v) => String(v))
      : undefined
    const fleet = await setFleetVisibility(siteId, {
      hideAllRoutes: typeof body.hideAllRoutes === "boolean" ? body.hideAllRoutes : undefined,
      hideEditorRoute: typeof body.hideEditorRoute === "boolean" ? body.hideEditorRoute : undefined,
      hiddenRouteIds,
      routeId: typeof body.routeId === "string" ? body.routeId : undefined,
      hidden: typeof body.hidden === "boolean" ? body.hidden : undefined,
    })
    return NextResponse.json({ fleet })
  })
}
