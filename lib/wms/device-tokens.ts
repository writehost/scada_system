import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import type { PoolClient } from "pg"
import { WmsHttpError } from "@/lib/wms/errors"

/**
 * Подключение ТСД по токену вместо логина и пароля.
 *
 * Две сущности:
 * - код подключения (`wms_device_enroll_tokens`) — короткий код, который выдаёт кладовщик
 *   в веб-интерфейсе; живёт минуты и обменивается на постоянный токен устройства;
 * - токен устройства (`wms_device_tokens`) — длинный секрет, который ТСД хранит у себя
 *   и присылает в заголовке `X-Device-Token` при каждом обращении.
 *
 * В базе лежат только SHA-256 хеши: восстановить код или токен из базы нельзя.
 */

/** Алфавит кода подключения: без 0/O/1/I, чтобы не путать при вводе с клавиатуры ТСД. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const CODE_GROUPS = 3
const CODE_GROUP_LEN = 4

const DEVICE_TOKEN_PREFIX = "wmsd_"

export type DeviceAuthMode = "off" | "soft" | "strict"

export type DeviceAuthSettings = {
  /** off — не проверять, soft — пускать старые ТСД без токена, strict — только по токену. */
  mode: DeviceAuthMode
  /** Срок жизни кода подключения по умолчанию, минуты. */
  defaultTtlMinutes: number
  /** Сколько устройств можно подключить одним кодом по умолчанию. */
  defaultMaxUses: number
  updatedAt?: string | null
  updatedBy?: string | null
}

export const DEFAULT_DEVICE_AUTH_SETTINGS: DeviceAuthSettings = {
  mode: "soft",
  defaultTtlMinutes: 60,
  defaultMaxUses: 1,
}

const DEVICE_AUTH_SETTINGS_KEY = "device_auth"

export type DeviceEnrollTokenRow = {
  tokenId: string
  codeHint: string
  deviceName: string
  platform: string
  maxUses: number
  usedCount: number
  expiresAt: string
  createdAt: string
  createdBy: string
  createdOrigin: string
  note: string
  revokedAt: string | null
  revokedBy: string | null
  lastUsedAt: string | null
  lastDeviceUid: string | null
  /** Производное состояние для интерфейса. */
  state: "active" | "used" | "expired" | "revoked"
}

export type DeviceTokenRow = {
  deviceTokenId: string
  deviceUid: string
  tokenHint: string
  issuedAt: string
  issuedBy: string
  issuedVia: string
  lastUsedAt: string | null
  lastAppVersion: string | null
  revokedAt: string | null
  revokedBy: string | null
}

export type DeviceTokenActor = {
  login: string
  fio: string
  origin: string
}

const ISO = `'YYYY-MM-DD"T"HH24:MI:SSOF:00'`

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

export function hashDeviceToken(token: string): string {
  return sha256(token.trim())
}

/** Код подключения нечувствителен к регистру и разделителям: `k7m4 qw2r-9txb` = `K7M4QW2R9TXB`. */
export function normalizeEnrollCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
}

function generateEnrollCode(): { code: string; normalized: string } {
  const groups: string[] = []
  for (let g = 0; g < CODE_GROUPS; g += 1) {
    let group = ""
    const bytes = randomBytes(CODE_GROUP_LEN)
    for (let i = 0; i < CODE_GROUP_LEN; i += 1) {
      group += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
    }
    groups.push(group)
  }
  const code = groups.join("-")
  return { code, normalized: normalizeEnrollCode(code) }
}

function generateDeviceToken(): string {
  return `${DEVICE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`
}

function tokenHint(token: string): string {
  const tail = token.slice(-4)
  return `…${tail}`
}

function codeHint(code: string): string {
  return code.slice(-4)
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
  } catch {
    return false
  }
}

let schemaReady = false

