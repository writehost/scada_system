import { driverState } from "@/lib/route/driver-state"
import { withRouteTx } from "@/lib/route/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Активное задание водителя. Свободному погрузчику YMS сразу предлагает следующее задание. */
export async function GET(req: Request) {
  return withRouteTx(req, "route.drive", (ctx) => driverState(ctx.client, ctx.siteId, ctx.actor, { allowOffer: true }))
}
