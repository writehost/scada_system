import { NextResponse } from "next/server"
import { assertSameOrigin, fail, HttpError, readJson } from "@/lib/http"
import { activateInvite } from "@/lib/requests"
import { requireSession } from "@/lib/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    assertSameOrigin(req)
    const s = await requireSession()
    const body = await readJson(req)
    const token = typeof body.token === "string" ? body.token.trim() : ""
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new HttpError(400, "Некорректная ссылка", "bad_token")
    return NextResponse.json(await activateInvite(token, s))
  } catch (error) {
    return fail(error)
  }
}
