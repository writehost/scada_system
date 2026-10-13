import { NextResponse } from "next/server"
import { fail } from "@/lib/http"
import { listRequests } from "@/lib/requests"
import { requireOwner } from "@/lib/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const s = await requireOwner()
    const url = new URL(req.url)
    const data = await listRequests({
      status: url.searchParams.get("status") || undefined,
      q: (url.searchParams.get("q") || "").trim().slice(0, 100) || undefined,
      mine: url.searchParams.get("mine") === "1" ? s.sub : null,
    })
    return NextResponse.json(data)
  } catch (error) {
    return fail(error)
  }
}
