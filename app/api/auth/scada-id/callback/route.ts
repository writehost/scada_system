import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { createSessionToken, sessionCookieOptions, SESSION_TTL_SEC } from "@/lib/auth/session"
import { WMS_SESSION_COOKIE } from "@/lib/auth/types"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import {
  exchangeScadaIdCode,
  fetchScadaIdUserInfo,
  getScadaIdSettings,
  identityFromTokens,
  resolveScadaIdPermissions,
  wmsRolesFromScada,
} from "@/lib/wms/scada-id"
import { upsertWmsUserFromScadaId } from "@/lib/wms/scada-id-users"
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

function fail(req: Request, message: string) {
  return NextResponse.redirect(`${publicOrigin(req)}/login?error=${encodeURIComponent(message)}`)
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get("code")?.trim() || ""
  const state = url.searchParams.get("state")?.trim() || ""
  const kcError = url.searchParams.get("error_description") || url.searchParams.get("error")
  if (kcError) return fail(req, kcError)
  if (!code || !state) return fail(req, "Scada ID не вернул код авторизации")

  const jar = await cookies()
  const raw = jar.get("wms_oidc")?.value
  if (!raw) return fail(req, "Сессия входа Scada ID истекла. Попробуйте ещё раз.")

  let stored: { state?: string; verifier?: string; next?: string; siteCode?: string }
  try {
    stored = JSON.parse(raw) as typeof stored
  } catch {
    return fail(req, "Повреждён cookie входа Scada ID")
  }
  if (!stored.state || stored.state !== state || !stored.verifier) {
    return fail(req, "Не совпал state — вход прерван")
  }

  const requestedSite = canonicalSiteCode(stored.siteCode)
  const pool = tryGetPool(requestedSite) || tryGetPool()
  if (!pool) return fail(req, "Нет базы WMS")
  const client = await pool.connect()
  try {
    const siteCode = requestedSite
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return fail(req, "Неизвестная площадка")
    const settings = await getScadaIdSettings(client, siteId)
    const tokens = await exchangeScadaIdCode(settings, code, stored.verifier)
    if (!tokens.access_token) {
      return fail(req, tokens.error_description || tokens.error || "Не удалось обменять код Scada ID")
    }
    const userinfo = await fetchScadaIdUserInfo(settings, tokens.access_token)
    let perms
    try {
      perms = await resolveScadaIdPermissions(settings, tokens.access_token)
    } catch (err) {
      const ident = identityFromTokens(tokens, userinfo)
      return fail(
        req,
        ident.email
          ? `Scada ID не выдал права для ${ident.email}`
          : err instanceof Error
            ? err.message
            : "Нет прав в Scada ID"
      )
    }
    const orgSite = canonicalSiteCode(perms.organization?.site_code || siteCode)
    const resolvedSiteId = (await getSiteId(client, orgSite)) || siteId
    const roleCodes = wmsRolesFromScada(perms)
    if (roleCodes.length === 0) {
      return fail(req, `${perms.email || "Пользователь"} не имеет доступа к Scada WMS`)
    }
    const user = await upsertWmsUserFromScadaId(client, resolvedSiteId, perms, roleCodes)
    const session = await createSessionToken({
      userId: user.userId,
      login: user.login,
      fio: user.displayName,
      position: user.position,
      roleCodes: user.roleCodes,
    })
    const next = stored.next && stored.next.startsWith("/") ? stored.next : "/"
    const res = NextResponse.redirect(`${publicOrigin(req)}${next}`)
    res.cookies.set(WMS_SESSION_COOKIE, session, sessionCookieOptions(SESSION_TTL_SEC))
    res.cookies.set("wms_oidc", "", { path: "/", maxAge: 0 })
    res.cookies.set("wms_access_hint", session, {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 30,
    })
    res.cookies.set("wms_site_code", orgSite, {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    })
    return res
  } catch (err) {
    console.error(err)
    return fail(req, err instanceof Error ? err.message : "Ошибка входа через Scada ID")
  } finally {
    client.release()
  }
}
