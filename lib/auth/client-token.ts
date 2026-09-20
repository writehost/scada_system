export const WMS_ACCESS_TOKEN_KEY = "wms_access_token"

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null
  try {
    return localStorage.getItem(WMS_ACCESS_TOKEN_KEY)?.trim() || null
  } catch {
    return null
  }
}

export function setAccessToken(token: string) {
  if (typeof window === "undefined") return
  localStorage.setItem(WMS_ACCESS_TOKEN_KEY, token.trim())
}

export function clearAccessToken() {
  if (typeof window === "undefined") return
  localStorage.removeItem(WMS_ACCESS_TOKEN_KEY)
}

export function authRequestHeaders(extra?: HeadersInit): HeadersInit {
  const base =
    extra instanceof Headers
      ? Object.fromEntries(extra.entries())
      : Array.isArray(extra)
        ? Object.fromEntries(extra)
        : { ...(extra as Record<string, string> | undefined) }

  const token = getAccessToken()
  if (token) base.Authorization = `Bearer ${token}`
  return base
}
