import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"
import type { PoolClient } from "pg"
import { effectiveEdiRoles } from "../edi/permissions.ts"
import type { EdiOrgAccess, EdiSession } from "./session.ts"

const scryptAsync = promisify(scrypt)

/** Тот же формат хеша, что у WMS (lib/wms/password.ts): scrypt:<salt>:<hash>. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored?.startsWith("scrypt:")) return false
  const parts = stored.split(":")
  if (parts.length !== 3) return false
  const salt = Buffer.from(parts[1], "base64")
  const expected = Buffer.from(parts[2], "base64")
  if (!salt.length || !expected.length) return false
  const actual = (await scryptAsync(password, salt, expected.length)) as Buffer
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = (await scryptAsync(password, salt, 64)) as Buffer
  return `scrypt:${salt.toString("base64")}:${hash.toString("base64")}`
}

type UserRow = {
  user_id: string
  site_id: number
  site_code: string
  site_name: string
  login: string
  display_name: string
  password_hash: string | null
  external_code: string | null
  wms_roles: string[]
  edi_roles: string[]
}

const USER_SELECT = `
  SELECT u.user_id::text, u.site_id, s.site_code, s.name AS site_name, u.login, u.display_name,
         u.password_hash, u.external_code,
         COALESCE((SELECT array_agg(r.code) FROM wms_user_roles ur JOIN wms_roles r ON r.role_id = ur.role_id
                   WHERE ur.user_id = u.user_id), '{}') AS wms_roles,
         COALESCE((SELECT array_agg(er.role_code) FROM edi_user_roles er
                   WHERE er.user_id = u.user_id AND er.site_id = u.site_id), '{}') AS edi_roles
  FROM wms_users u
  JOIN wms_sites s ON s.site_id = u.site_id AND s.is_active
  WHERE u.is_active`

function orgsFrom(rows: UserRow[]): EdiOrgAccess[] {
  return rows
    .filter((r) => effectiveEdiRoles(r.wms_roles, r.edi_roles).length > 0)
    .map((r) => ({ siteId: r.site_id, siteCode: r.site_code, name: r.site_name, userId: r.user_id }))
}

/** Все организации, где у этой персоны есть активная учётная запись с доступом к EDI. */
export async function findOrgsForPerson(
  client: PoolClient,
  person: { login: string; externalCode?: string | null }
): Promise<EdiOrgAccess[]> {
  const r = await client.query<UserRow>(
    `${USER_SELECT} AND (($2 = '' AND lower(u.login) = lower($1)) OR ($2 <> '' AND u.external_code = $2))
     ORDER BY s.site_id`,
    [person.login, person.externalCode ?? ""]
  )
  return orgsFrom(r.rows)
}

export type LoginResult =
  | { ok: true; session: Omit<EdiSession, "iat" | "exp"> }
  | { ok: false; status: number; error: string }

export function pickOrg(orgs: EdiOrgAccess[], siteCode?: string | null): EdiOrgAccess | null {
  if (orgs.length === 0) return null
  const wanted = (siteCode || "").trim().toLowerCase()
  return orgs.find((o) => o.siteCode.toLowerCase() === wanted) ?? orgs[0]
}

export async function passwordLogin(
  client: PoolClient,
  input: { login: string; password: string; siteCode?: string | null }
): Promise<LoginResult> {
  const r = await client.query<UserRow>(`${USER_SELECT} AND lower(u.login) = lower($1) ORDER BY s.site_id`, [input.login])
  const valid: UserRow[] = []
  for (const row of r.rows) {
    if (await verifyPassword(input.password, row.password_hash)) valid.push(row)
  }
  if (valid.length === 0) return { ok: false, status: 401, error: "Неверный логин или пароль" }
  const orgs = orgsFrom(valid)
  const active = pickOrg(orgs, input.siteCode)
  if (!active) return { ok: false, status: 403, error: "У учётной записи нет доступа к SCADA EDI" }
  const me = valid.find((v) => v.user_id === active.userId)!
  return {
    ok: true,
    session: {
      userId: active.userId,
      login: me.login,
      fio: me.display_name,
      siteId: active.siteId,
      siteCode: active.siteCode,
      orgs,
      via: "password",
    },
  }
}

/** Персональный токен WMS (`wmsu_…`) как Bearer — для SCADA Mobile и интеграций. */
export async function sessionFromWmsApiToken(client: PoolClient, token: string): Promise<EdiSession | null> {
  if (!token.startsWith("wmsu_")) return null
  const hash = createHash("sha256").update(token, "utf8").digest("hex")
  const exists = await client.query<{ ok: boolean }>(`SELECT to_regclass('public.wms_user_api_tokens') IS NOT NULL AS ok`)
  if (!exists.rows[0]?.ok) return null
  const r = await client.query<UserRow>(
    `${USER_SELECT} AND u.user_id = (SELECT t.user_id FROM wms_user_api_tokens t WHERE t.token_hash = $1 AND t.revoked_at IS NULL LIMIT 1)`,
    [hash]
  )
  const row = r.rows[0]
  if (!row) return null
  const orgs = orgsFrom([row])
  if (orgs.length === 0) return null
  const now = Date.now()
  return {
    userId: row.user_id,
    login: row.login,
    fio: row.display_name,
    siteId: row.site_id,
    siteCode: row.site_code,
    orgs,
    via: "password",
    iat: now,
    exp: now + 60_000,
  }
}
