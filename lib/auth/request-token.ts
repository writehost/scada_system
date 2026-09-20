import type { NextRequest } from "next/server"
import { cookies } from "next/headers"
import { WMS_SESSION_COOKIE } from "@/lib/auth/types"

export function bearerFromAuthorizationHeader(value: string | null): string | null {
  if (!value) return null
  const m = value.match(/^Bearer\s+(.+)$/i)
  return m?.[1]?.trim() || null
}

function cookieValueFromHeader(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null
  const parts = cookieHeader.split(";")
  for (const part of parts) {
    const [rawKey, ...rest] = part.trim().split("=")
    if (rawKey === name) {
      const raw = rest.join("=")
      try {
        return decodeURIComponent(raw)
      } catch {
        return raw
      }
    }
  }
  return null
}

export async function readAuthTokenFromRequest(req?: Request | NextRequest): Promise<string | null> {
  const fromHeader = req ? bearerFromAuthorizationHeader(req.headers.get("authorization")) : null
  if (fromHeader) return fromHeader

  if (req && "cookies" in req && typeof req.cookies?.get === "function") {
    const fromReqCookie = req.cookies.get(WMS_SESSION_COOKIE)?.value?.trim()
    if (fromReqCookie) return fromReqCookie
  }

  if (req) {
    const fromCookieHeader = cookieValueFromHeader(req.headers.get("cookie"), WMS_SESSION_COOKIE)
    if (fromCookieHeader?.trim()) return fromCookieHeader.trim()
  }

  try {
    const store = await cookies()
    return store.get(WMS_SESSION_COOKIE)?.value || null
  } catch {
    return null
  }
}
