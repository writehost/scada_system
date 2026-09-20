import { readAuthTokenFromRequest } from "@/lib/auth/request-token"
import { verifySessionToken } from "@/lib/auth/session"
import type { WmsAuthSession } from "@/lib/auth/types"
import { isUserApiToken, verifyUserApiToken } from "@/lib/wms/user-api-tokens"

export type ResolvedUserAuth = {
  session: WmsAuthSession
  via: "session" | "api-token"
}

/** Cookie/JWT сессии сайта или персональный Bearer `wmsu_…`. */
export async function resolveUserAuth(req?: Request): Promise<ResolvedUserAuth | null> {
  const token = await readAuthTokenFromRequest(req).catch(() => null)
  if (!token) return null
  if (isUserApiToken(token)) {
    const session = await verifyUserApiToken(token)
    return session ? { session, via: "api-token" } : null
  }
  const session = await verifySessionToken(token)
  return session ? { session, via: "session" } : null
}

/** Только интерактивный вход (cookie / JWT логина), не API-токен. Для выпуска токенов. */
export async function resolveInteractiveSession(req?: Request): Promise<WmsAuthSession | null> {
  const token = await readAuthTokenFromRequest(req).catch(() => null)
  if (!token || isUserApiToken(token)) return null
  return verifySessionToken(token)
}
