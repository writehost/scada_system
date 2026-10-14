/**
 * Сессия EDI: подписанный HMAC-SHA256 токен в httpOnly cookie, та же схема, что у WMS и YMS.
 * Учётные записи не хранятся в EDI — это строки wms_users (общий справочник SCADA ID / WMS).
 */

export const EDI_SESSION_COOKIE = "edi_session"
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000
export const SESSION_TTL_SEC = SESSION_TTL_MS / 1000

export type EdiOrgAccess = {
  siteId: number
  siteCode: string
  name: string
  /** user_id той же персоны в этой организации (в WMS пользователь заводится на площадку). */
  userId: string
}

export type EdiSession = {
  userId: string
  login: string
  fio: string
  siteId: number
  siteCode: string
  orgs: EdiOrgAccess[]
  via: "password" | "scada-id"
  iat: number
  exp: number
}

function getSecret(): string {
  const secret = (process.env.EDI_AUTH_SECRET || process.env.WMS_AUTH_SECRET || "").trim()
  if (secret) return secret
  if (process.env.NODE_ENV === "production") throw new Error("EDI_AUTH_SECRET is not set")
  return "dev-edi-auth-secret-change-me"
}

const encoder = new TextEncoder()

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function hmacKey(secret: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage])
}

export async function signPayload(payload: unknown, secret = getSecret()): Promise<string> {
  const data = toBase64Url(encoder.encode(JSON.stringify(payload)))
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(data))
  return `${data}.${toBase64Url(new Uint8Array(sig))}`
}

export async function verifyPayload<T>(token: string, secret = getSecret()): Promise<T | null> {
  const trimmed = (token || "").trim()
  const dot = trimmed.lastIndexOf(".")
  if (dot <= 0) return null
  const data = trimmed.slice(0, dot)
  const sig = trimmed.slice(dot + 1)
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret, "verify"),
      fromBase64Url(sig) as unknown as ArrayBuffer,
      encoder.encode(data)
    )
    if (!ok) return null
    return JSON.parse(new TextDecoder().decode(fromBase64Url(data))) as T
  } catch {
    return null
  }
}

export async function createSessionToken(input: Omit<EdiSession, "iat" | "exp">): Promise<string> {
  const now = Date.now()
  return signPayload({ ...input, iat: now, exp: now + SESSION_TTL_MS } satisfies EdiSession)
}

export async function verifySessionToken(token: string): Promise<EdiSession | null> {
  const payload = await verifyPayload<EdiSession>(token)
  if (!payload?.userId || !payload.siteId || typeof payload.exp !== "number") return null
  if (payload.exp < Date.now()) return null
  const revokedBefore = Date.parse(process.env.EDI_AUTH_REVOKED_BEFORE || "")
  if (Number.isFinite(revokedBefore) && payload.iat < revokedBefore) return null
  return payload
}

export function sessionCookieOptions(maxAgeSec: number) {
  const override = process.env.EDI_AUTH_COOKIE_SECURE?.trim().toLowerCase()
  const secure = override === "true" ? true : override === "false" ? false : process.env.NODE_ENV === "production"
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: maxAgeSec }
}

export function readCookie(req: Request, name: string): string {
  const header = req.headers.get("cookie") || ""
  for (const part of header.split(";")) {
    const p = part.trim()
    if (p.startsWith(`${name}=`)) return decodeURIComponent(p.slice(name.length + 1))
  }
  return ""
}
