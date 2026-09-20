import type { PoolClient } from "pg";
import { WmsHttpError } from "@/lib/wms/errors";

const ADMIN_ROLE = "admin";

const PERMISSIONS: Array<{ code: string; name: string }> = [
  { code: "wms.stock.receive", name: "Приёмка на остаток" },
  { code: "wms.stock.issue", name: "Выдача со склада" },
  { code: "wms.stock.transfer", name: "Перемещение" },
  { code: "wms.stock.adjust", name: "Корректировка остатка" },
  { code: "wms.items.read", name: "Чтение номенклатуры" },
  { code: "wms.items.write", name: "Изменение номенклатуры" },
  { code: "wms.tasks.claim", name: "Взятие и выполнение заданий" },
  { code: "wms.audit.read", name: "Просмотр аудита" },
];

/** Какие права у роли, кроме admin (admin проходит по коду роли). */
const ROLE_PERMISSIONS: Record<string, string[]> = {
  warehouse_manager: [
    "wms.stock.receive",
    "wms.stock.issue",
    "wms.stock.transfer",
    "wms.stock.adjust",
    "wms.items.read",
    "wms.items.write",
    "wms.tasks.claim",
    "wms.audit.read",
  ],
  warehouse_operator: [
    "wms.stock.receive",
    "wms.stock.issue",
    "wms.stock.transfer",
    "wms.items.read",
    "wms.tasks.claim",
  ],
  line_operator: ["wms.stock.receive", "wms.items.read", "wms.tasks.claim"],
  auditor: ["wms.items.read", "wms.tasks.claim", "wms.audit.read"],
};

let schemaReady = false;

/** Создаёт RBAC-таблицы и заполняет справочник, если их ещё нет. */
export async function ensureWmsPermissionsSchema(client: PoolClient): Promise<boolean> {
  if (schemaReady) return true;
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_permissions (
      permission_id SMALLSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_role_permissions (
      role_id SMALLINT NOT NULL REFERENCES wms_roles(role_id) ON DELETE CASCADE,
      permission_id SMALLINT NOT NULL REFERENCES wms_permissions(permission_id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_id)
    )
  `);
  for (const perm of PERMISSIONS) {
    await client.query(
      `INSERT INTO wms_permissions (code, name) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
      [perm.code, perm.name]
    );
  }
  for (const [roleCode, codes] of Object.entries(ROLE_PERMISSIONS)) {
    await client.query(
      `INSERT INTO wms_role_permissions (role_id, permission_id)
       SELECT r.role_id, p.permission_id
       FROM wms_roles r
       JOIN wms_permissions p ON p.code = ANY($2::text[])
       WHERE r.code = $1
       ON CONFLICT DO NOTHING`,
      [roleCode, codes]
    );
  }
  schemaReady = true;
  return true;
}

async function resolveUserId(
  client: PoolClient,
  userId: string | null | undefined,
  login?: string | null
): Promise<string> {
  const uid = userId?.trim() || "";
  if (uid) return uid;
  const name = login?.trim() || "";
  if (!name) return "";
  const r = await client.query<{ user_id: string }>(
    `SELECT user_id::text AS user_id
     FROM wms_users
     WHERE lower(login) = lower($1)
     LIMIT 1`,
    [name]
  );
  return r.rows[0]?.user_id ?? "";
}

export async function userHasWmsPermission(
  client: PoolClient,
  userId: string,
  permissionCode: string
): Promise<boolean> {
  const hasTable = await ensureWmsPermissionsSchema(client);
  if (!hasTable) return true;

  const r = await client.query<{ ok: boolean }>(
    `SELECT TRUE AS ok
     FROM wms_user_roles ur
     JOIN wms_roles r ON r.role_id = ur.role_id
     LEFT JOIN wms_role_permissions rp ON rp.role_id = r.role_id
     LEFT JOIN wms_permissions p ON p.permission_id = rp.permission_id
     WHERE ur.user_id = $1::bigint
       AND (r.code = $2 OR p.code = $3)
     LIMIT 1`,
    [userId, ADMIN_ROLE, permissionCode]
  );
  return r.rows.length > 0;
}

export async function requireWmsPermission(
  client: PoolClient,
  userId: string | null | undefined,
  permissionCode: string,
  login?: string | null
) {
  await ensureWmsPermissionsSchema(client);
  const uid = await resolveUserId(client, userId, login);
  if (!uid) {
    throw new WmsHttpError(403, "требуется авторизованный пользователь", "permission_denied");
  }
  const ok = await userHasWmsPermission(client, uid, permissionCode);
  if (!ok) {
    throw new WmsHttpError(
      403,
      `недостаточно прав: ${permissionCode}`,
      "permission_denied"
    );
  }
}

export const WMS_PERMISSION = {
  stockReceive: "wms.stock.receive",
  stockIssue: "wms.stock.issue",
  stockTransfer: "wms.stock.transfer",
  stockAdjust: "wms.stock.adjust",
  itemsRead: "wms.items.read",
  itemsWrite: "wms.items.write",
  tasksClaim: "wms.tasks.claim",
  auditRead: "wms.audit.read",
} as const;
