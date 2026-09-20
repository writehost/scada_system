import type { PoolClient } from "pg"
import { registerWmsDevice } from "@/lib/wms/devices"
import {
  PRINT_TERMINAL_PLATFORM,
  parsePrintTerminalRawId,
  printTerminalDisplayName,
  printTerminalUid,
  rawPrintTerminalId,
} from "@/lib/wms/device-kind"
import { WmsHttpError } from "@/lib/wms/errors"

export type UpsertPrintTerminalInput = {
  deviceUid?: string
  rawDeviceId?: string
  deviceName?: string
  appVersion?: string
  extraInfo?: Record<string, unknown>
}

function resolveRawId(input: UpsertPrintTerminalInput): string {
  const fromUid = (input.deviceUid || "").trim()
  const fromRaw = (input.rawDeviceId || "").trim()
  if (fromRaw) return rawPrintTerminalId(fromRaw)
  if (fromUid) return rawPrintTerminalId(fromUid)
  return ""
}

export async function upsertPrintTerminal(
  client: PoolClient,
  siteId: number,
  input: UpsertPrintTerminalInput
) {
  const rawId = resolveRawId(input)
  const uid = printTerminalUid(rawId)
  if (!uid) {
    throw new WmsHttpError(400, "deviceId is required", "bad_device_uid")
  }
  return registerWmsDevice(client, siteId, {
    deviceUid: uid,
    deviceName: (input.deviceName || "").trim() || printTerminalDisplayName(rawId),
    platform: PRINT_TERMINAL_PLATFORM,
    appVersion: input.appVersion,
    deviceInfo: {
      kind: "print-terminal",
      rawDeviceId: rawId,
      ...(input.extraInfo || {}),
    },
  })
}

/** Создаёт карточку, если её ещё нет. Не двигает last_seen — иначе архивные планшеты «оживут». */
export async function ensurePrintTerminal(
  client: PoolClient,
  siteId: number,
  input: UpsertPrintTerminalInput & { lastSeenAt?: string | Date | null }
) {
  const rawId = resolveRawId(input)
  const uid = printTerminalUid(rawId)
  if (!uid) return null

  const existing = await client.query<{ deviceUid: string }>(
    `SELECT device_uid AS "deviceUid" FROM wms_devices WHERE site_id = $1 AND device_uid = $2 LIMIT 1`,
    [siteId, uid]
  )
  if (existing.rows[0]) return existing.rows[0]

  const name = (input.deviceName || "").trim() || printTerminalDisplayName(rawId)
  const info = JSON.stringify({
    kind: "print-terminal",
    rawDeviceId: rawId,
    ...(input.extraInfo || {}),
  })
  const lastSeen =
    input.lastSeenAt instanceof Date
      ? input.lastSeenAt.toISOString()
      : typeof input.lastSeenAt === "string" && input.lastSeenAt.trim()
        ? input.lastSeenAt
        : null

  try {
    const r = await client.query(
      `INSERT INTO wms_devices (
         site_id, device_uid, device_name, platform, app_version, device_info_json, last_seen_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6::jsonb, COALESCE($7::timestamptz, now())
       )
       ON CONFLICT (device_uid) DO NOTHING
       RETURNING device_uid AS "deviceUid"`,
      [siteId, uid, name, PRINT_TERMINAL_PLATFORM, input.appVersion?.trim() || null, info, lastSeen]
    )
    return r.rows[0] ?? { deviceUid: uid }
  } catch (e) {
    const code = typeof (e as { code?: string })?.code === "string" ? (e as { code: string }).code : ""
    if (code !== "42703") throw e
    await client.query(
      `INSERT INTO wms_devices (
         site_id, device_uid, device_name, platform, app_version, last_seen_at
       ) VALUES (
         $1, $2, $3, $4, $5, COALESCE($6::timestamptz, now())
       )
       ON CONFLICT (device_uid) DO NOTHING`,
      [siteId, uid, name, PRINT_TERMINAL_PLATFORM, input.appVersion?.trim() || null, lastSeen]
    )
    return { deviceUid: uid }
  }
}

export async function relabelPrinterOriginDetails(client: PoolClient, siteId: number) {
  try {
    await client.query(
      `UPDATE wms_label_order_docs
          SET origin_detail = regexp_replace(origin_detail, '^ТСД\\s+', 'Печатный терминал · ')
        WHERE site_id = $1
          AND origin = 'printer-terminal'
          AND origin_detail ~ '^ТСД\\s+'`,
      [siteId]
    )
  } catch {
    // таблица или колонка могут отсутствовать на старых стендах
  }
}

export async function backfillPrintTerminalsFromOrders(client: PoolClient, siteId: number) {
  await relabelPrinterOriginDetails(client, siteId)
  try {
    const r = await client.query<{ originDetail: string | null; lastAt: string | Date | null }>(
      `SELECT origin_detail AS "originDetail", MAX(created_at) AS "lastAt"
         FROM wms_label_order_docs
        WHERE site_id = $1
          AND origin = 'printer-terminal'
        GROUP BY origin_detail`,
      [siteId]
    )
    for (const row of r.rows) {
      const rawId = parsePrintTerminalRawId(row.originDetail || "")
      if (!rawId) continue
      await ensurePrintTerminal(client, siteId, {
        rawDeviceId: rawId,
        lastSeenAt: row.lastAt,
      })
    }
  } catch {
    // журнал заказов кодов ещё не создан
  }
}
