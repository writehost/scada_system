import { NextResponse } from "next/server"
import { findAuthUser } from "@/lib/auth/users"
import { readAuthTokenFromRequest } from "@/lib/auth/request-token"
import { verifySessionToken } from "@/lib/auth/session"
import { tryGetPool } from "@/lib/wms/pool"
import { authenticateDbUser } from "@/lib/wms/auth-db"
import { createMapToken, mapUrlForToken, planPageUrl } from "@/lib/wms/row-identify-token"
import { requestOrigin } from "@/lib/wms/row-identify-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  let body: {
    siteCode?: string
    rowId?: string
    expiresInSec?: number
    login?: string
    password?: string
  } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    body = {}
  }

  const existing = await readAuthTokenFromRequest(req)
  const session = existing ? await verifySessionToken(existing) : null
  let login = session?.login
  if (!login && body.login && body.password) {
    const pool = tryGetPool()
    if (pool) {
      const client = await pool.connect()
      try {
        const dbUser = await authenticateDbUser(client, body.login, body.password)
        if (dbUser) login = dbUser.login
      } finally {
        client.release()
      }
    }
    if (!login) {
      const user = findAuthUser(body.login, body.password)
      if (!user) return NextResponse.json({ error: "invalid login or password" }, { status: 401 })
      login = user.login
    }
  }
  if (!login) {
    return NextResponse.json(
      { error: "Нужен вход в WMS (Bearer/cookie) или login+password в теле" },
      { status: 401 }
    )
  }

  const siteCode = (body.siteCode ?? "DEFAULT").trim() || "DEFAULT"
  const created = createMapToken({
    siteCode,
    rowId: body.rowId,
    login,
    expiresInSec: body.expiresInSec,
  })
  const origin = requestOrigin(req)
  return NextResponse.json({
    token: created.token,
    tokenType: "Bearer",
    expiresAt: created.expiresAt,
    siteCode,
    rowId: created.payload.rowId ?? null,
    mapUrl: mapUrlForToken(origin, created.token, created.payload.rowId),
    planUrl: planPageUrl(origin, created.token, created.payload.rowId),
    openapiUrl: `${origin}/api/wms/row-identify/openapi`,
  })
}
