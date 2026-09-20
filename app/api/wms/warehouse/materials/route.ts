import { NextResponse } from "next/server"
import { listMaterialsWarehouse, MATERIALS_ITEM_TYPES } from "@/lib/wms/materials-warehouse"
import { withFgSite } from "@/lib/wms/finished-goods-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withFgSite(req, async (client, siteId) => {
    const url = new URL(req.url)
    const query = url.searchParams.get("query") ?? url.searchParams.get("q") ?? ""
    const productGroupNames = url.searchParams
      .getAll("productGroup")
      .map((s) => s.trim())
      .filter(Boolean)
    const itemTypeCode =
      (url.searchParams.get("itemTypeCode") ?? "").trim() || MATERIALS_ITEM_TYPES.join(",")
    const rows = await listMaterialsWarehouse(client, siteId, {
      query,
      productGroupNames,
      includeBareProductGroup: url.searchParams.get("bareProductGroup") === "1",
      itemTypeCode,
    })
    return NextResponse.json({
      rows,
      summary: {
        itemCount: rows.length,
        issueCount: rows.filter((r) => r.urgency === "issue" || r.urgency === "expired").length,
        quarantineCount: rows.filter(
          (r) => r.qualityStatus === "QUARANTINE" || r.qualityStatus === "HOLD" || r.qualityStatus === "REJECTED"
        ).length,
        fefoCount: rows.filter((r) => r.rotationPolicy === "fefo").length,
      },
    })
  })
}
