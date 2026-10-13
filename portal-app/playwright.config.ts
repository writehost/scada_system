import { defineConfig, devices } from "@playwright/test"
import path from "node:path"

const PORT = 3120
const STUB = 3199
const BASE = `http://127.0.0.1:${PORT}`

export const TEST_ENV = {
  PORTAL_DATABASE_URL: process.env.PORTAL_TEST_DATABASE_URL || "postgres://portal:portal@127.0.0.1:5432/portal_test?sslmode=disable",
  PORTAL_PUBLIC_URL: BASE,
  PORTAL_AUTH_SECRET: "e2e-portal-secret-0123456789abcdef0123456789",
  PORTAL_COOKIE_SECURE: "false",
  SCADA_ID_ISSUER: `http://127.0.0.1:${STUB}/realms/scada-system-id`,
  SCADA_ID_API: `http://127.0.0.1:${STUB}`,
  PORTAL_SCADA_ID_CLIENT_ID: "scada-portal",
  PORTAL_SCADA_ID_CLIENT_SECRET: "portal-test-secret",
  PORTAL_SCADA_ID_ADMIN_CLIENT_ID: "portal-provisioner",
  PORTAL_SCADA_ID_ADMIN_CLIENT_SECRET: "provisioner-test-secret",
  PORTAL_SCADA_ID_APP_GROUPS: JSON.stringify({ "scada-wms": "/apps/scada-wms/operator", "scada-yms": "/apps/scada-yms/operator" }),
  PORTAL_SCADA_ID_ORGANIZATIONS: "1",
  PORTAL_SEND_MAIL_BIN: path.resolve("tests/support/mail-sink.py"),
  PORTAL_MAIL_SINK_DIR: path.resolve("test-results/mail"),
  PORTAL_ADMIN_NOTIFY_EMAILS: "owner@scada.test",
  PORTAL_FORM_MIN_FILL_MS: "300",
  PORTAL_RATE_PER_IP_HOUR: "100",
  PORTAL_RATE_PER_EMAIL_DAY: "3",
  PORTAL_CONTACT_EMAIL: "hello@scadasystem.test",
}

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: "./tests/e2e/global-setup.ts",
  reporter: [["list"]],
  use: { baseURL: BASE, trace: "retain-on-failure", locale: "ru-RU" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      command: `node tests/support/scada-id-stub.mjs`,
      url: `http://127.0.0.1:${STUB}/__stub/state`,
      env: { STUB_PORT: String(STUB) },
      reuseExistingServer: false,
    },
    {
      command: `${process.env.E2E_SKIP_BUILD ? "" : "npm run build && "}node .next/standalone/server.js`,
      url: `${BASE}/api/health`,
      env: { ...TEST_ENV, PORT: String(PORT), HOSTNAME: "127.0.0.1" },
      timeout: 240_000,
      reuseExistingServer: false,
    },
  ],
})
