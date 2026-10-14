import { NextResponse } from "next/server"
import { findOrgsForPerson } from "@/lib/auth/identity.ts"
import { createSessionToken, EDI_SESSION_COOKIE, sessionCookieOptions, SESSION_TTL_SEC } from "@/lib/auth/session.ts"
import { HttpError } from "@/lib/db.ts"
import { jsonBody, route } from "@/lib/http.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Переключение организации: доступ перепроверяется по wms_users на момент переключения. */
export const POST = route(async ({ client, actor, req, session }) => {
  const body = await jsonBody<{ siteId?: number }>(req)
  const ext = await client.query<{ external_code: string | null }>(
    `SELECT external_code FROM wms_users WHERE user_id = $1::bigint`,
    [actor.userId]
  )
  const orgs = await findOrgsForPerson(client, { login: actor.login, externalCode: ext.rows[0]?.external_code })
  const allowed = orgs.filter((o) => actor.orgs.some((signed) => signed.siteId === o.siteId && signed.userId === o.userId))
  const target = allowed.find((o) => o.siteId === Number(body.siteId))
  if (!target) throw new HttpError(403, "Нет доступа к выбранной организации", "org_forbidden")
  const token = await createSessionToken({
    sid: session.sid,
    userId: target.userId,
    login: actor.login,
    fio: actor.fio,
    siteId: target.siteId,
    siteCode: target.siteCode,
    orgs: allowed,
    via: actor.via,
  })
  const res = NextResponse.json({ ok: true, siteCode: target.siteCode })
  res.cookies.set(EDI_SESSION_COOKIE, token, sessionCookieOptions(SESSION_TTL_SEC))
  return res
})
