import type { PoolClient } from "pg";
import { WmsHttpError } from "@/lib/wms/errors";
import { requireDeviceByUid, touchWmsDevice } from "@/lib/wms/devices";

export type SupportSessionStatus = "pending" | "active" | "declined" | "ended" | "expired";

export type SupportSessionRow = {
  sessionId: string;
  deviceUid: string;
  deviceId: string;
  status: SupportSessionStatus;
  requestedBy: string | null;
  requestedAt: string;
  acceptedAt: string | null;
  endedAt: string | null;
  expiresAt: string;
  currentScreen: string | null;
  lastHeartbeatAt: string | null;
  screenshotRequestedAt: string | null;
  latestScreenshotAt: string | null;
  hasScreenshot: boolean;
};

export type SupportEventRow = {
  eventId: string;
  level: string;
  eventType: string;
  message: string;
  details: Record<string, unknown> | null;
  createdAt: string;
};

const SESSION_TTL_MIN = 20;
const PENDING_TTL_MIN = 15;
const MAX_SCREENSHOT_CHARS = 900_000;

function mapSession(row: Record<string, unknown>): SupportSessionRow {
  return {
    sessionId: String(row.sessionId),
    deviceUid: String(row.deviceUid),
    deviceId: String(row.deviceId),
    status: row.status as SupportSessionStatus,
    requestedBy: row.requestedBy != null ? String(row.requestedBy) : null,
    requestedAt: String(row.requestedAt),
    acceptedAt: row.acceptedAt != null ? String(row.acceptedAt) : null,
    endedAt: row.endedAt != null ? String(row.endedAt) : null,
    expiresAt: String(row.expiresAt),
    currentScreen: row.currentScreen != null ? String(row.currentScreen) : null,
    lastHeartbeatAt: row.lastHeartbeatAt != null ? String(row.lastHeartbeatAt) : null,
    screenshotRequestedAt:
      row.screenshotRequestedAt != null ? String(row.screenshotRequestedAt) : null,
    latestScreenshotAt: row.latestScreenshotAt != null ? String(row.latestScreenshotAt) : null,
    hasScreenshot: Boolean(row.hasScreenshot),
  };
}

async function expireStaleSessions(client: PoolClient, siteId: number, deviceId: string) {
  await client.query(
    `UPDATE wms_device_support_sessions
     SET status = 'expired', ended_at = now()
     WHERE site_id = $1
       AND device_id = $2::bigint
       AND status IN ('pending', 'active')
       AND expires_at < now()`,
    [siteId, deviceId]
  );
  await client.query(
    `UPDATE wms_device_support_sessions
     SET status = 'expired', ended_at = now()
     WHERE site_id = $1
       AND device_id = $2::bigint
       AND status = 'pending'
       AND requested_at < now() - ($3::text || ' minutes')::interval`,
    [siteId, deviceId, String(PENDING_TTL_MIN)]
  );
}

async function fetchSessionById(
  client: PoolClient,
  siteId: number,
  sessionId: string
): Promise<SupportSessionRow | null> {
  const r = await client.query(
    `SELECT
       s.session_id::text AS "sessionId",
       s.device_uid AS "deviceUid",
       s.device_id::text AS "deviceId",
       s.status,
       s.requested_by AS "requestedBy",
       s.requested_at AS "requestedAt",
       s.accepted_at AS "acceptedAt",
       s.ended_at AS "endedAt",
       s.expires_at AS "expiresAt",
       s.current_screen AS "currentScreen",
       s.last_heartbeat_at AS "lastHeartbeatAt",
       s.screenshot_requested_at AS "screenshotRequestedAt",
       s.latest_screenshot_at AS "latestScreenshotAt",
       (s.latest_screenshot_base64 IS NOT NULL AND length(s.latest_screenshot_base64) > 0) AS "hasScreenshot"
     FROM wms_device_support_sessions s
     WHERE s.site_id = $1 AND s.session_id = $2::bigint`,
    [siteId, sessionId]
  );
  return r.rows[0] ? mapSession(r.rows[0]) : null;
}

