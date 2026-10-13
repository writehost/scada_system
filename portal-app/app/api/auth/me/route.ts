import { NextResponse } from "next/server"
import { getSession, myApps } from "@/lib/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const s = await getSession()
  if (!s) return NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } })
  return NextResponse.json(
    {
      authenticated: true,
      user: { email: s.email, name: s.name, firstName: s.firstName, lastName: s.lastName, isOwner: s.isOwner },
      organization: s.organization,
      apps: myApps(s),
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}
