import { NextResponse } from "next/server"
import { assertSameOrigin, fail, HttpError, readJson } from "@/lib/http"
import { retryMail } from "@/lib/requests"
import { requireOwner } from "@/lib/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req)
    const s = await requireOwner()
    const id = Number((await ctx.params).id)
    const body = await readJson(req)
    const mailId = Number(body.mailId)
    if (!Number.isInteger(id) || !Number.isInteger(mailId)) throw new HttpError(400, "Некорректный запрос", "bad_request")
    return NextResponse.json(await retryMail(id, mailId, s))
  } catch (error) {
    return fail(error)
  }
}