async function fetchOpenSession(
  client: PoolClient,
  siteId: number,
  deviceId: string
): Promise<SupportSessionRow | null> {
  const r = await client.query(
    `SELECT
       s.session_id::text AS "sessionId",
       s.device_uid AS "deviceUid",
       s.device_id::text AS "deviceId",
       s.status,
       s.requested_by AS "requestedBy",
       s.requested_at AS "requestedAt",
       s.accepted_at AS "acceptedAt",
       s.ended_at AS "endedAt",
       s.expires_at AS "expiresAt",
       s.current_screen AS "currentScreen",
       s.last_heartbeat_at AS "lastHeartbeatAt",
       s.screenshot_requested_at AS "screenshotRequestedAt",
       s.latest_screenshot_at AS "latestScreenshotAt",
       (s.latest_screenshot_base64 IS NOT NULL AND length(s.latest_screenshot_base64) > 0) AS "hasScreenshot"
     FROM wms_device_support_sessions s
     WHERE s.site_id = $1
       AND s.device_id = $2::bigint
       AND s.status IN ('pending', 'active')
     ORDER BY s.requested_at DESC
     LIMIT 1`,
    [siteId, deviceId]
  );
  return r.rows[0] ? mapSession(r.rows[0]) : null;
}

export async function requestDeviceSupportSession(
  client: PoolClient,
  siteId: number,
  deviceUid: string,
  requestedBy?: string | null
) {
  const device = await requireDeviceByUid(client, siteId, deviceUid);
  await expireStaleSessions(client, siteId, device.deviceId);

  const existing = await fetchOpenSession(client, siteId, device.deviceId);
  if (existing) return { session: existing, created: false };

  const r = await client.query(
    `INSERT INTO wms_device_support_sessions (
       site_id, device_id, device_uid, requested_by, status, expires_at
     ) VALUES (
       $1, $2::bigint, $3, NULLIF($4, ''), 'pending',
       now() + ($5::text || ' minutes')::interval
     )
     RETURNING session_id::text AS "sessionId"`,
    [siteId, device.deviceId, device.deviceUid, requestedBy?.trim() ?? "", String(SESSION_TTL_MIN)]
  );
  const sessionId = r.rows[0]?.sessionId as string;
  const session = await fetchSessionById(client, siteId, sessionId);
  if (!session) throw new WmsHttpError(500, "failed to create support session", "support_create_failed");
  return { session, created: true };
}

export async function getDeviceSupportStatus(
  client: PoolClient,
  siteId: number,
  deviceUid: string,
  sessionId?: string | null
) {
  const device = await requireDeviceByUid(client, siteId, deviceUid);
  await expireStaleSessions(client, siteId, device.deviceId);

  let session: SupportSessionRow | null = null;
  if (sessionId?.trim()) {
    session = await fetchSessionById(client, siteId, sessionId.trim());
    if (session && session.deviceUid !== device.deviceUid) {
      throw new WmsHttpError(404, "session not found", "support_session_not_found");
    }
  } else {
    session = await fetchOpenSession(client, siteId, device.deviceId);
  }

  if (!session) return { session: null, events: [] as SupportEventRow[], screenshotBase64: null as string | null };

  const events = await listSupportEvents(client, siteId, session.sessionId, 80);
  let screenshotBase64: string | null = null;
  if (session.hasScreenshot) {
    const img = await client.query<{ data: string }>(
      `SELECT latest_screenshot_base64 AS data
       FROM wms_device_support_sessions
       WHERE site_id = $1 AND session_id = $2::bigint`,
      [siteId, session.sessionId]
    );
    screenshotBase64 = img.rows[0]?.data ?? null;
  }

  return { session, events, screenshotBase64 };
}

export async function pollDeviceSupport(
  client: PoolClient,
  siteId: number,
  deviceUid: string,
  activeSessionId?: string | null
) {
  const device = await requireDeviceByUid(client, siteId, deviceUid);
  await touchWmsDevice(client, siteId, deviceUid);
  await expireStaleSessions(client, siteId, device.deviceId);

  let session = await fetchOpenSession(client, siteId, device.deviceId);
  if (activeSessionId?.trim() && session && session.sessionId !== activeSessionId.trim()) {
    session = await fetchSessionById(client, siteId, activeSessionId.trim());
  }

  if (!session) {
    return { session: null, screenshotRequested: false };
  }

  const screenshotRequested =
    session.status === "active" &&
    session.screenshotRequestedAt != null &&
    (session.latestScreenshotAt == null ||
      new Date(session.screenshotRequestedAt).getTime() >
        new Date(session.latestScreenshotAt).getTime());

  return { session, screenshotRequested };
}

