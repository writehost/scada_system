import { NextResponse } from "next/server"
import { computeDriverStats, readFgKaraFleet } from "@/lib/wms/fg-kara-fleet-storage"
import { withFleetSite } from "@/lib/wms/fg-kara-fleet-http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withFleetSite(req, async (_client, siteId) => {
    const fleet = await readFgKaraFleet(siteId)
    const stats = computeDriverStats(fleet)
    return NextResponse.json({
      stats,
      violations: (fleet.violations || []).slice(0, 100),
      updatedAt: fleet.updatedAt,
    })
  })
}
