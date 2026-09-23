import { NextResponse } from "next/server"
import { verifySessionToken } from "@/lib/auth/session"
import type { WmsAuthSession } from "@/lib/auth/types"
import { WMS_SESSION_COOKIE } from "@/lib/auth/types"

export type WmsActor = {
  via: "session"
  session: WmsAuthSession | null
  deviceUid: string | null
  userId: string | null
}

function tokenFrom(req: Request): string {
  const header = req.headers.get("cookie") || ""
  const parts = header.split(";").map((part) => part.trim())
  const row = parts.find((part) => part.startsWith(`${WMS_SESSION_COOKIE}=`))
  if (!row) return ""
  return decodeURIComponent(row.slice(WMS_SESSION_COOKIE.length + 1))
}

export async function requireWmsActor(
  req: Request
): Promise<{ actor: WmsActor } | { error: NextResponse }> {
  const token = tokenFrom(req)
  const session = token ? await verifySessionToken(token) : null
  if (!session) {
    return {
      error: NextResponse.json({ error: "Нужен вход в YMS", code: "auth_required" }, { status: 401 }),
    }
  }
  return {
    actor: {
      via: "session",
      session,
      deviceUid: null,
      userId: session.userId?.trim() || null,
    },
  }
}
