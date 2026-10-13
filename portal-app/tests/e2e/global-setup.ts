import { rm } from "node:fs/promises"
import { Client } from "pg"
import { PORTAL_SCHEMA_SQL } from "../../lib/schema"
import { TEST_ENV } from "../../playwright.config"

export default async function globalSetup() {
  await rm(TEST_ENV.PORTAL_MAIL_SINK_DIR, { recursive: true, force: true })
  const c = new Client({ connectionString: TEST_ENV.PORTAL_DATABASE_URL })
  await c.connect()
  await c.query(PORTAL_SCHEMA_SQL)
  await c.query("TRUNCATE portal_access_requests, portal_rate_hits, portal_mail_outbox RESTART IDENTITY CASCADE")
  await c.end()
  await fetch("http://127.0.0.1:3199/__stub/reset", { method: "POST" }).catch(() => undefined)
}
