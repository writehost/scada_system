import { NextResponse } from "next/server"
import { findFgMarkingCode } from "@/lib/wms/finished-goods-warehouse"
import { withFgSite } from "@/lib/wms/finished-goods-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withFgSite(req, async (client, siteId) => {
    const url = new URL(req.url)
    const code = url.searchParams.get("code") ?? ""
    const hit = await findFgMarkingCode(client, siteId, code)
    return NextResponse.json({ hit })
  })
}
