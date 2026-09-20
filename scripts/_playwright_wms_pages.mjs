#!/usr/bin/env node
import { chromium } from "@playwright/test"

const BASE = process.env.WMS_TEST_BASE || "http://83.222.9.11:3004"
const LOGIN = process.env.WMS_TEST_LOGIN || "nikita"
const PASSWORD = process.env.WMS_TEST_PASSWORD || "admin"

const ROUTES = [
  "/",
  "/search",
  "/receiving",
  "/movement",
  "/issue",
  "/return",
  "/revision",
  "/virtual-warehouse",
  "/warehouse-stock/materials",
  "/warehouse-stock/finished-goods",
  "/occupancy",
  "/cells",
  "/tasks",
  "/documents",
  "/terminals",
  "/nomenclature",
  "/references",
  "/settings",
  "/pos-terminal",
]

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const page = await context.newPage()

const consoleErrors = []
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`))
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(`console: ${msg.text()}`)
})

await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 })
await page.locator("#login").fill(LOGIN)
await page.locator("#password").fill(PASSWORD)
await page.locator('button[type="submit"]').click()
await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30000 })

const failures = []

for (const route of ROUTES) {
  consoleErrors.length = 0
  const res = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 90000 })
  const status = res?.status() ?? 0
  await page.waitForTimeout(1500)
  const bodyText = await page.locator("body").innerText().catch(() => "")
  const crash =
    /couldn.t load/i.test(bodyText) ||
    /Application error/i.test(bodyText) ||
    bodyText.includes("500:") ||
    consoleErrors.some((e) => /TypeError|ReferenceError|Invariant/i.test(e))

  const title = await page.title()
  console.log(`${status} ${route.padEnd(35)} ${crash ? "FAIL" : "OK"} | ${title.slice(0, 40)}`)
  if (crash) {
    failures.push({ route, bodyText: bodyText.slice(0, 400), consoleErrors: [...consoleErrors] })
  }
}

await browser.close()

if (failures.length) {
  console.log("\n=== FAILURES ===")
  for (const f of failures) {
    console.log(`\n${f.route}:`)
    console.log(f.bodyText)
    for (const e of f.consoleErrors) console.log(" ", e)
  }
  process.exit(1)
}

console.log("\nAll routes passed browser smoke test")
