import { NextResponse } from "next/server"
import { sessionCookieOptions } from "@/lib/auth/session"
import { WMS_SESSION_COOKIE } from "@/lib/auth/types"

export const runtime = "nodejs"

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(WMS_SESSION_COOKIE, "", { ...sessionCookieOptions(0), maxAge: 0 })
  return res
}
