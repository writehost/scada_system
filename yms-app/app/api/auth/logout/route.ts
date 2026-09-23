import { NextResponse } from "next/server"
import { WMS_SESSION_COOKIE } from "@/lib/auth/types"

export const runtime = "nodejs"

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(WMS_SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 })
  return res
}
