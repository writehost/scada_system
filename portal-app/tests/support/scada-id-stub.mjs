// Тестовый стенд SCADA ID для e2e: те же маршруты Keycloak (OIDC + Admin REST)
// и API прав /api/v1/permissions/resolve, которые вызывает портал.
// Только для тестов и локальной разработки — в прод не попадает.
import { createServer } from "node:http"
import { randomBytes, randomUUID } from "node:crypto"

const PORT = Number(process.env.STUB_PORT || 3199)
const REALM = "scada-system-id"
const CLIENT_ID = "scada-portal"
const CLIENT_SECRET = "portal-test-secret"
const ADMIN_ID = "portal-provisioner"
const ADMIN_SECRET = "provisioner-test-secret"

const GROUPS = [
  { id: "g-wms-op", path: "/apps/scada-wms/operator" },
  { id: "g-yms-op", path: "/apps/scada-yms/operator" },
]
const ORGS = [
  { id: "org-skit", name: "Завод Скит" },
  { id: "org-test", name: "ООО Тестовая организация" },
]

function fresh() {
  return {
    users: [
      { id: "u-owner", email: "owner@scada.test", firstName: "Ольга", lastName: "Владелец", attributes: {}, god: true, groups: [], orgs: [] },
      { id: "u-existing", email: "existing@client.test", firstName: "Егор", lastName: "Существующий", attributes: {}, god: false, groups: [], orgs: [] },
      { id: "u-viewer", email: "viewer@client.test", firstName: "Вера", lastName: "Наблюдатель", attributes: {}, god: false, groups: ["g-wms-op"], orgs: ["org-skit"] },
    ],
    codes: new Map(),
    tokens: new Map(),
    actionEmails: [],
  }
}
let state = fresh()

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url")
const jwt = (payload) => `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.stub`

function send(res, status, body, headers = {}) {
  const isStr = typeof body === "string"
  res.writeHead(status, { "Content-Type": isStr ? "text/html; charset=utf-8" : "application/json", ...headers })
  res.end(isStr ? body : body === undefined ? "" : JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks).toString("utf8")
}

function bearer(req) {
  const h = req.headers.authorization || ""
  return state.tokens.get(h.replace(/^Bearer\s+/i, ""))
}

const userBy = (email) => state.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase())
const rep = (u) => ({
  id: u.id,
  username: u.email,
  email: u.email,
  emailVerified: true,
  enabled: true,
  firstName: u.firstName,
  lastName: u.lastName,
  attributes: u.attributes,
  requiredActions: u.requiredActions || [],
})

