import { NextResponse } from "next/server"
import { readFgKaraFleet, upsertLoadingPoint, writeFgKaraFleet } from "@/lib/wms/fg-kara-fleet"
import { withFleetSite } from "@/lib/wms/fg-kara-fleet-http"
import { requireWmsActor } from "@/lib/wms/require-actor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withFleetSite(req, async (_client, siteId) => {
    const fleet = await readFgKaraFleet(siteId)
    return NextResponse.json({ loadingPoints: fleet.loadingPoints })
  })
}

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  return withFleetSite(req, async (_client, siteId, body) => {
    const fleet = await readFgKaraFleet(siteId)
    const { snapshot, point } = upsertLoadingPoint(fleet, body)
    const saved = await writeFgKaraFleet(siteId, snapshot)
    return NextResponse.json({ point, fleet: saved }, { status: 201 })
  })
}
