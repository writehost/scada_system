import { NextResponse } from "next/server"
import { errorResponse, resolveUser } from "@/lib/server/http.ts"
import { withSystem } from "@/lib/server/db.ts"
import { HttpError } from "@/lib/server/errors.ts"
import { uuid } from "@/lib/server/validate.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const auth = await resolveUser(req)
    if (!auth) throw new HttpError(401, "auth_required", "Нужен вход")
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const orgId = uuid(body, "orgId", "Организация", true)!
    await withSystem(async (c) => {
      const m = await c.query("SELECT 1 FROM ems_memberships WHERE org_id = $1 AND user_id = $2", [orgId, auth.user.userId])
      if (!m.rows[0]) throw new HttpError(403, "not_member", "Нет доступа к этой организации")
      await c.query("UPDATE ems_sessions SET active_org_id = $2 WHERE session_id = $1", [auth.user.sessionId, orgId])
    })
    return NextResponse.json({ ok: true, orgId })
  } catch (e) {
    return errorResponse(e)
  }
}
