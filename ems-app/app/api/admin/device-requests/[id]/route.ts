import { NextResponse } from "next/server"
import { errorResponse } from "@/lib/server/http.ts"
import { requirePlatformAdmin } from "@/lib/server/admin.ts"
import { isUuid, withSystem } from "@/lib/server/db.ts"
import { badRequest } from "@/lib/server/errors.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requirePlatformAdmin(req)
    const { id } = await ctx.params
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    if (!isUuid(id) || !["new", "processing", "closed"].includes(String(body.status))) throw badRequest("Статус заявки")
    await withSystem((c) => c.query("UPDATE ems_device_requests SET status = $2 WHERE request_id = $1", [id, body.status]))
    return NextResponse.json({ ok: true })
  } catch (e) {
    return errorResponse(e)
  }
}
