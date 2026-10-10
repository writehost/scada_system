// Создаёт чистую базу для набора тестов. Приложение подключается ролью
// ems_app без прав суперпользователя и без владения таблицами — так RLS
// действует в тестах так же, как в эксплуатации.
import pg from "pg"
import { randomBytes } from "node:crypto"
import { migrate } from "../../scripts/migrate.ts"
import { clientConfig, closePool, withSystem } from "../../lib/server/db.ts"
import { resetPartitionCache } from "../../lib/services/aggregate.ts"
import { createOrganization, upsertUser } from "../../lib/services/org.ts"

const ADMIN_URL = process.env.EMS_TEST_ADMIN_URL || "postgres://ems:ems@127.0.0.1:5432/postgres"

export type TestDb = { name: string; appUrl: string; ownerUrl: string; drop: () => Promise<void> }

export async function createTestDb(): Promise<TestDb> {
  const name = `ems_test_${randomBytes(4).toString("hex")}`
  const admin = new pg.Client(clientConfig(ADMIN_URL))
  await admin.connect()
  await admin.query(`CREATE DATABASE ${name}`)
  await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ems_app') THEN CREATE ROLE ems_app LOGIN PASSWORD 'ems_app' NOSUPERUSER NOBYPASSRLS; END IF; END $$`)
  await admin.end()
  const ownerUrl = ADMIN_URL.replace(/\/[^/]*$/, `/${name}`)
  await migrate(ownerUrl, () => undefined)
  const owner = new pg.Client(clientConfig(ownerUrl))
  await owner.connect()
  await owner.query(`GRANT USAGE, CREATE ON SCHEMA public TO ems_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ems_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ems_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ems_app;`)
  await owner.end()
  const u = new URL(ownerUrl)
  u.username = "ems_app"
  u.password = "ems_app"
  const appUrl = u.toString()
  process.env.EMS_DATABASE_URL = appUrl
  resetPartitionCache()
  return {
    name,
    appUrl,
    ownerUrl,
    drop: async () => {
      await closePool()
      const a = new pg.Client(clientConfig(ADMIN_URL))
      await a.connect()
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
      await a.end()
    },
  }
}

export async function makeOrg(opts: { segment?: "home" | "industrial"; name?: string; email?: string } = {}): Promise<{ orgId: string; userId: string }> {
  return withSystem(async (c) => {
    const subj = `test-${randomBytes(4).toString("hex")}`
    const { userId } = await upsertUser(c, { subject: subj, email: opts.email ?? `${subj}@example.test`, name: "Тестовый пользователь", isPlatformAdmin: false })
    const orgId = await createOrganization(c, { name: opts.name ?? "Тест", kind: opts.segment === "industrial" ? "corporate" : "personal", segment: opts.segment ?? "home", ownerUserId: userId })
    return { orgId, userId }
  })
}
