import pg from "pg"

export type Db = pg.PoolClient | pg.Client

// NUMERIC приходит строкой — деньги храним с двумя знаками, double достаточно для отображения.
pg.types.setTypeParser(1700, (v) => (v == null ? null : Number.parseFloat(v)))
// BIGINT (идентификаторы каналов, курсоры ленты) — в пределах 2^53.
pg.types.setTypeParser(20, (v) => (v == null ? null : Number(v)))
// DATE оставляем строкой YYYY-MM-DD: календарная дата не должна сдвигаться часовым поясом процесса.
pg.types.setTypeParser(1082, (v) => v)

let pool: pg.Pool | null = null

export function databaseUrl(): string {
  return (process.env.EMS_DATABASE_URL || process.env.DATABASE_URL || "").trim()
}

export function clientConfig(url = databaseUrl()): pg.ClientConfig {
  const parsed = new URL(url)
  const sslmode = parsed.searchParams.get("sslmode")
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\/+/, ""),
    ssl: sslmode === "disable" || !sslmode ? false : { rejectUnauthorized: sslmode === "verify-full" },
  }
}

export function getPool(): pg.Pool {
  if (pool) return pool
  const url = databaseUrl()
  if (!url) throw new DbUnavailableError()
  pool = new pg.Pool({ ...clientConfig(url), max: Number(process.env.EMS_DB_POOL_MAX || 10) })
  pool.on("error", (err) => console.error("[ems] pg pool error", err.message))
  return pool
}

export async function closePool(): Promise<void> {
  if (pool) {
    const p = pool
    pool = null
    await p.end()
  }
}

export class DbUnavailableError extends Error {
  constructor() {
    super("База данных SCADA EMS не настроена (EMS_DATABASE_URL)")
    this.name = "DbUnavailableError"
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value)
}

async function inTx<T>(setup: (c: pg.PoolClient) => Promise<void>, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query("BEGIN")
    await setup(client)
    const result = await fn(client)
    await client.query("COMMIT")
    return result
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

/**
 * Транзакция в контексте одной организации. RLS пропускает только строки
 * этой организации, даже если в запросе забыт фильтр по org_id.
 */
export function withOrg<T>(orgId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  if (!isUuid(orgId)) throw new Error("withOrg: invalid org id")
  return inTx(async (c) => {
    await c.query("SELECT set_config('ems.org_id', $1, true), set_config('ems.scope', '', true)", [orgId])
  }, fn)
}

/** Межорганизационная транзакция: только для аутентификации и фоновых задач. */
export function withSystem<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  return inTx(async (c) => {
    await c.query("SELECT set_config('ems.scope', 'system', true), set_config('ems.org_id', '', true)")
  }, fn)
}

/** Переключает уже открытую транзакцию на организацию (используется фоновыми задачами по каждой организации). */
export async function enterOrg(c: Db, orgId: string): Promise<void> {
  if (!isUuid(orgId)) throw new Error("enterOrg: invalid org id")
  await c.query("SELECT set_config('ems.org_id', $1, true), set_config('ems.scope', '', true)", [orgId])
}
