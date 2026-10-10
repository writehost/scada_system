import { NextResponse } from "next/server"
import { errorResponse, resolveUser } from "@/lib/server/http.ts"
import { withSystem } from "@/lib/server/db.ts"
import { revokeSession, SESSION_COOKIE } from "@/lib/server/session.ts"
import { audit } from "@/lib/services/audit.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const auth = await resolveUser(req)
    if (auth) {
      await withSystem(async (c) => {
        await revokeSession(c, auth.user.sessionId)
        await audit(c, auth.user.activeOrgId, { kind: "user", id: auth.user.userId }, "auth.logout", { type: "session", id: auth.user.sessionId })
      })
    }
    const res = NextResponse.json({ ok: true })
    res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 })
    return res
  } catch (e) {
    return errorResponse(e)
  }
}
