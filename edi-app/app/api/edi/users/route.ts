import { route } from "@/lib/http.ts"
import { effectiveEdiRoles } from "@/lib/edi/permissions.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Пользователи организации с доступом к EDI — для назначения ответственных, маршрутов, делегирования. */
export const GET = route(async ({ client, actor }) => {
  const r = await client.query<{ user_id: string; display_name: string; login: string; wms_roles: string[]; edi_roles: string[]; department: string | null }>(
    `SELECT u.user_id::text, u.display_name, u.login,
            COALESCE((SELECT array_agg(r.code) FROM wms_user_roles ur JOIN wms_roles r ON r.role_id = ur.role_id WHERE ur.user_id = u.user_id), '{}') AS wms_roles,
            COALESCE((SELECT array_agg(er.role_code) FROM edi_user_roles er WHERE er.user_id = u.user_id AND er.site_id = u.site_id), '{}') AS edi_roles,
            (SELECT p.department FROM edi_user_profiles p WHERE p.user_id = u.user_id AND p.site_id = u.site_id) AS department
     FROM wms_users u WHERE u.site_id = $1 AND u.is_active ORDER BY u.display_name`,
    [actor.siteId]
  )
  return {
    users: r.rows
      .map((u) => ({ userId: u.user_id, name: u.display_name, login: u.login, department: u.department, roles: effectiveEdiRoles(u.wms_roles, u.edi_roles), explicit: u.edi_roles.length > 0 }))
      .filter((u) => u.roles.length > 0),
  }
})
