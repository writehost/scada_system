import { NextResponse } from "next/server"
import { EDI_SESSION_COOKIE } from "@/lib/auth/session.ts"

export const runtime = "nodejs"

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(EDI_SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 })
  return res
}
