import { getUpstreamCrptBearerToken } from "@/lib/wms/crpt-auth"

const PRODUCT_INFO_URL = "https://markirovka.crpt.ru/api/v4/true-api/product/info"

function normalizeGtin(gtin: string): string {
  return gtin.trim().padStart(14, "0").slice(-14)
}

/** Название товара ЧЗ по GTIN (True API product/info). */
export async function fetchCrptProductName(gtin: string): Promise<string | null> {
  const g = normalizeGtin(gtin)
  if (!/^\d{14}$/.test(g)) return null

  const token = getUpstreamCrptBearerToken()
  if (!token) return null
  const auth = token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch(PRODUCT_INFO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: auth,
      },
      body: JSON.stringify({ gtins: [g] }),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      results?: Array<{ gtin?: string; name?: string; fullName?: string; productName?: string }>
    }
    const results = data.results ?? []
    const hit =
      results.find((r) => normalizeGtin(String(r.gtin ?? "")) === g) ?? results[0]
    const name = String(hit?.name || hit?.fullName || hit?.productName || "").trim()
    return name || null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function isStubFinishedGoodsName(name: string, gtin?: string): boolean {
  const n = name.trim()
  if (/^ГП\s+\d{8,14}$/i.test(n)) return true
  if (gtin && n === `ГП ${normalizeGtin(gtin)}`) return true
  if (gtin && n === normalizeGtin(gtin)) return true
  return false
}
