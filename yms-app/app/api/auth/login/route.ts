import { NextResponse } from "next/server"
import { createSessionToken, sessionCookieOptions, SESSION_TTL_SEC } from "@/lib/auth/session"
import { WMS_SESSION_COOKIE } from "@/lib/auth/types"
import { verifyPassword } from "@/lib/wms/password"
import { tryGetPool } from "@/lib/wms/pool"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  let body: { login?: string; password?: string }
  try {
    body = (await req.json()) as { login?: string; password?: string }
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 })
  }
  const login = String(body.login ?? "").trim()
  const password = String(body.password ?? "")
  if (!login || !password) {
    return NextResponse.json({ error: "Введите логин и пароль" }, { status: 400 })
  }
  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "База WMS недоступна" }, { status: 503 })
  }
  const client = await pool.connect()
  try {
    const r = await client.query<{
      userId: string
      login: string
      displayName: string
      position: string | null
      passwordHash: string | null
      isActive: boolean
      roles: string[]
    }>(
      `SELECT u.user_id::text AS "userId", u.login, u.display_name AS "displayName",
              u.position, u.password_hash AS "passwordHash", u.is_active AS "isActive",
              COALESCE(array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
       FROM wms_users u
       LEFT JOIN wms_user_roles ur ON ur.user_id = u.user_id
       LEFT JOIN wms_roles r ON r.role_id = ur.role_id
       WHERE lower(u.login) = lower($1)
       GROUP BY u.user_id
       LIMIT 1`,
      [login]
    )
    const row = r.rows[0]
    if (!row?.isActive || !row.passwordHash || !(await verifyPassword(password, row.passwordHash))) {
      return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 })
    }
    const roleCodes = Array.isArray(row.roles) ? row.roles.filter(Boolean) : []
    const token = await createSessionToken({
      userId: row.userId,
      login: row.login,
      fio: row.displayName,
      position: row.position || "YMS",
      roleCodes,
    })
    const res = NextResponse.json({ ok: true, user: { login: row.login, fio: row.displayName } })
    res.cookies.set(WMS_SESSION_COOKIE, token, sessionCookieOptions(SESSION_TTL_SEC))
    return res
  } finally {
    client.release()
  }
}
