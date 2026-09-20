import { NextResponse } from "next/server"
import {
  listAprilTagFamilies,
  resolveFamily,
} from "@/lib/wms/apriltag-generate"
import { withFgSite } from "@/lib/wms/finished-goods-route"
import { readFgPlanAprilTags } from "@/lib/wms/fg-plan-apriltags-storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withFgSite(req, async (_client, siteId) => {
    const snapshot = await readFgPlanAprilTags(siteId)
    const planFamily = resolveFamily(snapshot.family)
    const plan = snapshot.tags.map((tag) => ({
      id: tag.id,
      tagId: tag.tagId,
      label: tag.label ?? null,
      rows: tag.coverage?.rows ?? [],
    }))
    return NextResponse.json({
      family: planFamily.id,
      maxId: planFamily.maxId,
      families: listAprilTagFamilies(),
      updatedAt: snapshot.updatedAt,
      planCount: plan.length,
      plan,
    })
  })
}
