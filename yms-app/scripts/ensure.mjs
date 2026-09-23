import pg from "pg"
import { ensureYmsSchema, ensureYardSeed } from "./schema.ts"

const url = process.env.DATABASE_URL || process.env.PG_URL || ""
if (!url) throw new Error("DATABASE_URL is missing")
const parsed = new URL(url)
const client = new pg.Client({
  host: parsed.hostname,
  port: parsed.port ? Number(parsed.port) : 5432,
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: parsed.pathname.replace(/^\/+/, ""),
  ssl: parsed.searchParams.get("sslmode") === "disable" ? false : undefined,
})
await client.connect()
await ensureYmsSchema(client)
const siteCode = (process.env.WMS_SITE_CODE || "skeet").trim() || "skeet"
const site = await client.query(
  `SELECT site_id FROM wms_sites WHERE is_active AND (site_code = $1 OR site_code = 'skeet') ORDER BY site_id LIMIT 1`,
  [siteCode]
)
const siteId = site.rows[0]?.site_id
if (!siteId) throw new Error("site not found")
await ensureYardSeed(client, siteId)
const count = await client.query(`SELECT count(*)::int AS n FROM yms_yard_objects WHERE site_id = $1`, [siteId])
console.log("yms_ready", count.rows[0].n)
await client.end()
