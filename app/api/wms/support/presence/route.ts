import { NextResponse } from "next/server"
import { readAuthTokenFromRequest } from "@/lib/auth/request-token"
import { verifySessionToken } from "@/lib/auth/session"
import { upsertPresence } from "@/lib/wms/support-presence"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function clientIdOk(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,64}$/.test(value)
}

export async function POST(req: Request) {
  const token = await readAuthTokenFromRequest(req)
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const session = await verifySessionToken(token)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = (await req.json().catch(() => null)) as {
    clientId?: string
    path?: string
    x?: number
    y?: number
    followClientId?: string | null
  } | null

  if (!body || !clientIdOk(body.clientId)) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 })
  }

  const userId = String(session.userId || session.login)
  const snapshot = upsertPresence({
    clientId: body.clientId,
    userId,
    login: session.login,
    displayName: (session.fio || session.login).trim(),
    path: typeof body.path === "string" ? body.path : "/",
    x: typeof body.x === "number" ? body.x : 0.5,
    y: typeof body.y === "number" ? body.y : 0.5,
    followClientId: typeof body.followClientId === "string" ? body.followClientId : null,
  })

  return NextResponse.json(snapshot)
}
