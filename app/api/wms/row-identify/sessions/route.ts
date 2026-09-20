import { NextResponse } from "next/server"
import { withRowIdentify } from "@/lib/wms/row-identify-route"
import { createRowIdentifySession } from "@/lib/wms/row-identify"
import { requireWmsActor } from "@/lib/wms/require-actor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true });
  if ("error" in actorGate) return actorGate.error;

  let body: { siteCode?: string; rowId?: string } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    body = {}
  }
  return withRowIdentify(req, body.siteCode, async (_client, _siteId, auth) => {
    const rowId =
      body.rowId?.trim() ||
      (auth.via === "map-token" ? auth.token.rowId : undefined) ||
      null
    const session = await createRowIdentifySession({
      siteCode: body.siteCode || (auth.via === "map-token" ? auth.token.siteCode : "DEFAULT"),
      rowId,
    })
    return NextResponse.json(session, { status: 201 })
  })
}
