import { NextResponse } from "next/server"
import { assertSameOrigin, fail, parseId } from "@/lib/http"
import { inviteRequest } from "@/lib/requests"
import { requireOwner } from "@/lib/session"
import { publicOrigin } from "@/lib/site"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req)
    const s = await requireOwner()
    const id = parseId((await ctx.params).id)
    return NextResponse.json(await inviteRequest(id, s, publicOrigin(req)))
  } catch (error) {
    return fail(error)
  }
}
