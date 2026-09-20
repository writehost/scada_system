import { NextResponse } from "next/server"
import { resolveInteractiveSession } from "@/lib/auth/resolve-user-auth"
import type { WmsAuthSession } from "@/lib/auth/types"
import { tryGetPool } from "@/lib/wms/pool"
import { createUserApiToken, listUserApiTokens } from "@/lib/wms/user-api-tokens"
import type { PoolClient } from "pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function unauthorized() {
  return NextResponse.json({ error: "Нужен вход в WMS", code: "auth_required" }, { status: 401 })
}

async function sessionUserId(client: PoolClient, session: WmsAuthSession): Promise<string> {
  const uid = session.userId?.trim() || ""
  if (uid) return uid
  const r = await client.query<{ user_id: string }>(
    `SELECT user_id::text AS user_id FROM wms_users WHERE lower(login) = lower($1) LIMIT 1`,
    [session.login]
  )
  return r.rows[0]?.user_id ?? ""
}

export async function GET(req: Request) {
  const session = await resolveInteractiveSession(req)
  if (!session) return unauthorized()
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const client = await pool.connect()
  try {
    const userId = await sessionUserId(client, session)
    if (!userId) return unauthorized()
    const tokens = await listUserApiTokens(client, userId)
    return NextResponse.json({ tokens })
  } finally {
    client.release()
  }
}

export async function POST(req: Request) {
  const session = await resolveInteractiveSession(req)
  if (!session) return unauthorized()
  let name = "API"
  try {
    const body = (await req.json()) as { name?: string }
    if (typeof body.name === "string" && body.name.trim()) name = body.name.trim()
  } catch {
    /* имя по умолчанию */
  }
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const client = await pool.connect()
  try {
    const userId = await sessionUserId(client, session)
    if (!userId) return unauthorized()
    const created = await createUserApiToken(client, userId, name)
    return NextResponse.json({
      token: created.token,
      tokenType: "Bearer",
      warning: "Скопируйте токен сейчас — повторно показать его нельзя",
      ...created.row,
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    if (code === "token_limit") {
      return NextResponse.json({ error: "Не больше 10 активных токенов", code: "token_limit" }, { status: 409 })
    }
    if (code === "name_too_long") {
      return NextResponse.json({ error: "Слишком длинное имя", code: "name_too_long" }, { status: 400 })
    }
    console.error(error)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  } finally {
    client.release()
  }
}
