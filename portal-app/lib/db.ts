import { Pool, type PoolClient } from "pg"
import { PORTAL_SCHEMA_SQL } from "./schema"
import { HttpError } from "./errors"

let pool: Pool | null = null
let schemaReady: Promise<void> | null = null

function fromUrl(url: string): Pool {
  const parsed = new URL(url)
  const sslmode = parsed.searchParams.get("sslmode")
  return new Pool({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\/+/, ""),
    ssl: sslmode === "disable" || !sslmode ? false : { rejectUnauthorized: sslmode === "verify-full" },
    max: 6,
  })
}

export function tryGetPool(): Pool | null {
  if (pool) return pool
  const url = (process.env.PORTAL_DATABASE_URL || process.env.DATABASE_URL || "").trim()
  if (!url) return null
  pool = fromUrl(url)
  return pool
}

async function ensureSchema(p: Pool): Promise<void> {
  if (!schemaReady) {
    schemaReady = p.query(PORTAL_SCHEMA_SQL).then(
      () => undefined,
      (err) => {
        schemaReady = null
        throw err
      }
    )
  }
  return schemaReady
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const p = tryGetPool()
  if (!p) throw new HttpError(503, "База данных портала не настроена", "no_database")
  await ensureSchema(p)
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
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw err
    }
  })
}
