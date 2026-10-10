import { NextResponse } from "next/server"
import { authorizeUrl, newPkce, scadaIdConfig, scadaIdConfigured } from "@/lib/server/scada-id.ts"
import { publicOrigin } from "@/lib/server/http.ts"
import { rateLimit } from "@/lib/server/ratelimit.ts"
import { clientIp } from "@/lib/server/http.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const origin = publicOrigin(req)
  const url = new URL(req.url)
  if (!rateLimit(`login:${clientIp(req)}`, 30).ok) return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("Слишком много попыток входа, подождите минуту")}`)
  const cfg = scadaIdConfig()
  if (!scadaIdConfigured(cfg)) return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("Вход через SCADA ID не настроен на сервере")}`)
  const next = url.searchParams.get("next") || "/"
  const pkce = newPkce()
  const res = NextResponse.redirect(authorizeUrl(cfg, `${origin}/api/auth/scada-id/callback`, pkce))
  res.cookies.set("ems_oidc", JSON.stringify({ state: pkce.state, verifier: pkce.verifier, next: next.startsWith("/") && !next.startsWith("//") ? next : "/" }), {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/api/auth/scada-id",
    maxAge: 600,
  })
  return res
}
