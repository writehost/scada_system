/**
 * Токен терминала на стороне клиента.
 *
 * Живёт в `localStorage` рядом с остальными настройками ТСД и подставляется
 * в заголовок `X-Device-Token` на каждый запрос к API. Логин и пароль WMS
 * при подключении по коду не нужны.
 */

const DEVICE_TOKEN_KEY = "tsd_device_token"
const DEVICE_TOKEN_ISSUED_KEY = "tsd_device_token_at"

export const DEVICE_TOKEN_HEADER = "X-Device-Token"

export function getDeviceToken(): string {
  if (typeof window === "undefined") return ""
  try {
    return (localStorage.getItem(DEVICE_TOKEN_KEY) || "").trim()
  } catch {
    return ""
  }
}

export function setDeviceToken(token: string, issuedAt?: string): void {
  if (typeof window === "undefined") return
  try {
    const value = (token || "").trim()
    if (!value) {
      localStorage.removeItem(DEVICE_TOKEN_KEY)
      localStorage.removeItem(DEVICE_TOKEN_ISSUED_KEY)
      return
    }
    localStorage.setItem(DEVICE_TOKEN_KEY, value)
    localStorage.setItem(DEVICE_TOKEN_ISSUED_KEY, issuedAt || new Date().toISOString())
  } catch {
    /* приватный режим браузера — работаем без сохранения */
  }
}

export function clearDeviceToken(): void {
  setDeviceToken("")
}

export function getDeviceTokenIssuedAt(): string {
  if (typeof window === "undefined") return ""
  try {
    return localStorage.getItem(DEVICE_TOKEN_ISSUED_KEY) || ""
  } catch {
    return ""
  }
}

/** Короткий хвост токена для показа в интерфейсе — весь токен на экран не выводим. */
export function deviceTokenHint(): string {
  const token = getDeviceToken()
  return token ? `…${token.slice(-4)}` : ""
}

export function deviceTokenHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init)
  const token = getDeviceToken()
  if (token) headers.set(DEVICE_TOKEN_HEADER, token)
  return headers
}
