import { NextResponse } from "next/server"
import { errorResponse, resolveUser } from "@/lib/server/http.ts"
import { withSystem } from "@/lib/server/db.ts"
import { HttpError } from "@/lib/server/errors.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const auth = await resolveUser(req)
    if (!auth) throw new HttpError(401, "auth_required", "Нужен вход")
    const rows = await withSystem(async (c) =>
      (await c.query(
        `SELECT session_id, kind, created_at, last_seen_at, expires_at, user_agent, ip FROM ems_sessions
          WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC`,
        [auth.user.userId],
      )).rows,
    )
    return NextResponse.json({ sessions: rows.map((s) => ({ ...s, current: s.session_id === auth.user.sessionId })) })
  } catch (e) {
    return errorResponse(e)
  }
}
