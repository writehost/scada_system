import { NextResponse } from "next/server"
import { resolveUserAuth } from "@/lib/auth/resolve-user-auth"
import type { WmsAuthSession } from "@/lib/auth/types"

export async function getWmsRequestSession(req: Request): Promise<WmsAuthSession | null> {
  const auth = await resolveUserAuth(req)
  return auth?.session ?? null
}

/** 401, если нет валидной сессии (cookie или Bearer). */
export async function requireWmsSession(
  req: Request
): Promise<{ session: WmsAuthSession } | { error: NextResponse }> {
  const session = await getWmsRequestSession(req)
  if (!session) {
    return {
      error: NextResponse.json(
        { error: "Нужен вход в WMS", code: "auth_required" },
        { status: 401 }
      ),
    }
  }
  return { session }
}
