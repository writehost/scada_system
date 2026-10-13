import { sign, unsign } from "./crypto"

export const OIDC_COOKIE = "portal_oidc"

export type OidcState = { state: string; verifier: string; nonce: string; next: string }

export function safeNext(raw: string | null | undefined): string {
  const v = (raw || "/").trim()
  // Только относительные пути этого сайта: без «//host» и схем.
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return "/"
  return v.slice(0, 500)
}

export const encodeOidcState = (s: OidcState) => sign(s, "oidc")
export const decodeOidcState = (raw: string | undefined) => unsign<OidcState>(raw, "oidc")
