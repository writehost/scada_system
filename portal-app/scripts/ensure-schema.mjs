// Создаёт таблицы portal_* (идемпотентно). Существующие таблицы WMS/YMS не трогает.
// Запуск: PORTAL_DATABASE_URL=postgres://… node --experimental-strip-types scripts/ensure-schema.mjs
import pg from "pg"
import { PORTAL_SCHEMA_SQL } from "../lib/schema.ts"

const url = process.env.PORTAL_DATABASE_URL || process.env.DATABASE_URL
if (!url) {
  console.error("Задайте PORTAL_DATABASE_URL")
  process.exit(1)
}
const client = new pg.Client({ connectionString: url })
await client.connect()
await client.query(PORTAL_SCHEMA_SQL)
await client.end()
console.log("portal_* схема готова")
