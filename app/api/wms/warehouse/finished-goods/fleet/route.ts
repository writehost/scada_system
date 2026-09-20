import { NextResponse } from "next/server"
import { loadFleetTags, readFgKaraFleet } from "@/lib/wms/fg-kara-fleet"
import { withFleetSite } from "@/lib/wms/fg-kara-fleet-http"
import { loadPlanPath } from "@/lib/wms/fg-plan-path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withFleetSite(req, async (_client, siteId) => {
    const fleet = await readFgKaraFleet(siteId)
    const [tags, path] = await Promise.all([loadFleetTags(siteId), loadPlanPath(siteId)])
    return NextResponse.json({ ...fleet, tags, pathTags: path.tags })
  })
}
