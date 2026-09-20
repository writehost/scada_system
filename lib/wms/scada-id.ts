import { createHash, randomBytes } from "node:crypto"
import type { PoolClient } from "pg"

export const SCADA_ID_SETTINGS_KEY = "scada_id"

export type ScadaIdSettings = {
  enabled: boolean
  issuer: string
  apiUrl: string
  clientId: string
  clientSecret: string
  redirectUri: string
  updatedAt: string | null
  updatedBy: string | null
  hasClientSecret: boolean
}

export type ScadaIdPublicStatus = {
  enabled: boolean
  configured: boolean
  issuer: string
  loginAvailable: boolean
}

export type ScadaIdGrant = {
  application_id: string
  application_slug: string
  application_name: string
  role: string
  allowed: boolean
}

export type ScadaIdPermissions = {
  subject_id: string
  user_id: string
  email: string
  display_name: string
  is_super_admin: boolean
  is_god: boolean
  grants: ScadaIdGrant[]
  organization?: {
    slug: string
    name: string
    site_code: string
  } | null
}

const ISO = `'YYYY-MM-DD"T"HH24:MI:SSOF'`

const DEFAULTS: ScadaIdSettings = {
  enabled: true,
  issuer: process.env.SCADA_ID_ISSUER?.trim() || "https://id.scada25.ru/realms/scada-system-id",
  apiUrl: process.env.SCADA_ID_API?.trim() || "https://id.scada25.ru",
  clientId: process.env.SCADA_ID_CLIENT_ID?.trim() || "wms",
  clientSecret: process.env.SCADA_ID_CLIENT_SECRET?.trim() || "",
  redirectUri:
    process.env.SCADA_ID_REDIRECT_URI?.trim() || "https://wms.scada25.ru/api/auth/scada-id/callback",
  updatedAt: null,
  updatedBy: null,
  hasClientSecret: Boolean(process.env.SCADA_ID_CLIENT_SECRET?.trim()),
}

export const WMS_ROLE_FROM_SCADA: Record<string, string[]> = {
  god: ["admin", "warehouse_manager", "warehouse_operator", "line_operator", "auditor"],
  admin: ["admin", "warehouse_manager"],
  operator: ["warehouse_operator", "line_operator"],
  viewer: ["auditor"],
  none: [],
}

export function wmsRolesFromScada(perms: ScadaIdPermissions): string[] {
  if (perms.is_god || perms.is_super_admin) return [...WMS_ROLE_FROM_SCADA.god]
  const grant =
    perms.grants.find((g) => g.application_slug === "scada-wms") ||
    perms.grants.find((g) => g.application_slug === "wms")
  const role = grant?.role || "none"
  return [...(WMS_ROLE_FROM_SCADA[role] ?? [])]
}

export function positionFromScada(perms: ScadaIdPermissions, roles: string[]): string {
  if (perms.is_god || roles.includes("admin")) return "Бог / администратор WMS"
  if (roles.includes("warehouse_manager")) return "Начальник склада"
  if (roles.includes("auditor")) return "Ревизор"
  if (roles.includes("line_operator")) return "Оператор линии"
  if (roles.includes("warehouse_operator")) return "Кладовщик"
  return perms.display_name || "Пользователь Scada ID"
}

