import type { PoolClient } from "pg";
import { WmsHttpError } from "@/lib/wms/errors";
import { hashPassword } from "@/lib/wms/password";

export type CreateWmsUserInput = {
  login: string;
  displayName: string;
  password?: string;
  position?: string | null;
  externalCode?: string | null;
  phone?: string | null;
  roleCodes?: string[];
};

const ALL_WMS_ROLES = [
  "admin",
  "warehouse_manager",
  "warehouse_operator",
  "line_operator",
  "auditor",
];

function expandRoleCodes(codes: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const raw of codes ?? []) {
    const key = raw.trim().toLowerCase();
    if (!key) continue;
    if (key === "god" || key === "бог" || key === "super_admin") {
      for (const role of ALL_WMS_ROLES) out.add(role);
      continue;
    }
    out.add(raw.trim());
  }
  return [...out];
}

function isPgUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "23505";
}

export async function createWmsUser(
  client: PoolClient,
  siteId: number,
  input: CreateWmsUserInput
) {
  const login = input.login.trim();
  const displayName = input.displayName.trim();
  if (!login) {
    throw new WmsHttpError(400, "login is required", "bad_login");
  }
  if (!displayName) {
    throw new WmsHttpError(400, "displayName is required", "bad_display_name");
  }
  const password = input.password?.trim() ?? "";
  if (!password || password.length < 4) {
    throw new WmsHttpError(400, "password is required (min 4 chars)", "bad_password");
  }
  const passwordHash = await hashPassword(password);

  await client.query("BEGIN");
  try {
    const ins = await client.query<{ userId: string }>(
      `INSERT INTO wms_users (site_id, login, display_name, position, external_code, phone, password_hash, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       RETURNING user_id::text AS "userId"`,
      [
        siteId,
        login,
        displayName,
        input.position?.trim() || null,
        input.externalCode?.trim() || null,
        input.phone?.trim() || null,
        passwordHash,
      ]
    );
    const userId = ins.rows[0]!.userId;
    const roles = expandRoleCodes(input.roleCodes);
    if (roles.length > 0) {
      await client.query(
        `INSERT INTO wms_user_roles (user_id, role_id)
         SELECT $1::bigint, r.role_id FROM wms_roles r WHERE r.code = ANY($2::text[])
         ON CONFLICT DO NOTHING`,
        [userId, roles]
      );
    }

    const row = await client.query<{
      userId: string;
      login: string;
      displayName: string;
      externalCode: string | null;
      phone: string | null;
      isActive: boolean;
      hasPassword: boolean;
      roles: string[];
    }>(
      `
      SELECT
        u.user_id::text AS "userId",
        u.login,
        u.display_name AS "displayName",
        u.external_code AS "externalCode",
        u.phone,
        u.is_active AS "isActive",
        (u.password_hash IS NOT NULL) AS "hasPassword",
        COALESCE(array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
      FROM wms_users u
      LEFT JOIN wms_user_roles ur ON ur.user_id = u.user_id
      LEFT JOIN wms_roles r ON r.role_id = ur.role_id
      WHERE u.user_id = $1::bigint
      GROUP BY u.user_id, u.login, u.display_name, u.external_code, u.phone, u.is_active, u.password_hash
      `,
      [userId]
    );

    await client.query("COMMIT");
    return row.rows[0]!;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (isPgUniqueViolation(e)) {
      throw new WmsHttpError(409, "login already exists", "duplicate_login");
    }
    throw e;
  }
}

export type UpdateWmsUserInput = {
  userId: string;
  displayName?: string;
  position?: string | null;
  phone?: string | null;
  externalCode?: string | null;
  password?: string;
  isActive?: boolean;
  roleCodes?: string[];
};

