import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { decodeOidcState, OIDC_COOKIE } from "@/lib/auth-flow"
import { safeEqual } from "@/lib/crypto"
import { scadaIdConfig } from "@/lib/scada-id/config"
import { decodeJwtPayload, exchangeCode, fetchUserInfo, resolvePermissions } from "@/lib/scada-id/oidc"
import { buildSession, encodeSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session"
import { publicOrigin } from "@/lib/site"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const origin = publicOrigin(req)
  const failTo = (msg: string) => {
    const res = NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent(msg)}`)
    res.cookies.set(OIDC_COOKIE, "", { path: "/", maxAge: 0 })
    return res
  }
  const url = new URL(req.url)
  const err = url.searchParams.get("error_description") || url.searchParams.get("error")
  if (err) return failTo(`SCADA ID: ${err}`)
  const code = url.searchParams.get("code") || ""
  const state = url.searchParams.get("state") || ""
  const stored = decodeOidcState((await cookies()).get(OIDC_COOKIE)?.value)
  if (!code || !stored || !state || !safeEqual(state, stored.state)) {
    return failTo("Сессия входа устарела. Попробуйте войти ещё раз.")
  }
  const cfg = scadaIdConfig()
  const redirectUri = `${origin}/api/auth/callback`
  try {
    const tokens = await exchangeCode(cfg, code, stored.verifier, redirectUri)
    if (!tokens.access_token) return failTo(tokens.error_description || "SCADA ID не выдал токен")
    const idt = decodeJwtPayload(tokens.id_token)
    if (idt.nonce && idt.nonce !== stored.nonce) return failTo("Ответ SCADA ID не прошёл проверку")
    const info = await fetchUserInfo(cfg, tokens.access_token)
    const perms = await resolvePermissions(cfg, tokens.access_token)
    const email = String(info.email || idt.email || perms?.email || "").trim().toLowerCase()
    if (!email) return failTo("В учётной записи SCADA ID нет email")
    const firstName = String(info.given_name || idt.given_name || "").trim()
    const lastName = String(info.family_name || idt.family_name || "").trim()
    const session = buildSession(
      {
        sub: String(info.sub || idt.sub || perms?.subject_id || email),
        email,
        name: String(info.name || perms?.display_name || [firstName, lastName].filter(Boolean).join(" ") || email),
        firstName,
        lastName,
      },
      perms,
      cfg.application
    )
    const res = NextResponse.redirect(`${origin}${stored.next}`)
    res.cookies.set(SESSION_COOKIE, encodeSession(session), sessionCookieOptions())
    res.cookies.set(OIDC_COOKIE, "", { path: "/", maxAge: 0 })
    return res
  } catch (e) {
    console.error("[portal] scada-id callback", e)
    return failTo("SCADA ID временно недоступен. Попробуйте позже.")
  }
}
