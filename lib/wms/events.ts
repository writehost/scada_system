import type { PoolClient } from "pg";

export type WmsTaskEventType =
  | "task_assigned"
  | "task_claimed"
  | "task_started"
  | "task_completed"
  | "task_exception"
  | "task_updated"
  | "push_test";

export type WmsTaskEvent = {
  siteId: number;
  taskId: string;
  eventType: WmsTaskEventType;
  /** Если событие относится к конкретному терминалу — для фильтрации SSE/long-poll. */
  deviceUid?: string | null;
  message?: string | null;
  atIso: string;
};

export const WMS_TASK_EVENTS_CHANNEL = "wms_task_events";

export async function notifyWmsTaskEvent(client: PoolClient, event: Omit<WmsTaskEvent, "atIso"> & { atIso?: string }) {
  const payload: WmsTaskEvent = {
    ...event,
    deviceUid: event.deviceUid ?? null,
    atIso: event.atIso ?? new Date().toISOString(),
  };
  // NOTIFY payload <= 8000 bytes; держим минимальным.
  await client.query(`SELECT pg_notify($1::text, $2::text)`, [WMS_TASK_EVENTS_CHANNEL, JSON.stringify(payload)]);
}

