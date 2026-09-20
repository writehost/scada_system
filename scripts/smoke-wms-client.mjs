#!/usr/bin/env node
const args = process.argv.slice(2)
function arg(name, fallback = "") {
  const i = args.indexOf(name)
  return i >= 0 ? String(args[i + 1] ?? fallback) : fallback
}

const base = (arg("--base", process.env.WMS_SMOKE_BASE_URL || "http://10.26.30.36:3004")).replace(/\/$/, "")
const timeoutMs = Number(arg("--timeout-ms", "15000"))
const allowAuthRedirect = args.includes("--allow-auth-redirect")

const pagePaths = [
  "/",
  "/receiving",
  "/movement",
  "/issue",
  "/documents",
  "/tasks",
  "/settings",
  "/cells",
  "/warehouse-stock",
]

const apiChecks = [
  ["/api/app/update-check", [200]],
  ["/api/wms/receiving/operator-feed?siteCode=DEFAULT&limit=3", [200]],
  ["/api/wms/notifications?siteCode=DEFAULT", [200]],
  ["/api/wms/expiry-alerts/active?siteCode=DEFAULT", [200]],
  ["/api/wms/warehouse/occupancy?siteCode=DEFAULT", [200]],
  ["/api/wms/documents?siteCode=DEFAULT&limit=3", [200]],
  ["/api/wms/tasks?siteCode=DEFAULT&limit=3", [200]],
]

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      ...init,
    })
  } finally {
    clearTimeout(t)
  }
}

const failures = []

for (const path of pagePaths) {
  const url = `${base}${path}`
  try {
    const res = await fetchWithTimeout(url)
    const location = res.headers.get("location") || ""
    const authRedirect = res.status >= 300 && res.status < 400 && location.includes("/login")
    const ok = res.status === 200 || (allowAuthRedirect && authRedirect)
    const body = res.status === 200 ? await res.text() : ""
    const hasNextError = body.includes("This page couldn't load") || body.includes("__next_error__")
    if (!ok || hasNextError) {
      failures.push(`PAGE ${path}: HTTP ${res.status}${location ? ` -> ${location}` : ""}${hasNextError ? " NEXT_ERROR" : ""}`)
    }
    console.log(`${ok && !hasNextError ? "OK" : "FAIL"} PAGE ${path} HTTP ${res.status}`)
  } catch (e) {
    failures.push(`PAGE ${path}: ${e instanceof Error ? e.message : String(e)}`)
    console.log(`FAIL PAGE ${path}`)
  }
}

for (const [path, expected] of apiChecks) {
  const url = `${base}${path}`
  try {
    const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } })
    const location = res.headers.get("location") || ""
    const authRedirect = res.status >= 300 && res.status < 400 && location.includes("/login")
    const ok = expected.includes(res.status) || (allowAuthRedirect && authRedirect)
    let payload = ""
    try {
      payload = await res.text()
    } catch {
      payload = ""
    }
    if (!ok) {
      failures.push(`API ${path}: HTTP ${res.status}${location ? ` -> ${location}` : ""} ${payload.slice(0, 300)}`)
    }
    console.log(`${ok ? "OK" : "FAIL"} API ${path} HTTP ${res.status}${authRedirect ? " AUTH_REDIRECT" : ""}`)
  } catch (e) {
    failures.push(`API ${path}: ${e instanceof Error ? e.message : String(e)}`)
    console.log(`FAIL API ${path}`)
  }
}

if (failures.length) {
  console.error("\nSmoke failures:")
  for (const f of failures) console.error(`- ${f}`)
  process.exit(1)
}

console.log("\nSmoke OK")
