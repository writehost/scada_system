import type { PoolClient } from "pg";
import { WmsHttpError } from "@/lib/wms/errors";

export type RegisterWmsDeviceInput = {
  deviceUid: string;
  deviceName: string;
  platform?: string;
  appVersion?: string;
  deviceInfo?: Record<string, unknown>;
};

const LIST_DEVICES_SELECT_DEVICE_INFO = `d.device_info_json AS "deviceInfo"`;
const LIST_DEVICES_SELECT_NO_DEVICE_INFO = `NULL::jsonb AS "deviceInfo"`;

const lastSeenTouchAt = new Map<string, number>()
const LAST_SEEN_TOUCH_MS = 45_000

function isVirtualDeviceUid(deviceUid: string): boolean {
  const n = deviceUid.trim().toLowerCase()
  return !n || n === "web-operator" || n === "веб-интерфейс"
}

/** Отметка «терминал на связи» без ошибки, не чаще раза в 45 секунд. */
export async function touchDeviceLastSeenQuiet(
  client: PoolClient,
  siteId: number,
  deviceUid: string | null | undefined
) {
  const uid = (deviceUid || "").trim()
  if (isVirtualDeviceUid(uid)) return
  const key = `${siteId}:${uid}`
  const now = Date.now()
  if ((lastSeenTouchAt.get(key) || 0) > now - LAST_SEEN_TOUCH_MS) return
  lastSeenTouchAt.set(key, now)
  try {
    await client.query(
      `UPDATE wms_devices SET last_seen_at = now() WHERE site_id = $1 AND device_uid = $2`,
      [siteId, uid]
    )
  } catch {
    lastSeenTouchAt.delete(key)
  }
}

export async function listWmsDevices(
  client: PoolClient,
  siteId: number,
  options?: {
    query?: string;
    status?: string;
  }
) {
  const query = options?.query?.trim() ?? "";
  const status = options?.status?.trim() ?? "";

  const sql = (deviceInfoExpr: string) =>
    `SELECT
       d.device_id::text AS "deviceId",
       d.device_uid AS "deviceUid",
       d.device_name AS "deviceName",
       d.platform AS "platform",
       d.app_version AS "appVersion",
       ${deviceInfoExpr},
       s.code AS "deviceStatus",
       d.assigned_user_id::text AS "assignedUserId",
       u.display_name AS "assignedUser",
       GREATEST(
         d.last_seen_at,
         (
           SELECT max(dt.last_used_at)
           FROM wms_device_tokens dt
           WHERE dt.site_id = d.site_id
             AND dt.device_uid = d.device_uid
             AND dt.revoked_at IS NULL
         )
       ) AS "lastSeenAt",
       COUNT(*) FILTER (WHERE ts.code = 'open')::int AS "openTaskCount",
       COUNT(*) FILTER (WHERE ts.code IN ('claimed', 'in_progress', 'on_hold'))::int AS "activeTaskCount",
       COUNT(*) FILTER (WHERE ts.code = 'exception')::int AS "exceptionTaskCount",
       COUNT(*) FILTER (WHERE ts.code = 'completed')::int AS "completedTaskCount",
       COUNT(*) FILTER (WHERE ts.code NOT IN ('completed', 'cancelled'))::int AS "liveTaskCount",
       COUNT(t.task_id)::int AS "totalTaskCount",
       COALESCE((
         SELECT json_agg(x ORDER BY x.ord)
         FROM (
           SELECT
             t2.task_id::text AS "taskId",
             t2.task_code AS "taskCode",
             tt2.code AS "taskType",
             ts2.code AS "taskStatus",
             i2.name AS "itemName",
             row_number() OVER (ORDER BY t2.task_id DESC) AS ord
           FROM wms_tasks t2
           JOIN ref_wms_task_status ts2 ON ts2.task_status_id = t2.task_status_id
           JOIN ref_wms_task_type tt2 ON tt2.task_type_id = t2.task_type_id
           LEFT JOIN wms_items i2 ON i2.item_id = t2.item_id
           WHERE t2.site_id = d.site_id
             AND ts2.code NOT IN ('completed', 'cancelled')
             AND (
               t2.assigned_device_id = d.device_id
               OR (d.assigned_user_id IS NOT NULL AND t2.assigned_user_id = d.assigned_user_id)
             )
           ORDER BY t2.task_id DESC
           LIMIT 5
         ) x
       ), '[]'::json) AS "previewTasks"
     FROM wms_devices d
     JOIN ref_wms_device_status s ON s.device_status_id = d.device_status_id
     LEFT JOIN wms_users u ON u.user_id = d.assigned_user_id
     LEFT JOIN wms_tasks t ON t.site_id = d.site_id
       AND (
         t.assigned_device_id = d.device_id
         OR (d.assigned_user_id IS NOT NULL AND t.assigned_user_id = d.assigned_user_id)
       )
     LEFT JOIN ref_wms_task_status ts ON ts.task_status_id = t.task_status_id
     WHERE d.site_id = $1
       AND lower(d.device_uid) NOT IN ('web-operator')
       AND ($2::text = '' OR s.code = $2)
       AND (
         $3::text = ''
         OR d.device_uid ILIKE $4
         OR d.device_name ILIKE $4
         OR COALESCE(d.platform, '') ILIKE $4
         OR COALESCE(d.app_version, '') ILIKE $4
       )
     GROUP BY d.device_id, s.code, u.display_name
     ORDER BY GREATEST(
       d.last_seen_at,
       (
         SELECT max(dt.last_used_at)
         FROM wms_device_tokens dt
         WHERE dt.site_id = d.site_id
           AND dt.device_uid = d.device_uid
           AND dt.revoked_at IS NULL
       )
     ) DESC NULLS LAST, d.device_name, d.device_uid`;

  const params = [siteId, status, query, `%${query}%`] as const;

  try {
    const r = await client.query(sql(LIST_DEVICES_SELECT_DEVICE_INFO), [...params]);
    return { devices: mapDeviceRows(r.rows) };
  } catch (e) {
    const code = typeof (e as { code?: string })?.code === "string" ? (e as { code: string }).code : "";
    // Старые БД без колонки device_info_json или таблицы токенов
    if (code === "42703") {
      const r = await client.query(sql(LIST_DEVICES_SELECT_NO_DEVICE_INFO), [...params]);
      return { devices: mapDeviceRows(r.rows) };
    }
    throw e;
  }
}

