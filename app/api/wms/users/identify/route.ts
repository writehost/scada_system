import { NextResponse } from "next/server"
import type { PoolClient } from "pg"
import { positionFromRoles, type AuthenticatedDbUser } from "@/lib/wms/auth-db"
import { verifyPassword } from "@/lib/wms/password"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import { requireWmsActor } from "@/lib/wms/require-actor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function mapUserRow(
  client: PoolClient,
  whereSql: string,
  params: unknown[]
): Promise<(AuthenticatedDbUser & { pinHash?: string | null }) | null> {
  const r = await client.query<{
    userId: string
    login: string
    displayName: string
    position: string | null
    isActive: boolean
    pinHash: string | null
    roles: string[]
  }>(
    `
    SELECT
      u.user_id::text AS "userId",
      u.login,
      u.display_name AS "displayName",
      u.position,
      u.is_active AS "isActive",
      u.pin_hash AS "pinHash",
      COALESCE(array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
    FROM wms_users u
    LEFT JOIN wms_user_roles ur ON ur.user_id = u.user_id
    LEFT JOIN wms_roles r ON r.role_id = ur.role_id
    WHERE ${whereSql}
    GROUP BY u.user_id, u.login, u.display_name, u.position, u.is_active, u.pin_hash
    LIMIT 1
    `,
    params
  )
  const row = r.rows[0]
  if (!row || !row.isActive) return null
  const roleCodes = Array.isArray(row.roles) ? row.roles.filter(Boolean) : []
  return {
    userId: row.userId,
    login: row.login,
    displayName: row.displayName,
    position: positionFromRoles(roleCodes, row.position),
    roleCodes,
    pinHash: row.pinHash,
  }
}

function publicUser(user: AuthenticatedDbUser & { pinHash?: string | null }) {
  const { pinHash: _pinHash, ...rest } = user
  return rest
}

async function identifyByPin(client: PoolClient, siteId: number, identity: string, pin: string) {
  const user = await mapUserRow(
    client,
    `u.site_id = $1 AND (lower(u.login) = lower($2) OR lower(coalesce(u.external_code, '')) = lower($2))`,
    [siteId, identity.trim()]
  )
  if (!user?.pinHash || !pin) return null
  return (await verifyPassword(pin, user.pinHash)) ? publicUser(user) : null
}

async function identifyByRfid(client: PoolClient, siteId: number, rfidUid: string) {
  const user = await mapUserRow(
    client,
    `u.site_id = $1 AND lower(coalesce(u.rfid_uid, '')) = lower($2)`,
    [siteId, rfidUid.trim()]
  )
  return user ? publicUser(user) : null
}

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true })
  if ("error" in actorGate) return actorGate.error

  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured (set DATABASE_URL or PG_URL)" }, { status: 503 })
  }

  let body: {
    siteCode?: string
    method?: "rfid" | "pin"
    rfidUid?: string
    identity?: string
    pin?: string
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }

  const siteCode = typeof body.siteCode === "string" ? body.siteCode.trim() : ""
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 })

  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })

    const method = body.method === "pin" ? "pin" : "rfid"
    const user =
      method === "pin"
        ? await identifyByPin(client, siteId, body.identity ?? "", body.pin ?? "")
        : await identifyByRfid(client, siteId, body.rfidUid ?? "")

    if (!user) {
      return NextResponse.json(
        { error: "operator not found or credentials invalid", code: "operator_not_identified" },
        { status: 401 }
      )
    }

    return NextResponse.json({ user, method })
  } finally {
    client.release()
  }
}
