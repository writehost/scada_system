import { NextRequest, NextResponse } from "next/server"
import { appendSuzDiagnosticHints } from "@/lib/suz-error-hints"
import {
  normalizeSuzUuid,
  signedSuzV3CodesGet,
  summarizeUpstreamError,
  SUZ_SIGNED_POST_TIMEOUT_MS,
} from "@/lib/suz-signed-proxy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** POST /api/wms/suz/codes — прокси «Получить КМ» из заказа СУЗ (как GSMT /api/suz/codes). */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      clientToken?: string
      token?: string
      signature?: string
      omsId?: string
      orderId?: string
      gtin?: string
      quantity?: number | string
      suzBaseUrl?: string
    }

    const clientToken =
      typeof body.clientToken === "string" && body.clientToken.trim()
        ? body.clientToken.trim()
        : typeof body.token === "string"
          ? body.token.trim()
          : ""
    const signature = typeof body.signature === "string" ? body.signature.replace(/\s/g, "").trim() : ""
    const omsId = normalizeSuzUuid(typeof body.omsId === "string" ? body.omsId : "")
    const orderId = normalizeSuzUuid(typeof body.orderId === "string" ? body.orderId : "")
    const gtin = typeof body.gtin === "string" ? body.gtin.trim() : ""
    const qtyRaw = body.quantity

    if (!clientToken) return NextResponse.json({ error: "Требуется clientToken СУЗ" }, { status: 400 })
    if (!omsId) return NextResponse.json({ error: "Требуется omsId" }, { status: 400 })
    if (!orderId) return NextResponse.json({ error: "Требуется orderId" }, { status: 400 })
    if (!gtin) return NextResponse.json({ error: "Требуется gtin (14 цифр)" }, { status: 400 })
    if (!/^\d{14}$/.test(gtin)) {
      return NextResponse.json({ error: "gtin должен быть строкой из 14 цифр" }, { status: 400 })
    }

    const quantity =
      typeof qtyRaw === "number" && Number.isFinite(qtyRaw)
        ? Math.floor(qtyRaw)
        : typeof qtyRaw === "string" && /^\d+$/.test(qtyRaw.trim())
          ? parseInt(qtyRaw.trim(), 10)
          : NaN
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 150_000) {
      return NextResponse.json({ error: "quantity должно быть целым от 1 до 150000" }, { status: 400 })
    }

    const suzBaseUrl = typeof body.suzBaseUrl === "string" ? body.suzBaseUrl : ""
    const paramsBase = { suzBaseUrl, omsId, orderId, gtin, quantity, clientToken }

    let result: { ok: boolean; status: number; bodyText: string }
    try {
      result = signature
        ? await signedSuzV3CodesGet({ ...paramsBase, signature })
        : await signedSuzV3CodesGet(paramsBase)
      if (!result.ok && signature) {
        result = await signedSuzV3CodesGet(paramsBase)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return NextResponse.json({ error: appendSuzDiagnosticHints(msg) }, { status: 400 })
    }

    const { ok, status, bodyText } = result
    if (!ok) {
      const parsed = summarizeUpstreamError(bodyText)
      const text = parsed || bodyText || `HTTP ${status}`
      return NextResponse.json(
        { error: appendSuzDiagnosticHints(text), raw: bodyText.length > 4000 ? undefined : bodyText },
        { status: status >= 500 ? 502 : status },
      )
    }

    let data: unknown = {}
    try {
      data = bodyText ? JSON.parse(bodyText) : {}
    } catch {
      data = { raw: bodyText }
    }
    return NextResponse.json(data)
  } catch (e) {
    const isAbort = e instanceof Error && e.name === "AbortError"
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { error: isAbort ? `Превышено время ожидания (${SUZ_SIGNED_POST_TIMEOUT_MS / 1000} сек)` : msg },
      { status: 502 },
    )
  }
}
