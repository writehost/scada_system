import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"
import { bearerFromAuthorizationHeader } from "@/lib/auth/request-token"
import { verifySessionToken } from "@/lib/auth/session"
import { WMS_SESSION_COOKIE, type WmsAuthSession } from "@/lib/auth/types"

export const ROW_IDENTIFY_TOKEN_KIND = "fg-map"

export type FgMapTokenPayload = {
  kind: typeof ROW_IDENTIFY_TOKEN_KIND
  siteCode: string
  rowId?: string
  login?: string
  exp: number
}

function secret(): string {
  return (
    process.env.WMS_MAP_TOKEN_SECRET?.trim() ||
    process.env.WMS_AUTH_SECRET?.trim() ||
    "dev-wms-auth-secret-change-me"
  )
}

function toBase64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url")
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url")
}

export function createMapToken(input: {
  siteCode: string
  rowId?: string
  login?: string
  expiresInSec?: number
}): { token: string; expiresAt: string; payload: FgMapTokenPayload } {
  const ttl = Math.min(Math.max(input.expiresInSec ?? 30 * 24 * 60 * 60, 300), 180 * 24 * 60 * 60)
  const payload: FgMapTokenPayload = {
    kind: ROW_IDENTIFY_TOKEN_KIND,
    siteCode: input.siteCode.trim() || "DEFAULT",
    rowId: input.rowId?.trim() || undefined,
    login: input.login?.trim() || undefined,
    exp: Date.now() + ttl * 1000,
  }
  const data = toBase64Url(JSON.stringify(payload))
  return {
    token: `${data}.${sign(data)}`,
    expiresAt: new Date(payload.exp).toISOString(),
    payload,
  }
}

export function verifyMapToken(token: string): FgMapTokenPayload | null {
  const trimmed = token.trim()
  const dot = trimmed.lastIndexOf(".")
  if (dot <= 0) return null
  const data = trimmed.slice(0, dot)
  const sig = trimmed.slice(dot + 1)
  if (!data || !sig) return null
  const expected = sign(data)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as FgMapTokenPayload
    if (payload.kind !== ROW_IDENTIFY_TOKEN_KIND || !payload.siteCode || typeof payload.exp !== "number") {
      return null
    }
    if (payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export function newSessionId(): string {
  return randomUUID()
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16)
}

export async function resolveRowIdentifyAuth(req: Request): Promise<
  | { ok: true; via: "map-token"; token: FgMapTokenPayload }
  | { ok: true; via: "session"; session: WmsAuthSession }
  | { ok: false; error: string; status: number }
> {
  const url = new URL(req.url)
  const raw =
    bearerFromAuthorizationHeader(req.headers.get("authorization")) ||
    req.headers.get("x-map-token")?.trim() ||
    url.searchParams.get("mapToken")?.trim() ||
    url.searchParams.get("token")?.trim() ||
    ""

  if (raw) {
    const map = verifyMapToken(raw)
    if (map) return { ok: true, via: "map-token", token: map }
    const session = await verifySessionToken(raw)
    if (session) return { ok: true, via: "session", session }
    return { ok: false, error: "invalid or expired token", status: 401 }
  }

  try {
    const cookieToken = (await cookies()).get(WMS_SESSION_COOKIE)?.value
    if (cookieToken) {
      const session = await verifySessionToken(cookieToken)
      if (session) return { ok: true, via: "session", session }
    }
  } catch {
    /* cookies() недоступен вне request context */
  }

  return { ok: false, error: "Authorization Bearer token is required", status: 401 }
}

export function mapUrlForToken(origin: string, token: string, rowId?: string | null): string {
  const url = new URL("/api/wms/row-identify/open-map", origin)
  url.searchParams.set("token", token)
  if (rowId) url.searchParams.set("row", rowId)
  return url.toString()
}

export function planPageUrl(origin: string, token: string, rowId?: string | null): string {
  const url = new URL("/warehouse-plan/fg/index.html", origin)
  url.searchParams.set("mapToken", token)
  if (rowId) url.searchParams.set("row", rowId)
  return url.toString()
}
