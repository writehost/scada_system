import { NextResponse } from "next/server"
import { passwordLogin } from "@/lib/auth/identity.ts"
import { createSessionToken, EDI_SESSION_COOKIE, sessionCookieOptions, SESSION_TTL_SEC } from "@/lib/auth/session.ts"
import { withClient } from "@/lib/db.ts"
import { errorResponse, prepare } from "@/lib/http.ts"
import { recordEvent } from "@/lib/edi/audit.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  let body: { login?: string; password?: string; siteCode?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 })
  }
  const login = String(body.login ?? "").trim()
  const password = String(body.password ?? "")
  if (!login || !password) return NextResponse.json({ error: "Введите логин и пароль" }, { status: 400 })
  try {
    const result = await withClient(async (client) => {
      await prepare(client)
      const r = await passwordLogin(client, { login, password, siteCode: body.siteCode })
      if (r.ok) {
        await recordEvent(client, {
          siteId: r.session.siteId,
          actorUserId: r.session.userId,
          actorName: r.session.fio,
          action: "auth.login",
          details: { via: "password" },
          ip: (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null,
        })
      }
      return r
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    const token = await createSessionToken(result.session)
    const res = NextResponse.json({ ok: true, user: { login: result.session.login, fio: result.session.fio } })
    res.cookies.set(EDI_SESSION_COOKIE, token, sessionCookieOptions(SESSION_TTL_SEC))
    return res
  } catch (e) {
    return errorResponse(e)
  }
}
