import pg from "pg"
import type { Pool, PoolClient } from "pg"

let pool: Pool | null = null

export function poolFromUrl(url: string, max = 6): Pool {
  const parsed = new URL(url)
  const sslmode = parsed.searchParams.get("sslmode")
  return new pg.Pool({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\/+/, ""),
    ssl: sslmode === "disable" || !sslmode ? false : { rejectUnauthorized: sslmode === "verify-full" },
    max,
  })
}

export function tryGetPool(): Pool | null {
  if (pool) return pool
  const url = (process.env.DATABASE_URL || process.env.PG_URL || "").trim()
  if (!url) return null
  pool = poolFromUrl(url)
  return pool
}

/** Для тестов и скриптов: подменить пул. */
export function setPool(next: Pool | null) {
  pool = next
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const p = tryGetPool()
  if (!p) throw new HttpError(503, "База данных не настроена (DATABASE_URL)", "db_not_configured")
  const client = await p.connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}

export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query("BEGIN")
    try {
      const out = await fn(client)
      await client.query("COMMIT")
      return out
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw e
    }
  })
}

export class HttpError extends Error {
  status: number
  code: string
  details?: unknown
  constructor(status: number, message: string, code = "error", details?: unknown) {
    super(message)
    this.name = "HttpError"
    this.status = status
    this.code = code
    this.details = details
  }
}
