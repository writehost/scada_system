// Тестовый двойник SCADA ID: тот же контракт, что использует WMS и EMS —
// Keycloak OIDC (auth/token/userinfo, PKCE S256) и /api/v1/permissions/resolve.
import http from "node:http"
import { createHash, randomBytes } from "node:crypto"
import type { AddressInfo } from "node:net"

export type MockUser = {
  sub: string
  email: string
  name: string
  grants: Array<{ application_slug: string; role: string }>
  organization?: { slug: string; name: string } | null
  superAdmin?: boolean
}

export async function startMockScadaId(clientSecret: string) {
  const codes = new Map<string, { user: MockUser; challenge: string; redirectUri: string }>()
  const tokens = new Map<string, MockUser>()
  let nextUser: MockUser | null = null
  const realm = "/realms/scada-system-id/protocol/openid-connect"

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x")
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" })
      res.end(JSON.stringify(body))
    }
    const bearer = () => /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? ""
    if (url.pathname === `${realm}/auth`) {
      const user = nextUser
      if (!user) return json(400, { error: "no_user" })
      if (url.searchParams.get("code_challenge_method") !== "S256") return json(400, { error: "pkce_required" })
      const code = randomBytes(12).toString("hex")
      codes.set(code, { user, challenge: url.searchParams.get("code_challenge") ?? "", redirectUri: url.searchParams.get("redirect_uri") ?? "" })
      const back = new URL(url.searchParams.get("redirect_uri")!)
      back.searchParams.set("code", code)
      back.searchParams.set("state", url.searchParams.get("state") ?? "")
      res.writeHead(302, { Location: back.toString() })
      return res.end()
    }
    if (url.pathname === `${realm}/token` && req.method === "POST") {
      let body = ""
      for await (const chunk of req) body += chunk
      const p = new URLSearchParams(body)
      const entry = codes.get(p.get("code") ?? "")
      if (!entry) return json(400, { error: "invalid_grant" })
      codes.delete(p.get("code")!)
      if (p.get("client_secret") !== clientSecret) return json(401, { error: "invalid_client" })
      if (p.get("redirect_uri") !== entry.redirectUri) return json(400, { error: "invalid_grant", error_description: "redirect_uri mismatch" })
      const challenge = createHash("sha256").update(p.get("code_verifier") ?? "").digest("base64url")
      if (challenge !== entry.challenge) return json(400, { error: "invalid_grant", error_description: "PKCE verification failed" })
      const token = randomBytes(16).toString("hex")
      tokens.set(token, entry.user)
      return json(200, { access_token: token, token_type: "Bearer", expires_in: 300 })
    }
    if (url.pathname === `${realm}/userinfo`) {
      const u = tokens.get(bearer())
      if (!u) return json(401, { error: "invalid_token" })
      return json(200, { sub: u.sub, email: u.email, name: u.name, preferred_username: u.email })
    }
    if (url.pathname === "/api/v1/permissions/resolve") {
      const u = tokens.get(bearer())
      if (!u) return json(401, { error: "invalid_token" })
      return json(200, {
        subject_id: u.sub,
        user_id: u.sub,
        email: u.email,
        display_name: u.name,
        is_super_admin: Boolean(u.superAdmin),
        is_god: false,
        grants: u.grants.map((g) => ({ ...g, application_id: g.application_slug, application_name: g.application_slug, allowed: g.role !== "none" })),
        organization: u.organization ?? null,
      })
    }
    json(404, { error: "not_found" })
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const port = (server.address() as AddressInfo).port
  return {
    issuer: `http://127.0.0.1:${port}/realms/scada-system-id`,
    api: `http://127.0.0.1:${port}`,
    setUser: (u: MockUser) => {
      nextUser = u
    },
    /** Выдать access token напрямую (как после входа в SCADA Mobile). */
    issueToken: (u: MockUser) => {
      const t = randomBytes(16).toString("hex")
      tokens.set(t, u)
      return t
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}
