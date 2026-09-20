import { NextResponse } from "next/server"
import { getFgExpiryBuckets } from "@/lib/wms/finished-goods-warehouse"
import { withFgSite } from "@/lib/wms/finished-goods-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withFgSite(req, async (client, siteId) => {
    const buckets = await getFgExpiryBuckets(client, siteId)
    return NextResponse.json({ buckets })
  })
}
