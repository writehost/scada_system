import { NextResponse } from "next/server"
import { checkFormToken, clientIp, ipHash } from "@/lib/antispam"
import { assertSameOrigin, fail, HttpError, readJson } from "@/lib/http"
import { createRequest } from "@/lib/requests"
import { APPLICANT_STATUS_LABEL } from "@/lib/request-status"
import { getSession } from "@/lib/session"
import { validateRequestInput } from "@/lib/validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    assertSameOrigin(req)
    const body = await readJson(req)
    const parsed = validateRequestInput(body)
    if (!parsed.ok) throw new HttpError(422, "Проверьте поля формы", "validation", parsed.fields)
    const input = parsed.value
    // Поле-ловушка скрыто от людей; заполняют его только боты.
    if (input.honeypot) throw new HttpError(400, "Заявка отклонена антиспам-фильтром", "spam")
    checkFormToken(input.formToken)
    const session = await getSession()
    const result = await createRequest(input, {
      ipHash: ipHash(clientIp(req)),
      userAgent: req.headers.get("user-agent") || "",
      session,
    })
    const applicantMail = result.mail.find((m) => m.kind === "applicant_received")
    return NextResponse.json(
      {
        ok: true,
        replayed: result.replayed,
        request: { ...result.request, statusLabel: APPLICANT_STATUS_LABEL[result.request.status] },
        confirmationEmail: result.replayed ? "unchanged" : applicantMail?.status || "skipped",
      },
      { status: result.replayed ? 200 : 201 }
    )
  } catch (error) {
    return fail(error)
  }
}