async function ensureSettingsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_app_settings (
      site_id INT NOT NULL,
      setting_key TEXT NOT NULL,
      setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, setting_key)
    )
  `)
}

function normalize(src: Record<string, unknown>, fallbackSecret: string): ScadaIdSettings {
  const secret =
    typeof src.clientSecret === "string" && src.clientSecret.trim()
      ? src.clientSecret.trim()
      : fallbackSecret
  return {
    enabled: src.enabled !== false,
    issuer: typeof src.issuer === "string" && src.issuer.trim() ? src.issuer.trim() : DEFAULTS.issuer,
    apiUrl: typeof src.apiUrl === "string" && src.apiUrl.trim() ? src.apiUrl.trim() : DEFAULTS.apiUrl,
    clientId:
      typeof src.clientId === "string" && src.clientId.trim() ? src.clientId.trim() : DEFAULTS.clientId,
    clientSecret: secret,
    redirectUri:
      typeof src.redirectUri === "string" && src.redirectUri.trim()
        ? src.redirectUri.trim()
        : DEFAULTS.redirectUri,
    updatedAt: typeof src.updatedAt === "string" ? src.updatedAt : null,
    updatedBy: typeof src.updatedBy === "string" ? src.updatedBy : null,
    hasClientSecret: Boolean(secret),
  }
}

export async function getScadaIdSettings(
  client: PoolClient,
  siteId: number
): Promise<ScadaIdSettings> {
  await ensureSettingsTable(client)
  const r = await client.query<{ setting_value: unknown; updated_at: string }>(
    `SELECT setting_value, to_char(updated_at, ${ISO}) AS updated_at
     FROM wms_app_settings
     WHERE site_id = $1 AND setting_key = $2`,
    [siteId, SCADA_ID_SETTINGS_KEY]
  )
  const row = r.rows[0]
  if (!row) return { ...DEFAULTS, hasClientSecret: Boolean(DEFAULTS.clientSecret) }
  const value = (row.setting_value ?? {}) as Record<string, unknown>
  return normalize(
    { ...value, updatedAt: row.updated_at },
    DEFAULTS.clientSecret
  )
}

export function publicScadaIdStatus(settings: ScadaIdSettings): ScadaIdPublicStatus {
  const configured = Boolean(settings.issuer && settings.clientId && settings.clientSecret)
  return {
    enabled: settings.enabled,
    configured,
    issuer: settings.issuer,
    loginAvailable: settings.enabled && configured,
  }
}

export function maskScadaIdSettings(settings: ScadaIdSettings) {
  return {
    enabled: settings.enabled,
    issuer: settings.issuer,
    apiUrl: settings.apiUrl,
    clientId: settings.clientId,
    clientSecret: settings.hasClientSecret ? "••••••••" : "",
    redirectUri: settings.redirectUri,
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy,
    hasClientSecret: settings.hasClientSecret,
    loginAvailable: publicScadaIdStatus(settings).loginAvailable,
  }
}

export async function saveScadaIdSettings(
  client: PoolClient,
  siteId: number,
  input: Record<string, unknown>,
  actor: { login?: string; fio?: string }
): Promise<ScadaIdSettings> {
  const current = await getScadaIdSettings(client, siteId)
  const nextSecret =
    typeof input.clientSecret === "string" &&
    input.clientSecret.trim() &&
    input.clientSecret.trim() !== "••••••••"
      ? input.clientSecret.trim()
      : current.clientSecret
  const next = normalize(
    {
      ...current,
      ...input,
      clientSecret: nextSecret,
      updatedBy: actor.fio || actor.login || null,
    },
    nextSecret
  )
  await client.query(
    `INSERT INTO wms_app_settings (site_id, setting_key, setting_value, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (site_id, setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
    [
      siteId,
      SCADA_ID_SETTINGS_KEY,
      JSON.stringify({
        enabled: next.enabled,
        issuer: next.issuer,
        apiUrl: next.apiUrl,
        clientId: next.clientId,
        clientSecret: next.clientSecret,
        redirectUri: next.redirectUri,
        updatedBy: next.updatedBy,
      }),
    ]
  )
  return { ...next, updatedAt: new Date().toISOString(), hasClientSecret: Boolean(next.clientSecret) }
}

export function newPkce(): { verifier: string; challenge: string; state: string } {
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  const state = randomBytes(16).toString("base64url")
  return { verifier, challenge, state }
}

export function authorizeUrl(
  settings: ScadaIdSettings,
  pkce: { challenge: string; state: string },
  opts?: { loginHint?: string }
): string {
  const base = settings.issuer.replace(/\/$/, "")
  const url = new URL(`${base}/protocol/openid-connect/auth`)
  url.searchParams.set("client_id", settings.clientId)
  url.searchParams.set("redirect_uri", settings.redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", "openid")
  url.searchParams.set("state", pkce.state)
  url.searchParams.set("code_challenge", pkce.challenge)
  url.searchParams.set("code_challenge_method", "S256")
  if (opts?.loginHint) url.searchParams.set("login_hint", opts.loginHint)
  return url.toString()
}

type TokenResponse = {
  access_token?: string
  id_token?: string
  error?: string
  error_description?: string
}

export async function exchangeScadaIdCode(
  settings: ScadaIdSettings,
  code: string,
  verifier: string
): Promise<TokenResponse> {
  const tokenUrl = `${settings.issuer.replace(/\/$/, "")}/protocol/openid-connect/token`
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
    code,
    redirect_uri: settings.redirectUri,
    code_verifier: verifier,
  })
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  })
  return (await res.json().catch(() => ({}))) as TokenResponse
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1]
  if (!part) return {}
  const padded = part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4)
  try {
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>
  } catch {
    return {}
  }
}

export async function fetchScadaIdUserInfo(
  settings: ScadaIdSettings,
  accessToken: string
): Promise<Record<string, unknown>> {
  const res = await fetch(`${settings.issuer.replace(/\/$/, "")}/protocol/openid-connect/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  })
  if (!res.ok) return {}
  return (await res.json().catch(() => ({}))) as Record<string, unknown>
}

export async function resolveScadaIdPermissions(
  settings: ScadaIdSettings,
  accessToken: string
): Promise<ScadaIdPermissions> {
  const url = `${settings.apiUrl.replace(/\/$/, "")}/api/v1/permissions/resolve?application=scada-wms`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(detail || `Scada ID отказал в правах (${res.status})`)
  }
  return (await res.json()) as ScadaIdPermissions
}

export function identityFromTokens(
  tokens: TokenResponse,
  userinfo: Record<string, unknown>
): { email: string; name: string; subject: string } {
  const id = tokens.id_token ? decodeJwtPayload(tokens.id_token) : {}
  const access = tokens.access_token ? decodeJwtPayload(tokens.access_token) : {}
  const email = String(
    userinfo.email || id.email || access.email || userinfo.preferred_username || id.preferred_username || ""
  )
    .trim()
    .toLowerCase()
  const name = String(
    userinfo.name ||
      id.name ||
      [userinfo.given_name, userinfo.family_name].filter(Boolean).join(" ") ||
      email.split("@")[0] ||
      "Scada ID"
  ).trim()
  const subject = String(userinfo.sub || id.sub || access.sub || email).trim()
  return { email, name, subject }
}
