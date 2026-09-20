/**
 * Очередь заказов кодов с терминала печати этикеток (scada25 sidecar).
 * Публично: https://scada25.ru/gsmt/api/code-orders
 */

export type LabelCodeOrderStatus =
  | "new"
  | "codes_ready"
  | "sent_to_printer"
  | "signed"
  | "cancelled"
  | "done"

export type LabelCodeOrder = {
  id: string
  createdAt: string
  updatedAt: string
  status: LabelCodeOrderStatus | string
  gtin: string
  quantity: number
  nomenclatureName: string
  stickerType: string
  deviceId: string
  source: string
  note: string
  codesCount: number
  hasCodes: boolean
  printJobId: string
  codes?: string[]
}

function queueBase(): string {
  const fromEnv =
    (typeof process !== "undefined" && process.env.WMS_LABEL_QUEUE_URL?.trim()) ||
    (typeof process !== "undefined" && process.env.GSMT_PUBLIC_URL?.trim()) ||
    ""
  if (fromEnv) return fromEnv.replace(/\/$/, "")
  return "https://scada25.ru/gsmt"
}

async function queueFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = queueBase()
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`
  return fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  })
}

export async function listLabelCodeOrders(opts?: {
  status?: string
  limit?: number
}): Promise<LabelCodeOrder[]> {
  const q = new URLSearchParams()
  if (opts?.status) q.set("status", opts.status)
  if (opts?.limit) q.set("limit", String(opts.limit))
  const res = await queueFetch(`/api/code-orders?${q.toString()}`)
  const data = (await res.json()) as { ok?: boolean; orders?: LabelCodeOrder[]; error?: string }
  if (!res.ok) throw new Error(data.error || `code-orders ${res.status}`)
  return data.orders ?? []
}

/** Заказ, созданный из WMS: очередь та же, что у терминала печати, отличается только `source`. */
export async function createLabelCodeOrder(input: {
  gtin: string
  quantity: number
  nomenclatureName?: string
  stickerType?: string
  deviceId?: string
  source?: string
  note?: string
}): Promise<LabelCodeOrder> {
  const res = await queueFetch(`/api/code-orders`, {
    method: "POST",
    body: JSON.stringify({
      gtin: input.gtin,
      quantity: input.quantity,
      nomenclatureName: input.nomenclatureName ?? "",
      stickerType: input.stickerType ?? "",
      deviceId: input.deviceId ?? "",
      source: input.source ?? "wms-ui",
      note: input.note ?? "",
    }),
  })
  const data = (await res.json()) as { ok?: boolean; order?: LabelCodeOrder; error?: string }
  if (!res.ok || !data.order) throw new Error(data.error || `create order ${res.status}`)
  return data.order
}

export async function getLabelCodeOrder(id: string, includeCodes = false): Promise<LabelCodeOrder> {
  const q = includeCodes ? "?includeCodes=1" : "?includeCodes=0"
  const res = await queueFetch(`/api/code-orders/${encodeURIComponent(id)}${q}`)
  const data = (await res.json()) as { ok?: boolean; order?: LabelCodeOrder; error?: string }
  if (!res.ok || !data.order) throw new Error(data.error || `code-order ${res.status}`)
  return data.order
}

export async function patchLabelCodeOrder(
  id: string,
  body: { status?: string; note?: string; codes?: string[] | string; printJobId?: string },
): Promise<LabelCodeOrder> {
  const res = await queueFetch(`/api/code-orders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as { ok?: boolean; order?: LabelCodeOrder; error?: string }
  if (!res.ok || !data.order) throw new Error(data.error || `patch ${res.status}`)
  return data.order
}

export async function printLabelCodeOrder(
  id: string,
  opts?: { autoStart?: boolean; deviceId?: string; fileName?: string },
): Promise<{ printJobId: string; codesCount: number }> {
  const res = await queueFetch(`/api/code-orders/${encodeURIComponent(id)}/print`, {
    method: "POST",
    body: JSON.stringify(opts ?? { autoStart: true }),
  })
  const data = (await res.json()) as {
    ok?: boolean
    printJobId?: string
    codesCount?: number
    error?: string
  }
  if (!res.ok || !data.printJobId) throw new Error(data.error || `print ${res.status}`)
  return { printJobId: data.printJobId, codesCount: data.codesCount ?? 0 }
}

export function labelCodeOrderCodesDownloadUrl(id: string): string {
  return `${queueBase()}/api/code-orders/${encodeURIComponent(id)}/codes.txt`
}

export async function deleteLabelCodeOrder(id: string): Promise<void> {
  const res = await queueFetch(`/api/code-orders/${encodeURIComponent(id)}`, { method: "DELETE" })
  const data = (await res.json()) as { ok?: boolean; error?: string }
  if (!res.ok) throw new Error(data.error || `delete ${res.status}`)
}

export type PrintedLabelLookup = {
  gtin: string
  nomenclatureName: string
  orderId: string
  createdAt: string
  code: string
}

export async function lookupPrintedLabelCode(code: string): Promise<PrintedLabelLookup | null> {
  const q = new URLSearchParams({ code: code.trim() })
  const res = await queueFetch(`/api/code-orders/lookup?${q.toString()}`)
  if (res.status === 404) return null
  const data = (await res.json()) as {
    ok?: boolean
    gtin?: string
    nomenclatureName?: string
    code?: string
    order?: { id?: string; createdAt?: string }
    error?: string
  }
  if (!res.ok || !data.ok) return null
  const gtin = String(data.gtin || "").replace(/\D/g, "")
  if (gtin.length < 8) return null
  return {
    gtin: gtin.padStart(14, "0").slice(-14),
    nomenclatureName: String(data.nomenclatureName || "").trim(),
    orderId: String(data.order?.id || ""),
    createdAt: String(data.order?.createdAt || ""),
    code: String(data.code || code).trim(),
  }
}