export async function ensureDeviceTokenSchema(client: PoolClient): Promise<void> {
  if (schemaReady) return
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_device_enroll_tokens (
      token_id BIGSERIAL PRIMARY KEY,
      site_id INT NOT NULL,
      code_hash TEXT NOT NULL,
      code_hint TEXT NOT NULL DEFAULT '',
      device_name TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      max_uses INT NOT NULL DEFAULT 1,
      used_count INT NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by_login TEXT,
      created_by_fio TEXT,
      created_origin TEXT,
      note TEXT,
      revoked_at TIMESTAMPTZ,
      revoked_by TEXT,
      last_used_at TIMESTAMPTZ,
      last_device_uid TEXT
    )
  `)
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS wms_device_enroll_tokens_hash_idx
     ON wms_device_enroll_tokens (code_hash)`
  )
  await client.query(
    `CREATE INDEX IF NOT EXISTS wms_device_enroll_tokens_site_idx
     ON wms_device_enroll_tokens (site_id, created_at DESC)`
  )

  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_device_tokens (
      device_token_id BIGSERIAL PRIMARY KEY,
      site_id INT NOT NULL,
      device_uid TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      token_hint TEXT NOT NULL DEFAULT '',
      issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      issued_by_login TEXT,
      issued_by_fio TEXT,
      issued_via TEXT NOT NULL DEFAULT 'enroll',
      enroll_token_id BIGINT,
      last_used_at TIMESTAMPTZ,
      last_ip TEXT,
      last_app_version TEXT,
      revoked_at TIMESTAMPTZ,
      revoked_by TEXT
    )
  `)
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS wms_device_tokens_hash_idx ON wms_device_tokens (token_hash)`
  )
  await client.query(
    `CREATE INDEX IF NOT EXISTS wms_device_tokens_device_idx ON wms_device_tokens (site_id, device_uid)`
  )

  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_device_auth_events (
      event_id BIGSERIAL PRIMARY KEY,
      site_id INT NOT NULL,
      at TIMESTAMPTZ NOT NULL DEFAULT now(),
      kind TEXT NOT NULL,
      device_uid TEXT,
      actor TEXT,
      origin TEXT,
      detail TEXT
    )
  `)
  await client.query(
    `CREATE INDEX IF NOT EXISTS wms_device_auth_events_site_idx
     ON wms_device_auth_events (site_id, at DESC)`
  )
  schemaReady = true
}

export async function appendDeviceAuthEvent(
  client: PoolClient,
  siteId: number,
  input: { kind: string; deviceUid?: string | null; actor?: string | null; origin?: string | null; detail?: string | null }
): Promise<void> {
  await client.query(
    `INSERT INTO wms_device_auth_events (site_id, kind, device_uid, actor, origin, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      siteId,
      input.kind,
      input.deviceUid || null,
      input.actor || null,
      input.origin || null,
      input.detail || null,
    ]
  )
}

/* ----------------------------------------------------------------------------
 * Настройки
 * ------------------------------------------------------------------------- */

function normalizeSettings(raw: unknown): DeviceAuthSettings {
  const src = (raw ?? {}) as Partial<DeviceAuthSettings>
  const mode: DeviceAuthMode =
    src.mode === "off" || src.mode === "strict" || src.mode === "soft"
      ? src.mode
      : DEFAULT_DEVICE_AUTH_SETTINGS.mode
  const ttl = Number(src.defaultTtlMinutes)
  const uses = Number(src.defaultMaxUses)
  return {
    mode,
    defaultTtlMinutes:
      Number.isFinite(ttl) && ttl >= 5 && ttl <= 60 * 24 * 30
        ? Math.round(ttl)
        : DEFAULT_DEVICE_AUTH_SETTINGS.defaultTtlMinutes,
    defaultMaxUses:
      Number.isFinite(uses) && uses >= 1 && uses <= 50
        ? Math.round(uses)
        : DEFAULT_DEVICE_AUTH_SETTINGS.defaultMaxUses,
    updatedAt: typeof src.updatedAt === "string" ? src.updatedAt : null,
    updatedBy: typeof src.updatedBy === "string" ? src.updatedBy : null,
  }
}

