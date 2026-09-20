import { NextResponse } from "next/server"
import { withPlacementSite } from "@/lib/wms/fg-placement-http"
import { loadOutboundDemand } from "@/lib/wms/fg-cross-dock"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withPlacementSite(req, async (client, siteId) => {
    const hints = await loadOutboundDemand(client, siteId)
    return NextResponse.json({ hints })
  })
}
