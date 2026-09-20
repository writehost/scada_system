import { createHash, randomBytes } from "node:crypto"
import type { PoolClient } from "pg"
import type { WmsAuthSession } from "@/lib/auth/types"
import { tryGetPool } from "@/lib/wms/pool"

export const USER_API_TOKEN_PREFIX = "wmsu_"
const MAX_TOKENS_PER_USER = 10
const LAST_USED_TOUCH_MS = 5 * 60 * 1000

export type UserApiTokenRow = {
  tokenId: string
  name: string
  tokenPrefix: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

let schemaReady = false

export async function ensureUserApiTokensSchema(client: PoolClient): Promise<void> {
  if (schemaReady) return
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_user_api_tokens (
      token_id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES wms_users(user_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      token_prefix TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    )
  `)
  await client.query(
    `CREATE INDEX IF NOT EXISTS wms_user_api_tokens_user_idx
     ON wms_user_api_tokens (user_id) WHERE revoked_at IS NULL`
  )
  schemaReady = true
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

export function isUserApiToken(token: string | null | undefined): boolean {
  return Boolean(token && token.trim().startsWith(USER_API_TOKEN_PREFIX))
}

export function mintUserApiTokenSecret(): { token: string; prefix: string; hash: string } {
  const token = `${USER_API_TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`
  return { token, prefix: token.slice(0, 12), hash: sha256(token) }
}

export async function listUserApiTokens(
  client: PoolClient,
  userId: string
): Promise<UserApiTokenRow[]> {
  await ensureUserApiTokensSchema(client)
  const r = await client.query<{
    token_id: string
    name: string
    token_prefix: string
    created_at: string
    last_used_at: string | null
    revoked_at: string | null
  }>(
    `SELECT token_id::text AS token_id,
            name,
            token_prefix,
            created_at::text,
            last_used_at::text,
            revoked_at::text
     FROM wms_user_api_tokens
     WHERE user_id = $1::bigint AND revoked_at IS NULL
     ORDER BY created_at DESC`,
    [userId]
  )
  return r.rows.map((row) => ({
    tokenId: row.token_id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }))
}

export async function createUserApiToken(
  client: PoolClient,
  userId: string,
  name: string
): Promise<{ token: string; row: UserApiTokenRow }> {
  await ensureUserApiTokensSchema(client)
  const label = name.trim() || "API"
  if (label.length > 80) {
    throw new Error("name_too_long")
  }
  const active = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM wms_user_api_tokens
     WHERE user_id = $1::bigint AND revoked_at IS NULL`,
    [userId]
  )
  if (Number(active.rows[0]?.n || 0) >= MAX_TOKENS_PER_USER) {
    throw new Error("token_limit")
  }
  const minted = mintUserApiTokenSecret()
  const inserted = await client.query<{
    token_id: string
    name: string
    token_prefix: string
    created_at: string
  }>(
    `INSERT INTO wms_user_api_tokens (user_id, name, token_prefix, token_hash)
     VALUES ($1::bigint, $2, $3, $4)
     RETURNING token_id::text AS token_id, name, token_prefix, created_at::text`,
    [userId, label, minted.prefix, minted.hash]
  )
  const row = inserted.rows[0]!
  return {
    token: minted.token,
    row: {
      tokenId: row.token_id,
      name: row.name,
      tokenPrefix: row.token_prefix,
      createdAt: row.created_at,
      lastUsedAt: null,
      revokedAt: null,
    },
  }
}

export async function revokeUserApiToken(
  client: PoolClient,
  userId: string,
  tokenId: string
): Promise<boolean> {
  await ensureUserApiTokensSchema(client)
  const r = await client.query(
    `UPDATE wms_user_api_tokens
     SET revoked_at = now()
     WHERE token_id = $1::bigint AND user_id = $2::bigint AND revoked_at IS NULL`,
    [tokenId, userId]
  )
  return (r.rowCount ?? 0) > 0
}

type TokenUserRow = {
  token_id: string
  user_id: string
  login: string
  display_name: string
  position: string | null
  is_active: boolean
  last_used_at: string | null
  role_codes: string[] | null
}

export async function verifyUserApiToken(token: string): Promise<WmsAuthSession | null> {
  const trimmed = token.trim()
  if (!isUserApiToken(trimmed)) return null
  const pool = tryGetPool()
  if (!pool) return null
  const client = await pool.connect()
  try {
    await ensureUserApiTokensSchema(client)
    const hashed = sha256(trimmed)
    const r = await client.query<TokenUserRow>(
      `SELECT t.token_id::text AS token_id,
              u.user_id::text AS user_id,
              u.login,
              u.display_name,
              u.position,
              u.is_active,
              t.last_used_at::text AS last_used_at,
              coalesce(
                array_agg(r.code) FILTER (WHERE r.code IS NOT NULL),
                '{}'
              ) AS role_codes
       FROM wms_user_api_tokens t
       JOIN wms_users u ON u.user_id = t.user_id
       LEFT JOIN wms_user_roles ur ON ur.user_id = u.user_id
       LEFT JOIN wms_roles r ON r.role_id = ur.role_id
       WHERE t.token_hash = $1 AND t.revoked_at IS NULL
       GROUP BY t.token_id, u.user_id, u.login, u.display_name, u.position, u.is_active, t.last_used_at
       LIMIT 1`,
      [hashed]
    )
    const hit = r.rows[0]
    if (!hit || !hit.is_active) return null

    const last = hit.last_used_at ? Date.parse(hit.last_used_at) : 0
    if (!Number.isFinite(last) || Date.now() - last > LAST_USED_TOUCH_MS) {
      await client.query(`UPDATE wms_user_api_tokens SET last_used_at = now() WHERE token_id = $1::bigint`, [
        hit.token_id,
      ])
    }

    return {
      userId: hit.user_id,
      login: hit.login,
      fio: hit.display_name || hit.login,
      position: hit.position || "WMS",
      roleCodes: hit.role_codes ?? [],
      exp: Date.now() + 365 * 24 * 60 * 60 * 1000,
    }
  } finally {
    client.release()
  }
}
