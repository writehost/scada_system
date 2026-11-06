import { actorLabel } from "@/lib/route/auth"
import { withRoute, withRouteTx } from "@/lib/route/http"
import { listCalibrations, saveCalibration } from "@/lib/route/apriltags"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withRoute(req, "route.read", async (ctx) => ({ calibrations: await listCalibrations(ctx.client, ctx.siteId) }))
}

/** Новая версия калибровки камеры (камера + объектив + разрешение). Старые версии остаются в истории. */
export async function POST(req: Request) {
  return withRouteTx(req, "route.map.write", async (ctx) => ({
    calibration: await saveCalibration(ctx.client, ctx.siteId, ctx.body, actorLabel(ctx.actor)),
  }))
}
