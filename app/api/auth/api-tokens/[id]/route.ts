import { NextResponse } from "next/server"
import { resolveInteractiveSession } from "@/lib/auth/resolve-user-auth"
import { tryGetPool } from "@/lib/wms/pool"
import { revokeUserApiToken } from "@/lib/wms/user-api-tokens"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function DELETE(
  req: Request,
  segmentData: { params: Promise<{ id: string }> }
) {
  const session = await resolveInteractiveSession(req)
  if (!session) {
    return NextResponse.json({ error: "Нужен вход в WMS", code: "auth_required" }, { status: 401 })
  }
  const params = await segmentData.params
  const tokenId = decodeURIComponent(params.id ?? "").trim()
  if (!tokenId) return NextResponse.json({ error: "token id required" }, { status: 400 })
  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 })
  const client = await pool.connect()
  try {
    let userId = session.userId?.trim() || ""
    if (!userId) {
      const found = await client.query<{ user_id: string }>(
        `SELECT user_id::text AS user_id FROM wms_users WHERE lower(login) = lower($1) LIMIT 1`,
        [session.login]
      )
      userId = found.rows[0]?.user_id ?? ""
    }
    if (!userId) {
      return NextResponse.json({ error: "Нужен вход в WMS", code: "auth_required" }, { status: 401 })
    }
    const ok = await revokeUserApiToken(client, userId, tokenId)
    if (!ok) return NextResponse.json({ error: "token not found", code: "not_found" }, { status: 404 })
    return NextResponse.json({ ok: true })
  } finally {
    client.release()
  }
}
