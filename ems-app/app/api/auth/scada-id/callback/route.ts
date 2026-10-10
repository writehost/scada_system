import { NextResponse } from "next/server"
import { exchangeCode, scadaIdConfig } from "@/lib/server/scada-id.ts"
import { completeLogin } from "@/lib/server/login.ts"
import { clientIp, cookieValue, publicOrigin } from "@/lib/server/http.ts"
import { HttpError } from "@/lib/server/errors.ts"
import { cookieOptions, SESSION_COOKIE, WEB_TTL_SEC } from "@/lib/server/session.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const origin = publicOrigin(req)
  const fail = (message: string) => {
    const res = NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`)
    res.cookies.set("ems_oidc", "", { path: "/api/auth/scada-id", maxAge: 0 })
    return res
  }
  const url = new URL(req.url)
  const kcError = url.searchParams.get("error_description") || url.searchParams.get("error")
  if (kcError) return fail(`SCADA ID: ${kcError}`)
  const code = url.searchParams.get("code") || ""
  const state = url.searchParams.get("state") || ""
  const raw = cookieValue(req, "ems_oidc")
  if (!raw) return fail("Сессия входа истекла. Попробуйте ещё раз.")
  let stored: { state?: string; verifier?: string; next?: string }
  try {
    stored = JSON.parse(raw)
  } catch {
    return fail("Повреждены данные входа")
  }
  if (!code || !stored.state || stored.state !== state || !stored.verifier) return fail("Не совпал параметр state — вход прерван")
  const cfg = scadaIdConfig()
  try {
    const tokens = await exchangeCode(cfg, code, stored.verifier, `${origin}/api/auth/scada-id/callback`)
    if (!tokens.access_token) return fail(tokens.error_description || tokens.error || "SCADA ID не выдал токен")
    const login = await completeLogin(tokens.access_token, { kind: "web", userAgent: req.headers.get("user-agent"), ip: clientIp(req), cfg })
    const res = NextResponse.redirect(`${origin}${stored.next || "/"}`)
    res.cookies.set(SESSION_COOKIE, login.token, cookieOptions(WEB_TTL_SEC))
    res.cookies.set("ems_oidc", "", { path: "/api/auth/scada-id", maxAge: 0 })
    return res
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message)
    console.error("[ems] scada id callback", err)
    return fail("Ошибка входа через SCADA ID")
  }
}
