import { NextResponse } from "next/server"
import { loginConfigured, scadaIdConfig } from "@/lib/scada-id/config"
import { logoutUrl } from "@/lib/scada-id/oidc"
import { SESSION_COOKIE } from "@/lib/session"
import { publicOrigin } from "@/lib/site"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const origin = publicOrigin(req)
  const cfg = scadaIdConfig()
  const target = loginConfigured(cfg) ? logoutUrl(cfg, `${origin}/`) : `${origin}/`
  const res = NextResponse.redirect(target, 303)
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 })
  return res
}
