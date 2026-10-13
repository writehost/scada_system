import { cookies } from "next/headers"
import { sign, unsign } from "./crypto"
import { HttpError } from "./errors"
import { products, type ProductKey } from "./products"
import type { Permissions } from "./scada-id/oidc"

export const SESSION_COOKIE = "portal_session"
export const SESSION_TTL_SEC = 8 * 60 * 60

export type PortalSession = {
  sub: string
  email: string
  name: string
  firstName: string
  lastName: string
  isOwner: boolean
  /** Разрешённые приложения SCADA ID (application_slug → роль). */
  apps: Record<string, string>
  organization: { ref: string; name: string } | null
  iat: number
  exp: number
}

export function buildSession(
  identity: { sub: string; email: string; name: string; firstName: string; lastName: string },
  perms: Permissions | null,
  portalApplication: string
): PortalSession {
  const apps: Record<string, string> = {}
  for (const g of perms?.grants || []) {
    if (g.allowed && g.role && g.role !== "none") apps[g.application_slug] = g.role
  }
  const portalRole = apps[portalApplication]
  const now = Date.now()
  return {
    ...identity,
    isOwner: Boolean(perms?.is_god || perms?.is_super_admin || portalRole === "admin" || portalRole === "god"),
    apps,
    organization: perms?.organization
      ? { ref: perms.organization.slug, name: perms.organization.name || perms.organization.slug }
      : null,
    iat: now,
    exp: now + SESSION_TTL_SEC * 1000,
  }
}

export function encodeSession(s: PortalSession): string {
  return sign(s, "session")
}

export function decodeSession(token: string | undefined): PortalSession | null {
  const s = unsign<PortalSession>(token, "session")
  if (!s || typeof s.exp !== "number" || s.exp < Date.now()) return null
  return s
}

export async function getSession(): Promise<PortalSession | null> {
  const jar = await cookies()
  return decodeSession(jar.get(SESSION_COOKIE)?.value)
}

export async function requireSession(): Promise<PortalSession> {
  const s = await getSession()
  if (!s) throw new HttpError(401, "Войдите через SCADA ID", "auth_required")
  return s
}

export async function requireOwner(): Promise<PortalSession> {
  const s = await requireSession()
  if (!s.isOwner) throw new HttpError(403, "Раздел доступен только администратору экосистемы", "owner_required")
  return s
}

export function sessionCookieOptions(maxAge = SESSION_TTL_SEC) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.PORTAL_COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  }
}

export type MyApp = {
  key: ProductKey
  name: string
  color: string
  onColor: string
  role: string
  url: string | null
  organization: string | null
}

/**
 * «Мои приложения» строятся только из прав, которые вернул SCADA ID.
 * Портал не выдаёт права сам и не открывает приложение в обход его входа.
 */
export function myApps(s: PortalSession): MyApp[] {
  const list: MyApp[] = []
  for (const p of products()) {
    const role = s.apps[p.scadaIdApp]
    if (!role || p.status === "development") continue
    list.push({
      key: p.key,
      name: p.name,
      color: p.color,
      onColor: p.onColor,
      role,
      url: p.defaultUrl ? `${p.defaultUrl.replace(/\/$/, "")}${p.launchPath || ""}` : null,
      organization: s.organization?.name || null,
    })
  }
  return list
}
