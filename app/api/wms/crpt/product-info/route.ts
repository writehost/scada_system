import { NextResponse } from "next/server"
import { getUpstreamCrptBearerToken } from "@/lib/wms/crpt-auth"
import { requireWmsActor } from "@/lib/wms/require-actor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PRODUCT_INFO_URL = "https://markirovka.crpt.ru/api/v4/true-api/product/info"

function asGtins(body: unknown): string[] {
  if (!body || typeof body !== "object") return []
  const raw = (body as { gtins?: unknown }).gtins
  if (!Array.isArray(raw)) return []
  return [
    ...new Set(
      raw
        .map((g) => String(g ?? "").trim().padStart(14, "0").slice(-14))
        .filter((g) => /^\d{14}$/.test(g))
    ),
  ]
}

/** Карточка товара ЧЗ по GTIN — для подстановки названия при импорте ГП. */
export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true })
  if ("error" in actorGate) return actorGate.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }

  const gtins = asGtins(body)
  if (gtins.length === 0) {
    return NextResponse.json({ error: "gtins required" }, { status: 400 })
  }

  const token = getUpstreamCrptBearerToken()
  if (!token) {
    return NextResponse.json(
      { error: "CRPT token not configured (WMS_CRPT_BEARER_TOKEN)" },
      { status: 503 }
    )
  }

  const auth = token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25000)
  try {
    const res = await fetch(PRODUCT_INFO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: auth,
      },
      body: JSON.stringify({ gtins }),
      signal: controller.signal,
    })
    const text = await res.text()
    let data: unknown = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      return NextResponse.json({ error: "CRPT returned non-JSON" }, { status: 502 })
    }
    if (!res.ok) {
      const err =
        data && typeof data === "object" && "error" in data
          ? String((data as { error?: unknown }).error ?? "")
          : text.slice(0, 200)
      return NextResponse.json(
        { error: err || `CRPT HTTP ${res.status}` },
        { status: res.status >= 500 ? 502 : res.status }
      )
    }
    return NextResponse.json(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const aborted = e instanceof Error && e.name === "AbortError"
    return NextResponse.json({ error: aborted ? "CRPT timeout" : msg }, { status: 502 })
  } finally {
    clearTimeout(timer)
  }
}