function permissions(u) {
  const grants = u.groups
    .map((gid) => GROUPS.find((g) => g.id === gid))
    .filter(Boolean)
    .map((g) => {
      const [, , app, role] = g.path.split("/")
      return { application_slug: app, application_name: app, role, allowed: true }
    })
  const orgId = u.orgs[0] || u.attributes.scada_organization?.[0]
  const org = ORGS.find((o) => o.id === orgId)
  return {
    subject_id: u.id,
    user_id: u.id,
    email: u.email,
    display_name: `${u.firstName} ${u.lastName}`,
    is_super_admin: false,
    is_god: Boolean(u.god),
    grants,
    organization: org ? { slug: org.id, name: org.name, site_code: "" } : null,
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const p = url.pathname
  const base = `/realms/${REALM}/protocol/openid-connect`
  const admin = `/admin/realms/${REALM}`

  try {
    if (p === "/__stub/state") {
      return send(res, 200, { users: state.users, actionEmails: state.actionEmails })
    }
    if (p === "/__stub/reset" && req.method === "POST") {
      state = fresh()
      return send(res, 200, { ok: true })
    }

    if (p === `${base}/auth`) {
      const q = url.searchParams
      if (q.get("client_id") !== CLIENT_ID) return send(res, 400, "bad client")
      const hint = q.get("login_hint") || ""
      return send(
        res,
        200,
        `<!doctype html><meta charset="utf-8"><title>SCADA ID — тестовый стенд</title>
        <h1>SCADA ID (тестовый стенд)</h1>
        <form method="post" action="${base}/auth/submit">
          ${["redirect_uri", "state", "nonce"].map((k) => `<input type="hidden" name="${k}" value="${q.get(k) || ""}">`).join("")}
          <label>Email <input name="email" id="stub-email" value="${hint}"></label>
          <button id="stub-login" type="submit">Войти</button>
        </form>`
      )
    }
    if (p === `${base}/auth/submit` && req.method === "POST") {
      const f = new URLSearchParams(await readBody(req))
      const u = userBy(f.get("email"))
      if (!u) return send(res, 200, `<p id="stub-error">Нет пользователя</p>`)
      const code = randomBytes(12).toString("hex")
      state.codes.set(code, { userId: u.id, nonce: f.get("nonce") })
      const to = new URL(f.get("redirect_uri"))
      to.searchParams.set("code", code)
      to.searchParams.set("state", f.get("state"))
      return send(res, 302, "", { Location: to.toString() })
    }
    if (p === `${base}/token` && req.method === "POST") {
      const f = new URLSearchParams(await readBody(req))
      if (f.get("grant_type") === "client_credentials") {
        if (f.get("client_id") !== ADMIN_ID || f.get("client_secret") !== ADMIN_SECRET) return send(res, 401, { error: "unauthorized_client", error_description: "bad admin secret" })
        const t = randomBytes(16).toString("hex")
        state.tokens.set(t, { admin: true })
        return send(res, 200, { access_token: t, expires_in: 300 })
      }
      if (f.get("client_id") !== CLIENT_ID || f.get("client_secret") !== CLIENT_SECRET) return send(res, 401, { error: "unauthorized_client" })
      const c = state.codes.get(f.get("code"))
      if (!c || !f.get("code_verifier")) return send(res, 400, { error: "invalid_grant" })
      state.codes.delete(f.get("code"))
      const u = state.users.find((x) => x.id === c.userId)
      const t = randomBytes(16).toString("hex")
      state.tokens.set(t, { userId: u.id })
      return send(res, 200, { access_token: t, id_token: jwt({ sub: u.id, email: u.email, nonce: c.nonce, given_name: u.firstName, family_name: u.lastName }) })
    }
    if (p === `${base}/userinfo`) {
      const t = bearer(req)
      const u = t && state.users.find((x) => x.id === t.userId)
      if (!u) return send(res, 401, {})
      return send(res, 200, { sub: u.id, email: u.email, name: `${u.firstName} ${u.lastName}`, given_name: u.firstName, family_name: u.lastName })
    }
    if (p === `${base}/logout`) {
      return send(res, 302, "", { Location: url.searchParams.get("post_logout_redirect_uri") || "/" })
    }
    if (p === "/api/v1/permissions/resolve") {
      const t = bearer(req)
      const u = t && state.users.find((x) => x.id === t.userId)
      if (!u) return send(res, 401, {})
      return send(res, 200, permissions(u))
    }

    if (p.startsWith(admin)) {
      if (!bearer(req)?.admin) return send(res, 401, { error: "no admin token" })
      const rest = p.slice(admin.length)
      if (rest === "/users" && req.method === "GET") {
        const email = url.searchParams.get("email")
        const u = userBy(email)
        return send(res, 200, u ? [rep(u)] : [])
      }
      if (rest === "/users" && req.method === "POST") {
        const body = JSON.parse(await readBody(req))
        if (userBy(body.email)) return send(res, 409, { errorMessage: "User exists with same email" })
        const u = { id: randomUUID(), email: body.email, firstName: body.firstName, lastName: body.lastName, attributes: body.attributes || {}, god: false, groups: [], orgs: [], emailVerified: body.emailVerified }
        state.users.push(u)
        return send(res, 201, undefined, { Location: `http://127.0.0.1:${PORT}${admin}/users/${u.id}` })
      }
      let m = rest.match(/^\/users\/([^/]+)$/)
      if (m) {
        const u = state.users.find((x) => x.id === m[1])
        if (!u) return send(res, 404, {})
        if (req.method === "GET") return send(res, 200, rep(u))
        if (req.method === "PUT") {
          const body = JSON.parse(await readBody(req))
          u.attributes = body.attributes || u.attributes
          return send(res, 204)
        }
      }
      m = rest.match(/^\/users\/([^/]+)\/execute-actions-email$/)
      if (m && req.method === "PUT") {
        const u = state.users.find((x) => x.id === m[1])
        if (!u) return send(res, 404, {})
        const actions = JSON.parse(await readBody(req))
        u.requiredActions = actions
        state.actionEmails.push({ userId: u.id, email: u.email, actions, redirectUri: url.searchParams.get("redirect_uri"), clientId: url.searchParams.get("client_id") })
        return send(res, 204)
      }
      m = rest.match(/^\/group-by-path\/(.+)$/)
      if (m) {
        const path = "/" + m[1].split("/").map(decodeURIComponent).join("/")
        const g = GROUPS.find((x) => x.path === path)
        return g ? send(res, 200, g) : send(res, 404, {})
      }
      m = rest.match(/^\/users\/([^/]+)\/groups\/([^/]+)$/)
      if (m && req.method === "PUT") {
        const u = state.users.find((x) => x.id === m[1])
        if (!u || !GROUPS.some((g) => g.id === m[2])) return send(res, 404, {})
        if (!u.groups.includes(m[2])) u.groups.push(m[2])
        return send(res, 204)
      }
      if (rest === "/organizations" && req.method === "GET") return send(res, 200, ORGS.map((o) => ({ id: o.id, name: o.name })))
      m = rest.match(/^\/organizations\/([^/]+)\/members$/)
      if (m && req.method === "POST") {
        const userId = JSON.parse(await readBody(req))
        const u = state.users.find((x) => x.id === userId)
        if (!u || !ORGS.some((o) => o.id === m[1])) return send(res, 404, {})
        if (u.orgs.includes(m[1])) return send(res, 409, {})
        u.orgs.push(m[1])
        return send(res, 201)
      }
    }
    send(res, 404, { error: "not found", path: p })
  } catch (e) {
    send(res, 500, { error: String(e) })
  }
})

server.listen(PORT, "127.0.0.1", () => console.log(`SCADA ID stub on :${PORT}`))
