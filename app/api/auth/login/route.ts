import { NextResponse } from "next/server"
import { tryGetPool } from "@/lib/wms/pool"
import { authenticateDbUser } from "@/lib/wms/auth-db"
import { findAuthUser } from "@/lib/auth/users"
import { createSessionToken, sessionCookieOptions, SESSION_TTL_SEC } from "@/lib/auth/session"
import { WMS_SESSION_COOKIE } from "@/lib/auth/types"

export const runtime = "nodejs"

function loginSuccess(
  token: string,
  user: Record<string, unknown>
): NextResponse {
  const res = NextResponse.json({
    ok: true,
    accessToken: token,
    tokenType: "Bearer",
    expiresIn: SESSION_TTL_SEC,
    user,
  })
  res.cookies.set(WMS_SESSION_COOKIE, token, sessionCookieOptions(SESSION_TTL_SEC))
  return res
}

export async function POST(req: Request) {
  let body: { login?: string; password?: string }
  try {
    body = (await req.json()) as { login?: string; password?: string }
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }

  const login = String(body.login ?? "").trim()
  const password = String(body.password ?? "")
  if (!login || !password) {
    return NextResponse.json({ error: "login and password are required" }, { status: 400 })
  }

  const pool = tryGetPool()
  if (pool) {
    const client = await pool.connect()
    try {
      const dbUser = await authenticateDbUser(client, login, password)
      if (dbUser) {
        const token = await createSessionToken({
          userId: dbUser.userId,
          login: dbUser.login,
          fio: dbUser.displayName,
          position: dbUser.position || "WMS",
          roleCodes: dbUser.roleCodes,
        })
        return loginSuccess(token, {
          userId: dbUser.userId,
          login: dbUser.login,
          fio: dbUser.displayName,
          position: dbUser.position,
          roleCodes: dbUser.roleCodes,
        })
      }
    } finally {
      client.release()
    }
  }

  const legacyUser = findAuthUser(login, password)
  if (!legacyUser) {
    return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 })
  }

  const token = await createSessionToken({
    login: legacyUser.login,
    fio: legacyUser.fio,
    position: legacyUser.position,
  })

  return loginSuccess(token, {
    login: legacyUser.login,
    fio: legacyUser.fio,
    position: legacyUser.position,
  })
}
