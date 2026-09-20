import type { PoolClient } from "pg";
import { WmsHttpError } from "@/lib/wms/errors";

/** Совпадает с `wms_roles.code` и мобильной матрицей в `web/interface/lib/mobile-permissions.ts` */
const TASKS_ROLE_CODES = new Set([
  "admin",
  "warehouse_manager",
  "warehouse_operator",
  "line_operator",
]);

const REVISION_ROLE_CODES = new Set([
  "admin",
  "warehouse_manager",
  "warehouse_operator",
  "auditor",
]);

export function isRevisionTaskType(taskTypeCode: string): boolean {
  return taskTypeCode.trim().toLowerCase() === "revision";
}

export function roleCodesAllowTaskType(roleCodes: string[], taskTypeCode: string): boolean {
  if (isRevisionTaskType(taskTypeCode)) {
    return roleCodes.some((c) => REVISION_ROLE_CODES.has(c));
  }
  return roleCodes.some((c) => TASKS_ROLE_CODES.has(c));
}

export type DeviceOperatorAuth =
  | { kind: "none" }
  | { kind: "resolved"; operatorUserId: string; roleCodes: string[] };

export async function resolveDeviceOperatorAuth(
  client: PoolClient,
  siteId: number,
  deviceUid: string,
  operatorUserIdFromRequest?: string | null
): Promise<DeviceOperatorAuth> {
  const explicit = operatorUserIdFromRequest?.trim() || "";
  const dev = await client.query<{ assigned_user_id: string | null }>(
    `SELECT assigned_user_id::text AS assigned_user_id
     FROM wms_devices
     WHERE site_id = $1 AND device_uid = $2`,
    [siteId, deviceUid.trim()]
  );
  const assigned = dev.rows[0]?.assigned_user_id?.trim() || "";
  const targetUserId = explicit || assigned;
  if (!targetUserId) return { kind: "none" };

  const ur = await client.query<{ ok: boolean }>(
    `SELECT TRUE AS ok FROM wms_users WHERE site_id = $1 AND user_id = $2::bigint AND is_active`,
    [siteId, targetUserId]
  );
  if (ur.rows.length === 0) {
    throw new WmsHttpError(403, "оператор не найден на этой площадке", "operator_invalid");
  }

  const rr = await client.query<{ code: string }>(
    `SELECT r.code
     FROM wms_user_roles ur
     JOIN wms_roles r ON r.role_id = ur.role_id
     WHERE ur.user_id = $1::bigint
     ORDER BY r.code`,
    [targetUserId]
  );
  return {
    kind: "resolved",
    operatorUserId: targetUserId,
    roleCodes: rr.rows.map((x) => x.code),
  };
}

export function assertResolvedOperatorHasRoles(auth: DeviceOperatorAuth): asserts auth is {
  kind: "resolved";
  operatorUserId: string;
  roleCodes: string[];
} {
  if (auth.kind !== "resolved") {
    throw new WmsHttpError(
      403,
      "Выберите оператора на экране синхронизации или назначьте пользователя устройству.",
      "operator_required"
    );
  }
  if (auth.roleCodes.length === 0) {
    throw new WmsHttpError(403, "У оператора нет ролей WMS.", "no_roles");
  }
}

export type TaskDeviceRow = {
  taskTypeCode: string;
  assignedDeviceId: string | null;
  deviceId: string;
};

/** Одна строка: задача + тип + устройство по UID */
export async function loadTaskRowForDevice(
  client: PoolClient,
  siteId: number,
  taskId: string,
  deviceUid: string
): Promise<TaskDeviceRow | null> {
  const r = await client.query<{
    task_type_code: string;
    assigned_device_id: string | null;
    device_id: string;
  }>(
    `SELECT
       tt.code AS task_type_code,
       t.assigned_device_id::text AS assigned_device_id,
       d.device_id::text AS device_id
     FROM wms_tasks t
     JOIN ref_wms_task_type tt ON tt.task_type_id = t.task_type_id
     JOIN wms_devices d ON d.site_id = t.site_id AND d.device_uid = $3
     WHERE t.site_id = $1 AND t.task_id = $2::bigint`,
    [siteId, taskId, deviceUid.trim()]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    taskTypeCode: row.task_type_code,
    assignedDeviceId: row.assigned_device_id,
    deviceId: row.device_id,
  };
}

export function filterTasksByRoleCodes<T extends { taskType: string }>(
  tasks: T[],
  roleCodes: string[]
): T[] {
  return tasks.filter((t) => roleCodesAllowTaskType(roleCodes, t.taskType));
}

/** Мутации устройства: оператор и роли обязательны */
export async function assertOperatorMutationAllowed(
  client: PoolClient,
  siteId: number,
  deviceUid: string,
  operatorUserIdFromRequest: string | undefined | null
): Promise<{ operatorUserId: string; roleCodes: string[] }> {
  const auth = await resolveDeviceOperatorAuth(client, siteId, deviceUid, operatorUserIdFromRequest);
  assertResolvedOperatorHasRoles(auth);
  return { operatorUserId: auth.operatorUserId, roleCodes: auth.roleCodes };
}

export function assertTaskTypeAllowedForRoles(roleCodes: string[], taskTypeCode: string): void {
  if (!roleCodesAllowTaskType(roleCodes, taskTypeCode)) {
    throw new WmsHttpError(403, "Недостаточно прав для этого типа задачи", "forbidden_task_type");
  }
}

/**
 * Claim: тип задачи проверяем; устройство может назначаться при взятии — не требуем совпадения assigned_device.
 */
