import { NextResponse } from "next/server"
import { issueFormToken } from "@/lib/antispam"

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({ token: issueFormToken() }, { headers: { "Cache-Control": "no-store" } })
}
