import { createHash, randomBytes } from "node:crypto"
import type { ScadaIdConfig } from "./config"

export type Grant = {
  application_id?: string
  application_slug: string
  application_name?: string
  role: string
  allowed: boolean
}

export type Permissions = {
  subject_id: string
  user_id: string
  email: string
  display_name: string
  is_super_admin: boolean
  is_god: boolean
  grants: Grant[]
  organization?: { slug: string; name: string; site_code?: string } | null
}

export type TokenResponse = {
  access_token?: string
  id_token?: string
  error?: string
  error_description?: string
}

export function newPkce() {
  const verifier = randomBytes(32).toString("base64url")
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: randomBytes(16).toString("base64url"),
    nonce: randomBytes(16).toString("base64url"),
  }
}

export function authorizeUrl(
  cfg: ScadaIdConfig,
  redirectUri: string,
  pkce: { challenge: string; state: string; nonce: string },
  loginHint?: string
): string {
  const url = new URL(`${cfg.issuer}/protocol/openid-connect/auth`)
  url.searchParams.set("client_id", cfg.clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", "openid email profile")
  url.searchParams.set("state", pkce.state)
  url.searchParams.set("nonce", pkce.nonce)
  url.searchParams.set("code_challenge", pkce.challenge)
  url.searchParams.set("code_challenge_method", "S256")
  if (loginHint) url.searchParams.set("login_hint", loginHint)
  return url.toString()
}

export async function exchangeCode(
  cfg: ScadaIdConfig,
  code: string,
  verifier: string,
  redirectUri: string
): Promise<TokenResponse> {
  const res = await fetch(`${cfg.issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  })
  return (await res.json().catch(() => ({}))) as TokenResponse
}

export async function fetchUserInfo(cfg: ScadaIdConfig, accessToken: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${cfg.issuer}/protocol/openid-connect/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return {}
  return (await res.json().catch(() => ({}))) as Record<string, unknown>
}

/**
 * Права пользователя по всем приложениям. Ответ 401/403/404 — это «прав нет»,
 * пользователь всё равно может войти на портал и подать заявку.
 */
export async function resolvePermissions(cfg: ScadaIdConfig, accessToken: string): Promise<Permissions | null> {
  const url = `${cfg.apiUrl}/api/v1/permissions/resolve?application=${encodeURIComponent(cfg.application)}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  })
  if (res.status === 401 || res.status === 403 || res.status === 404) return null
  if (!res.ok) throw new Error(`SCADA ID: ошибка получения прав (${res.status})`)
  return (await res.json()) as Permissions
}

export function decodeJwtPayload(token: string | undefined): Record<string, unknown> {
  const part = token?.split(".")[1]
  if (!part) return {}
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function logoutUrl(cfg: ScadaIdConfig, postLogoutRedirect: string): string {
  const url = new URL(`${cfg.issuer}/protocol/openid-connect/logout`)
  url.searchParams.set("client_id", cfg.clientId)
  url.searchParams.set("post_logout_redirect_uri", postLogoutRedirect)
  return url.toString()
}
