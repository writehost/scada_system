import { NextResponse } from "next/server"
import { addViolation, readFgKaraFleet, writeFgKaraFleet } from "@/lib/wms/fg-kara-fleet-storage"
import { withFleetSite } from "@/lib/wms/fg-kara-fleet-http"
import { requireWmsActor } from "@/lib/wms/require-actor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withFleetSite(req, async (_client, siteId) => {
    const fleet = await readFgKaraFleet(siteId)
    return NextResponse.json({ violations: fleet.violations || [], updatedAt: fleet.updatedAt })
  })
}

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req)
  if ("error" in actorGate) return actorGate.error
  return withFleetSite(req, async (_client, siteId, body) => {
    try {
      const fleet = await readFgKaraFleet(siteId)
      const { snapshot, violation } = addViolation(fleet, {
        kind: String(body.kind || "other"),
        driverId: body.driverId != null ? String(body.driverId) : null,
        karaId: body.karaId != null ? String(body.karaId) : null,
        missionId: body.missionId != null ? String(body.missionId) : null,
        message: String(body.message || ""),
        meta: body.meta && typeof body.meta === "object" ? body.meta : undefined,
      })
      const saved = await writeFgKaraFleet(siteId, snapshot)
      return NextResponse.json({ violation, fleet: saved }, { status: 201 })
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "ошибка" },
        { status: 400 }
      )
    }
  })
}
