import { NextResponse } from "next/server"
import { authorizeRowIdentify } from "@/lib/wms/row-identify-route"
import { getRowIdentifySession } from "@/lib/wms/row-identify"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const url = new URL(req.url)
  const auth = await authorizeRowIdentify(req, url.searchParams.get("siteCode"))
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { id } = await ctx.params
  const session = await getRowIdentifySession(id)
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 })
  return NextResponse.json(session)
}
