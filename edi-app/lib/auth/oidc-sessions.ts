import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { HttpError } from "../db.ts"
import { decryptSecret, encryptSecret } from "../edi/secrets.ts"
import { ediRolesFromScada, loadScadaIdConfig, resolvePermissions, type ScadaIdConfig, type ScadaIdPermissions } from "./scada-id.ts"
import type { EdiSession } from "./session.ts"

export const OIDC_SESSIONS_DDL = `
CREATE TABLE edi_auth_sessions (
  session_id UUID PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id),
  user_id BIGINT NOT NULL REFERENCES wms_users(user_id),
  subject_id TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  access_expires_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX edi_auth_sessions_expiry ON edi_auth_sessions (expires_at);
`

export type OidcTokens = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }
function lifetime(seconds: unknown): number {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : 60
}

export async function saveOidcSession(client: PoolClient, siteId: number, userId: string, perms: ScadaIdPermissions, tokens: OidcTokens): Promise<string> {
  if (!tokens.access_token || !perms.subject_id) throw new HttpError(401, "SCADA ID не подтвердил пользователя")
  const sid = randomUUID()
  await client.query(`INSERT INTO edi_auth_sessions (session_id, site_id, user_id, subject_id,
    access_token_enc, refresh_token_enc, access_expires_at, expires_at)
    VALUES ($1, $2, $3::bigint, $4, $5, $6, now() + make_interval(secs => $7), now() + interval '12 hours')`,
    [sid, siteId, userId, perms.subject_id, encryptSecret(tokens.access_token), tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null, lifetime(tokens.expires_in)])
  return sid
}

async function refresh(cfg: ScadaIdConfig, token: string): Promise<OidcTokens> {
  const response = await fetch(`${cfg.issuer.replace(/\/$/, "")}/protocol/openid-connect/token`, {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: token }),
  })
  if (!response.ok) throw new HttpError(401, "Сессия SCADA ID истекла", "auth_required")
  return response.json() as Promise<OidcTokens>
}

/** Recheck authority at SCADA ID on every API request; local cookie alone never grants corporate access. */
export async function currentOidcRoles(client: PoolClient, session: EdiSession, origin: string): Promise<string[]> {
  if (!session.sid) throw new HttpError(401, "Требуется повторный вход через SCADA ID", "auth_required")
  const cfg = await loadScadaIdConfig(client, origin)
  if (!cfg) throw new HttpError(503, "SCADA ID не настроен")
  await client.query("BEGIN")
  try {
    const result = await client.query<{ subject_id: string; access_token_enc: string; refresh_token_enc: string | null; access_expires_at: Date }>(
      `SELECT subject_id, access_token_enc, refresh_token_enc, access_expires_at FROM edi_auth_sessions
       WHERE session_id = $1::uuid AND site_id = $2 AND user_id = $3::bigint AND expires_at > now() FOR UPDATE`,
      [session.sid, session.siteId, session.userId])
    const row = result.rows[0]
    if (!row) throw new HttpError(401, "Сессия завершена", "auth_required")
    let accessToken = decryptSecret(row.access_token_enc)
    if (row.access_expires_at.getTime() <= Date.now() + 30_000) {
      if (!row.refresh_token_enc) throw new HttpError(401, "Сессия SCADA ID истекла", "auth_required")
      const tokens = await refresh(cfg, decryptSecret(row.refresh_token_enc))
      if (!tokens.access_token) throw new HttpError(401, "SCADA ID не обновил сессию", "auth_required")
      accessToken = tokens.access_token
      await client.query(`UPDATE edi_auth_sessions SET access_token_enc = $2, refresh_token_enc = COALESCE($3, refresh_token_enc),
        access_expires_at = now() + make_interval(secs => $4) WHERE session_id = $1`,
        [session.sid, encryptSecret(accessToken), tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null, lifetime(tokens.expires_in)])
    }
    const permissions = await resolvePermissions(cfg, accessToken)
    if (permissions.subject_id !== row.subject_id || permissions.organization?.site_code !== session.siteCode) throw new HttpError(403, "SCADA ID не подтвердил доступ к организации")
    const roles = ediRolesFromScada(permissions)
    if (!roles.length) throw new HttpError(403, "SCADA ID отозвал доступ к EDI")
    await client.query("COMMIT")
    return roles
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }
}
