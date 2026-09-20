import { NextResponse } from "next/server"
import { withRowIdentify } from "@/lib/wms/row-identify-route"
import { resolveRowIdentifySession } from "@/lib/wms/row-identify"
import { requireWmsActor } from "@/lib/wms/require-actor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true });
  if ("error" in actorGate) return actorGate.error;

  const { id } = await ctx.params
  let body: { siteCode?: string } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    body = {}
  }
  return withRowIdentify(req, body.siteCode, async (client, siteId) => {
    const session = await resolveRowIdentifySession(client, siteId, id)
    return NextResponse.json(session)
  })
}
