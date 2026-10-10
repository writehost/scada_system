import { NextResponse } from "next/server"
import { devLogin, devLoginEnabled } from "@/lib/server/login.ts"
import { clientIp, errorResponse, publicApi } from "@/lib/server/http.ts"
import { cookieOptions, SESSION_COOKIE, WEB_TTL_SEC } from "@/lib/server/session.ts"
import { email, oneOf, str } from "@/lib/server/validate.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = publicApi({ rate: 20 }, async ({ req, body }) => {
  if (!devLoginEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 })
  try {
    const login = await devLogin({
      email: email(body, "email")!,
      name: str(body, "name", "Имя", { max: 80 }) || "Разработчик",
      segment: oneOf(body, "segment", "Сегмент", ["home", "industrial"] as const, "home"),
      ip: clientIp(req),
    })
    const res = NextResponse.json({ ok: true, token: login.token })
    res.cookies.set(SESSION_COOKIE, login.token, cookieOptions(WEB_TTL_SEC))
    return res
  } catch (e) {
    return errorResponse(e)
  }
})
