import { NextResponse } from "next/server"
import { advanceMission } from "@/lib/wms/fg-kara-fleet"
import { withFleetSite } from "@/lib/wms/fg-kara-fleet-http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const params = await Promise.resolve(ctx.params)
  return withFleetSite(req, async (_client, siteId, body) => {
    try {
      const actionRaw = String(body.action || "advance")
      const allowed = ["advance", "cancel", "complete", "accept", "refuse", "wrong_row"] as const
      const action = (allowed as readonly string[]).includes(actionRaw)
        ? (actionRaw as (typeof allowed)[number])
        : "advance"
      const result = await advanceMission(siteId, params.id, action, {
        driverId: body.driverId != null ? String(body.driverId) : null,
        refuseReason: body.refuseReason != null ? String(body.refuseReason) : null,
        actualRowId: body.actualRowId != null ? String(body.actualRowId) : null,
      })
      const current = result.mission.stops[result.mission.currentIndex]
      return NextResponse.json({
        mission: result.mission,
        currentStop: current || null,
        remaining: result.mission.stops.slice(result.mission.currentIndex),
        fleet: result.fleet,
        interleave: result.interleave,
      })
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "ошибка задания" },
        { status: 400 }
      )
    }
  })
}
