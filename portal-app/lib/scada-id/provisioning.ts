import { HttpError } from "../errors"
import { provisioningConfigured, scadaIdConfig, type ScadaIdConfig } from "./config"

/**
 * Выдача доступа в SCADA ID через стандартный Keycloak Admin REST API
 * сервисной учётной записью портала (client credentials, роли realm-management:
 * view-users, manage-users, query-groups; для организаций — manage-organizations).
 *
 * — Новый пользователь: создаётся с уже подтверждённым email и именем из заявки,
 *   Keycloak сам отправляет письмо «завершите регистрацию» (execute-actions-email).
 * — Доступ к приложениям: членство в группе, сопоставленной приложению
 *   (PORTAL_SCADA_ID_APP_GROUPS). Если сопоставления нет — выдача остаётся
 *   ручной, портал её не имитирует.
 * — Организация: членство в организации Keycloak (PORTAL_SCADA_ID_ORGANIZATIONS=1)
 *   или атрибут пользователя `scada_organization`.
 */

export type ScadaUser = {
  id: string
  email: string
  firstName?: string
  lastName?: string
  attributes?: Record<string, string[]>
}

export type GrantOutcome = { app: string; state: "provisioned" | "manual" | "failed"; detail: string }

let tokenCache: { token: string; until: number } | null = null

function adminBase(cfg: ScadaIdConfig) {
  return `${cfg.baseUrl}/admin/realms/${encodeURIComponent(cfg.realm)}`
}

async function adminToken(cfg: ScadaIdConfig): Promise<string> {
  if (tokenCache && tokenCache.until > Date.now() + 10_000) return tokenCache.token
  const res = await fetch(`${cfg.issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.adminClientId,
      client_secret: cfg.adminClientSecret,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  })
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string }
  if (!res.ok || !body.access_token) {
    throw new HttpError(502, `SCADA ID отклонил сервисный вход портала: ${body.error_description || res.status}`, "scada_id_auth")
  }
  tokenCache = { token: body.access_token, until: Date.now() + (body.expires_in || 60) * 1000 }
  return body.access_token
}

async function admin(cfg: ScadaIdConfig, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await adminToken(cfg)
  return fetch(`${adminBase(cfg)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  })
}

async function expectOk(res: Response, what: string, allow: number[] = []) {
  if (res.ok || allow.includes(res.status)) return
  const detail = (await res.text().catch(() => "")).slice(0, 300)
  throw new HttpError(502, `SCADA ID: не удалось ${what} (${res.status}) ${detail}`.trim(), "scada_id_error")
}

function requireConfigured(cfg: ScadaIdConfig) {
  if (!provisioningConfigured(cfg)) {
    throw new HttpError(
      503,
      "Выдача доступа в SCADA ID не настроена: задайте PORTAL_SCADA_ID_ADMIN_CLIENT_ID и PORTAL_SCADA_ID_ADMIN_CLIENT_SECRET",
      "provisioning_not_configured"
    )
  }
}

export async function findUserByEmail(email: string, cfg = scadaIdConfig()): Promise<ScadaUser | null> {
  requireConfigured(cfg)
  const res = await admin(cfg, `/users?email=${encodeURIComponent(email)}&exact=true&briefRepresentation=false`)
  await expectOk(res, "найти пользователя")
  const list = (await res.json()) as ScadaUser[]
  return list.find((u) => (u.email || "").toLowerCase() === email.toLowerCase()) || null
}

export async function createUser(
  input: { email: string; firstName: string; lastName: string; attributes: Record<string, string> },
  cfg = scadaIdConfig()
): Promise<string> {
  requireConfigured(cfg)
  const res = await admin(cfg, `/users`, {
    method: "POST",
    body: JSON.stringify({
      username: input.email,
      email: input.email,
      emailVerified: true,
      enabled: true,
      firstName: input.firstName,
      lastName: input.lastName,
      attributes: Object.fromEntries(Object.entries(input.attributes).map(([k, v]) => [k, [v]])),
    }),
  })
  if (res.status === 409) {
    const existing = await findUserByEmail(input.email, cfg)
    if (existing) return existing.id
  }
  await expectOk(res, "создать пользователя")
  const location = res.headers.get("location") || ""
  const id = location.split("/").pop()
  if (id) return id
  const created = await findUserByEmail(input.email, cfg)
  if (!created) throw new HttpError(502, "SCADA ID создал пользователя, но не вернул его id", "scada_id_error")
  return created.id
}

