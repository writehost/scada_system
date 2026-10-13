import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

export function authSecret(): string {
  const secret = process.env.PORTAL_AUTH_SECRET?.trim()
  if (secret && secret.length >= 32) return secret
  if (process.env.NODE_ENV === "production") {
    throw new Error("PORTAL_AUTH_SECRET не задан или короче 32 символов")
  }
  return "dev-portal-secret-change-me-dev-portal-secret"
}

export function hmac(data: string, purpose: string): string {
  return createHmac("sha256", `${purpose}:${authSecret()}`).update(data).digest("base64url")
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export function sign(payload: unknown, purpose: string): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${data}.${hmac(data, purpose)}`
}

export function unsign<T>(token: string | undefined | null, purpose: string): T | null {
  if (!token) return null
  const dot = token.lastIndexOf(".")
  if (dot <= 0) return null
  const data = token.slice(0, dot)
  if (!safeEqual(token.slice(dot + 1), hmac(data, purpose))) return null
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as T
  } catch {
    return null
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url")
}

export function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex")
}
