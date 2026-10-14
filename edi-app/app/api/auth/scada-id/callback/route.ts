import { NextResponse } from "next/server"
import { findOrgsForPerson, pickOrg } from "@/lib/auth/identity.ts"
import { publicOrigin } from "@/lib/auth/origin.ts"
import { ediRolesFromScada, exchangeCode, loadScadaIdConfig, resolvePermissions, upsertUserFromScadaId } from "@/lib/auth/scada-id.ts"
import { createSessionToken, EDI_SESSION_COOKIE, readCookie, sessionCookieOptions, SESSION_TTL_SEC } from "@/lib/auth/session.ts"
import { withTx } from "@/lib/db.ts"
import { prepare } from "@/lib/http.ts"
import { recordEvent } from "@/lib/edi/audit.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const origin = publicOrigin(req)
  const fail = (m: string) => NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(m)}`)
  const url = new URL(req.url)
  const err = url.searchParams.get("error_description") || url.searchParams.get("error")
  if (err) return fail(err)
  const code = url.searchParams.get("code") || ""
  const state = url.searchParams.get("state") || ""
  let stored: { state?: string; verifier?: string; next?: string; siteCode?: string } = {}
  try {
    stored = JSON.parse(readCookie(req, "edi_oidc") || "{}")
  } catch {
    return fail("Повреждён cookie входа")
  }
  if (!code || !stored.state || stored.state !== state || !stored.verifier) return fail("Сессия входа истекла или state не совпал")
  try {
    const session = await withTx(async (client) => {
      await prepare(client)
      const cfg = await loadScadaIdConfig(client, origin)
      if (!cfg) throw new Error("Вход через SCADA ID не настроен")
      const tokens = await exchangeCode(cfg, code, stored.verifier!)
      if (!tokens.access_token) throw new Error(tokens.error_description || tokens.error || "SCADA ID не выдал токен")
      const perms = await resolvePermissions(cfg, tokens.access_token)
      const roles = ediRolesFromScada(perms)
      if (roles.length === 0) throw new Error(`${perms.email || "Пользователь"} не имеет доступа к SCADA EDI`)
      const siteCode = perms.organization?.site_code || stored.siteCode || process.env.WMS_SITE_CODE || ""
      const site = await client.query<{ site_id: number }>(
        `SELECT site_id FROM wms_sites WHERE is_active AND lower(site_code) = lower($1) LIMIT 1`,
        [siteCode]
      )
      if (!site.rows[0]) throw new Error(`Организация «${siteCode}» не найдена в SCADA System`)
      const user = await upsertUserFromScadaId(client, site.rows[0].site_id, perms, roles)
      const orgs = await findOrgsForPerson(client, { login: user.login, externalCode: user.externalCode })
      const active = pickOrg(orgs, siteCode)
      if (!active) throw new Error("Нет доступа к SCADA EDI")
      await recordEvent(client, { siteId: active.siteId, actorUserId: active.userId, actorName: user.displayName, action: "auth.login", details: { via: "scada-id" } })
      return { userId: active.userId, login: user.login, fio: user.displayName, siteId: active.siteId, siteCode: active.siteCode, orgs, via: "scada-id" as const }
    })
    const res = NextResponse.redirect(`${origin}${stored.next || "/"}`)
    res.cookies.set(EDI_SESSION_COOKIE, await createSessionToken(session), sessionCookieOptions(SESSION_TTL_SEC))
    res.cookies.set("edi_oidc", "", { path: "/", maxAge: 0 })
    return res
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Ошибка входа через SCADA ID")
  }
}
