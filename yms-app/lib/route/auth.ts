import { createHash } from "node:crypto"
import type { PoolClient } from "pg"
import { SESSION_AUDIENCE, verifySessionToken } from "@/lib/auth/session"
import { WMS_SESSION_COOKIE } from "@/lib/auth/types"
import { WmsHttpError } from "@/lib/wms/errors"
import { looksLikeJwt, OidcError, oidcConfigFromEnv, routeRolesFromClaims, verifyOidcToken } from "@/lib/route/oidc"

export const ROUTE_DEVICE_TOKEN_PREFIX = "rdev_"

export type RouteUserActor = {
  kind: "user"
  via: "session" | "scada-id"
  login: string
  userId: string | null
  fio: string
  roleCodes: string[]
}

export type RouteDeviceActor = {
  kind: "device"
  deviceId: string
  deviceKind: string
  karaId: string | null
}

export type RouteActor = RouteUserActor | RouteDeviceActor

export const ROUTE_PERMISSIONS = [
  { code: "route.read", name: "Route: просмотр" },
  { code: "route.drive", name: "Route: работа водителя погрузчика" },
  { code: "route.scan.manual", name: "Route: ручной ввод кода палеты/адреса" },
  { code: "route.dispatch", name: "Route: диспетчер (назначение, приоритет, отмена, блокировки)" },
  { code: "route.position.manual", name: "Route: ручная позиция погрузчика" },
  { code: "route.map.write", name: "Route: редактор карты и меток" },
  { code: "route.position.write", name: "Route: запись позиции (сервис позиционирования)" },
] as const

export type RoutePermission = (typeof ROUTE_PERMISSIONS)[number]["code"]

const ALL = "*"
const GRANTS: Record<string, string[]> = {
  admin: [ALL],
  warehouse_manager: [ALL],
  route_admin: ["route.read", "route.map.write", "route.dispatch", "route.position.manual", "route.scan.manual"],
  route_dispatcher: ["route.read", "route.dispatch", "route.position.manual", "route.scan.manual"],
  yms_dispatcher: ["route.read", "route.dispatch", "route.position.manual"],
  dispatcher: ["route.read", "route.dispatch", "route.position.manual"],
  route_senior_driver: ["route.read", "route.drive", "route.scan.manual"],
  route_driver: ["route.read", "route.drive"],
  warehouse_operator: ["route.read", "route.drive"],
  auditor: ["route.read"],
}

const DEVICE_GRANTS: Record<string, string[]> = {
  localizer: ["route.position.write"],
}

export function routeGrantsAllow(roleCodes: string[], permission: string): boolean {
  for (const raw of roleCodes) {
    const g = GRANTS[raw.trim().toLowerCase()]
    if (g && (g.includes(ALL) || g.includes(permission))) return true
  }
  return false
}

export function actorCan(actor: RouteActor, permission: string): boolean {
  if (actor.kind === "device") return (DEVICE_GRANTS[actor.deviceKind] ?? []).includes(permission)
  return routeGrantsAllow(actor.roleCodes, permission)
}

export function actorLabel(actor: RouteActor): string {
  return actor.kind === "user" ? actor.login : `device:${actor.deviceId}`
}

