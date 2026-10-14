import type { PoolClient } from "pg"
import { HttpError } from "../db.ts"
import type { EdiSession } from "../auth/session.ts"
import { effectiveEdiRoles, permissionsForRoles, type EdiPermission } from "./permissions.ts"

export type Actor = {
  userId: string
  login: string
  fio: string
  siteId: number
  siteCode: string
  orgName: string
  orgs: EdiSession["orgs"]
  roles: string[]
  wmsRoles: string[]
  permissions: Set<EdiPermission>
  department: string | null
  via: EdiSession["via"]
}

export async function loadUserRoles(
  client: PoolClient,
  siteId: number,
  userId: string
): Promise<{ active: boolean; wmsRoles: string[]; ediRoles: string[]; department: string | null; fio: string; login: string }> {
  const r = await client.query<{
    is_active: boolean
    login: string
    display_name: string
    wms_roles: string[]
    edi_roles: string[]
    department: string | null
  }>(
    `SELECT u.is_active, u.login, u.display_name,
            COALESCE((SELECT array_agg(r.code) FROM wms_user_roles ur JOIN wms_roles r ON r.role_id = ur.role_id
                      WHERE ur.user_id = u.user_id), '{}') AS wms_roles,
            COALESCE((SELECT array_agg(er.role_code) FROM edi_user_roles er
                      WHERE er.user_id = u.user_id AND er.site_id = $1), '{}') AS edi_roles,
            (SELECT p.department FROM edi_user_profiles p WHERE p.user_id = u.user_id AND p.site_id = $1) AS department
     FROM wms_users u
     WHERE u.user_id = $2::bigint AND u.site_id = $1`,
    [siteId, userId]
  )
  const row = r.rows[0]
  if (!row) return { active: false, wmsRoles: [], ediRoles: [], department: null, fio: "", login: "" }
  return {
    active: row.is_active,
    wmsRoles: row.wms_roles ?? [],
    ediRoles: row.edi_roles ?? [],
    department: row.department,
    fio: row.display_name,
    login: row.login,
  }
}

export async function actorFromSession(client: PoolClient, session: EdiSession): Promise<Actor> {
  const org = session.orgs.find((o) => o.siteId === session.siteId)
  if (!org) throw new HttpError(403, "Нет доступа к организации", "org_forbidden")
  const roles = await loadUserRoles(client, session.siteId, session.userId)
  if (!roles.active) throw new HttpError(401, "Пользователь отключён", "user_inactive")
  const ediRoles = effectiveEdiRoles(roles.wmsRoles, roles.ediRoles)
  if (ediRoles.length === 0) throw new HttpError(403, "Нет доступа к SCADA EDI", "edi_forbidden")
  return {
    userId: session.userId,
    login: roles.login || session.login,
    fio: roles.fio || session.fio,
    siteId: session.siteId,
    siteCode: session.siteCode,
    orgName: org.name,
    orgs: session.orgs,
    roles: ediRoles,
    wmsRoles: roles.wmsRoles,
    permissions: permissionsForRoles(ediRoles),
    department: roles.department,
    via: session.via,
  }
}

export function can(actor: Actor, permission: EdiPermission): boolean {
  return actor.permissions.has(permission)
}

export function requirePermission(actor: Actor, permission: EdiPermission): void {
  if (!can(actor, permission)) throw new HttpError(403, `Недостаточно прав: ${permission}`, "permission_denied")
}

/** Актор по user_id без cookie (временные ссылки, фоновые операции): права перечитываются из БД. */
export async function actorForUser(client: PoolClient, siteId: number, userId: string): Promise<Actor> {
  const site = await client.query<{ site_code: string; name: string }>(`SELECT site_code, name FROM wms_sites WHERE site_id = $1 AND is_active`, [siteId])
  if (!site.rows[0]) throw new HttpError(403, "Организация недоступна", "org_forbidden")
  return actorFromSession(client, {
    userId,
    login: "",
    fio: "",
    siteId,
    siteCode: site.rows[0].site_code,
    orgs: [{ siteId, siteCode: site.rows[0].site_code, name: site.rows[0].name, userId }],
    via: "password",
    iat: Date.now(),
    exp: Date.now() + 60_000,
  })
}