function mapDeviceRows(rows: Array<Record<string, unknown>>) {
  return rows.map((row) => {
    let preview = row.previewTasks
    if (typeof preview === "string") {
      try {
        preview = JSON.parse(preview)
      } catch {
        preview = []
      }
    }
    return { ...row, previewTasks: Array.isArray(preview) ? preview : [] }
  })
}

export async function resolveDeviceByUid(
  client: PoolClient,
  siteId: number,
  deviceUid: string
): Promise<{
  deviceId: string;
  deviceUid: string;
  deviceName: string;
  platform: string | null;
  appVersion: string | null;
  deviceStatus: string;
  lastSeenAt: string | null;
} | null> {
  const trimmedUid = deviceUid.trim();
  if (!trimmedUid) return null;
  const sql = (deviceInfoExpr: string) =>
    `SELECT
       d.device_id::text AS "deviceId",
       d.device_uid AS "deviceUid",
       d.device_name AS "deviceName",
       d.platform AS "platform",
       d.app_version AS "appVersion",
       ${deviceInfoExpr},
       s.code AS "deviceStatus",
       d.last_seen_at AS "lastSeenAt"
     FROM wms_devices d
     JOIN ref_wms_device_status s ON s.device_status_id = d.device_status_id
     WHERE d.site_id = $1 AND d.device_uid = $2`;

  const savepointName = "sp_resolve_device_uid";
  let hasSavepoint = false;
  try {
    await client.query(`SAVEPOINT ${savepointName}`);
    hasSavepoint = true;
  } catch (e) {
    const code = typeof (e as { code?: string })?.code === "string" ? (e as { code: string }).code : "";
    // 25P01 = outside transaction block; в этом случае просто работаем без savepoint.
    if (code !== "25P01") throw e;
  }
  try {
    const r = await client.query(sql(`d.device_info_json AS "deviceInfo"`), [siteId, trimmedUid]);
    if (hasSavepoint) await client.query(`RELEASE SAVEPOINT ${savepointName}`);
    return r.rows[0] ?? null;
  } catch (e) {
    const code = typeof (e as { code?: string })?.code === "string" ? (e as { code: string }).code : "";
    if (code === "42703") {
      // Внутри транзакции ошибка 42703 помечает txn как failed; откатываемся к savepoint и пробуем legacy SQL.
      if (hasSavepoint) await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
      const r = await client.query(sql(`NULL::jsonb AS "deviceInfo"`), [siteId, trimmedUid]);
      if (hasSavepoint) await client.query(`RELEASE SAVEPOINT ${savepointName}`);
      return r.rows[0] ?? null;
    }
    if (hasSavepoint) {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
      await client.query(`RELEASE SAVEPOINT ${savepointName}`);
    }
    throw e;
  }
}

