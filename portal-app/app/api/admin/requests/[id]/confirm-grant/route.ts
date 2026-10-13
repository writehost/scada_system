import { NextResponse } from "next/server"
import { assertSameOrigin, fail, parseId, readJson } from "@/lib/http"
import { confirmManualGrant } from "@/lib/requests"
import { requireOwner } from "@/lib/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req)
    const s = await requireOwner()
    const id = parseId((await ctx.params).id)
    const body = await readJson(req)
    return NextResponse.json(await confirmManualGrant(id, s, String(body.note || "")))
  } catch (error) {
    return fail(error)
  }
}