export async function assertDeviceClaimAllowed(
  client: PoolClient,
  siteId: number,
  deviceUid: string,
  operatorUserIdFromRequest: string | undefined | null,
  taskId: string
): Promise<void> {
  const { roleCodes } = await assertOperatorMutationAllowed(
    client,
    siteId,
    deviceUid,
    operatorUserIdFromRequest
  );
  const row = await loadTaskRowForDevice(client, siteId, taskId, deviceUid);
  if (!row) throw new WmsHttpError(404, "task not found", "task_not_found");
  assertTaskTypeAllowedForRoles(roleCodes, row.taskTypeCode);
}

export async function assertDeviceTaskReadAllowed(
  client: PoolClient,
  siteId: number,
  deviceUid: string,
  operatorUserIdFromRequest: string | undefined | null,
  taskId: string
): Promise<void> {
  const row = await loadTaskRowForDevice(client, siteId, taskId, deviceUid);
  if (!row) throw new WmsHttpError(404, "task not found", "task_not_found");
  if (row.assignedDeviceId && row.assignedDeviceId !== row.deviceId) {
    throw new WmsHttpError(403, "Задача назначена на другое устройство", "wrong_device");
  }
  const auth = await resolveDeviceOperatorAuth(client, siteId, deviceUid, operatorUserIdFromRequest);
  if (auth.kind === "none") return;
  if (auth.roleCodes.length === 0) {
    throw new WmsHttpError(403, "У оператора нет ролей WMS.", "no_roles");
  }
  assertTaskTypeAllowedForRoles(auth.roleCodes, row.taskTypeCode);
}

export async function assertDeviceMutationAllowed(
  client: PoolClient,
  siteId: number,
  deviceUid: string,
  operatorUserIdFromRequest: string | undefined | null,
  taskId: string
): Promise<void> {
  const row = await loadTaskRowForDevice(client, siteId, taskId, deviceUid);
  if (!row) throw new WmsHttpError(404, "task not found", "task_not_found");
  if (row.assignedDeviceId !== row.deviceId) {
    throw new WmsHttpError(409, "task is assigned to another device", "wrong_device");
  }
  const auth = await resolveDeviceOperatorAuth(client, siteId, deviceUid, operatorUserIdFromRequest);
  if (auth.kind === "none") {
    // Диспетчер уже назначил задание на этот ТСД — не блокируем старт/скан из‑за смены.
    return;
  }
  if (auth.roleCodes.length === 0) {
    throw new WmsHttpError(403, "У оператора нет ролей WMS.", "no_roles");
  }
  assertTaskTypeAllowedForRoles(auth.roleCodes, row.taskTypeCode);
}

/**
 * Чтение документа с ТСД: оператор и роли обязательны.
 * Доступ: либо передан `taskId` и это задание текущего терминала с тем же document_id,
 * либо на терминале есть задачи по этому документу и хотя бы один тип задачи разрешён ролями.
 */
export async function assertDeviceMayReadDocument(
  client: PoolClient,
  siteId: number,
  deviceUid: string,
  operatorUserIdFromRequest: string | undefined | null,
  documentId: string,
  taskIdFromRequest?: string | null
): Promise<void> {
  const { roleCodes } = await assertOperatorMutationAllowed(
    client,
    siteId,
    deviceUid,
    operatorUserIdFromRequest
  );

  const docHead = await client.query(
    `SELECT 1 FROM wms_documents WHERE site_id = $1 AND document_id = $2::bigint`,
    [siteId, documentId]
  );
  if (docHead.rows.length === 0) {
    throw new WmsHttpError(404, "document not found", "document_not_found");
  }

  const trimTask = taskIdFromRequest?.trim();
  if (trimTask) {
    const trow = await client.query<{ document_id: string | null }>(
      `SELECT document_id::text AS document_id FROM wms_tasks WHERE site_id = $1 AND task_id = $2::bigint`,
      [siteId, trimTask]
    );
    const docOnTask = trow.rows[0]?.document_id;
    if (!docOnTask || docOnTask !== documentId) {
      throw new WmsHttpError(403, "Задание не относится к этому документу", "task_document_mismatch");
    }
    await assertDeviceTaskReadAllowed(client, siteId, deviceUid, operatorUserIdFromRequest, trimTask);
    return;
  }

  const dev = await client.query<{ device_id: string }>(
    `SELECT device_id::text AS device_id FROM wms_devices WHERE site_id = $1 AND device_uid = $2`,
    [siteId, deviceUid.trim()]
  );
  const deviceDbId = dev.rows[0]?.device_id;
  if (!deviceDbId) {
    throw new WmsHttpError(404, "device not found", "device_not_found");
  }

  const types = await client.query<{ code: string }>(
    `SELECT DISTINCT tt.code
     FROM wms_tasks t
     JOIN ref_wms_task_type tt ON tt.task_type_id = t.task_type_id
     WHERE t.site_id = $1
       AND t.document_id = $2::bigint
       AND t.assigned_device_id = $3::bigint`,
    [siteId, documentId, deviceDbId]
  );
  if (types.rows.length === 0) {
    throw new WmsHttpError(
      403,
      "Нет задач этого документа на вашем терминале. Откройте документ из карточки задания.",
      "document_not_on_device"
    );
  }
  const allowed = types.rows.some((r) => roleCodesAllowTaskType(roleCodes, r.code));
  if (!allowed) {
    throw new WmsHttpError(
      403,
      "Недостаточно прав для документов с этими типами задач",
      "forbidden_document"
    );
  }
}
