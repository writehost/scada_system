import { Pool } from "pg"

let pool: Pool | null = null

function fromUrl(url: string): Pool {
  const parsed = new URL(url)
  const sslmode = parsed.searchParams.get("sslmode")
  return new Pool({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\/+/, ""),
    ssl: sslmode === "disable" ? false : undefined,
    max: 4,
  })
}

export function tryGetPool(): Pool | null {
  if (pool) return pool
  const url = (process.env.DATABASE_URL || process.env.PG_URL || "").trim()
  if (!url) return null
  pool = fromUrl(url)
  return pool
}
