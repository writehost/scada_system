import { NextResponse } from "next/server"
import { dispatchKara } from "@/lib/wms/fg-kara-fleet"
import { withFleetSite } from "@/lib/wms/fg-kara-fleet-http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  return withFleetSite(req, async (client, siteId, body) => {
    try {
      const result = await dispatchKara(client, siteId, {
        karaId: typeof body.karaId === "string" ? body.karaId : undefined,
        karaName: typeof body.karaName === "string" ? body.karaName : undefined,
        lineCode: typeof body.lineCode === "string" ? body.lineCode : undefined,
        itemCode: typeof body.itemCode === "string" ? body.itemCode : undefined,
        routeId: typeof body.routeId === "string" ? body.routeId : undefined,
        stops: body.stops,
        path: body.path,
        pickupIndex: body.pickupIndex,
        dropIndex: body.dropIndex,
        note: typeof body.note === "string" ? body.note : undefined,
        kind: typeof body.kind === "string" ? body.kind : undefined,
        source: typeof body.source === "string" ? body.source : undefined,
        driverId: body.driverId != null ? String(body.driverId) : null,
        lotCode: body.lotCode != null ? String(body.lotCode) : null,
        palletId: body.palletId != null ? String(body.palletId) : null,
        targetRowId: body.targetRowId != null ? String(body.targetRowId) : null,
        priority: typeof body.priority === "number" ? body.priority : undefined,
        startStatus: body.startStatus === "queued" ? "queued" : "active",
      })
      const current = result.mission.stops[result.mission.currentIndex]
      return NextResponse.json({
        mission: result.mission,
        kara: result.kara,
        route: result.route,
        currentStop: current || null,
        remaining: result.mission.stops.slice(result.mission.currentIndex),
        fleet: result.fleet,
        interleave: result.interleave,
      })
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "не удалось создать задание" },
        { status: 400 }
      )
    }
  })
}