export async function respondDeviceSupport(
  client: PoolClient,
  siteId: number,
  deviceUid: string,
  sessionId: string,
  accept: boolean
) {
  const device = await requireDeviceByUid(client, siteId, deviceUid);
  const session = await fetchSessionById(client, siteId, sessionId);
  if (!session || session.deviceUid !== device.deviceUid) {
    throw new WmsHttpError(404, "session not found", "support_session_not_found");
  }
  if (session.status !== "pending") {
    throw new WmsHttpError(409, "session is not pending", "support_not_pending");
  }

  const nextStatus = accept ? "active" : "declined";
  await client.query(
    `UPDATE wms_device_support_sessions
     SET status = $4,
         accepted_at = CASE WHEN $5::boolean THEN now() ELSE accepted_at END,
         ended_at = CASE WHEN $5::boolean THEN NULL ELSE now() END,
         expires_at = CASE
           WHEN $5::boolean THEN now() + ($6::text || ' minutes')::interval
           ELSE expires_at
         END
     WHERE site_id = $1 AND session_id = $2::bigint AND device_id = $3::bigint`,
    [siteId, sessionId, device.deviceId, nextStatus, accept, String(SESSION_TTL_MIN)]
  );

  await appendSupportEvents(client, siteId, sessionId, [
    {
      level: accept ? "info" : "warn",
      eventType: accept ? "accepted" : "declined",
      message: accept ? "Оператор разрешил режим поддержки" : "Оператор отклонил запрос поддержки",
    },
  ]);

  const updated = await fetchSessionById(client, siteId, sessionId);
  return { session: updated! };
}

export async function postDeviceSupportTelemetry(
  client: PoolClient,
  siteId: number,
  deviceUid: string,
  sessionId: string,
  input: {
    currentScreen?: string | null;
    events?: Array<{
      level?: string;
      eventType?: string;
      message: string;
      details?: Record<string, unknown> | null;
    }>;
  }
) {
  const device = await requireDeviceByUid(client, siteId, deviceUid);
  const session = await fetchSessionById(client, siteId, sessionId);
  if (!session || session.deviceUid !== device.deviceUid) {
    throw new WmsHttpError(404, "session not found", "support_session_not_found");
  }
  if (session.status !== "active") {
    throw new WmsHttpError(409, "support session is not active", "support_not_active");
  }

  const screen = input.currentScreen?.trim() || null;
  await client.query(
    `UPDATE wms_device_support_sessions
     SET current_screen = COALESCE($4, current_screen),
         last_heartbeat_at = now(),
         expires_at = now() + ($5::text || ' minutes')::interval
     WHERE site_id = $1 AND session_id = $2::bigint AND device_id = $3::bigint`,
    [siteId, sessionId, device.deviceId, screen, String(SESSION_TTL_MIN)]
  );

  if (input.events?.length) {
    await appendSupportEvents(client, siteId, sessionId, input.events);
  }

  const updated = await fetchSessionById(client, siteId, sessionId);
  return { session: updated! };
}

export async function uploadDeviceSupportScreenshot(
  client: PoolClient,
  siteId: number,
  deviceUid: string,
  sessionId: string,
  screenshotBase64: string
) {
  const device = await requireDeviceByUid(client, siteId, deviceUid);
  const session = await fetchSessionById(client, siteId, sessionId);
  if (!session || session.deviceUid !== device.deviceUid) {
    throw new WmsHttpError(404, "session not found", "support_session_not_found");
  }
  if (session.status !== "active") {
    throw new WmsHttpError(409, "support session is not active", "support_not_active");
  }

  const data = screenshotBase64.trim();
  if (!data) throw new WmsHttpError(400, "screenshotBase64 is required", "bad_screenshot");
  if (data.length > MAX_SCREENSHOT_CHARS) {
    throw new WmsHttpError(413, "screenshot too large", "screenshot_too_large");
  }

  await client.query(
    `UPDATE wms_device_support_sessions
     SET latest_screenshot_base64 = $4,
         latest_screenshot_at = now(),
         screenshot_requested_at = NULL,
         last_heartbeat_at = now()
     WHERE site_id = $1 AND session_id = $2::bigint AND device_id = $3::bigint`,
    [siteId, sessionId, device.deviceId, data]
  );

  await appendSupportEvents(client, siteId, sessionId, [
    { level: "info", eventType: "screenshot", message: "Снимок экрана отправлен на сервер" },
  ]);

  return { ok: true as const };
}

