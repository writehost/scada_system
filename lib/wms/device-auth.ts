import { readAuthTokenFromRequest } from "@/lib/auth/request-token"
import { verifySessionToken } from "@/lib/auth/session"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { WmsHttpError } from "@/lib/wms/errors"
import { touchDeviceLastSeenQuiet } from "@/lib/wms/devices"
import {
  checkDeviceToken,
  getDeviceAuthSettings,
  type DeviceAuthMode,
} from "@/lib/wms/device-tokens"

/**
 * Проверка обращения от ТСД.
 *
 * Порядок: токен устройства → сессия пользователя (веб-интерфейс и служебные вызовы) →
 * режим проверки. В режиме `soft` старые терминалы без токена продолжают работать,
 * в `strict` — получают 401 и уходят на экран подключения.
 */

export const DEVICE_TOKEN_HEADER = "x-device-token"

/** Служебный uid веб-интерфейса не считается терминалом: им нельзя обойти вход. */
export function isPhysicalDeviceUid(uid: string | null | undefined): boolean {
  const n = (uid || "").trim().toLowerCase()
  if (!n) return false
  if (n === "web-operator" || n === "веб-интерфейс") return false
  return true
}

export type DeviceAuthResult = {
  /** Чем авторизовались: токеном ТСД, сессией человека или ничем (легаси). */
  via: "device-token" | "user-session" | "legacy"
  mode: DeviceAuthMode
  deviceUid: string | null
  /** true — обращение прошло только потому, что режим мягкий. */
  legacy: boolean
}

export function readDeviceTokenFromRequest(req: Request): string | null {
  const header = req.headers.get(DEVICE_TOKEN_HEADER)
  if (header?.trim()) return header.trim()
  const authorization = req.headers.get("authorization")
  const m = authorization?.match(/^Device\s+(.+)$/i)
  return m?.[1]?.trim() || null
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]!.trim()
  return req.headers.get("x-real-ip")
}

let settingsCache: { siteId: number; at: number; mode: DeviceAuthMode } | null = null
const SETTINGS_TTL_MS = 30_000

async function readMode(siteId: number): Promise<DeviceAuthMode> {
  const now = Date.now()
  if (settingsCache && settingsCache.siteId === siteId && now - settingsCache.at < SETTINGS_TTL_MS) {
    return settingsCache.mode
  }
  const pool = tryGetPool()
  if (!pool) return "off"
  const client = await pool.connect()
  try {
    const settings = await getDeviceAuthSettings(client, siteId)
    settingsCache = { siteId, at: now, mode: settings.mode }
    return settings.mode
  } finally {
    client.release()
  }
}

/** Сбрасывает кеш режима — вызывается сразу после сохранения настроек. */
export function resetDeviceAuthModeCache(): void {
  settingsCache = null
}

/**
 * Обёртка для маршрутов ТСД: возвращает готовый ответ 401, если пускать нельзя,
 * и `null`, если можно продолжать. Так проверка не зависит от try/catch маршрута.
 */
export async function guardDeviceRequest(
  req: Request,
  input: { siteCode: string; deviceUid?: string; appVersion?: string; allowUnregistered?: boolean }
): Promise<Response | null> {
  try {
    await requireDeviceAuth(req, input)
    return null
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error("device auth check failed", error)
    return Response.json(
      { error: "Проверка терминала временно недоступна", code: "device_auth_unavailable" },
      { status: 503 }
    )
  }
}

export async function requireDeviceAuth(
  req: Request,
  input: { siteCode: string; deviceUid?: string; appVersion?: string; allowUnregistered?: boolean }
): Promise<DeviceAuthResult> {
  const pool = tryGetPool()
  if (!pool) {
    throw new WmsHttpError(503, "База недоступна для проверки терминала", "device_auth_unavailable")
  }

  const token = readDeviceTokenFromRequest(req)
  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, input.siteCode || "DEFAULT")
    if (siteId == null) {
      throw new WmsHttpError(404, "unknown siteCode", "unknown_site")
    }
    const mode = await readMode(siteId)

    if (token) {
      const check = await checkDeviceToken(client, {
        token,
        siteId,
        deviceUid: input.deviceUid,
        appVersion: input.appVersion,
        ip: clientIp(req) ?? undefined,
      })
      if (check.ok) {
        await touchDeviceLastSeenQuiet(client, siteId, check.deviceUid)
        return { via: "device-token", mode, deviceUid: check.deviceUid, legacy: false }
      }
      // Испорченный или отозванный токен отклоняем в любом режиме: ТСД должен переподключиться.
      const message =
        check.reason === "revoked"
          ? "Токен терминала отозван — подключите ТСД заново"
          : check.reason === "device_mismatch"
            ? "Токен выдан другому терминалу"
            : check.reason === "site_mismatch"
              ? "Токен выдан для другой площадки"
              : "Токен терминала не распознан — подключите ТСД заново"
      throw new WmsHttpError(401, message, "device_token_invalid")
    }

    const sessionToken = await readAuthTokenFromRequest(req).catch(() => null)
    if (sessionToken) {
      const session = await verifySessionToken(sessionToken)
      if (session) {
        return { via: "user-session", mode, deviceUid: input.deviceUid ?? null, legacy: false }
      }
    }

    if (mode === "strict") {
      throw new WmsHttpError(
        401,
        "Терминал не подключён: нужен код подключения из раздела «Терминалы»",
        "device_token_required"
      )
    }

    const uid = (input.deviceUid || "").trim()
    if (input.allowUnregistered) {
      return { via: "legacy", mode, deviceUid: uid || null, legacy: true }
    }
    if (!isPhysicalDeviceUid(uid)) {
      throw new WmsHttpError(401, "Нужен вход в WMS или токен терминала", "auth_required")
    }
    const known = await client.query(
      `SELECT 1 FROM wms_devices WHERE site_id = $1 AND device_uid = $2 LIMIT 1`,
      [siteId, uid]
    )
    if (known.rows.length === 0) {
      throw new WmsHttpError(401, "Терминал не зарегистрирован", "device_unknown")
    }
    await touchDeviceLastSeenQuiet(client, siteId, uid)
    return { via: "legacy", mode, deviceUid: uid, legacy: true }
  } finally {
    client.release()
  }
}
