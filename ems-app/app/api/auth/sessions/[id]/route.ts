import { NextResponse } from "next/server"
import { errorResponse, resolveUser } from "@/lib/server/http.ts"
import { isUuid, withSystem } from "@/lib/server/db.ts"
import { HttpError } from "@/lib/server/errors.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await resolveUser(req)
    if (!auth) throw new HttpError(401, "auth_required", "Нужен вход")
    const { id } = await ctx.params
    if (!isUuid(id)) throw new HttpError(400, "invalid_input", "Неверный идентификатор")
    await withSystem((c) => c.query("UPDATE ems_sessions SET revoked_at = now() WHERE session_id = $1 AND user_id = $2 AND revoked_at IS NULL", [id, auth.user.userId]))
    return NextResponse.json({ ok: true })
  } catch (e) {
    return errorResponse(e)
  }
}
