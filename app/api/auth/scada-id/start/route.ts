import { NextResponse } from "next/server"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { authorizeUrl, getScadaIdSettings, newPkce, publicScadaIdStatus } from "@/lib/wms/scada-id"
import { canonicalSiteCode } from "@/lib/wms/site-code"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function publicOrigin(req: Request): string {
  const proto = (req.headers.get("x-forwarded-proto") || "https").split(",")[0].trim()
  const host = (
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    "wms.scada25.ru"
  )
    .split(",")[0]
    .trim()
  if (!host || host.startsWith("0.0.0.0") || host.startsWith("127.0.0.1")) {
    return "https://wms.scada25.ru"
  }
  if (host === "scada25.ru" || host === "www.scada25.ru") {
    return "https://wms.scada25.ru"
  }
  return `${proto}://${host}`
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const next = url.searchParams.get("callbackUrl") || "/"
  const siteCode = canonicalSiteCode(url.searchParams.get("siteCode"))
  const origin = publicOrigin(req)

  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("Нет базы WMS")}`)
  }
  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) {
      return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("Неизвестная площадка")}`)
    }
    const settings = await getScadaIdSettings(client, siteId)
    settings.redirectUri = `${origin}/api/auth/scada-id/callback`
    const status = publicScadaIdStatus(settings)
    if (!status.loginAvailable) {
      return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("Вход через Scada ID не настроен")}`)
    }
    const pkce = newPkce()
    const loginHint = (url.searchParams.get("loginHint") || "").trim()
    const dest = authorizeUrl(settings, pkce, loginHint ? { loginHint } : undefined)
    const res = NextResponse.redirect(dest)
    res.cookies.set(
      "wms_oidc",
      JSON.stringify({
        state: pkce.state,
        verifier: pkce.verifier,
        next: next.startsWith("/") ? next : "/",
        siteCode,
      }),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.WMS_AUTH_COOKIE_SECURE === "true" || url.protocol === "https:",
        path: "/",
        maxAge: 10 * 60,
      }
    )
    return res
  } finally {
    client.release()
  }
}