/** Виртуальные устройства для операций из веб-интерфейса (не ТСД). */
const VIRTUAL_DEVICE_UIDS: Record<string, RegisterWmsDeviceInput> = {
  "web-operator": {
    deviceUid: "web-operator",
    deviceName: "Веб-интерфейс WMS",
    platform: "web",
    appVersion: "wms-web",
  },
};

/** Канонический UID для проведения/закрытия с веб-интерфейса. */
export const WEB_OPERATOR_DEVICE_UID = "web-operator";

const WEB_OPERATOR_ALIASES = new Set([
  "web-operator",
  "web_operator",
  "weboperator",
  "веб-интерфейс",
  "веб",
  "web",
]);

/** Приводит псевдонимы веб-оператора к `web-operator`. */
export function normalizeOperatorDeviceUid(deviceUid: string): string {
  const trimmed = deviceUid.trim();
  if (!trimmed) return WEB_OPERATOR_DEVICE_UID;
  if (WEB_OPERATOR_ALIASES.has(trimmed.toLowerCase())) return WEB_OPERATOR_DEVICE_UID;
  return trimmed;
}

async function ensureVirtualDevice(
  client: PoolClient,
  siteId: number,
  deviceUid: string
): Promise<boolean> {
  const normalized = normalizeOperatorDeviceUid(deviceUid);
  const spec = VIRTUAL_DEVICE_UIDS[normalized.toLowerCase()];
  if (!spec) return false;
  await registerWmsDevice(client, siteId, spec);
  return true;
}

export async function requireDeviceByUid(
  client: PoolClient,
  siteId: number,
  deviceUid: string
) {
  const trimmedUid = normalizeOperatorDeviceUid(deviceUid);
  let device = await resolveDeviceByUid(client, siteId, trimmedUid);
  if (!device && trimmedUid) {
    const created = await ensureVirtualDevice(client, siteId, trimmedUid);
    if (created) {
      device = await resolveDeviceByUid(client, siteId, trimmedUid);
    }
  }
  if (!device) {
    throw new WmsHttpError(404, `device not found: ${trimmedUid}`, "device_not_found");
  }
  return device;
}

export async function registerWmsDevice(
  client: PoolClient,
  siteId: number,
  input: RegisterWmsDeviceInput
) {
  const deviceUid = input.deviceUid.trim();
  const deviceName = input.deviceName.trim();
  if (!deviceUid) {
    throw new WmsHttpError(400, "deviceUid is required", "bad_device_uid");
  }
  if (!deviceName) {
    throw new WmsHttpError(400, "deviceName is required", "bad_device_name");
  }

  const payload = input.deviceInfo ? JSON.stringify(input.deviceInfo) : null;

  const insertWithInfo = async () =>
    client.query(
      `INSERT INTO wms_devices (
         site_id, device_uid, device_name, platform, app_version, device_info_json, last_seen_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6::jsonb, now()
       )
       ON CONFLICT (device_uid)
       DO UPDATE SET
         site_id = EXCLUDED.site_id,
         device_name = EXCLUDED.device_name,
         platform = COALESCE(EXCLUDED.platform, wms_devices.platform),
         app_version = COALESCE(EXCLUDED.app_version, wms_devices.app_version),
         device_info_json = COALESCE(wms_devices.device_info_json, '{}'::jsonb)
           || COALESCE(EXCLUDED.device_info_json, '{}'::jsonb),
         last_seen_at = now()
       RETURNING
         device_id::text AS "deviceId",
         device_uid AS "deviceUid",
         device_name AS "deviceName",
         platform AS "platform",
         app_version AS "appVersion",
         device_info_json AS "deviceInfo",
         last_seen_at AS "lastSeenAt",
         (
           SELECT code
           FROM ref_wms_device_status s
           WHERE s.device_status_id = wms_devices.device_status_id
         ) AS "deviceStatus"`,
      [siteId, deviceUid, deviceName, input.platform?.trim() || null, input.appVersion?.trim() || null, payload]
    );

  const insertLegacy = async () =>
    client.query(
      `INSERT INTO wms_devices (
         site_id, device_uid, device_name, platform, app_version, last_seen_at
       ) VALUES (
         $1, $2, $3, $4, $5, now()
       )
       ON CONFLICT (device_uid)
       DO UPDATE SET
         site_id = EXCLUDED.site_id,
         device_name = EXCLUDED.device_name,
         platform = COALESCE(EXCLUDED.platform, wms_devices.platform),
         app_version = COALESCE(EXCLUDED.app_version, wms_devices.app_version),
         last_seen_at = now()
       RETURNING
         device_id::text AS "deviceId",
         device_uid AS "deviceUid",
         device_name AS "deviceName",
         platform AS "platform",
         app_version AS "appVersion",
         NULL::jsonb AS "deviceInfo",
         last_seen_at AS "lastSeenAt",
         (
           SELECT code
           FROM ref_wms_device_status s
           WHERE s.device_status_id = wms_devices.device_status_id
         ) AS "deviceStatus"`,
      [siteId, deviceUid, deviceName, input.platform?.trim() || null, input.appVersion?.trim() || null]
    );

  try {
    const r = await insertWithInfo();
    return r.rows[0]!;
  } catch (e) {
    const code = typeof (e as { code?: string })?.code === "string" ? (e as { code: string }).code : "";
    if (code === "42703") {
      const r = await insertLegacy();
      return r.rows[0]!;
    }
    throw e;
  }
}

