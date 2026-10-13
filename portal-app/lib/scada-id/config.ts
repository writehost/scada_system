/**
 * SCADA ID — Keycloak-реалм (OIDC) плюс API прав `/api/v1/permissions/resolve`,
 * тот же, что использует WMS (`lib/wms/scada-id.ts` в корне репозитория).
 * Портал регистрируется в нём отдельным клиентом и не хранит паролей.
 */
export type ScadaIdConfig = {
  issuer: string
  apiUrl: string
  baseUrl: string
  realm: string
  clientId: string
  clientSecret: string
  application: string
  adminClientId: string
  adminClientSecret: string
  appGroups: Record<string, string>
  organizations: boolean
  inviteActions: string[]
  inviteLifespanSec: number
}

export function scadaIdConfig(): ScadaIdConfig {
  const env = (k: string) => (process.env[k] || "").trim()
  const issuer = (env("SCADA_ID_ISSUER") || "https://id.scada25.ru/realms/scada-system-id").replace(/\/$/, "")
  const m = issuer.match(/^(.*)\/realms\/([^/]+)$/)
  let appGroups: Record<string, string> = {}
  try {
    const raw = env("PORTAL_SCADA_ID_APP_GROUPS")
    if (raw) appGroups = JSON.parse(raw) as Record<string, string>
  } catch {
    console.error("[portal] PORTAL_SCADA_ID_APP_GROUPS: некорректный JSON")
  }
  return {
    issuer,
    apiUrl: (env("SCADA_ID_API") || "https://id.scada25.ru").replace(/\/$/, ""),
    baseUrl: m ? m[1] : issuer,
    realm: m ? m[2] : "",
    clientId: env("PORTAL_SCADA_ID_CLIENT_ID") || "scada-portal",
    clientSecret: env("PORTAL_SCADA_ID_CLIENT_SECRET"),
    application: env("PORTAL_SCADA_ID_APPLICATION") || "scada-portal",
    adminClientId: env("PORTAL_SCADA_ID_ADMIN_CLIENT_ID"),
    adminClientSecret: env("PORTAL_SCADA_ID_ADMIN_CLIENT_SECRET"),
    appGroups,
    organizations: env("PORTAL_SCADA_ID_ORGANIZATIONS") === "1",
    inviteActions: (env("PORTAL_SCADA_ID_INVITE_ACTIONS") || "UPDATE_PROFILE,UPDATE_PASSWORD")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    inviteLifespanSec: Number(env("PORTAL_SCADA_ID_INVITE_LIFESPAN_SEC")) || 3 * 24 * 3600,
  }
}

export function loginConfigured(cfg = scadaIdConfig()): boolean {
  return Boolean(cfg.issuer && cfg.clientId && cfg.clientSecret)
}

export function provisioningConfigured(cfg = scadaIdConfig()): boolean {
  return Boolean(cfg.realm && cfg.adminClientId && cfg.adminClientSecret)
}
