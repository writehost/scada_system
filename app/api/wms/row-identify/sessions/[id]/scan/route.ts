import { NextResponse } from "next/server"
import { withRowIdentify } from "@/lib/wms/row-identify-route"
import { scanRowIdentifyCode } from "@/lib/wms/row-identify"
import { requireWmsActor } from "@/lib/wms/require-actor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true });
  if ("error" in actorGate) return actorGate.error;

  const { id } = await ctx.params
  let body: { siteCode?: string; code?: string; role?: string } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const role = body.role === "end" ? "end" : body.role === "start" ? "start" : null
  if (!role) return NextResponse.json({ error: "role must be start or end" }, { status: 400 })
  if (!body.code?.trim()) return NextResponse.json({ error: "code is required" }, { status: 400 })

  return withRowIdentify(req, body.siteCode, async (client, siteId) => {
    const session = await scanRowIdentifyCode(client, siteId, id, body.code!.trim(), role)
    return NextResponse.json(session)
  })
}
