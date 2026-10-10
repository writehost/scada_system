// Применяет SQL-миграции из db/migrations по порядку. Каждая — в своей транзакции.
import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"
import { clientConfig, databaseUrl } from "../lib/server/db.ts"

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations")

export async function migrate(url = databaseUrl(), log = console.log): Promise<string[]> {
  if (!url) throw new Error("EMS_DATABASE_URL is not set")
  const client = new pg.Client(clientConfig(url))
  await client.connect()
  const applied: string[] = []
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS ems_schema_migrations (
      version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
    await client.query("SELECT pg_advisory_lock(hashtext('ems_migrate'))")
    const done = new Map(
      (await client.query<{ version: string; checksum: string }>("SELECT version, checksum FROM ems_schema_migrations")).rows.map(
        (r) => [r.version, r.checksum],
      ),
    )
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()
    for (const file of files) {
      const sql = await readFile(path.join(dir, file), "utf8")
      const checksum = createHash("sha256").update(sql).digest("hex")
      const prev = done.get(file)
      if (prev) {
        if (prev !== checksum) throw new Error(`Миграция ${file} изменена после применения`)
        continue
      }
      await client.query("BEGIN")
      try {
        await client.query(sql)
        await client.query("INSERT INTO ems_schema_migrations (version, checksum) VALUES ($1, $2)", [file, checksum])
        await client.query("COMMIT")
      } catch (err) {
        await client.query("ROLLBACK")
        throw new Error(`Миграция ${file}: ${(err as Error).message}`)
      }
      applied.push(file)
      log(`applied ${file}`)
    }
    // Секции телеметрии на текущий и три следующих месяца.
    await client.query(`SELECT ems_ensure_month_partition(t, (date_trunc('month', now()) + make_interval(months => m))::date)
      FROM unnest(ARRAY['ems_readings','ems_agg_hourly']) t, generate_series(-1, 3) m`)
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('ems_migrate'))").catch(() => undefined)
    await client.end()
  }
  return applied
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate()
    .then((a) => console.log(a.length ? `done, ${a.length} applied` : "schema is up to date"))
    .catch((e) => {
      console.error(e.message)
      process.exit(1)
    })
}
