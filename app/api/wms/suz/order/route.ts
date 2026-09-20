import { NextRequest, NextResponse } from "next/server"
import {
  decodeBase64Utf8,
  signedSuzV3Post,
  summarizeUpstreamError,
  SUZ_SIGNED_POST_TIMEOUT_MS,
} from "@/lib/suz-signed-proxy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** POST /api/wms/suz/order — прокси создания заказа КМ в СУЗ (как GSMT /api/suz/order). */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      clientToken?: string
      token?: string
      signature?: string
      content?: string
      omsId?: string
      suzBaseUrl?: string
    }

    const clientToken =
      typeof body.clientToken === "string" && body.clientToken.trim()
        ? body.clientToken.trim()
        : typeof body.token === "string"
          ? body.token.trim()
          : ""
    const signature = typeof body.signature === "string" ? body.signature.replace(/\s/g, "").trim() : ""
    const content = typeof body.content === "string" ? body.content.trim() : ""
    const omsId = typeof body.omsId === "string" ? body.omsId.trim() : ""

    if (!clientToken) return NextResponse.json({ error: "Требуется clientToken СУЗ" }, { status: 400 })
    if (!signature || !content) return NextResponse.json({ error: "Требуются signature и content" }, { status: 400 })
    if (!omsId) return NextResponse.json({ error: "Требуется omsId" }, { status: 400 })

    const payloadUtf8 = decodeBase64Utf8(content)
    const { ok, status, bodyText } = await signedSuzV3Post({
      resource: "order",
      suzBaseUrl: typeof body.suzBaseUrl === "string" ? body.suzBaseUrl : "",
      omsId,
      clientToken,
      signature,
      bodyUtf8: payloadUtf8,
    })

    if (!ok) {
      const parsed = summarizeUpstreamError(bodyText)
      return NextResponse.json(
        { error: parsed || bodyText || `HTTP ${status}`, raw: bodyText.length > 4000 ? undefined : bodyText },
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