/** Штатное приглашение SCADA ID: письмо со ссылкой на завершение регистрации. */
export async function sendRegistrationInvite(userId: string, redirectUri: string, cfg = scadaIdConfig()) {
  requireConfigured(cfg)
  const qs = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    lifespan: String(cfg.inviteLifespanSec),
  })
  const res = await admin(cfg, `/users/${encodeURIComponent(userId)}/execute-actions-email?${qs}`, {
    method: "PUT",
    body: JSON.stringify(cfg.inviteActions),
  })
  await expectOk(res, "отправить приглашение")
}

export type Organization = { ref: string; name: string }

/** Список организаций, если в SCADA ID включены организации Keycloak. */
export async function listOrganizations(cfg = scadaIdConfig()): Promise<Organization[] | null> {
  if (!provisioningConfigured(cfg) || !cfg.organizations) return null
  const res = await admin(cfg, `/organizations?briefRepresentation=true&max=500`)
  await expectOk(res, "получить список организаций")
  const list = (await res.json()) as Array<{ id: string; name: string; alias?: string }>
  return list.map((o) => ({ ref: o.id, name: o.name || o.alias || o.id }))
}

async function setOrganization(userId: string, orgRef: string, cfg: ScadaIdConfig) {
  if (cfg.organizations) {
    const res = await admin(cfg, `/organizations/${encodeURIComponent(orgRef)}/members`, {
      method: "POST",
      body: JSON.stringify(userId),
    })
    await expectOk(res, "добавить пользователя в организацию", [409])
    return
  }
  const cur = await admin(cfg, `/users/${encodeURIComponent(userId)}`)
  await expectOk(cur, "прочитать пользователя")
  const user = (await cur.json()) as ScadaUser
  const res = await admin(cfg, `/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: JSON.stringify({ ...user, attributes: { ...(user.attributes || {}), scada_organization: [orgRef] } }),
  })
  await expectOk(res, "назначить организацию")
}

async function groupIdByPath(path: string, cfg: ScadaIdConfig): Promise<string | null> {
  const clean = path.replace(/^\/+/, "")
  const res = await admin(cfg, `/group-by-path/${clean.split("/").map(encodeURIComponent).join("/")}`)
  if (res.status === 404) return null
  await expectOk(res, `найти группу ${path}`)
  return ((await res.json()) as { id: string }).id
}

/**
 * Назначает организацию и доступ к одобренным приложениям — и только к ним.
 * Возвращает итог по каждому приложению; ничего не помечается выданным,
 * если SCADA ID не подтвердил операцию.
 */
export async function assignAccess(
  userId: string,
  orgRef: string,
  apps: string[],
  cfg = scadaIdConfig()
): Promise<GrantOutcome[]> {
  requireConfigured(cfg)
  await setOrganization(userId, orgRef, cfg)
  const out: GrantOutcome[] = []
  for (const app of [...new Set(apps)]) {
    const path = cfg.appGroups[app]
    if (!path) {
      out.push({ app, state: "manual", detail: "Для приложения не задана группа SCADA ID — выдайте доступ вручную" })
      continue
    }
    try {
      const gid = await groupIdByPath(path, cfg)
      if (!gid) {
        out.push({ app, state: "failed", detail: `Группа ${path} не найдена в SCADA ID` })
        continue
      }
      const res = await admin(cfg, `/users/${encodeURIComponent(userId)}/groups/${encodeURIComponent(gid)}`, { method: "PUT" })
      await expectOk(res, `добавить в группу ${path}`)
      out.push({ app, state: "provisioned", detail: `Группа ${path}` })
    } catch (err) {
      out.push({ app, state: "failed", detail: err instanceof Error ? err.message : String(err) })
    }
  }
  return out
}

export function _resetTokenCacheForTests() {
  tokenCache = null
}
