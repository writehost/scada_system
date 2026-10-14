import { NextResponse } from "next/server"
import { EDI_SESSION_COOKIE, readCookie, verifySessionToken } from "@/lib/auth/session.ts"
import { withClient } from "@/lib/db.ts"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const session = await verifySessionToken(readCookie(req, EDI_SESSION_COOKIE))
  if (session?.sid) {
    try {
      await withClient((client) => client.query("DELETE FROM edi_auth_sessions WHERE session_id = $1::uuid AND user_id = $2::bigint", [session.sid, session.userId]))
    } catch {
      return NextResponse.json({ error: "Не удалось завершить серверную сессию; повторите выход" }, { status: 503 })
    }
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set(EDI_SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 })
  return res
}
