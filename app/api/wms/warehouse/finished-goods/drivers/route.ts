import { NextResponse } from "next/server"
import { readFgKaraFleet, upsertDriver, writeFgKaraFleet } from "@/lib/wms/fg-kara-fleet-storage"
import { withFleetSite } from "@/lib/wms/fg-kara-fleet-http"
import { requireWmsActor } from "@/lib/wms/require-actor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withFleetSite(req, async (_client, siteId) => {
    const fleet = await readFgKaraFleet(siteId)
    return NextResponse.json({
      drivers: fleet.drivers,
      karas: fleet.karas,
      updatedAt: fleet.updatedAt,
    })
  })
}

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req)
  if ("error" in actorGate) return actorGate.error

  return withFleetSite(req, async (_client, siteId, body) => {
    try {
      const fleet = await readFgKaraFleet(siteId)
      const { snapshot, driver } = upsertDriver(fleet, body)
      const saved = await writeFgKaraFleet(siteId, snapshot)
      return NextResponse.json({ driver, fleet: saved }, { status: 201 })
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "не удалось сохранить карщика" },
        { status: 400 }
      )
    }
  })
}
