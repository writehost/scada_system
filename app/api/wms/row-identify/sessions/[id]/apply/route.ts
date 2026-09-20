import { NextResponse } from "next/server"
import { withRowIdentify } from "@/lib/wms/row-identify-route"
import { applyRowIdentifySession } from "@/lib/wms/row-identify"
import { attachSessionCodesToFgLocation, resolveOrCreateFgPlanLocation } from "@/lib/wms/fg-plan-locations"
import { postFgPlanInventoryToStock } from "@/lib/wms/fg-plan-stock-post"
import { requireWmsActor } from "@/lib/wms/require-actor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true });
  if ("error" in actorGate) return actorGate.error;

  const { id } = await ctx.params
  let body: { siteCode?: string; rowId?: string } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    body = {}
  }
  return withRowIdentify(req, body.siteCode, async (client, siteId, auth) => {
    const rowId =
      body.rowId?.trim() ||
      (auth.via === "map-token" ? auth.token.rowId : undefined) ||
      null
    const session = await applyRowIdentifySession(siteId, id, rowId)
    try {
      const planRowId = session.rowId?.trim()
      if (planRowId) {
        const loc = await resolveOrCreateFgPlanLocation(client, siteId, planRowId)
        await attachSessionCodesToFgLocation(client, siteId, loc.locationId, session)
      }
      if (session.appliedAddresses?.length) {
        await postFgPlanInventoryToStock(client, siteId, { addresses: session.appliedAddresses })
      }
    } catch (error) {
      console.error("[row-identify apply] fg location / stock", error)
    }
    return NextResponse.json(session)
  })
}
