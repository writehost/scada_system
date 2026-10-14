import { createHash, randomBytes } from "node:crypto"
import type { PoolClient } from "pg"
import { EDI_ROLES_FROM_SCADA } from "../edi/permissions.ts"
import { hashPassword } from "./identity.ts"
import { HttpError } from "../db.ts"

/**
 * Вход через SCADA ID (Keycloak-реалм + API прав), тот же контракт, что использует WMS
 * (lib/wms/scada-id.ts): OIDC code+PKCE, затем GET /api/v1/permissions/resolve?application=…
 * Отдельной базы учётных записей EDI нет: пользователь заводится/обновляется в wms_users.
 */

export const SCADA_ID_APPLICATION = "scada-edi"

export type ScadaIdConfig = {
  issuer: string
  apiUrl: string
  clientId: string
  clientSecret: string
  redirectUri: string
}

export type ScadaIdPermissions = {
  subject_id: string
  user_id: string
  email: string
  display_name: string
  is_super_admin: boolean
  is_god: boolean
  grants: Array<{ application_slug: string; role: string; allowed: boolean }>
  organization?: { slug: string; name: string; site_code: string } | null
}

export async function loadScadaIdConfig(client: PoolClient | null, origin: string): Promise<ScadaIdConfig | null> {
  let stored: Record<string, unknown> = {}
  if (client && process.env.NODE_ENV !== "production") {
    const exists = await client.query<{ ok: boolean }>(`SELECT to_regclass('public.wms_app_settings') IS NOT NULL AS ok`)
    if (exists.rows[0]?.ok) {
      const r = await client.query<{ setting_value: Record<string, unknown> }>(
        `SELECT setting_value FROM wms_app_settings WHERE setting_key = 'scada_id_edi' ORDER BY site_id LIMIT 1`
      )
      stored = r.rows[0]?.setting_value ?? {}
    }
  }
  const pick = (k: string, env: string, def = "") =>
    (typeof stored[k] === "string" && (stored[k] as string).trim()) || process.env[env]?.trim() || def
  const cfg: ScadaIdConfig = {
    issuer: pick("issuer", "SCADA_ID_ISSUER", "https://id.scada25.ru/realms/scada-system-id"),
    apiUrl: pick("apiUrl", "SCADA_ID_API", "https://id.scada25.ru"),
    clientId: pick("clientId", "SCADA_ID_EDI_CLIENT_ID", SCADA_ID_APPLICATION),
    clientSecret: pick("clientSecret", "SCADA_ID_EDI_CLIENT_SECRET"),
    redirectUri: `${origin}/api/auth/scada-id/callback`,
  }
  if (stored.enabled === false) return null
  return cfg.clientSecret ? cfg : null
}

export function newPkce() {
  const verifier = randomBytes(32).toString("base64url")
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: randomBytes(16).toString("base64url"),
  }
}

export function authorizeUrl(cfg: ScadaIdConfig, pkce: { challenge: string; state: string }): string {
  const url = new URL(`${cfg.issuer.replace(/\/$/, "")}/protocol/openid-connect/auth`)
  url.searchParams.set("client_id", cfg.clientId)
  url.searchParams.set("redirect_uri", cfg.redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", "openid email profile")
  url.searchParams.set("state", pkce.state)
  url.searchParams.set("code_challenge", pkce.challenge)
  url.searchParams.set("code_challenge_method", "S256")
  return url.toString()
}

export async function exchangeCode(cfg: ScadaIdConfig, code: string, verifier: string) {
  const res = await fetch(`${cfg.issuer.replace(/\/$/, "")}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: cfg.redirectUri,
      code_verifier: verifier,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  })
  return (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }
}

export async function resolvePermissions(cfg: ScadaIdConfig, accessToken: string): Promise<ScadaIdPermissions> {
  const res = await fetch(
    `${cfg.apiUrl.replace(/\/$/, "")}/api/v1/permissions/resolve?application=${SCADA_ID_APPLICATION}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) }
  )
  if (!res.ok) throw new Error((await res.text().catch(() => "")) || `SCADA ID отказал в правах (${res.status})`)
  return (await res.json()) as ScadaIdPermissions
}

export function ediRolesFromScada(perms: ScadaIdPermissions): string[] {
  if (perms.is_god || perms.is_super_admin) return [...EDI_ROLES_FROM_SCADA.god]
  const grant = perms.grants.find((g) => g.application_slug === SCADA_ID_APPLICATION && g.allowed)
  return [...(EDI_ROLES_FROM_SCADA[grant?.role || "none"] ?? [])]
}

/** Заводит/обновляет пользователя в wms_users и выставляет только его роли EDI (складские роли не трогаются). */
export async function upsertUserFromScadaId(
  client: PoolClient,
  siteId: number,
  perms: ScadaIdPermissions,
  ediRoles: string[]
): Promise<{ userId: string; login: string; displayName: string; externalCode: string }> {
  const email = perms.email.trim().toLowerCase()
  const login = email || perms.subject_id
  const displayName = perms.display_name?.trim() || email.split("@")[0] || "SCADA ID"
  const external = `scada-id:${perms.subject_id || perms.user_id}`
  const found = await client.query<{ user_id: string; external_code: string | null; is_active: boolean }>(
    `SELECT user_id::text, external_code, is_active FROM wms_users WHERE site_id = $1 AND (lower(login) = lower($2) OR external_code = $3)
     ORDER BY CASE WHEN external_code = $3 THEN 0 ELSE 1 END LIMIT 1`,
    [siteId, login, external]
  )
  let userId = found.rows[0]?.user_id
  if (userId && !found.rows[0].is_active) throw new HttpError(403, "Учётная запись SCADA System отключена")
  if (userId && found.rows[0].external_code !== external) throw new HttpError(409, "Учётная запись с этим логином уже существует; администратор должен подтвердить связь со SCADA ID")
  if (!userId) {
    const ins = await client.query<{ user_id: string }>(
      `INSERT INTO wms_users (site_id, login, display_name, position, external_code, password_hash, is_active)
       VALUES ($1, $2, $3, 'SCADA EDI', $4, $5, TRUE) RETURNING user_id::text`,
      [siteId, login, displayName, external, await hashPassword(`scada-id:${randomBytes(24).toString("hex")}`)]
    )
    userId = ins.rows[0].user_id
  } else {
    await client.query(
      `UPDATE wms_users SET display_name = $2, external_code = COALESCE(NULLIF(external_code, ''), $3)
       WHERE user_id = $1::bigint`,
      [userId, displayName, external]
    )
  }
  await client.query(`DELETE FROM edi_user_roles WHERE site_id = $1 AND user_id = $2::bigint`, [siteId, userId])
  for (const role of ediRoles) {
    await client.query(
      `INSERT INTO edi_user_roles (site_id, user_id, role_code) VALUES ($1, $2::bigint, $3) ON CONFLICT DO NOTHING`,
      [siteId, userId, role]
    )
  }
  if (email) {
    await client.query(
      `INSERT INTO edi_user_profiles (site_id, user_id, email) VALUES ($1, $2::bigint, $3)
       ON CONFLICT (site_id, user_id) DO UPDATE SET email = EXCLUDED.email, updated_at = now()`,
      [siteId, userId, email]
    )
  }
  return { userId, login, displayName, externalCode: external }
}
