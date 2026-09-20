import { randomBytes } from "node:crypto"
import type { PoolClient } from "pg"
import { hashPassword } from "@/lib/wms/password"
import { positionFromScada, type ScadaIdPermissions } from "@/lib/wms/scada-id"

export type LinkedWmsUser = {
  userId: string
  login: string
  displayName: string
  position: string
  roleCodes: string[]
}

async function loadUser(
  client: PoolClient,
  userId: string
): Promise<LinkedWmsUser | null> {
  const r = await client.query<{
    userId: string
    login: string
    displayName: string
    position: string | null
    roles: string[]
  }>(
    `
    SELECT
      u.user_id::text AS "userId",
      u.login,
      u.display_name AS "displayName",
      u.position,
      COALESCE(array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
    FROM wms_users u
    LEFT JOIN wms_user_roles ur ON ur.user_id = u.user_id
    LEFT JOIN wms_roles r ON r.role_id = ur.role_id
    WHERE u.user_id = $1::bigint
    GROUP BY u.user_id, u.login, u.display_name, u.position
    `,
    [userId]
  )
  const row = r.rows[0]
  if (!row) return null
  return {
    userId: row.userId,
    login: row.login,
    displayName: row.displayName,
    position: row.position || "WMS",
    roleCodes: Array.isArray(row.roles) ? row.roles.filter(Boolean) : [],
  }
}

async function replaceRoles(client: PoolClient, userId: string, roleCodes: string[]): Promise<void> {
  await client.query(`DELETE FROM wms_user_roles WHERE user_id = $1::bigint`, [userId])
  if (roleCodes.length === 0) return
  await client.query(
    `INSERT INTO wms_user_roles (user_id, role_id)
     SELECT $1::bigint, r.role_id FROM wms_roles r WHERE r.code = ANY($2::text[])
     ON CONFLICT DO NOTHING`,
    [userId, roleCodes]
  )
}

export async function upsertWmsUserFromScadaId(
  client: PoolClient,
  siteId: number,
  perms: ScadaIdPermissions,
  roleCodes: string[]
): Promise<LinkedWmsUser> {
  const email = perms.email.trim().toLowerCase()
  const login = email || perms.subject_id
  const localLogin = email.includes("@") ? email.split("@")[0] : ""
  const displayName = perms.display_name?.trim() || localLogin || email.split("@")[0] || "Scada ID"
  const position = positionFromScada(perms, roleCodes)
  const external = `scada-id:${perms.subject_id || perms.user_id}`

  const found = await client.query<{ userId: string }>(
    `SELECT user_id::text AS "userId"
     FROM wms_users
     WHERE site_id = $1
       AND (
         lower(login) = lower($2)
         OR external_code = $3
         OR ($4 <> '' AND lower(login) = lower($4))
       )
     ORDER BY CASE
       WHEN lower(login) = lower($2) THEN 0
       WHEN external_code = $3 THEN 1
       ELSE 2
     END
     LIMIT 1`,
    [siteId, login, external, localLogin]
  )

  let userId = found.rows[0]?.userId
  if (!userId) {
    const passwordHash = await hashPassword(`scada-id:${randomBytes(24).toString("hex")}`)
    const ins = await client.query<{ userId: string }>(
      `INSERT INTO wms_users (site_id, login, display_name, position, external_code, password_hash, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       RETURNING user_id::text AS "userId"`,
      [siteId, login, displayName, position, external, passwordHash]
    )
    userId = ins.rows[0]!.userId
  } else {
    await client.query(
      `UPDATE wms_users
       SET display_name = $2,
           position = $3,
           external_code = COALESCE(NULLIF(external_code, ''), $4),
           is_active = TRUE
       WHERE user_id = $1::bigint`,
      [userId, displayName, position, external]
    )
  }

  await replaceRoles(client, userId, roleCodes)
  const user = await loadUser(client, userId)
  if (!user) throw new Error("Не удалось создать пользователя WMS из Scada ID")
  return { ...user, roleCodes, position, displayName, login: user.login }
}
