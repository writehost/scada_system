import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { expect, type Page } from "@playwright/test"
import { Client } from "pg"
import { TEST_ENV } from "../../playwright.config"

export async function sql<T = Record<string, unknown>>(q: string, args: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: TEST_ENV.PORTAL_DATABASE_URL })
  await c.connect()
  try {
    return (await c.query(q, args)).rows as T[]
  } finally {
    await c.end()
  }
}

export type SentMail = { subject: string; text: string; html: string; recipients: string[] }

export async function mails(): Promise<SentMail[]> {
  const dir = TEST_ENV.PORTAL_MAIL_SINK_DIR
  const files = (await readdir(dir).catch(() => [])).sort()
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(dir, f), "utf8")) as SentMail))
}

export async function mailsTo(email: string) {
  return (await mails()).filter((m) => m.recipients.includes(email))
}

export function linkFrom(mail: SentMail, re = /http:\/\/127\.0\.0\.1:3120\/activate\?token=[A-Za-z0-9_%-]+/): string {
  const m = mail.text.match(re)
  if (!m) throw new Error(`В письме нет ссылки: ${mail.text}`)
  return m[0]
}

export async function stubState() {
  return (await (await fetch("http://127.0.0.1:3199/__stub/state")).json()) as {
    users: Array<{ id: string; email: string; groups: string[]; orgs: string[]; attributes: Record<string, string[]>; emailVerified?: boolean; firstName: string }>
    actionEmails: Array<{ email: string; actions: string[]; redirectUri: string; clientId: string }>
  }
}

/** Вход через стенд SCADA ID (форма логина Keycloak подменена). */
export async function loginAs(page: Page, email: string, next = "/") {
  await page.goto(`/api/auth/login?next=${encodeURIComponent(next)}`)
  await page.locator("#stub-email").fill(email)
  await page.locator("#stub-login").click()
  await page.waitForURL((u) => u.origin === "http://127.0.0.1:3120")
}

export function uniqueEmail(tag: string) {
  return `${tag}.${Date.now()}.${Math.floor(Math.random() * 1e4)}@client.test`
}

export async function formToken(page: Page): Promise<string> {
  const r = await page.request.get("/api/requests/form-token")
  return (await r.json()).token
}

export function payload(email: string, extra: Record<string, unknown> = {}) {
  return {
    firstName: "Иван",
    lastName: "Тестов",
    email,
    company: "ООО Тест",
    jobTitle: "Логист",
    phone: "",
    comment: "",
    consent: true,
    modules: ["wms"],
    idempotencyKey: `k${Date.now()}${Math.floor(Math.random() * 1e9)}abcdef`,
    ...extra,
  }
}

export async function fillApplicant(page: Page, f: { firstName: string; lastName: string; email?: string; company: string; jobTitle: string; comment?: string }) {
  await page.fill("#f-firstName", f.firstName)
  await page.fill("#f-lastName", f.lastName)
  if (f.email !== undefined) await page.fill("#f-email", f.email)
  await page.fill("#f-company", f.company)
  await page.fill("#f-jobTitle", f.jobTitle)
  if (f.comment) await page.fill("#f-comment", f.comment)
  await page.check("#f-consent")
}

export { expect }

export async function submitViaApi(page: Page, email: string, modules: string[], extra: Record<string, unknown> = {}) {
  const token = await formToken(page)
  await page.waitForTimeout(350)
  const r = await page.request.post("/api/requests", {
    data: { ...payload(email, { modules, ...extra }), formToken: token },
    headers: { "Content-Type": "application/json" },
  })
  expect(r.status()).toBe(201)
  const no = (await r.json()).request.publicNo as string
  const [row] = await sql<{ id: number }>("SELECT id::int FROM portal_access_requests WHERE public_no = $1", [no])
  return { no, id: row.id }
}