export async function updateWmsUser(
  client: PoolClient,
  siteId: number,
  input: UpdateWmsUserInput
) {
  const userId = input.userId.trim();
  if (!userId) throw new WmsHttpError(400, "userId is required", "bad_user_id");

  const existing = await client.query<{ userId: string }>(
    `SELECT user_id::text AS "userId" FROM wms_users WHERE site_id = $1 AND user_id = $2::bigint`,
    [siteId, userId]
  );
  if (!existing.rows[0]) {
    throw new WmsHttpError(404, "user not found", "user_not_found");
  }

  const password = input.password?.trim() ?? "";
  if (password && password.length < 4) {
    throw new WmsHttpError(400, "password must be at least 4 characters", "bad_password");
  }
  const passwordHash = password ? await hashPassword(password) : null;

  await client.query("BEGIN");
  try {
    await client.query(
      `
      UPDATE wms_users
      SET
        display_name = COALESCE(NULLIF($3, ''), display_name),
        position = CASE WHEN $4::text IS NULL THEN position ELSE NULLIF($4, '') END,
        phone = CASE WHEN $5::text IS NULL THEN phone ELSE NULLIF($5, '') END,
        external_code = CASE WHEN $6::text IS NULL THEN external_code ELSE NULLIF($6, '') END,
        password_hash = COALESCE($7, password_hash),
        is_active = COALESCE($8, is_active)
      WHERE user_id = $2::bigint AND site_id = $1
      `,
      [
        siteId,
        userId,
        input.displayName?.trim() ?? "",
        input.position === undefined ? null : (input.position?.trim() ?? ""),
        input.phone === undefined ? null : (input.phone?.trim() ?? ""),
        input.externalCode === undefined ? null : (input.externalCode?.trim() ?? ""),
        passwordHash,
        typeof input.isActive === "boolean" ? input.isActive : null,
      ]
    );

    if (Array.isArray(input.roleCodes)) {
      const roles = expandRoleCodes(input.roleCodes);
      await client.query(`DELETE FROM wms_user_roles WHERE user_id = $1::bigint`, [userId]);
      if (roles.length > 0) {
        await client.query(
          `INSERT INTO wms_user_roles (user_id, role_id)
           SELECT $1::bigint, r.role_id FROM wms_roles r WHERE r.code = ANY($2::text[])
           ON CONFLICT DO NOTHING`,
          [userId, roles]
        );
      }
    }

    const row = await client.query<{
      userId: string;
      login: string;
      displayName: string;
      externalCode: string | null;
      phone: string | null;
      position: string | null;
      isActive: boolean;
      hasPassword: boolean;
      roles: string[];
    }>(
      `
      SELECT
        u.user_id::text AS "userId",
        u.login,
        u.display_name AS "displayName",
        u.external_code AS "externalCode",
        u.phone,
        u.position,
        u.is_active AS "isActive",
        (u.password_hash IS NOT NULL) AS "hasPassword",
        COALESCE(array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
      FROM wms_users u
      LEFT JOIN wms_user_roles ur ON ur.user_id = u.user_id
      LEFT JOIN wms_roles r ON r.role_id = ur.role_id
      WHERE u.user_id = $1::bigint
      GROUP BY u.user_id, u.login, u.display_name, u.external_code, u.phone, u.position, u.is_active, u.password_hash
      `,
      [userId]
    );

    await client.query("COMMIT");
    return row.rows[0]!;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  }
}

export async function deleteWmsUser(
  client: PoolClient,
  siteId: number,
  userIdRaw: string
) {
  const userId = userIdRaw.trim();
  if (!userId) throw new WmsHttpError(400, "userId is required", "bad_user_id");

  const existing = await client.query<{ userId: string; login: string; isAdmin: boolean }>(
    `
    SELECT
      u.user_id::text AS "userId",
      u.login,
      EXISTS (
        SELECT 1
        FROM wms_user_roles ur
        JOIN wms_roles r ON r.role_id = ur.role_id
        WHERE ur.user_id = u.user_id AND r.code = 'admin'
      ) AS "isAdmin"
    FROM wms_users u
    WHERE u.site_id = $1 AND u.user_id = $2::bigint AND u.is_active
    `,
    [siteId, userId]
  );
  const row = existing.rows[0];
  if (!row) throw new WmsHttpError(404, "user not found", "user_not_found");

  if (row.isAdmin) {
    const admins = await client.query<{ count: string }>(
      `
      SELECT COUNT(DISTINCT u.user_id)::text AS count
      FROM wms_users u
      JOIN wms_user_roles ur ON ur.user_id = u.user_id
      JOIN wms_roles r ON r.role_id = ur.role_id
      WHERE u.site_id = $1 AND u.is_active AND r.code = 'admin'
      `,
      [siteId]
    );
    if (Number(admins.rows[0]?.count ?? 0) <= 1) {
      throw new WmsHttpError(409, "cannot delete last active admin", "last_admin");
    }
  }

  await client.query("BEGIN");
  try {
    await client.query(
      `UPDATE wms_devices
       SET assigned_user_id = NULL
       WHERE site_id = $1 AND assigned_user_id = $2::bigint`,
      [siteId, userId]
    );
    await client.query(`DELETE FROM wms_user_roles WHERE user_id = $1::bigint`, [userId]);
    await client.query(
      `
      UPDATE wms_users
      SET
        login = CONCAT(login, '.deleted.', user_id::text),
        display_name = CONCAT(display_name, ' (удалён)'),
        password_hash = NULL,
        is_active = FALSE
      WHERE site_id = $1 AND user_id = $2::bigint
      `,
      [siteId, userId]
    );
    await client.query("COMMIT");
    return { ok: true, deletedUserId: userId };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  }
}
