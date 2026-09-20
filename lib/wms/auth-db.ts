import type { PoolClient } from "pg";
import { verifyPassword } from "@/lib/wms/password";

export type AuthenticatedDbUser = {
  userId: string;
  login: string;
  displayName: string;
  position: string | null;
  roleCodes: string[];
};

function mapRolesToPosition(roleCodes: string[]): string {
  if (roleCodes.includes("admin")) return "Администратор";
  if (roleCodes.includes("warehouse_manager")) return "Начальник склада";
  if (roleCodes.includes("auditor")) return "Ревизор";
  if (roleCodes.includes("line_operator")) return "Оператор линии";
  if (roleCodes.includes("warehouse_operator")) return "Кладовщик";
  return "Оператор WMS";
}

export function positionFromRoles(roleCodes: string[], storedPosition?: string | null): string {
  const trimmed = storedPosition?.trim();
  if (trimmed) return trimmed;
  return mapRolesToPosition(roleCodes);
}

export async function authenticateDbUser(
  client: PoolClient,
  login: string,
  password: string
): Promise<AuthenticatedDbUser | null> {
  const normalizedLogin = login.trim().toLowerCase();
  if (!normalizedLogin || !password) return null;

  const r = await client.query<{
    userId: string;
    login: string;
    displayName: string;
    position: string | null;
    passwordHash: string | null;
    isActive: boolean;
    roles: string[];
  }>(
    `
    SELECT
      u.user_id::text AS "userId",
      u.login,
      u.display_name AS "displayName",
      u.position,
      u.password_hash AS "passwordHash",
      u.is_active AS "isActive",
      COALESCE(array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
    FROM wms_users u
    LEFT JOIN wms_user_roles ur ON ur.user_id = u.user_id
    LEFT JOIN wms_roles r ON r.role_id = ur.role_id
    WHERE lower(u.login) = lower($1)
    GROUP BY u.user_id, u.login, u.display_name, u.position, u.password_hash, u.is_active
    LIMIT 1
    `,
    [normalizedLogin]
  );

  const row = r.rows[0];
  if (!row || !row.isActive || !row.passwordHash) return null;
  const ok = await verifyPassword(password, row.passwordHash);
  if (!ok) return null;

  const roleCodes = Array.isArray(row.roles) ? row.roles.filter(Boolean) : [];
  return {
    userId: row.userId,
    login: row.login,
    displayName: row.displayName,
    position: positionFromRoles(roleCodes, row.position),
    roleCodes,
  };
}

export async function getDbUserById(
  client: PoolClient,
  userId: string
): Promise<AuthenticatedDbUser | null> {
  const r = await client.query<{
    userId: string;
    login: string;
    displayName: string;
    position: string | null;
    isActive: boolean;
    roles: string[];
  }>(
    `
    SELECT
      u.user_id::text AS "userId",
      u.login,
      u.display_name AS "displayName",
      u.position,
      u.is_active AS "isActive",
      COALESCE(array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
    FROM wms_users u
    LEFT JOIN wms_user_roles ur ON ur.user_id = u.user_id
    LEFT JOIN wms_roles r ON r.role_id = ur.role_id
    WHERE u.user_id = $1::bigint AND u.is_active = TRUE
    GROUP BY u.user_id, u.login, u.display_name, u.position, u.is_active
    `,
    [userId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const roleCodes = Array.isArray(row.roles) ? row.roles.filter(Boolean) : [];
  return {
    userId: row.userId,
    login: row.login,
    displayName: row.displayName,
    position: positionFromRoles(roleCodes, row.position),
    roleCodes,
  };
}

async function mapDbUserRow(
  client: PoolClient,
  whereSql: string,
  params: unknown[]
): Promise<(AuthenticatedDbUser & { pinHash?: string | null }) | null> {
  const r = await client.query<{
    userId: string;
    login: string;
    displayName: string;
    position: string | null;
    isActive: boolean;
    pinHash: string | null;
    roles: string[];
  }>(
    `
    SELECT
      u.user_id::text AS "userId",
      u.login,
      u.display_name AS "displayName",
      u.position,
      u.is_active AS "isActive",
      u.pin_hash AS "pinHash",
      COALESCE(array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
    FROM wms_users u
    LEFT JOIN wms_user_roles ur ON ur.user_id = u.user_id
    LEFT JOIN wms_roles r ON r.role_id = ur.role_id
    WHERE ${whereSql}
    GROUP BY u.user_id, u.login, u.display_name, u.position, u.is_active, u.pin_hash
    LIMIT 1
    `,
    params
  );
  const row = r.rows[0];
  if (!row || !row.isActive) return null;
  const roleCodes = Array.isArray(row.roles) ? row.roles.filter(Boolean) : [];
  return {
    userId: row.userId,
    login: row.login,
    displayName: row.displayName,
    position: positionFromRoles(roleCodes, row.position),
    roleCodes,
    pinHash: row.pinHash,
  };
}

export async function identifyDbUserByRfid(
  client: PoolClient,
  siteId: number,
  rfidUid: string
): Promise<AuthenticatedDbUser | null> {
  const uid = rfidUid.trim().toLowerCase();
  if (!uid) return null;
  return mapDbUserRow(client, "u.site_id = $1 AND lower(u.rfid_uid) = $2", [siteId, uid]);
}

export async function identifyDbUserByPin(
  client: PoolClient,
  siteId: number,
  identity: string,
  pin: string
): Promise<AuthenticatedDbUser | null> {
  const cleanIdentity = identity.trim().toLowerCase();
  if (!cleanIdentity || !pin) return null;
  const user = await mapDbUserRow(
    client,
    "u.site_id = $1 AND (lower(u.login) = $2 OR lower(u.external_code) = $2)",
    [siteId, cleanIdentity]
  );
  if (!user?.pinHash) return null;
  const ok = await verifyPassword(pin, user.pinHash);
  if (!ok) return null;
  const { pinHash: _pinHash, ...publicUser } = user;
  return publicUser;
}

export function mapLegacyPositionToRoleCodes(position: string): string[] {
  const p = position.trim().toLowerCase();
  if (p.includes("админ")) return ["admin"];
  if (p.includes("начальник")) return ["warehouse_manager"];
  if (p.includes("ревиз")) return ["auditor"];
  if (p.includes("линия") || p.includes("цех")) return ["line_operator"];
  return ["warehouse_operator"];
}
