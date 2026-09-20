import { NextResponse } from "next/server"
import { loadPlanPath } from "@/lib/wms/fg-plan-path"
import { withFleetSite } from "@/lib/wms/fg-kara-fleet-http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withFleetSite(req, async (_client, siteId) => {
    const { tags } = await loadPlanPath(siteId)
    return NextResponse.json({ pathTags: tags })
  })
}
