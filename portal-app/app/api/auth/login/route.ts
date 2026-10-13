import { NextResponse } from "next/server"
import { encodeOidcState, OIDC_COOKIE, safeNext } from "@/lib/auth-flow"
import { loginConfigured, scadaIdConfig } from "@/lib/scada-id/config"
import { authorizeUrl, newPkce } from "@/lib/scada-id/oidc"
import { sessionCookieOptions } from "@/lib/session"
import { publicOrigin } from "@/lib/site"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const origin = publicOrigin(req)
  const next = safeNext(url.searchParams.get("next"))
  const cfg = scadaIdConfig()
  if (!loginConfigured(cfg)) {
    return NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent("Вход через SCADA ID не настроен на этом сервере")}`)
  }
  const pkce = newPkce()
  const hint = (url.searchParams.get("hint") || "").trim().slice(0, 254)
  const res = NextResponse.redirect(authorizeUrl(cfg, `${origin}/api/auth/callback`, pkce, hint || undefined))
  res.cookies.set(
    OIDC_COOKIE,
    encodeOidcState({ state: pkce.state, verifier: pkce.verifier, nonce: pkce.nonce, next }),
    sessionCookieOptions(10 * 60)
  )
  return res
}
