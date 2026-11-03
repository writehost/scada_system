/**
 * Тестовый HTTP-стенд: вызывает настоящие обработчики App Router (app/api/**\/route.ts)
 * без сборки Next — Request/Response те же Web API. Нужен там, где npm недоступен.
 *
 *   tsx --tsconfig tests/route/tsconfig.yms.json tests/route/harness/serve.ts --root app/api --port 3914
 */
import http from "node:http"
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1])
const root = path.resolve(args.get("root") || "app/api")
const prefix = args.get("prefix") || "/api"
const port = Number(args.get("port") || 3914)
const staticDir = args.get("static") ? path.resolve(args.get("static")!) : null

type RouteDef = { re: RegExp; keys: string[]; file: string }
const routes: RouteDef[] = []

function walk(dir: string, segs: string[]) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, [...segs, name])
    else if (name === "route.ts") {
      const keys: string[] = []
      const pattern = segs
        .map((s) => {
          const m = s.match(/^\[(.+)\]$/)
          if (m) {
            keys.push(m[1])
            return "([^/]+)"
          }
          return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        })
        .join("/")
      routes.push({ re: new RegExp(`^${prefix}/${pattern}/?$`), keys, file: p })
    }
  }
}
walk(root, [])
routes.sort((a, b) => a.keys.length - b.keys.length)

const cache = new Map<string, Record<string, unknown>>()
async function load(file: string) {
  if (!cache.has(file)) cache.set(file, await import(pathToFileURL(file).href))
  return cache.get(file)!
}

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" }

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`)
    if (staticDir && !url.pathname.startsWith(prefix + "/")) {
      let rel = decodeURIComponent(url.pathname)
      if (rel.endsWith("/")) rel += "index.html"
      const f = path.join(staticDir, rel)
      const tryFiles = [f, `${f}.html`, path.join(f, "index.html")]
      const hit = tryFiles.find((x) => x.startsWith(staticDir) && existsSync(x) && statSync(x).isFile())
      if (hit) {
        res.writeHead(200, { "content-type": MIME[path.extname(hit)] || "application/octet-stream" })
        res.end(readFileSync(hit))
        return
      }
    }
    const def = routes.find((r) => r.re.test(url.pathname))
    if (!def) {
      res.writeHead(404, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: "no route" }))
      return
    }
    const m = url.pathname.match(def.re)!
    const params: Record<string, string> = {}
    def.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])))
    const mod = await load(def.file)
    const handler = mod[req.method || "GET"] as ((r: Request, c: unknown) => Promise<Response>) | undefined
    if (!handler) {
      res.writeHead(405)
      res.end()
      return
    }
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const body = chunks.length ? Buffer.concat(chunks) : undefined
    const ctrl = new AbortController()
    req.on("close", () => ctrl.abort())
    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x))
      else if (v != null) headers.set(k, v)
    }
    const request = new Request(url, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      signal: ctrl.signal,
    })
    const response = await handler(request, { params: Promise.resolve(params) })
    const out: Record<string, string | string[]> = {}
    response.headers.forEach((v, k) => {
      if (k === "set-cookie") return
      out[k] = v
    })
    const cookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? []
    if (cookies.length) out["set-cookie"] = cookies
    res.writeHead(response.status, out)
    if (!response.body) {
      res.end()
      return
    }
    const reader = response.body.getReader()
    req.on("close", () => void reader.cancel().catch(() => undefined))
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
    res.end()
  } catch (error) {
    console.error("[harness]", error)
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" })
    res.end(JSON.stringify({ error: String((error as Error)?.message || error) }))
  }
})

server.listen(port, "127.0.0.1", () => {
  console.log(`harness ${root} on :${port} (${routes.length} routes)`)
})
