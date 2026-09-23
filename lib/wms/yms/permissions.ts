import type { PoolClient } from "pg"
import { WmsHttpError } from "@/lib/wms/errors"
import type { WmsActor } from "@/lib/wms/require-actor"

const ALL = "*"

const ROLE_GRANTS: Record<string, string[]> = {
  admin: [ALL],
  warehouse_manager: [ALL],
  warehouse_operator: ["yms.read", "yms.warehouse.confirm"],
  auditor: ["yms.read"],
  yms_dispatcher: ["yms.read", "yms.visit.write", "yms.assign", "yms.yard.write", "yms.gate.confirm"],
  dispatcher: ["yms.read", "yms.visit.write", "yms.assign", "yms.yard.write", "yms.gate.confirm"],
  yms_guard: ["yms.read", "yms.gate.confirm"],
  guard: ["yms.read", "yms.gate.confirm"],
  yms_logist: ["yms.read", "yms.visit.write"],
  logist: ["yms.read", "yms.visit.write"],
  yms_warehouse: ["yms.read", "yms.warehouse.confirm"],
}

const YMS_PERMISSIONS: Array<{ code: string; name: string }> = [
  { code: "yms.read", name: "Чтение территории" },
  { code: "yms.visit.write", name: "Заявки на визит" },
  { code: "yms.assign", name: "Назначение стоянки и дока" },
  { code: "yms.gate.confirm", name: "КПП: въезд и выезд" },
  { code: "yms.warehouse.confirm", name: "Подтверждение складской операции" },
  { code: "yms.yard.write", name: "План территории" },
]

let permsReady = false

export async function ensureYmsPermissionRows(client: PoolClient): Promise<void> {
  if (permsReady) return
  try {
    await client.query(
      `INSERT INTO wms_permissions (code, name)
       SELECT v.code, v.name FROM jsonb_to_recordset($1::jsonb) AS v(code text, name text)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
      [JSON.stringify(YMS_PERMISSIONS)]
    )
    const cols = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'wms_roles'`
    )
    const names = new Set(cols.rows.map((r) => r.column_name))
    if (names.has("code") && names.has("name")) {
      await client.query(
        `INSERT INTO wms_roles (code, name)
         SELECT v.code, v.name
         FROM (VALUES
           ('yms_dispatcher', 'Диспетчер территории'),
           ('yms_guard', 'Охрана КПП'),
           ('yms_logist', 'Логист'),
           ('yms_warehouse', 'Склад: подтверждение погрузки')
         ) AS v(code, name)
         WHERE NOT EXISTS (SELECT 1 FROM wms_roles r WHERE r.code = v.code)`
      )
    }
    await client.query(
      `INSERT INTO wms_role_permissions (role_id, permission_id)
       SELECT r.role_id, p.permission_id
       FROM wms_roles r
       JOIN wms_permissions p ON p.code = ANY($1::text[])
       WHERE r.code = ANY($2::text[])
       ON CONFLICT DO NOTHING`,
      [
        YMS_PERMISSIONS.map((p) => p.code),
        ["admin", "warehouse_manager", "yms_dispatcher", "dispatcher"],
      ]
    )
    await client.query(
      `INSERT INTO wms_role_permissions (role_id, permission_id)
       SELECT r.role_id, p.permission_id
       FROM wms_roles r
       JOIN wms_permissions p ON p.code = ANY($1::text[])
       WHERE r.code = 'warehouse_operator'
       ON CONFLICT DO NOTHING`,
      [["yms.read", "yms.warehouse.confirm"]]
    )
    await client.query(
      `INSERT INTO wms_role_permissions (role_id, permission_id)
       SELECT r.role_id, p.permission_id
       FROM wms_roles r
       JOIN wms_permissions p ON p.code = 'yms.read'
       WHERE r.code = 'auditor'
       ON CONFLICT DO NOTHING`
    )
  } catch {
    /* справочник прав может отличаться — проверка ниже идёт по кодам ролей */
  }
  permsReady = true
}

async function loadRoleCodes(
  client: PoolClient,
  siteId: number,
  actor: WmsActor
): Promise<string[]> {
  const fromSession = actor.session?.roleCodes?.filter(Boolean) ?? []
  const userId = actor.userId?.trim() || actor.session?.userId?.trim() || ""
  const login = actor.session?.login?.trim() || ""
  if (!/^\d+$/.test(userId) && !login) return fromSession
  try {
    const r = await client.query<{ code: string }>(
      `SELECT DISTINCT r.code
       FROM wms_users u
       JOIN wms_user_roles ur ON ur.user_id = u.user_id
       JOIN wms_roles r ON r.role_id = ur.role_id
       WHERE u.site_id = $1
         AND (
           ($2::text <> '' AND u.user_id = $2::bigint)
           OR ($3::text <> '' AND lower(u.login) = lower($3))
         )`,
      [siteId, /^\d+$/.test(userId) ? userId : "", login]
    )
    const dbCodes = r.rows.map((row) => row.code)
    return [...new Set([...fromSession, ...dbCodes])]
  } catch {
    return fromSession
  }
}

export function grantsAllow(codes: string[], permission: string): boolean {
  for (const code of codes) {
    const grants = ROLE_GRANTS[code.trim().toLowerCase()]
    if (!grants) continue
    if (grants.includes(ALL) || grants.includes(permission)) return true
  }
  return false
}

export async function assertYmsPermission(
  client: PoolClient,
  siteId: number,
  actor: WmsActor,
  permission: string
): Promise<string[]> {
  await ensureYmsPermissionRows(client)
  const codes = await loadRoleCodes(client, siteId, actor)
  if (!grantsAllow(codes, permission)) {
    throw new WmsHttpError(403, `недостаточно прав: ${permission}`, "permission_denied")
  }
  return codes
}

export function canRevealDriverPhone(roleCodes: string[]): boolean {
  return (
    grantsAllow(roleCodes, "yms.visit.write") ||
    grantsAllow(roleCodes, "yms.gate.confirm") ||
    grantsAllow(roleCodes, "yms.assign")
  )
}

export function maskPhone(phone: string | null | undefined): string | null {
  const value = (phone ?? "").trim()
  if (!value) return null
  if (value.length <= 4) return "•••"
  return `${value.slice(0, 2)}••••${value.slice(-2)}`
}
