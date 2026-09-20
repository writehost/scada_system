#!/usr/bin/env node
import { chromium } from "@playwright/test"

const args = process.argv.slice(2)
function arg(name, fallback = "") {
  const i = args.indexOf(name)
  return i >= 0 ? String(args[i + 1] ?? fallback) : fallback
}

const base = (arg("--base", process.env.WMS_E2E_BASE_URL || "http://127.0.0.1:3000")).replace(/\/$/, "")
const login = arg("--login", process.env.WMS_E2E_LOGIN || "nikita")
const password = arg("--password", process.env.WMS_E2E_PASSWORD || "admin")
const headed = args.includes("--headed")
const allowApi503 = args.includes("--allow-api-503")
const timeoutMs = Number(arg("--timeout-ms", "30000"))

const pages = [
  "/",
  "/receiving",
  "/movement",
  "/issue",
  "/documents",
  "/tasks",
  "/settings",
  "/settings?section=directories&dirTab=itemGroups",
  "/cells",
  "/settings?section=directories&dirTab=cellProfile",
  "/warehouse-stock",
]

const allowedConsoleNoise = [
  "Failed to load resource: the server responded with a status of 404",
  "/_vercel/insights/script.js",
  "The resource ",
  "was preloaded using link preload",
  "DevTools failed to load source map",
]

const failures = []

function isAllowedConsoleError(text) {
  return allowedConsoleNoise.some((needle) => text.includes(needle))
}

const browser = await chromium.launch({ headless: !headed })
const context = await browser.newContext({ baseURL: base })
const page = await context.newPage()

page.on("pageerror", (err) => {
  failures.push(`PAGEERROR ${page.url()}: ${err.message}`)
})

page.on("console", (msg) => {
  if (msg.type() !== "error") return
  const text = msg.text()
  if (isAllowedConsoleError(text)) return
  if (allowApi503 && text.includes("Failed to load resource: the server responded with a status of 503")) return
  failures.push(`CONSOLE ${page.url()}: ${text}`)
})

page.on("response", (res) => {
  const url = res.url()
  const status = res.status()
  if (status < 500) return
  if (allowApi503 && status === 503 && url.includes("/api/wms/")) return
  failures.push(`HTTP ${status} ${url}`)
})

async function loginViaApi() {
  const res = await context.request.post("/api/auth/login", {
    data: { login, password },
  })
  if (!res.ok()) {
    const body = await res.text().catch(() => "")
    throw new Error(`login failed: HTTP ${res.status()} ${body.slice(0, 300)}`)
  }
}

function pageFailedByContent(text) {
  return (
    text.includes("This page couldn't load") ||
    text.includes("A server error occurred") ||
    text.includes("__next_error__")
  )
}

await loginViaApi()

for (const route of pages) {
  const before = failures.length
  const response = await page.goto(route, { waitUntil: "domcontentloaded", timeout: timeoutMs })
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => undefined)
  const status = response?.status() ?? 0
  const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")

  if (status >= 400) failures.push(`PAGE ${route}: HTTP ${status}`)
  if (page.url().includes("/login")) failures.push(`PAGE ${route}: redirected to login`)
  if (pageFailedByContent(text)) failures.push(`PAGE ${route}: Next error page`)

  if (route === "/movement") {
    const beforeOps = failures.length
    await page.getByText("Группа номенклатуры", { exact: false }).first().waitFor({ timeout: 8000 }).catch(() => undefined)
    const groupBtn = page.locator('button:has-text("поз.")').first()
    if (await groupBtn.isVisible().catch(() => false)) {
      await groupBtn.click({ timeout: 3000 }).catch(() => undefined)
      await page.waitForTimeout(500)
    }
    const bodyAfter = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "")
    if (pageFailedByContent(bodyAfter)) failures.push(`PAGE ${route}: error after group pick`)
    if (failures.length > beforeOps) failures.push(`PAGE ${route}: errors in group browser`)
  }

  if (route === "/issue") {
    const beforeOps = failures.length
    await page.waitForTimeout(600)
    const tabs = page.locator("button.rounded-xl.border").filter({ hasText: /поз\.|групп/i })
    const count = await tabs.count().catch(() => 0)
    if (count > 1) {
      await tabs.nth(1).click({ timeout: 3000 }).catch(() => undefined)
      await page.waitForTimeout(500)
    }
    const bodyAfter = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "")
    if (pageFailedByContent(bodyAfter)) failures.push(`PAGE ${route}: error after group tab`)
    if (failures.length > beforeOps) failures.push(`PAGE ${route}: errors in issue groups`)
  }

  if (route === "/receiving") {
    const beforeOps = failures.length
    await page.waitForTimeout(600)
    const grp = page.locator(".flex.flex-wrap.gap-2 button").first()
    if (await grp.isVisible().catch(() => false)) {
      await grp.click({ timeout: 3000 }).catch(() => undefined)
      await page.waitForTimeout(400)
    }
    if (failures.length > beforeOps) failures.push(`PAGE ${route}: errors on receiving groups`)
  }

  if (route === "/cells") {
    const beforeDialog = failures.length
    await page.getByRole("button", { name: "Ячейка" }).click({ timeout: 5000 }).catch(() => undefined)
    await page.waitForTimeout(400)
    const dialogText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "")
    if (pageFailedByContent(dialogText)) failures.push(`PAGE ${route}: error after opening create dialog`)
    const addedDialog = failures.length - beforeDialog
    if (addedDialog > 0) failures.push(`PAGE ${route}: errors while create dialog open`)
    await page.keyboard.press("Escape").catch(() => undefined)
  }

  const added = failures.length - before
  console.log(`${added === 0 ? "OK" : "FAIL"} ${route} HTTP ${status} ${page.url()}`)
}

await browser.close()

if (failures.length) {
  console.error("\nE2E failures:")
  for (const f of failures) console.error(`- ${f}`)
  process.exit(1)
}

console.log("\nE2E pages OK")
