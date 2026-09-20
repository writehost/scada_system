import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { resolveUserAuth } from "@/lib/auth/resolve-user-auth"
import { DEVICE_TOKEN_HEADER } from "@/lib/wms/device-auth"
import { hashDeviceToken } from "@/lib/wms/device-tokens"
import { isLocalRequest } from "@/lib/wms/local-request"
import { tryGetPool } from "@/lib/wms/pool"

/** Пути без сессии: логин, здоровье, подключение ТСД. Мутации склада сюда не входят. */
const OPEN_PREFIXES = [
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/scada-id",
  "/api/app",
  "/api/s",
  "/api/wms/health",
  "/api/wms/devices/enroll",
  "/api/wms/devices/register",
  "/api/wms/platform/register",
  "/api/wms/devices/printer-purge",
  "/api/wms/devices/printer-heartbeat",
]

/** ТСД и POS: deviceUid часто только в JSON. Маршрут сам проверяет устройство. */
const TERMINAL_BODY_PREFIXES = [
  "/api/wms/devices",
  "/api/wms/mobile",
  "/api/wms/tasks",
  "/api/wms/receiving",
  "/api/wms/receivings",
  "/api/wms/scanner-sessions",
  "/api/wms/row-identify",
  "/api/wms/stock/pos-issue",
  "/api/wms/stock/pos-pick",
  "/api/wms/users/identify",
]

const PROTECTED_API_PREFIXES = ["/api/wms", "/api/catalog", "/api/fg", "/api/settings", "/api/ui-prefs"]

function pathMatches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function isProtectedApiPath(pathname: string): boolean {
  return PROTECTED_API_PREFIXES.some((prefix) => pathMatches(pathname, prefix))
}

export function isOpenApiPath(pathname: string): boolean {
  return OPEN_PREFIXES.some((prefix) => pathMatches(pathname, prefix))
}

export function isTerminalPath(pathname: string): boolean {
  return TERMINAL_BODY_PREFIXES.some((prefix) => pathMatches(pathname, prefix))
}

function json401(message = "Нужен вход в WMS или токен API", code = "auth_required") {
  return NextResponse.json({ error: message, code }, { status: 401 })
}

function readDeviceTokenHeader(req: NextRequest): string {
  return (
    req.headers.get(DEVICE_TOKEN_HEADER)?.trim() ||
    (req.headers.get("authorization") || "").match(/^Device\s+(.+)$/i)?.[1]?.trim() ||
    ""
  )
}

/**
 * Проверяет, что заголовок — действующий токен из `wms_device_tokens`.
 * Любая строка больше не считается пропуском.
 */
export async function deviceTokenHeaderIsValid(token: string): Promise<boolean | "unavailable"> {
  const trimmed = token.trim()
  if (!trimmed) return false
  const pool = tryGetPool()
  if (!pool) return "unavailable"
  try {
    const { rows } = await pool.query(
      `SELECT 1
         FROM wms_device_tokens
        WHERE token_hash = $1
          AND revoked_at IS NULL
        LIMIT 1`,
      [hashDeviceToken(trimmed)]
    )
    return rows.length > 0
  } catch (error) {
    console.error("device token middleware lookup failed", error)
    return "unavailable"
  }
}

/**
 * Не читает тело запроса (иначе его не увидит route handler).
 * Браузер — cookie/JWT; интеграции — Bearer wmsu_; ТСД — действующий токен устройства.
 */
export async function guardProtectedApiRequest(req: NextRequest): Promise<NextResponse | null> {
  const pathname = req.nextUrl.pathname
  if (!isProtectedApiPath(pathname) || isOpenApiPath(pathname)) return null

  if (
    isLocalRequest(req) &&
    (pathname.startsWith("/api/wms/expiry-alerts/") ||
      pathname.startsWith("/api/wms/devices/printer-purge") ||
      pathname.startsWith("/api/wms/devices/printer-heartbeat") ||
      pathname.startsWith("/api/wms/transfers/erp/sync") ||
      pathname.startsWith("/api/wms/production/plans/sync-vekas"))
  ) {
    return null
  }

  const user = await resolveUserAuth(req).catch(() => null)
  if (user) return null

  const deviceToken = readDeviceTokenHeader(req)
  if (deviceToken) {
    const valid = await deviceTokenHeaderIsValid(deviceToken)
    if (valid === true) return null
    if (valid === "unavailable") {
      return NextResponse.json(
        { error: "Проверка терминала временно недоступна", code: "device_auth_unavailable" },
        { status: 503 }
      )
    }
    return json401("Токен терминала недействителен", "device_token_invalid")
  }

  const method = req.method.toUpperCase()
  if (method !== "GET" && method !== "HEAD" && isTerminalPath(pathname)) {
    return null
  }

  return json401()
}
