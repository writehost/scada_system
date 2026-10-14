import type { PoolClient } from "pg"
import { decryptSecret, encryptSecret, maskSecret } from "../secrets.ts"

export type IntegrationKind = "wms" | "aps" | "yms" | "qpass" | "ems" | "edo" | "signature" | "mobile"

export type IntegrationRow = {
  integrationId: string
  kind: IntegrationKind
  provider: string
  name: string
  config: Record<string, unknown>
  hasSecret: boolean
  isEnabled: boolean
  verifiedAt: string | null
  lastCheckAt: string | null
  lastCheck: Record<string, unknown> | null
}

export type ResolvedIntegration = {
  integrationId: string | null
  kind: IntegrationKind
  provider: string
  enabled: boolean
  config: Record<string, unknown>
  secret: string
  source: "db" | "env"
}

const COLS = `integration_id::text AS "integrationId", kind, provider, name, config, secret_enc IS NOT NULL AS "hasSecret",
  is_enabled AS "isEnabled", verified_at AS "verifiedAt", last_check_at AS "lastCheckAt", last_check AS "lastCheck"`

/** Переменные окружения как запасной источник для заводской установки без настройки через интерфейс. */
function envFallback(kind: IntegrationKind): ResolvedIntegration | null {
  if (kind === "wms" && process.env.WMS_API_URL?.trim()) {
    return {
      integrationId: null,
      kind,
      provider: "scada-wms",
      enabled: true,
      config: { baseUrl: process.env.WMS_API_URL.trim(), siteCode: process.env.WMS_SITE_CODE?.trim() || "" },
      secret: process.env.WMS_API_TOKEN?.trim() || "",
      source: "env",
    }
  }
  if (kind === "qpass" && process.env.QPASS_ORIGIN?.trim()) {
    return {
      integrationId: null,
      kind,
      provider: "scada-qpass",
      enabled: true,
      config: { baseUrl: process.env.QPASS_ORIGIN.trim() },
      secret: process.env.QPASS_API_TOKEN?.trim() || "",
      source: "env",
    }
  }
  return null
}

export async function listIntegrations(client: PoolClient, siteId: number): Promise<IntegrationRow[]> {
  const r = await client.query<IntegrationRow>(`SELECT ${COLS} FROM edi_integrations WHERE site_id = $1 ORDER BY kind, provider`, [siteId])
  return r.rows
}

export async function resolveIntegration(client: PoolClient, siteId: number, kind: IntegrationKind): Promise<ResolvedIntegration | null> {
  const r = await client.query<{ integration_id: string; provider: string; config: Record<string, unknown>; secret_enc: string | null; is_enabled: boolean }>(
    `SELECT integration_id::text, provider, config, secret_enc, is_enabled FROM edi_integrations
     WHERE site_id = $1 AND kind = $2 ORDER BY is_enabled DESC, integration_id LIMIT 1`,
    [siteId, kind]
  )
  const row = r.rows[0]
  if (!row) return envFallback(kind)
  let secret = ""
  try {
    secret = decryptSecret(row.secret_enc)
  } catch {
    secret = ""
  }
  return {
    integrationId: row.integration_id,
    kind,
    provider: row.provider,
    enabled: row.is_enabled,
    config: row.config ?? {},
    secret,
    source: "db",
  }
}

export async function saveIntegration(
  client: PoolClient,
  siteId: number,
  userId: string,
  input: { kind: IntegrationKind; provider: string; name: string; config: Record<string, unknown>; secret?: string | null; isEnabled: boolean }
) {
  const secretEnc = input.secret && input.secret.trim() && !input.secret.includes("…") ? encryptSecret(input.secret.trim()) : null
  const r = await client.query<IntegrationRow>(
    `INSERT INTO edi_integrations (site_id, kind, provider, name, config, secret_enc, is_enabled, updated_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::bigint)
     ON CONFLICT (site_id, kind, provider) DO UPDATE SET
       name = EXCLUDED.name, config = EXCLUDED.config,
       secret_enc = COALESCE(EXCLUDED.secret_enc, edi_integrations.secret_enc),
       is_enabled = EXCLUDED.is_enabled, updated_by = EXCLUDED.updated_by, updated_at = now(),
       verified_at = CASE WHEN EXCLUDED.config = edi_integrations.config AND EXCLUDED.secret_enc IS NULL THEN edi_integrations.verified_at ELSE NULL END
     RETURNING ${COLS}`,
    [siteId, input.kind, input.provider, input.name, JSON.stringify(input.config), secretEnc, input.isEnabled, userId]
  )
  return r.rows[0]
}

export async function recordCheck(client: PoolClient, integrationId: string | null, result: { ok: boolean; [k: string]: unknown }) {
  if (!integrationId) return
  await client.query(
    `UPDATE edi_integrations SET last_check_at = now(), last_check = $2::jsonb,
       verified_at = CASE WHEN $3::boolean THEN now() ELSE verified_at END
     WHERE integration_id = $1::bigint`,
    [integrationId, JSON.stringify(result), result.ok]
  )
}

export function publicSecretHint(secret: string): string {
  return maskSecret(secret)
}
