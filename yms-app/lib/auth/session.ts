import type { WmsAuthSession } from "./types"

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000
export const SESSION_TTL_SEC = 24 * 60 * 60

function getSecret(): string {
  const secret = process.env.WMS_AUTH_SECRET?.trim()
  if (secret) return secret
  if (process.env.NODE_ENV === "production") {
    throw new Error("WMS_AUTH_SECRET is not set")
  }
  return "dev-wms-auth-secret-change-me"
}

const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data))
  return toBase64Url(new Uint8Array(sig))
}

async function hmacVerify(data: string, signature: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  )
  return crypto.subtle.verify("HMAC", key, fromBase64Url(signature), encoder.encode(data))
}

export async function createSessionToken(input: {
  userId?: string
  login: string
  fio: string
  position: string
  roleCodes?: string[]
}): Promise<string> {
  const now = Date.now()
  const payload: WmsAuthSession = {
    userId: input.userId,
    login: input.login,
    fio: input.fio,
    position: input.position,
    roleCodes: input.roleCodes,
    iat: now,
    exp: now + SESSION_TTL_MS,
  }
  const data = toBase64Url(encoder.encode(JSON.stringify(payload)))
  const sig = await hmacSign(data, getSecret())
  return `${data}.${sig}`
}

export async function verifySessionToken(token: string): Promise<WmsAuthSession | null> {
  const trimmed = token.trim()
  const dot = trimmed.lastIndexOf(".")
  if (dot <= 0) return null
  const data = trimmed.slice(0, dot)
  const sig = trimmed.slice(dot + 1)
  if (!data || !sig) return null

  const ok = await hmacVerify(data, sig, getSecret())
  if (!ok) return null

  try {
    const json = new TextDecoder().decode(fromBase64Url(data))
    const payload = JSON.parse(json) as WmsAuthSession
    if (!payload?.login || !payload?.fio || typeof payload.exp !== "number") return null
    if (payload.exp < Date.now()) return null
    const issuedAt = typeof payload.iat === "number" ? payload.iat : payload.exp - SESSION_TTL_MS
    const revokedBefore = parseRevokedBeforeMs()
    if (revokedBefore != null && issuedAt < revokedBefore) return null
    return payload
  } catch {
    return null
  }
}

function parseRevokedBeforeMs(): number | null {
  const raw = process.env.WMS_AUTH_REVOKED_BEFORE?.trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) {
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function authCookieSecure(): boolean {
  const override = process.env.WMS_AUTH_COOKIE_SECURE?.trim().toLowerCase()
  if (override === "true") return true
  if (override === "false") return false
  return process.env.NODE_ENV === "production"
}

export function sessionCookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: authCookieSecure(),
    path: "/",
    maxAge: maxAgeSec,
  }
}