export async function requestDeviceSupportScreenshot(
  client: PoolClient,
  siteId: number,
  deviceUid: string,
  sessionId: string
) {
  const device = await requireDeviceByUid(client, siteId, deviceUid);
  const session = await fetchSessionById(client, siteId, sessionId);
  if (!session || session.deviceUid !== device.deviceUid) {
    throw new WmsHttpError(404, "session not found", "support_session_not_found");
  }
  if (session.status !== "active") {
    throw new WmsHttpError(409, "support session is not active", "support_not_active");
  }

  await client.query(
    `UPDATE wms_device_support_sessions
     SET screenshot_requested_at = now()
     WHERE site_id = $1 AND session_id = $2::bigint AND device_id = $3::bigint`,
    [siteId, sessionId, device.deviceId]
  );

  await appendSupportEvents(client, siteId, sessionId, [
    { level: "info", eventType: "screenshot_request", message: "Администратор запросил снимок экрана" },
  ]);

  const updated = await fetchSessionById(client, siteId, sessionId);
  return { session: updated! };
}

export async function endDeviceSupportSession(
  client: PoolClient,
  siteId: number,
  deviceUid: string,
  sessionId: string,
  reason?: string | null
) {
  const device = await requireDeviceByUid(client, siteId, deviceUid);
  const session = await fetchSessionById(client, siteId, sessionId);
  if (!session || session.deviceUid !== device.deviceUid) {
    throw new WmsHttpError(404, "session not found", "support_session_not_found");
  }
  if (!["pending", "active"].includes(session.status)) {
    return { session };
  }

  await client.query(
    `UPDATE wms_device_support_sessions
     SET status = 'ended', ended_at = now()
     WHERE site_id = $1 AND session_id = $2::bigint AND device_id = $3::bigint`,
    [siteId, sessionId, device.deviceId]
  );

  await appendSupportEvents(client, siteId, sessionId, [
    {
      level: "info",
      eventType: "ended",
      message: reason?.trim() || "Сессия поддержки завершена",
    },
  ]);

  const updated = await fetchSessionById(client, siteId, sessionId);
  return { session: updated! };
}

async function appendSupportEvents(
  client: PoolClient,
  siteId: number,
  sessionId: string,
  events: Array<{
    level?: string;
    eventType?: string;
    message: string;
    details?: Record<string, unknown> | null;
  }>
) {
  for (const ev of events) {
    const msg = ev.message?.trim();
    if (!msg) continue;
    const level = ["info", "warn", "error"].includes(ev.level ?? "") ? ev.level! : "info";
    await client.query(
      `INSERT INTO wms_device_support_events (
         session_id, site_id, level, event_type, message, details_json
       ) VALUES ($1::bigint, $2, $3, $4, $5, $6::jsonb)`,
      [
        sessionId,
        siteId,
        level,
        ev.eventType?.trim() || "log",
        msg.slice(0, 4000),
        ev.details ? JSON.stringify(ev.details) : null,
      ]
    );
  }
}

async function listSupportEvents(
  client: PoolClient,
  siteId: number,
  sessionId: string,
  limit: number
): Promise<SupportEventRow[]> {
  const r = await client.query(
    `SELECT
       e.event_id::text AS "eventId",
       e.level,
       e.event_type AS "eventType",
       e.message,
       e.details_json AS details,
       e.created_at AS "createdAt"
     FROM wms_device_support_events e
     WHERE e.site_id = $1 AND e.session_id = $2::bigint
     ORDER BY e.created_at DESC
     LIMIT $3`,
    [siteId, sessionId, Math.min(Math.max(limit, 1), 200)]
  );
  return r.rows.map((row) => ({
    eventId: String(row.eventId),
    level: String(row.level),
    eventType: String(row.eventType),
    message: String(row.message),
    details: (row.details as Record<string, unknown> | null) ?? null,
    createdAt: String(row.createdAt),
  }));
}
