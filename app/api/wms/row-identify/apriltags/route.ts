import { NextResponse } from "next/server"
import { withRowIdentify } from "@/lib/wms/row-identify-route"
import { readFgPlanAprilTags, toPhoneAprilTagMap } from "@/lib/wms/fg-plan-apriltags-storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const url = new URL(req.url)
  return withRowIdentify(req, url.searchParams.get("siteCode"), async (_client, siteId) => {
    const snapshot = await readFgPlanAprilTags(siteId)
    return NextResponse.json({
      updatedAt: snapshot.updatedAt,
      ...toPhoneAprilTagMap(snapshot.tags),
    })
  })
}
