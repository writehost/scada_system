import { NextResponse } from "next/server"
import { errorResponse, resolveUser } from "@/lib/server/http.ts"
import { withSystem } from "@/lib/server/db.ts"
import { HttpError } from "@/lib/server/errors.ts"
import { rateLimit } from "@/lib/server/ratelimit.ts"
import { createDemoOrg } from "@/lib/services/demo.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Открыть демо: создаёт отдельную демо-организацию (или переключает на существующую). */
export async function POST(req: Request) {
  try {
    const auth = await resolveUser(req)
    if (!auth) throw new HttpError(401, "auth_required", "Нужен вход")
    const body = (await req.json().catch(() => ({}))) as { segment?: string }
    const segment = body.segment === "industrial" ? "industrial" : "home"
    if (!rateLimit(`demo:${auth.user.userId}`, 5, 3600_000).ok) throw new HttpError(429, "rate_limited", "Демо можно создавать не чаще 5 раз в час")
    const orgId = await withSystem(async (c) => {
      const existing = await c.query(
        `SELECT o.org_id FROM ems_organizations o JOIN ems_memberships m ON m.org_id = o.org_id WHERE m.user_id = $1 AND o.is_demo AND o.segment = $2 AND o.archived_at IS NULL LIMIT 1`,
        [auth.user.userId, segment],
      )
      const id = existing.rows[0]?.org_id ?? (await createDemoOrg(c, auth.user.userId, segment))
      await c.query("UPDATE ems_sessions SET active_org_id = $2 WHERE session_id = $1", [auth.user.sessionId, id])
      return id
    })
    return NextResponse.json({ orgId })
  } catch (e) {
    return errorResponse(e)
  }
}