/** Кто менял настройку, храним внутри JSON: в `wms_app_settings` нет колонки автора. */
async function ensureSettingsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_app_settings (
      site_id INT NOT NULL,
      setting_key TEXT NOT NULL,
      setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, setting_key)
    )
  `)
}

export async function getDeviceAuthSettings(
  client: PoolClient,
  siteId: number
): Promise<DeviceAuthSettings> {
  await ensureSettingsTable(client)
  const r = await client.query<{ setting_value: unknown; updated_at: string }>(
    `SELECT setting_value, to_char(updated_at, ${ISO}) AS updated_at
     FROM wms_app_settings
     WHERE site_id = $1 AND setting_key = $2`,
    [siteId, DEVICE_AUTH_SETTINGS_KEY]
  )
  const row = r.rows[0]
  if (!row) return { ...DEFAULT_DEVICE_AUTH_SETTINGS }
  const value = (row.setting_value ?? {}) as Record<string, unknown>
  return normalizeSettings({
    ...value,
    updatedAt: row.updated_at,
    updatedBy: typeof value.updatedBy === "string" ? value.updatedBy : null,
  })
}

export async function saveDeviceAuthSettings(
  client: PoolClient,
  siteId: number,
  input: unknown,
  actor: DeviceTokenActor
): Promise<DeviceAuthSettings> {
  await ensureSettingsTable(client)
  const next = normalizeSettings(input)
  await client.query(
    `INSERT INTO wms_app_settings (site_id, setting_key, setting_value, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (site_id, setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value,
                   updated_at = now()`,
    [
      siteId,
      DEVICE_AUTH_SETTINGS_KEY,
      JSON.stringify({
        mode: next.mode,
        defaultTtlMinutes: next.defaultTtlMinutes,
        defaultMaxUses: next.defaultMaxUses,
        updatedBy: actor.fio || actor.login || null,
      }),
    ]
  )
  await ensureDeviceTokenSchema(client)
  await appendDeviceAuthEvent(client, siteId, {
    kind: "settings",
    actor: actor.fio || actor.login,
    origin: actor.origin,
    detail: `Режим проверки токена: ${next.mode}`,
  })
  return { ...next, updatedAt: new Date().toISOString(), updatedBy: actor.fio || actor.login }
}

/* ----------------------------------------------------------------------------
 * Коды подключения
 * ------------------------------------------------------------------------- */

export async function issueEnrollToken(
  client: PoolClient,
  siteId: number,
  input: {
    deviceName?: string
    platform?: string
    ttlMinutes?: number
    maxUses?: number
    note?: string
    actor: DeviceTokenActor
  }
): Promise<{ code: string; token: DeviceEnrollTokenRow }> {
  await ensureDeviceTokenSchema(client)
  const settings = await getDeviceAuthSettings(client, siteId)
  const ttl = Math.min(
    60 * 24 * 30,
    Math.max(5, Math.round(Number(input.ttlMinutes) || settings.defaultTtlMinutes))
  )
  const maxUses = Math.min(50, Math.max(1, Math.round(Number(input.maxUses) || settings.defaultMaxUses)))

  // Коллизия кода практически невозможна, но повтор дешевле, чем упавший запрос.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { code, normalized } = generateEnrollCode()
    try {
      const r = await client.query<{ token_id: string }>(
        `INSERT INTO wms_device_enroll_tokens
           (site_id, code_hash, code_hint, device_name, platform, max_uses, expires_at,
            created_by_login, created_by_fio, created_origin, note)
         VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(mins => $7), $8, $9, $10, $11)
         RETURNING token_id::text AS token_id`,
        [
          siteId,
          sha256(normalized),
          codeHint(code),
          input.deviceName?.trim() || "",
          input.platform?.trim() || "",
          maxUses,
          ttl,
          input.actor.login || null,
          input.actor.fio || null,
          input.actor.origin || null,
          input.note?.trim() || null,
        ]
      )
      const tokenId = r.rows[0]!.token_id
      await appendDeviceAuthEvent(client, siteId, {
        kind: "code_issued",
        actor: input.actor.fio || input.actor.login,
        origin: input.actor.origin,
        detail: `Код …${codeHint(code)} на ${ttl} мин, устройств: ${maxUses}`,
      })
      const list = await listEnrollTokens(client, siteId, { tokenId })
      return { code, token: list[0]! }
    } catch (e) {
      const pgCode = (e as { code?: string })?.code
      if (pgCode === "23505" && attempt < 4) continue
      throw e
    }
  }
  throw new WmsHttpError(500, "не удалось выпустить код подключения", "enroll_code_failed")
}

export async function listEnrollTokens(
  client: PoolClient,
  siteId: number,
  options?: { tokenId?: string; includeClosed?: boolean; limit?: number }
): Promise<DeviceEnrollTokenRow[]> {
  await ensureDeviceTokenSchema(client)
  const limit = Math.min(200, Math.max(1, options?.limit ?? 50))
  const r = await client.query<{
    token_id: string
    code_hint: string
    device_name: string
    platform: string
    max_uses: number
    used_count: number
    expires_at: string
    created_at: string
    created_by_fio: string | null
    created_by_login: string | null
    created_origin: string | null
    note: string | null
    revoked_at: string | null
    revoked_by: string | null
    last_used_at: string | null
    last_device_uid: string | null
    expired: boolean
  }>(
    `SELECT token_id::text AS token_id, code_hint, device_name, platform, max_uses, used_count,
            to_char(expires_at, ${ISO}) AS expires_at,
            to_char(created_at, ${ISO}) AS created_at,
            created_by_fio, created_by_login, created_origin, note,
            to_char(revoked_at, ${ISO}) AS revoked_at, revoked_by,
            to_char(last_used_at, ${ISO}) AS last_used_at, last_device_uid,
            (expires_at <= now()) AS expired
     FROM wms_device_enroll_tokens
     WHERE site_id = $1
       AND ($2::bigint IS NULL OR token_id = $2::bigint)
       AND (
         $3::boolean
         OR (revoked_at IS NULL AND expires_at > now() AND used_count < max_uses)
       )
     ORDER BY created_at DESC
     LIMIT $4`,
    [siteId, options?.tokenId ?? null, options?.includeClosed ?? false, limit]
  )
  return r.rows.map((row) => ({
    tokenId: row.token_id,
    codeHint: row.code_hint,
    deviceName: row.device_name ?? "",
    platform: row.platform ?? "",
    maxUses: row.max_uses,
    usedCount: row.used_count,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    createdBy: row.created_by_fio || row.created_by_login || "—",
    createdOrigin: row.created_origin ?? "",
    note: row.note ?? "",
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    lastUsedAt: row.last_used_at,
    lastDeviceUid: row.last_device_uid,
    state: row.revoked_at
      ? "revoked"
      : row.used_count >= row.max_uses
        ? "used"
        : row.expired
          ? "expired"
          : "active",
  }))
}

export async function revokeEnrollToken(
  client: PoolClient,
  siteId: number,
  input: { tokenId: string; actor: DeviceTokenActor }
): Promise<void> {
  await ensureDeviceTokenSchema(client)
  const r = await client.query<{ code_hint: string }>(
    `UPDATE wms_device_enroll_tokens
     SET revoked_at = now(), revoked_by = $3
     WHERE site_id = $1 AND token_id = $2::bigint AND revoked_at IS NULL
     RETURNING code_hint`,
    [siteId, input.tokenId, input.actor.fio || input.actor.login || "—"]
  )
  if (r.rows.length === 0) {
    throw new WmsHttpError(404, "код не найден или уже погашен", "enroll_token_missing")
  }
  await appendDeviceAuthEvent(client, siteId, {
    kind: "code_revoked",
    actor: input.actor.fio || input.actor.login,
    origin: input.actor.origin,
    detail: `Код …${r.rows[0]!.code_hint} отозван`,
  })
}

/* ----------------------------------------------------------------------------
 * Токены устройств
 * ------------------------------------------------------------------------- */

export async function listDeviceTokens(
  client: PoolClient,
  siteId: number,
  options?: { deviceUid?: string; includeRevoked?: boolean }
): Promise<DeviceTokenRow[]> {
  await ensureDeviceTokenSchema(client)
  const r = await client.query<{
    device_token_id: string
    device_uid: string
    token_hint: string
    issued_at: string
    issued_by_fio: string | null
    issued_by_login: string | null
    issued_via: string
    last_used_at: string | null
    last_app_version: string | null
    revoked_at: string | null
    revoked_by: string | null
  }>(
    `SELECT device_token_id::text AS device_token_id, device_uid, token_hint,
            to_char(issued_at, ${ISO}) AS issued_at,
            issued_by_fio, issued_by_login, issued_via,
            to_char(last_used_at, ${ISO}) AS last_used_at, last_app_version,
            to_char(revoked_at, ${ISO}) AS revoked_at, revoked_by
     FROM wms_device_tokens
     WHERE site_id = $1
       AND ($2::text = '' OR device_uid = $2)
       AND ($3::boolean OR revoked_at IS NULL)
     ORDER BY issued_at DESC`,
    [siteId, options?.deviceUid?.trim() ?? "", options?.includeRevoked ?? false]
  )
  return r.rows.map((row) => ({
    deviceTokenId: row.device_token_id,
    deviceUid: row.device_uid,
    tokenHint: row.token_hint,
    issuedAt: row.issued_at,
    issuedBy: row.issued_by_fio || row.issued_by_login || "—",
    issuedVia: row.issued_via,
    lastUsedAt: row.last_used_at,
    lastAppVersion: row.last_app_version,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
  }))
}

export async function revokeDeviceTokens(
  client: PoolClient,
  siteId: number,
  input: { deviceUid: string; actor: DeviceTokenActor; reason?: string }
): Promise<number> {
  await ensureDeviceTokenSchema(client)
  const r = await client.query(
    `UPDATE wms_device_tokens
     SET revoked_at = now(), revoked_by = $3
     WHERE site_id = $1 AND device_uid = $2 AND revoked_at IS NULL`,
    [siteId, input.deviceUid.trim(), input.actor.fio || input.actor.login || "—"]
  )
  if ((r.rowCount ?? 0) > 0) {
    await appendDeviceAuthEvent(client, siteId, {
      kind: "token_revoked",
      deviceUid: input.deviceUid.trim(),
      actor: input.actor.fio || input.actor.login,
      origin: input.actor.origin,
      detail: input.reason || "Токен устройства отозван — ТСД нужно подключить заново",
    })
  }
  return r.rowCount ?? 0
}

/** Выдаёт новый токен устройства и гасит предыдущие: у ТСД всегда ровно один действующий. */
export async function issueDeviceToken(
  client: PoolClient,
  siteId: number,
  input: {
    deviceUid: string
    actor: DeviceTokenActor
    via: string
    enrollTokenId?: string | null
    appVersion?: string | null
  }
): Promise<string> {
  await ensureDeviceTokenSchema(client)
  const deviceUid = input.deviceUid.trim()
  await client.query(
    `UPDATE wms_device_tokens
     SET revoked_at = now(), revoked_by = $3
     WHERE site_id = $1 AND device_uid = $2 AND revoked_at IS NULL`,
    [siteId, deviceUid, `замена (${input.via})`]
  )
  const token = generateDeviceToken()
  await client.query(
    `INSERT INTO wms_device_tokens
       (site_id, device_uid, token_hash, token_hint, issued_by_login, issued_by_fio,
        issued_via, enroll_token_id, last_app_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::bigint, $9)`,
    [
      siteId,
      deviceUid,
      sha256(token),
      tokenHint(token),
      input.actor.login || null,
      input.actor.fio || null,
      input.via,
      input.enrollTokenId ?? null,
      input.appVersion || null,
    ]
  )
  return token
}

export type EnrollResult = {
  deviceUid: string
  deviceName: string
  deviceToken: string
  siteCode: string
  tokenHint: string
}

/**
 * Обмен кода подключения на токен устройства.
 * Код гасится атомарно (`used_count` растёт под UPDATE … RETURNING), поэтому
 * одновременный ввод одного кода на двух ТСД не выдаст лишних токенов.
 */
export async function redeemEnrollCode(
  client: PoolClient,
  input: {
    code: string
    deviceUid: string
    deviceName?: string
    platform?: string
    appVersion?: string
    origin?: string
  }
): Promise<{ siteId: number; enrollTokenId: string; deviceName: string; deviceToken: string }> {
  await ensureDeviceTokenSchema(client)
  const normalized = normalizeEnrollCode(input.code)
  if (normalized.length < 8) {
    throw new WmsHttpError(400, "Код подключения слишком короткий", "enroll_code_invalid")
  }
  const hash = sha256(normalized)

  const lookup = await client.query<{
    token_id: string
    site_id: number
    code_hash: string
    device_name: string
    max_uses: number
    used_count: number
    revoked_at: string | null
    expired: boolean
  }>(
    `SELECT token_id::text AS token_id, site_id, code_hash, device_name, max_uses, used_count,
            revoked_at, (expires_at <= now()) AS expired
     FROM wms_device_enroll_tokens
     WHERE code_hash = $1`,
    [hash]
  )
  const found = lookup.rows[0]
  if (!found || !safeEqualHex(found.code_hash, hash)) {
    throw new WmsHttpError(404, "Код подключения не найден", "enroll_code_not_found")
  }
  if (found.revoked_at) {
    throw new WmsHttpError(410, "Код подключения отозван", "enroll_code_revoked")
  }
  if (found.expired) {
    throw new WmsHttpError(410, "Срок действия кода истёк — попросите новый", "enroll_code_expired")
  }
  if (found.used_count >= found.max_uses) {
    throw new WmsHttpError(410, "Код уже использован", "enroll_code_used")
  }

  const claimed = await client.query<{ token_id: string; used_count: number }>(
    `UPDATE wms_device_enroll_tokens
     SET used_count = used_count + 1,
         last_used_at = now(),
         last_device_uid = $2
     WHERE token_id = $1::bigint
       AND revoked_at IS NULL
       AND expires_at > now()
       AND used_count < max_uses
     RETURNING token_id::text AS token_id, used_count`,
    [found.token_id, input.deviceUid.trim()]
  )
  if (claimed.rows.length === 0) {
    throw new WmsHttpError(410, "Код уже использован", "enroll_code_used")
  }

  const deviceName = input.deviceName?.trim() || found.device_name?.trim() || input.deviceUid.trim()
  const deviceToken = await issueDeviceToken(client, found.site_id, {
    deviceUid: input.deviceUid,
    actor: { login: "", fio: "подключение по коду", origin: input.origin || "" },
    via: "enroll-code",
    enrollTokenId: found.token_id,
    appVersion: input.appVersion ?? null,
  })
  await appendDeviceAuthEvent(client, found.site_id, {
    kind: "enrolled",
    deviceUid: input.deviceUid.trim(),
    actor: "терминал",
    origin: input.origin,
    detail: `Подключение по коду: ${deviceName} (${input.platform || "неизвестная платформа"})`,
  })

  return {
    siteId: found.site_id,
    enrollTokenId: found.token_id,
    deviceName,
    deviceToken,
  }
}

export type DeviceTokenCheck = {
  ok: boolean
  deviceUid: string | null
  reason: "valid" | "revoked" | "unknown" | "site_mismatch" | "device_mismatch"
}

export async function checkDeviceToken(
  client: PoolClient,
  input: { token: string; siteId: number; deviceUid?: string; appVersion?: string; ip?: string }
): Promise<DeviceTokenCheck> {
  await ensureDeviceTokenSchema(client)
  const token = input.token.trim()
  if (!token) return { ok: false, deviceUid: null, reason: "unknown" }
  const r = await client.query<{
    device_token_id: string
    site_id: number
    device_uid: string
    revoked_at: string | null
    stale: boolean
  }>(
    `SELECT device_token_id::text AS device_token_id, site_id, device_uid, revoked_at,
            (last_used_at IS NULL OR last_used_at < now() - interval '2 minutes') AS stale
     FROM wms_device_tokens
     WHERE token_hash = $1`,
    [sha256(token)]
  )
  const row = r.rows[0]
  if (!row) return { ok: false, deviceUid: null, reason: "unknown" }
  if (row.revoked_at) return { ok: false, deviceUid: row.device_uid, reason: "revoked" }
  if (row.site_id !== input.siteId) return { ok: false, deviceUid: row.device_uid, reason: "site_mismatch" }
  const wanted = input.deviceUid?.trim()
  if (wanted && wanted !== row.device_uid) {
    return { ok: false, deviceUid: row.device_uid, reason: "device_mismatch" }
  }
  // Отметку времени пишем не чаще раза в две минуты: ТСД опрашивают сервер постоянно.
  if (row.stale) {
    await client.query(
      `UPDATE wms_device_tokens
       SET last_used_at = now(),
           last_ip = COALESCE($2, last_ip),
           last_app_version = COALESCE($3, last_app_version)
       WHERE device_token_id = $1::bigint`,
      [row.device_token_id, input.ip ?? null, input.appVersion ?? null]
    )
  }
  return { ok: true, deviceUid: row.device_uid, reason: "valid" }
}

/** Сводка по устройствам для интерфейса: у кого есть действующий токен. */
export async function loadDeviceTokenSummary(
  client: PoolClient,
  siteId: number
): Promise<Map<string, { tokenHint: string; issuedAt: string; lastUsedAt: string | null; issuedBy: string }>> {
  await ensureDeviceTokenSchema(client)
  const r = await client.query<{
    device_uid: string
    token_hint: string
    issued_at: string
    last_used_at: string | null
    issued_by: string | null
  }>(
    `SELECT DISTINCT ON (device_uid)
            device_uid, token_hint,
            to_char(issued_at, ${ISO}) AS issued_at,
            to_char(last_used_at, ${ISO}) AS last_used_at,
            COALESCE(issued_by_fio, issued_by_login) AS issued_by
     FROM wms_device_tokens
     WHERE site_id = $1 AND revoked_at IS NULL
     ORDER BY device_uid, issued_at DESC`,
    [siteId]
  )
  const map = new Map<string, { tokenHint: string; issuedAt: string; lastUsedAt: string | null; issuedBy: string }>()
  for (const row of r.rows) {
    map.set(row.device_uid, {
      tokenHint: row.token_hint,
      issuedAt: row.issued_at,
      lastUsedAt: row.last_used_at,
      issuedBy: row.issued_by ?? "—",
    })
  }
  return map
}
