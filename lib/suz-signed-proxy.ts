/** Общая часть прокси к СУЗ API v3 (clientToken + X-Signature + JSON UTF-8). */

export const DEFAULT_SUZ_BASE = "https://suzgrid.crpt.ru"
export const SUZ_SIGNED_POST_TIMEOUT_MS = 45_000

/** Разрешённые сегменты пути после `/api/v3/` (защита от подстановки произвольного URL). */
const ALLOWED_RESOURCES = new Set(["utilisation", "order", "order/list", "codes"])

function normalizeResourceSegment(segment: string): string {
  const s = segment.trim().replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/")
  if (!/^[a-z]+(?:\/[a-z]+)*$/.test(s)) {
    throw new Error("Недопустимый ресурс СУЗ")
  }
  return s
}

export function decodeBase64Utf8(value: string): string {
  const normalized = value.replace(/\s/g, "")
  return Buffer.from(normalized, "base64").toString("utf-8")
}

export function sanitizeBaseUrl(input?: string): string {
  const raw = (input ?? "").trim()
  if (!raw) return DEFAULT_SUZ_BASE
  if (!/^https?:\/\//i.test(raw)) return DEFAULT_SUZ_BASE
  return raw.replace(/\/+$/, "")
}

/** Минимальные заголовки GET к suzgrid (Referer часто ломает ответы при серверном fetch). */
function suzGridGetHeaders(clientToken: string, signature?: string): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
    clientToken,
  }
  const sig = typeof signature === "string" ? signature.replace(/\s/g, "").trim() : ""
  if (sig) headers["X-Signature"] = sig
  return headers
}

/** UUID из документа СУЗ — в нижнем регистре в query. */
export function normalizeSuzUuid(value: string): string {
  const t = value.trim()
  const lower = t.toLowerCase()
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(lower)) return lower
  return t
}

export function summarizeUpstreamError(bodyText: string): string {
  const raw = bodyText.trim()
  if (!raw) return ""
  try {
    const j = JSON.parse(raw) as Record<string, unknown>
    const parts: string[] = []
    const push = (v: unknown) => {
      if (typeof v === "string" && v.trim()) parts.push(v.trim())
    }
    push(j.message)
    push(j.error)
    push(j.error_message)
    push(j.description)
    if (typeof j.error === "object" && j.error && typeof (j.error as Record<string, unknown>).message === "string") {
      push((j.error as Record<string, unknown>).message)
    }

    const glob = j.globalErrors
    if (Array.isArray(glob)) {
      for (const item of glob) {
        if (item && typeof item === "object") {
          const g = item as { error?: unknown; errorCode?: unknown }
          const msg = typeof g.error === "string" ? g.error.trim() : ""
          const code = g.errorCode != null ? `[${String(g.errorCode)}]` : ""
          const line = [code, msg].filter(Boolean).join(" ").trim()
          if (line) parts.push(line)
        }
      }
    }
    const fieldErrors = j.fieldErrors
    if (Array.isArray(fieldErrors)) {
      for (const item of fieldErrors) {
        if (item && typeof item === "object") {
          const f = item as { fieldName?: unknown; fieldError?: unknown; errorCode?: unknown }
          const name = typeof f.fieldName === "string" ? f.fieldName : ""
          const fe = typeof f.fieldError === "string" ? f.fieldError : f.errorCode != null ? String(f.errorCode) : ""
          const line = [name, fe].filter(Boolean).join(": ").trim()
          if (line) parts.push(line)
        }
      }
    }

    if (parts.length) return [...new Set(parts)].join(" — ")
  } catch {
    /* not json */
  }
  return raw
}

export async function signedSuzV3Post(params: {
  resource: string
  suzBaseUrl: string
  omsId: string
  clientToken: string
  signature: string
  bodyUtf8: string
}): Promise<{ ok: boolean; status: number; bodyText: string }> {
  const segment = normalizeResourceSegment(params.resource.trim())
  if (!ALLOWED_RESOURCES.has(segment)) {
    throw new Error("Недопустимый ресурс СУЗ")
  }
  const url = `${sanitizeBaseUrl(params.suzBaseUrl)}/api/v3/${segment}?omsId=${encodeURIComponent(params.omsId)}`
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), SUZ_SIGNED_POST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        clientToken: params.clientToken,
        "X-Signature": params.signature,
      },
      body: params.bodyUtf8,
      signal: controller.signal,
    })
    const bodyText = await res.text()
    return { ok: res.ok, status: res.status, bodyText }
  } finally {
    clearTimeout(id)
  }
}

