import { NextResponse } from "next/server"
import { authorizeUrl, loadScadaIdConfig, newPkce } from "@/lib/auth/scada-id.ts"
import { publicOrigin } from "@/lib/auth/origin.ts"
import { tryGetPool } from "@/lib/db.ts"
import { safeReturnPath } from "@/lib/auth/policy.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const origin = publicOrigin(req)
  const url = new URL(req.url)
  const pool = tryGetPool()
  const client = pool ? await pool.connect() : null
  try {
    const cfg = await loadScadaIdConfig(client, origin)
    if (!cfg) return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("Вход через SCADA ID не настроен")}`)
    const pkce = newPkce()
    const next = url.searchParams.get("next") || "/"
    const res = NextResponse.redirect(authorizeUrl(cfg, pkce))
    res.cookies.set(
      "edi_oidc",
      JSON.stringify({ state: pkce.state, verifier: pkce.verifier, next: safeReturnPath(next), siteCode: url.searchParams.get("siteCode") || "" }),
      { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https://"), path: "/", maxAge: 600 }
    )
    return res
  } finally {
    client?.release()
  }
}
