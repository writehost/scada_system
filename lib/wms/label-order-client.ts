import { authRequestHeaders } from "@/lib/auth/client-token"
import { getSiteCode } from "@/lib/wms-api"
import type { LabelCodeOrder } from "@/lib/wms/label-code-orders"
import type { LabelOrderDoc, LabelOrderEvent } from "@/lib/wms/label-order-docs"
import type {
  LabelOrderAdjustment,
  LabelOrderFact,
  LabelOrderWasteSettings,
} from "@/lib/wms/label-order-waste"
import type { LabelSuzSettings } from "@/lib/wms/label-suz-settings"

/** Заказ из очереди печати вместе с документом WMS и фактом печати. */
export type LabelOrderRow = LabelCodeOrder & {
  doc?: LabelOrderDoc | null
  fact?: LabelOrderFact | null
}

export type LabelOrderNomenclatureRow = {
  itemCode: string
  name: string
  gtin: string
  itemGroupCode: string | null
  productGroup?: string | null
  isMarked: boolean
  isStickerItem: boolean
  stickerKind: string | null
  lastOrderedAt: string | null
  ordersCount: number
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/wms/label-code-orders", {
    method: "POST",
    headers: authRequestHeaders({ "Content-Type": "application/json" }),
    credentials: "same-origin",
    body: JSON.stringify({ siteCode: getSiteCode(), ...body }),
  })
  const data = (await res.json()) as { error?: string } & T
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}

export async function listLabelOrderRows(limit = 100): Promise<{
  orders: LabelOrderRow[]
  settings: LabelOrderWasteSettings | null
  suzSettings: Partial<LabelSuzSettings> | null
}> {
  const qp = new URLSearchParams({ limit: String(limit), siteCode: getSiteCode() })
  const res = await fetch(`/api/wms/label-code-orders?${qp.toString()}`, {
    cache: "no-store",
    headers: authRequestHeaders(),
    credentials: "same-origin",
  })
  const data = (await res.json()) as {
    ok?: boolean
    orders?: LabelOrderRow[]
    settings?: LabelOrderWasteSettings | null
    suzSettings?: Partial<LabelSuzSettings> | null
    error?: string
  }
  if (!res.ok) throw new Error(data.error || res.statusText)
  return {
    orders: data.orders ?? [],
    settings: data.settings ?? null,
    suzSettings: data.suzSettings ?? null,
  }
}

export async function loadLabelOrderNomenclature(
  query: string,
  limit = 60
): Promise<LabelOrderNomenclatureRow[]> {
  const qp = new URLSearchParams({ siteCode: getSiteCode(), query, limit: String(limit) })
  const res = await fetch(`/api/wms/label-code-orders/nomenclature?${qp.toString()}`, {
    cache: "no-store",
    headers: authRequestHeaders(),
    credentials: "same-origin",
  })
  const data = (await res.json()) as {
    ok?: boolean
    items?: LabelOrderNomenclatureRow[]
    error?: string
  }
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data.items ?? []
}

export type LabelOrderDocDetails = {
  order: LabelCodeOrder
  doc?: LabelOrderDoc
  fact?: LabelOrderFact
  adjustments?: LabelOrderAdjustment[]
  events?: LabelOrderEvent[]
  settings?: LabelOrderWasteSettings
}

export async function loadLabelOrderDoc(orderId: string): Promise<LabelOrderDocDetails> {
  const qp = new URLSearchParams({ doc: "1", includeCodes: "0", siteCode: getSiteCode() })
  const res = await fetch(
    `/api/wms/label-code-orders/${encodeURIComponent(orderId)}?${qp.toString()}`,
    { cache: "no-store", headers: authRequestHeaders(), credentials: "same-origin" }
  )
  const data = (await res.json()) as LabelOrderDocDetails & { ok?: boolean; error?: string }
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}

export async function createLabelOrder(input: {
  gtin: string
  itemCode?: string
  nomenclatureName: string
  stickerType: string
  quantity: number
  wastePercent?: number
  addWasteToOrder?: boolean
  comment?: string
}): Promise<{ order: LabelCodeOrder; doc: LabelOrderDoc }> {
  return post<{ order: LabelCodeOrder; doc: LabelOrderDoc }>({ action: "create", ...input })
}

export async function saveLabelOrderSettings(
  settings: LabelOrderWasteSettings,
  suz?: Partial<LabelSuzSettings>
): Promise<{ settings: LabelOrderWasteSettings; suzSettings: Partial<LabelSuzSettings> | null }> {
  return post<{ settings: LabelOrderWasteSettings; suzSettings: Partial<LabelSuzSettings> | null }>({
    action: "save-settings",
    settings,
    suz,
  })
}

export async function submitLabelOrderAdjustment(input: {
  id: string
  printedQty: number
  spooledQty: number
  defectQty: number
  comment?: string
}): Promise<{
  fact: LabelOrderFact
  adjustments: LabelOrderAdjustment[]
  events: LabelOrderEvent[]
}> {
  return post({ action: "adjust", ...input })
}

export async function revertLabelOrderAdjustmentRequest(adjustmentId: string): Promise<void> {
  await post({ action: "revert-adjustment", adjustmentId })
}

export function labelOrderOriginLabel(
  doc: LabelOrderDoc | null | undefined,
  order?: { source?: string; deviceId?: string }
): string {
  if (doc?.origin === "wms-ui") return doc.originDetail || "интерфейс WMS"
  if (doc?.origin === "printer-terminal") {
    return doc.originDetail || (order?.deviceId ? `терминал печати · ${order.deviceId}` : "терминал печати")
  }
  if (doc?.originDetail) return doc.originDetail
  const source = (order?.source || "").trim()
  if (source === "printer-terminal") {
    return order?.deviceId ? `терминал печати · ${order.deviceId}` : "терминал печати"
  }
  return source || "источник неизвестен"
}

export function labelOrderAuthorLabel(doc: LabelOrderDoc | null | undefined): string {
  const fio = (doc?.authorFio || "").trim()
  const login = (doc?.authorLogin || "").trim()
  if (fio) return fio
  if (login) return login
  return "терминал печати"
}
