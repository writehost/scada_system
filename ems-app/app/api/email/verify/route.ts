import { NextResponse } from "next/server"
import { withSystem } from "@/lib/server/db.ts"
import { publicApi } from "@/lib/server/http.ts"
import { verifyEmailToken } from "@/lib/services/recipients.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Подтверждение выполняется POST-запросом со страницы /email/verify, чтобы ссылку не «нажимали» сканеры почты. */
export const POST = publicApi({ rate: 30 }, async ({ body }) => {
  const token = String(body.token ?? "")
  const r = await withSystem((c) => verifyEmailToken(c, token))
  if (!r) return NextResponse.json({ ok: false, error: "Ссылка недействительна или устарела. Запросите письмо повторно в настройках уведомлений." }, { status: 400 })
  return { ok: true, email: r.email }
})