/** GET …/{webapi|api}/v3/codes?omsId=&orderId=&gtin=&quantity= — «Получить КМ из заказа КМ». При необходимости — X-Signature (подпись `{}`). */
export async function signedSuzV3CodesGet(params: {
  suzBaseUrl: string
  omsId: string
  orderId: string
  gtin: string
  quantity: number
  clientToken: string
  signature?: string
}): Promise<{ ok: boolean; status: number; bodyText: string }> {
  const segment = normalizeResourceSegment("codes")
  if (!ALLOWED_RESOURCES.has(segment)) {
    throw new Error("Недопустимый ресурс СУЗ")
  }
  const q = Math.floor(Number(params.quantity))
  if (!Number.isFinite(q) || q < 1 || q > 150_000) {
    throw new Error("quantity должно быть от 1 до 150000")
  }
  const qs = new URLSearchParams()
  qs.set("omsId", normalizeSuzUuid(params.omsId))
  qs.set("orderId", normalizeSuzUuid(params.orderId))
  qs.set("gtin", params.gtin.trim())
  qs.set("quantity", String(q))

  const base = sanitizeBaseUrl(params.suzBaseUrl)
  const mounts = ["webapi", "api"] as const
  let last: { ok: boolean; status: number; bodyText: string } = { ok: false, status: 502, bodyText: "" }

  for (const mount of mounts) {
    const url = `${base}/${mount}/v3/${segment}?${qs.toString()}`
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), SUZ_SIGNED_POST_TIMEOUT_MS)
    try {
      let res: Response
      try {
        res = await fetch(url, {
          method: "GET",
          headers: suzGridGetHeaders(params.clientToken, params.signature),
          signal: controller.signal,
        })
      } catch (err) {
        last = {
          ok: false,
          status: 503,
          bodyText: err instanceof Error ? err.message : String(err),
        }
        continue
      }
      const bodyText = await res.text()
      last = { ok: res.ok, status: res.status, bodyText }
      if (res.ok) return last
    } finally {
      clearTimeout(id)
    }
  }
  return last
}

const ORDER_ID_UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/** GET …/{webapi|api}/v3/orders/{orderId}/buffer — буфер заказа. При необходимости — X-Signature (подпись `{}`). */
export async function signedSuzOrdersBufferGet(params: {
  suzBaseUrl: string
  orderId: string
  clientToken: string
  signature?: string
}): Promise<{ ok: boolean; status: number; bodyText: string }> {
  const oid = normalizeSuzUuid(params.orderId)
  if (!ORDER_ID_UUID_RE.test(oid)) {
    throw new Error("orderId должен быть UUID заказа СУЗ")
  }
  const base = sanitizeBaseUrl(params.suzBaseUrl)
  const mounts = ["webapi", "api"] as const
  let last: { ok: boolean; status: number; bodyText: string } = { ok: false, status: 502, bodyText: "" }

  for (const mount of mounts) {
    const url = `${base}/${mount}/v3/orders/${encodeURIComponent(oid)}/buffer`
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), SUZ_SIGNED_POST_TIMEOUT_MS)
    try {
      let res: Response
      try {
        res = await fetch(url, {
          method: "GET",
          headers: suzGridGetHeaders(params.clientToken, params.signature),
          signal: controller.signal,
        })
      } catch (err) {
        last = {
          ok: false,
          status: 503,
          bodyText: err instanceof Error ? err.message : String(err),
        }
        continue
      }
      const bodyText = await res.text()
      last = { ok: res.ok, status: res.status, bodyText }
      if (res.ok) return last
    } finally {
      clearTimeout(id)
    }
  }
  return last
}