function cookieToken(req: Request): string {
  const header = req.headers.get("cookie") || ""
  const row = header
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${WMS_SESSION_COOKIE}=`))
  return row ? decodeURIComponent(row.slice(WMS_SESSION_COOKIE.length + 1)) : ""
}

function bearer(req: Request): string {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : ""
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

async function userFromDb(
  client: PoolClient,
  siteId: number,
  where: { userId?: string | null; logins: string[] }
): Promise<{ userId: string; login: string; fio: string; roleCodes: string[]; siteId: number } | null> {
  const logins = where.logins.map((l) => l.trim().toLowerCase()).filter(Boolean)
  const uid = where.userId && /^\d+$/.test(where.userId) ? where.userId : ""
  if (!uid && logins.length === 0) return null
  const r = await client.query<{
    userId: string
    login: string
    fio: string
    siteId: number
    isActive: boolean
    roles: string[]
  }>(
    `SELECT u.user_id::text AS "userId", u.login, u.display_name AS fio, u.site_id AS "siteId",
            u.is_active AS "isActive",
            COALESCE(array_agg(r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
     FROM wms_users u
     LEFT JOIN wms_user_roles ur ON ur.user_id = u.user_id
     LEFT JOIN wms_roles r ON r.role_id = ur.role_id
     WHERE ($1::text <> '' AND u.user_id = NULLIF($1, '')::bigint)
        OR lower(u.login) = ANY($2::text[])
     GROUP BY u.user_id
     ORDER BY (u.site_id = $3) DESC
     LIMIT 1`,
    [uid, logins, siteId]
  )
  const row = r.rows[0]
  if (!row || !row.isActive) return null
  return { userId: row.userId, login: row.login, fio: row.fio, roleCodes: row.roles ?? [], siteId: row.siteId }
}

/**
 * Кто обращается к Route.
 *  - cookie сессии YMS с aud = "yms";
 *  - Bearer access token SCADA ID (aud/azp = scada-route);
 *  - Bearer токен устройства (сервис позиционирования), rdev_…
 * Принадлежность к площадке и активность пользователя проверяются по wms_users.
 */
export async function resolveRouteActor(req: Request, client: PoolClient, siteId: number): Promise<RouteActor> {
  const token = bearer(req)
  if (token.startsWith(ROUTE_DEVICE_TOKEN_PREFIX)) {
    const r = await client.query<{ device_id: string; kind: string; kara_id: string | null; revoked_at: string | null }>(
      `SELECT device_id, kind, kara_id, revoked_at::text
       FROM route_devices WHERE token_hash = $1 AND site_id = $2`,
      [hashDeviceToken(token), siteId]
    )
    const row = r.rows[0]
    if (!row || row.revoked_at) throw new WmsHttpError(401, "Токен устройства недействителен", "device_token_invalid")
    await client.query(`UPDATE route_devices SET last_seen_at = now() WHERE site_id = $1 AND device_id = $2`, [
      siteId,
      row.device_id,
    ])
    return { kind: "device", deviceId: row.device_id, deviceKind: row.kind, karaId: row.kara_id }
  }

  if (token && looksLikeJwt(token)) {
    const cfg = oidcConfigFromEnv()
    let claims
    try {
      claims = await verifyOidcToken(token, cfg)
    } catch (error) {
      if (error instanceof OidcError) throw new WmsHttpError(401, `SCADA ID: ${error.message}`, error.code)
      throw new WmsHttpError(401, "SCADA ID: токен не проверен", "token_invalid")
    }
    const logins = [claims.preferred_username, claims.email].filter((v): v is string => typeof v === "string")
    const user = await userFromDb(client, siteId, { logins })
    if (!user) throw new WmsHttpError(403, "Пользователь SCADA ID не заведён в WMS", "user_not_linked")
    if (user.siteId !== siteId) throw new WmsHttpError(403, "Пользователь не относится к этой площадке", "site_denied")
    return {
      kind: "user",
      via: "scada-id",
      login: user.login,
      userId: user.userId,
      fio: user.fio || claims.name || user.login,
      roleCodes: [...new Set([...user.roleCodes, ...routeRolesFromClaims(claims, cfg.audience)])],
    }
  }

  if (token) throw new WmsHttpError(401, "Неизвестный тип токена", "token_invalid")

  const cookie = cookieToken(req)
  const session = cookie ? await verifySessionToken(cookie) : null
  if (!session) throw new WmsHttpError(401, "Нужен вход в Route", "auth_required")
  if (session.aud !== SESSION_AUDIENCE) {
    throw new WmsHttpError(401, "Сессия выдана другим приложением. Войдите заново.", "session_audience")
  }
  const user = await userFromDb(client, siteId, { userId: session.userId, logins: [session.login] })
  if (!user) throw new WmsHttpError(403, "Пользователь отключён или не найден в WMS", "user_inactive")
  if (user.siteId !== siteId) throw new WmsHttpError(403, "Пользователь не относится к этой площадке", "site_denied")
  return {
    kind: "user",
    via: "session",
    login: user.login,
    userId: user.userId,
    fio: user.fio || session.fio,
    roleCodes: user.roleCodes,
  }
}

let rowsReady = false

/** Права и роли Route в справочнике WMS (если таблицы есть). Ошибка схемы не ломает вход. */
export async function ensureRoutePermissionRows(client: PoolClient): Promise<void> {
  if (rowsReady) return
  try {
    await client.query("SAVEPOINT route_perm_rows")
    await client.query(
      `INSERT INTO wms_permissions (code, name)
       SELECT v.code, v.name FROM jsonb_to_recordset($1::jsonb) AS v(code text, name text)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
      [JSON.stringify(ROUTE_PERMISSIONS)]
    )
    await client.query(
      `INSERT INTO wms_roles (code, name)
       SELECT v.code, v.name FROM (VALUES
         ('route_driver', 'Водитель погрузчика (Route)'),
         ('route_senior_driver', 'Старший водитель погрузчика (Route)'),
         ('route_dispatcher', 'Диспетчер погрузчиков (Route)'),
         ('route_admin', 'Администратор карты (Route)')
       ) AS v(code, name)
       WHERE NOT EXISTS (SELECT 1 FROM wms_roles r WHERE r.code = v.code)`
    )
    await client.query("RELEASE SAVEPOINT route_perm_rows")
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT route_perm_rows").catch(() => undefined)
  }
  rowsReady = true
}

export function requirePermission(actor: RouteActor, permission: RoutePermission): void {
  if (!actorCan(actor, permission)) {
    throw new WmsHttpError(403, `недостаточно прав: ${permission}`, "permission_denied")
  }
}

export function requireUser(actor: RouteActor): RouteUserActor {
  if (actor.kind !== "user") throw new WmsHttpError(403, "Действие доступно только пользователю", "user_required")
  return actor
}
