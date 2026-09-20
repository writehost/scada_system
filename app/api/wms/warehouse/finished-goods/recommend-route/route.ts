import { NextResponse } from "next/server"
import { recommendFor } from "@/lib/wms/fg-kara-fleet"
import { withFleetSite } from "@/lib/wms/fg-kara-fleet-http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withFleetSite(req, async (client, siteId) => {
    const url = new URL(req.url)
    const result = await recommendFor(client, siteId, {
      karaId: url.searchParams.get("karaId") || undefined,
      lineCode: url.searchParams.get("lineCode") || undefined,
      itemCode: url.searchParams.get("itemCode") || undefined,
      routeId: url.searchParams.get("routeId") || undefined,
    })
    return NextResponse.json({
      kara: result.kara,
      route: result.route,
      itemCode: result.itemCode,
      itemName: result.itemName,
      lineCode: result.lineCode,
      rows: result.rows,
      tags: result.tags,
      interleave: result.interleave,
    })
  })
}
