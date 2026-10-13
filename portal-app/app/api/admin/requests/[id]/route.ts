import { NextResponse } from "next/server"
import { assertSameOrigin, fail, parseId, readJson } from "@/lib/http"
import { getRequestDetail, updateRequest, type AdminPatch } from "@/lib/requests"
import { requireOwner } from "@/lib/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireOwner()
    return NextResponse.json(await getRequestDetail(parseId((await ctx.params).id)))
  } catch (error) {
    return fail(error)
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req)
    const s = await requireOwner()
    const body = await readJson(req)
    const patch: AdminPatch = {}
    if (typeof body.status === "string") patch.status = body.status
    if (body.assign === "me" || body.assign === "none") patch.assign = body.assign
    if (Array.isArray(body.approvedModules)) patch.approvedModules = body.approvedModules as string[]
    if (body.organization === null) patch.organization = null
    else if (body.organization && typeof body.organization === "object") {
      const o = body.organization as Record<string, unknown>
      patch.organization = { ref: String(o.ref || ""), name: String(o.name || o.ref || "") }
    }
    if (typeof body.note === "string") patch.note = body.note
    if (typeof body.notifyApplicant === "boolean") patch.notifyApplicant = body.notifyApplicant
    return NextResponse.json(await updateRequest(parseId((await ctx.params).id), s, patch))
  } catch (error) {
    return fail(error)
  }
}
