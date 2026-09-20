import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { guardDeviceRequest } from "@/lib/wms/device-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  const deviceUid = url.searchParams.get("deviceUid") ?? "";
  /** Явный выбор оператора на ТСД (localStorage), иначе берём assigned_user_id устройства */
  const operatorUserId = url.searchParams.get("operatorUserId") ?? "";

  if (!siteCode.trim() || !deviceUid.trim()) {
    return NextResponse.json({ error: "siteCode and deviceUid are required" }, { status: 400 });
  }
  const deviceAuthError = await guardDeviceRequest(req, { siteCode, deviceUid });
  if (deviceAuthError) return deviceAuthError;

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const dev = await client.query<{
      deviceId: string;
      deviceUid: string;
      deviceName: string;
      platform: string | null;
      appVersion: string | null;
      deviceStatus: string;
      lastSeenAt: string | null;
      assignedUserId: string | null;
      deviceInfo: Record<string, unknown> | null;
    }>(
      `SELECT
         d.device_id::text AS "deviceId",
         d.device_uid AS "deviceUid",
         d.device_name AS "deviceName",
         d.platform AS "platform",
         d.app_version AS "appVersion",
         rs.code AS "deviceStatus",
         d.last_seen_at AS "lastSeenAt",
         d.assigned_user_id::text AS "assignedUserId",
         d.device_info_json AS "deviceInfo"
       FROM wms_devices d
       JOIN ref_wms_device_status rs ON rs.device_status_id = d.device_status_id
       WHERE d.site_id = $1 AND d.device_uid = $2`,
      [siteId, deviceUid.trim()]
    );

    if (dev.rows.length === 0) {
      return NextResponse.json({ error: "device not found", code: "device_not_found" }, { status: 404 });
    }

    const device = dev.rows[0]!;

    const targetUserId =
      operatorUserId.trim().length > 0 ? operatorUserId.trim() : device.assignedUserId;

    let operator: {
      userId: string;
      login: string;
      displayName: string;
      externalCode: string | null;
      phone: string | null;
      isActive: boolean;
      roles: { code: string; name: string }[];
    } | null = null;

    if (targetUserId) {
      const ur = await client.query<{
        userId: string;
        login: string;
        displayName: string;
        externalCode: string | null;
        phone: string | null;
        isActive: boolean;
      }>(
        `
        SELECT
          u.user_id::text AS "userId",
          u.login,
          u.display_name AS "displayName",
          u.external_code AS "externalCode",
          u.phone,
          u.is_active AS "isActive"
        FROM wms_users u
        WHERE u.site_id = $1 AND u.user_id = $2::bigint
        `,
        [siteId, targetUserId]
      );
      if (ur.rows.length > 0) {
        const row = ur.rows[0]!;
        const rr = await client.query<{ code: string; name: string }>(
          `
          SELECT r.code, r.name
          FROM wms_user_roles ur
          JOIN wms_roles r ON r.role_id = ur.role_id
          WHERE ur.user_id = $1::bigint
          ORDER BY r.code
          `,
          [targetUserId]
        );
        operator = {
          userId: row.userId,
          login: row.login,
          displayName: row.displayName,
          externalCode: row.externalCode,
          phone: row.phone,
          isActive: row.isActive,
          roles: rr.rows.map((x) => ({ code: x.code, name: x.name })),
        };
      }
    }

    return NextResponse.json({
      siteCode: siteCode.trim(),
      device,
      assignedUserId: device.assignedUserId,
      operatorUserId: targetUserId || null,
      operator,
      hint:
        !operator && !targetUserId
          ? "Устройству не назначен пользователь. Назначьте оператора в веб-интерфейсе устройств или выберите себя при синхронизации."
          : !operator && targetUserId
            ? "Пользователь не найден или не относится к этому складу."
            : null,
    });
  } finally {
    client.release();
  }
}
