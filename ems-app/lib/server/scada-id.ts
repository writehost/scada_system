// Интеграция с SCADA ID по тому же контракту, что уже использует WMS
// (lib/wms/scada-id.ts): Keycloak realm scada-system-id, authorization code + PKCE,
// userinfo, и сервис прав GET {api}/api/v1/permissions/resolve?application=…

import { createHash, randomBytes } from "node:crypto"
import type { Role } from "../services/org.ts"

export type ScadaIdConfig = {
  issuer: string
  apiUrl: string
  clientId: string
  clientSecret: string
  application: string
  allowPersonal: boolean
}

export function scadaIdConfig(): ScadaIdConfig {
  return {
    issuer: (process.env.SCADA_ID_ISSUER || "https://id.scada25.ru/realms/scada-system-id").replace(/\/$/, ""),
    apiUrl: (process.env.SCADA_ID_API || "https://id.scada25.ru").replace(/\/$/, ""),
    clientId: process.env.SCADA_ID_CLIENT_ID || "ems",
    clientSecret: process.env.SCADA_ID_CLIENT_SECRET || "",
    application: process.env.SCADA_ID_APPLICATION || "scada-ems",
    // Домашние пользователи работают в личном пространстве без корпоративного гранта.
    allowPersonal: process.env.EMS_PERSONAL_ACCOUNTS !== "0",
  }
}

export function scadaIdConfigured(cfg = scadaIdConfig()): boolean {
  return Boolean(cfg.issuer && cfg.clientId && cfg.clientSecret)
}

export type ScadaIdGrant = { application_id?: string; application_slug: string; application_name?: string; role: string; allowed?: boolean }

export type ScadaIdPermissions = {
  subject_id: string
  user_id: string
  email: string
  display_name: string
  is_super_admin: boolean
  is_god: boolean
  grants: ScadaIdGrant[]
  organization?: { slug: string; name: string; site_code?: string } | null
}

export function newPkce() {
  const verifier = randomBytes(32).toString("base64url")
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url"), state: randomBytes(16).toString("base64url"), nonce: randomBytes(16).toString("base64url") }
}

export function authorizeUrl(cfg: ScadaIdConfig, redirectUri: string, pkce: { challenge: string; state: string; nonce: string }): string {
  const url = new URL(`${cfg.issuer}/protocol/openid-connect/auth`)
  url.searchParams.set("client_id", cfg.clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", "openid email profile")
  url.searchParams.set("state", pkce.state)
  url.searchParams.set("nonce", pkce.nonce)
  url.searchParams.set("code_challenge", pkce.challenge)
  url.searchParams.set("code_challenge_method", "S256")
  return url.toString()
}

export async function exchangeCode(cfg: ScadaIdConfig, code: string, verifier: string, redirectUri: string): Promise<{ access_token?: string; id_token?: string; error?: string; error_description?: string }> {
  const res = await fetch(`${cfg.issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: redirectUri, code_verifier: verifier }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  })
  return (await res.json().catch(() => ({ error: `token endpoint ${res.status}` }))) as { access_token?: string; error?: string }
}

/**
 * Проверка access token у SCADA ID: userinfo отвечает 200 только на действующий
 * токен. Подпись JWT отдельно не разбираем — источник истины сам SCADA ID.
 */
export async function userInfo(cfg: ScadaIdConfig, accessToken: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${cfg.issuer}/protocol/openid-connect/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return null
  return (await res.json().catch(() => null)) as Record<string, unknown> | null
}

export async function resolvePermissions(cfg: ScadaIdConfig, accessToken: string): Promise<ScadaIdPermissions | null> {
  const res = await fetch(`${cfg.apiUrl}/api/v1/permissions/resolve?application=${encodeURIComponent(cfg.application)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return null
  return (await res.json().catch(() => null)) as ScadaIdPermissions | null
}

/** Роль в организации EMS из гранта SCADA ID. Неизвестная роль — без доступа. */
export function emsRoleFromScada(perms: ScadaIdPermissions, application: string): Role | null {
  if (perms.is_god || perms.is_super_admin) return "admin"
  const grant = perms.grants?.find((g) => g.application_slug === application) ?? perms.grants?.find((g) => g.application_slug === "ems")
  if (!grant || grant.allowed === false) return null
  const map: Record<string, Role | null> = { god: "admin", admin: "admin", owner: "owner", engineer: "engineer", operator: "engineer", accountant: "accountant", viewer: "viewer", none: null }
  return map[grant.role] ?? null
}

export function identity(userinfo: Record<string, unknown>, perms: ScadaIdPermissions | null): { subject: string; email: string; name: string } {
  const email = String(perms?.email || userinfo.email || userinfo.preferred_username || "").trim().toLowerCase()
  const name = String(perms?.display_name || userinfo.name || [userinfo.given_name, userinfo.family_name].filter(Boolean).join(" ") || email.split("@")[0] || "Пользователь SCADA ID").trim()
  const subject = String(userinfo.sub || perms?.subject_id || "").trim()
  return { subject, email, name }
}
