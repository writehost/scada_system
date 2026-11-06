/**
 * Проверка access token SCADA ID (Keycloak, OIDC) для SCADA System Route.
 *
 * Проверяем: подпись по JWKS издателя, alg (только RS256/ES256), iss, aud/azp = сервис Route,
 * exp/nbf. Токен другого приложения (aud ≠ scada-route) отклоняется, даже если подпись верна.
 */

export type OidcConfig = {
  issuer: string
  audience: string
  jwksUrl: string
  clockSkewSec: number
}

export type OidcClaims = {
  iss: string
  sub: string
  aud?: string | string[]
  azp?: string
  exp: number
  nbf?: number
  iat?: number
  email?: string
  preferred_username?: string
  name?: string
  resource_access?: Record<string, { roles?: string[] }>
  [key: string]: unknown
}

export function oidcConfigFromEnv(): OidcConfig {
  const issuer = (
    process.env.ROUTE_OIDC_ISSUER ||
    process.env.SCADA_ID_ISSUER ||
    "https://id.scada25.ru/realms/scada-system-id"
  )
    .trim()
    .replace(/\/+$/, "")
  return {
    issuer,
    audience: (process.env.ROUTE_OIDC_AUDIENCE || "scada-route").trim(),
    jwksUrl: (process.env.ROUTE_OIDC_JWKS_URL || `${issuer}/protocol/openid-connect/certs`).trim(),
    clockSkewSec: Number(process.env.ROUTE_OIDC_SKEW_SEC || 30) || 30,
  }
}

type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string }

const JWKS_TTL_MS = 10 * 60 * 1000
const jwksCache = new Map<string, { at: number; keys: Jwk[] }>()

async function loadJwks(url: string, force = false): Promise<Jwk[]> {
  const hit = jwksCache.get(url)
  if (!force && hit && Date.now() - hit.at < JWKS_TTL_MS) return hit.keys
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) throw new Error(`JWKS недоступен: HTTP ${res.status}`)
  const body = (await res.json()) as { keys?: Jwk[] }
  const keys = Array.isArray(body.keys) ? body.keys : []
  jwksCache.set(url, { at: Date.now(), keys })
  return keys
}

export function resetJwksCacheForTests() {
  jwksCache.clear()
}

function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

function b64urlJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(value))) as T
}

export function looksLikeJwt(token: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
}

export class OidcError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
  }
}

export async function verifyOidcToken(token: string, cfg: OidcConfig, now = Date.now()): Promise<OidcClaims> {
  const parts = token.split(".")
  if (parts.length !== 3) throw new OidcError("token_format", "не JWT")
  const header = b64urlJson<{ alg?: string; kid?: string; typ?: string }>(parts[0])
  const claims = b64urlJson<OidcClaims>(parts[1])
  const alg = header.alg || ""
  if (alg !== "RS256" && alg !== "ES256") throw new OidcError("token_alg", `алгоритм ${alg || "?"} не разрешён`)

  let keys = await loadJwks(cfg.jwksUrl)
  let jwk = keys.find((k) => k.kid === header.kid && (!k.use || k.use === "sig"))
  if (!jwk) {
    keys = await loadJwks(cfg.jwksUrl, true)
    jwk = keys.find((k) => k.kid === header.kid && (!k.use || k.use === "sig"))
  }
  if (!jwk) throw new OidcError("token_kid", "ключ подписи не найден у издателя")

  const params =
    alg === "RS256"
      ? ({ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const)
      : ({ name: "ECDSA", namedCurve: "P-256" } as const)
  const { kid: _kid, alg: _alg, use: _use, ...pure } = jwk
  void _kid
  void _alg
  void _use
  const key = await crypto.subtle.importKey("jwk", pure, params, false, ["verify"])
  const verifyParams = alg === "RS256" ? params : ({ name: "ECDSA", hash: "SHA-256" } as const)
  const ok = await crypto.subtle.verify(
    verifyParams,
    key,
    b64urlToBytes(parts[2]) as unknown as BufferSource,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`) as unknown as BufferSource
  )
  if (!ok) throw new OidcError("token_signature", "подпись токена неверна")

  const nowSec = Math.floor(now / 1000)
  if ((claims.iss || "").replace(/\/+$/, "") !== cfg.issuer) {
    throw new OidcError("token_issuer", "токен выдан другим издателем")
  }
  const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : []
  if (!aud.includes(cfg.audience) && claims.azp !== cfg.audience) {
    throw new OidcError("token_audience", "токен выдан не для SCADA System Route")
  }
  if (typeof claims.exp !== "number" || claims.exp + cfg.clockSkewSec < nowSec) {
    throw new OidcError("token_expired", "срок действия токена истёк")
  }
  if (typeof claims.nbf === "number" && claims.nbf - cfg.clockSkewSec > nowSec) {
    throw new OidcError("token_not_yet_valid", "токен ещё не действует")
  }
  if (!claims.sub) throw new OidcError("token_subject", "в токене нет subject")
  return claims
}

/** Роли Route из токена: resource_access["scada-route"].roles → коды ролей. */
export function routeRolesFromClaims(claims: OidcClaims, audience: string): string[] {
  const roles = claims.resource_access?.[audience]?.roles ?? []
  const map: Record<string, string> = {
    driver: "route_driver",
    dispatcher: "route_dispatcher",
    admin: "route_admin",
    viewer: "auditor",
  }
  return [...new Set(roles.map((r) => map[r] || "").filter(Boolean))]
}
