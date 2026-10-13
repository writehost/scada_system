import { NextResponse } from "next/server"
import { fail } from "@/lib/http"
import { requestsForEmail } from "@/lib/requests"
import { requireSession } from "@/lib/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const s = await requireSession()
    return NextResponse.json({ items: await requestsForEmail(s.email) })
  } catch (error) {
    return fail(error)
  }
}