export async function deleteWmsDeviceById(
  client: PoolClient,
  siteId: number,
  deviceId: string
) {
  await client.query("BEGIN");
  try {
    const check = await client.query<{ ok: number }>(
      `SELECT 1 AS ok FROM wms_devices WHERE site_id = $1 AND device_id = $2::bigint`,
      [siteId, deviceId]
    );
    if (check.rows.length === 0) {
      await client.query("ROLLBACK");
      throw new WmsHttpError(404, "device not found", "device_not_found");
    }

    await client.query(
      `UPDATE wms_tasks SET assigned_device_id = NULL WHERE site_id = $1 AND assigned_device_id = $2::bigint`,
      [siteId, deviceId]
    );
    await client.query(
      `UPDATE wms_documents SET device_id = NULL WHERE site_id = $1 AND device_id = $2::bigint`,
      [siteId, deviceId]
    );
    await client.query(
      `UPDATE wms_stock_movements SET device_id = NULL WHERE site_id = $1 AND device_id = $2::bigint`,
      [siteId, deviceId]
    );
    await client.query(
      `UPDATE wms_request_log SET device_id = NULL WHERE site_id = $1 AND device_id = $2::bigint`,
      [siteId, deviceId]
    );

    await client.query(
      `DELETE FROM wms_devices WHERE site_id = $1 AND device_id = $2::bigint`,
      [siteId, deviceId]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  }
}

export async function touchWmsDevice(
  client: PoolClient,
  siteId: number,
  deviceUid: string
) {
  const device = await requireDeviceByUid(client, siteId, deviceUid);
  await client.query(
    `UPDATE wms_devices
     SET last_seen_at = now()
     WHERE site_id = $1 AND device_id = $2::bigint`,
    [siteId, device.deviceId]
  );
  return {
    ...device,
    lastSeenAt: new Date().toISOString(),
  };
}

export async function assignWmsDeviceUser(
  client: PoolClient,
  siteId: number,
  deviceId: string,
  assignedUserId?: string | null
) {
  const normalizedDeviceId = deviceId.trim();
  if (!normalizedDeviceId) {
    throw new WmsHttpError(400, "deviceId is required", "bad_device_id");
  }

  const normalizedUserId = (assignedUserId ?? "").trim();
  if (normalizedUserId) {
    const userCheck = await client.query(
      `SELECT 1
       FROM wms_users u
       WHERE u.site_id = $1 AND u.user_id = $2::bigint`,
      [siteId, normalizedUserId]
    );
    if (userCheck.rows.length === 0) {
      throw new WmsHttpError(404, "user not found", "user_not_found");
    }
  }

  const updated = await client.query<{
    deviceId: string;
    deviceUid: string;
    assignedUserId: string | null;
    assignedUser: string | null;
  }>(
    `UPDATE wms_devices d
     SET assigned_user_id = CASE
       WHEN $3::text = '' THEN NULL
       ELSE $3::bigint
     END
     WHERE d.site_id = $1
       AND d.device_id = $2::bigint
     RETURNING
       d.device_id::text AS "deviceId",
       d.device_uid AS "deviceUid",
       d.assigned_user_id::text AS "assignedUserId",
       (
         SELECT u.display_name
         FROM wms_users u
         WHERE u.user_id = d.assigned_user_id
       ) AS "assignedUser"`,
    [siteId, normalizedDeviceId, normalizedUserId]
  );

  if (updated.rows.length === 0) {
    throw new WmsHttpError(404, "device not found", "device_not_found");
  }

  return updated.rows[0]!;
}
