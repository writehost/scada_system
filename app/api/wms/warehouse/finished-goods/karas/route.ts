import { NextResponse } from "next/server"
import { readFgKaraFleet, upsertKara, writeFgKaraFleet } from "@/lib/wms/fg-kara-fleet"
import { withFleetSite } from "@/lib/wms/fg-kara-fleet-http"
import { requireWmsActor } from "@/lib/wms/require-actor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withFleetSite(req, async (_client, siteId) => {
    const fleet = await readFgKaraFleet(siteId)
    return NextResponse.json({ karas: fleet.karas, updatedAt: fleet.updatedAt })
  })
}

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  return withFleetSite(req, async (_client, siteId, body) => {
    const fleet = await readFgKaraFleet(siteId)
    const { snapshot, kara } = upsertKara(fleet, body)
    const saved = await writeFgKaraFleet(siteId, snapshot)
    return NextResponse.json({ kara, fleet: saved }, { status: 201 })
  })
}
