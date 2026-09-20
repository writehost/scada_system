import { NextResponse } from "next/server"
import { resolveUserAuth } from "@/lib/auth/resolve-user-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const auth = await resolveUserAuth(req)
  if (!auth) {
    return NextResponse.json({ user: null }, { status: 401 })
  }
  const session = auth.session
  return NextResponse.json({
    user: {
      userId: session.userId,
      login: session.login,
      fio: session.fio,
      position: session.position,
      roleCodes: session.roleCodes,
    },
  })
}
