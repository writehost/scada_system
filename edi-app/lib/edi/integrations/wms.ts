import type { PoolClient } from "pg"
import { resolveIntegration } from "./config.ts"

/**
 * Клиент SCADA WMS по её HTTP API (те же маршруты, что использует интерфейс склада), с персональным
 * токеном `wmsu_…` сервисного пользователя WMS. EDI не пишет в таблицы WMS напрямую:
 *  - справочник поставщиков, номенклатура, алиасы — чтение и создание алиаса через API WMS;
 *  - «черновик приёмки» — заказ на приход (PUT /api/wms/receiving/inbound): остатки не меняются,
 *    приёмку на остаток проводит склад существующей логикой WMS (ТСД → проведение);
 *  - факт приёмки — чтение проведений (GET /api/wms/receiving/stock-posts).
 * Недоступность WMS не ломает EDI: методы бросают WmsUnavailable, вызывающий код деградирует.
 */

export class WmsUnavailable extends Error {
  status: number
  constructor(message: string, status = 503) {
    super(message)
    this.name = "WmsUnavailable"
    this.status = status
  }
}

export type WmsItem = { itemCode: string; name: string; sku: string | null; uomCode: string | null; barcode?: string | null }
export type WmsAliasHit = { itemCode: string; itemName: string; aliasName: string; aliasSku: string | null; supplierCode: string | null; supplierName: string | null }
export type WmsSupplier = {
  supplierId: string
  code: string
  name: string
  taxId: string | null
  isActive: boolean
  meta: {
    legalName?: string
    kpp?: string
    ogrn?: string
    addresses?: { legal?: string; actual?: string; delivery?: string }
    phone?: string
    email?: string
    contactPerson?: string
    bankName?: string
    bankBik?: string
    bankAccount?: string
    corrAccount?: string
  }
}
export type WmsInboundLine = { itemCode: string; itemName: string; expectedQty: number; lotCode: string; targetLocationCode: string; splits?: unknown[] }
export type WmsStockPost = {
  documentId: string
  postedAtIso: string | null
  locationCode: string | null
  totalQty: number | null
  dismissedEmpty: boolean
  postedLines: Array<{ itemCode: string; qty: number; lotCode?: string; emissionDay?: string }>
}

export class WmsClient {
  baseUrl: string
  token: string
  siteCode: string
  timeoutMs: number
  constructor(opts: { baseUrl: string; token: string; siteCode: string; timeoutMs?: number }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "")
    this.token = opts.token
    this.siteCode = opts.siteCode
    this.timeoutMs = opts.timeoutMs ?? (Number(process.env.EDI_WMS_TIMEOUT_MS) || 8000)
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          "X-Site-Code": this.siteCode,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (e) {
      throw new WmsUnavailable(`WMS недоступна: ${e instanceof Error ? e.message : String(e)}`)
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.status === 401 || res.status === 403) throw new WmsUnavailable("WMS отклонила токен интеграции", res.status)
    if (!res.ok) throw new WmsUnavailable(String(data.error || `WMS ответила ${res.status}`), res.status)
    return data as T
  }

  private q(params: Record<string, string | number | undefined>): string {
    const u = new URLSearchParams({ siteCode: this.siteCode })
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.set(k, String(v))
    return u.toString()
  }

  async check(): Promise<{ ok: boolean; message: string; items?: number }> {
    const data = await this.call<{ items?: unknown[]; total?: number }>("GET", `/api/wms/items?${this.q({ limit: 1 })}`)
    return { ok: true, message: "WMS отвечает, токен принят", items: data.total ?? data.items?.length ?? 0 }
  }

  async suppliers(): Promise<WmsSupplier[]> {
    const data = await this.call<{ suppliers?: WmsSupplier[] }>("GET", `/api/wms/directories/suppliers?${this.q({})}`)
    return data.suppliers ?? []
  }

  async searchItems(query: string, limit = 20): Promise<WmsItem[]> {
    if (query.trim().length < 2) return []
    const data = await this.call<{ items?: Array<Record<string, unknown>> }>("GET", `/api/wms/items?${this.q({ query, limit })}`)
    return (data.items ?? []).map((i) => ({
      itemCode: String(i.itemCode),
      name: String(i.name ?? i.shortName ?? ""),
      sku: (i.sku as string) ?? null,
      uomCode: (i.uomCode as string) ?? null,
    }))
  }

  /** Поиск по штрихкоду/GTIN: строгое совпадение после нормализации к 14 цифрам. */
  async findByGtin(gtin: string): Promise<WmsItem | null> {
    const norm = gtin.replace(/\D/g, "").padStart(14, "0")
    const data = await this.call<{ items?: Array<Record<string, unknown>> }>("GET", `/api/wms/lookup?${this.q({ query: norm.replace(/^0+/, "") })}`)
    const hit = (data.items ?? []).find((i) => String(i.barcode ?? "").replace(/\D/g, "").padStart(14, "0") === norm)
    return hit ? { itemCode: String(hit.itemCode), name: String(hit.name ?? ""), sku: null, uomCode: null, barcode: String(hit.barcode) } : null
  }

  async searchAliases(query: string, supplier?: { code?: string | null; name?: string | null }): Promise<WmsAliasHit[]> {
    if (query.trim().length < 2) return []
    const data = await this.call<{ hits?: WmsAliasHit[] }>(
      "GET",
      `/api/wms/item-aliases/search?${this.q({ query, supplierCode: supplier?.code ?? undefined })}`
    )
    return data.hits ?? []
  }

  async createAlias(itemCode: string, alias: { aliasName: string; aliasSku?: string | null; gtin?: string | null; supplierCode?: string | null; supplierName?: string | null }) {
    return this.call<{ alias: { aliasId: string } }>("POST", `/api/wms/items/${encodeURIComponent(itemCode)}/aliases`, {
      siteCode: this.siteCode,
      ...alias,
      source: "scada-edi",
    })
  }

  async getInbound(documentId: string) {
    const data = await this.call<{ inbound: unknown }>("GET", `/api/wms/receiving/inbound?${this.q({ documentId })}`)
    return data.inbound as { documentId: string; supplier: string; lines: WmsInboundLine[]; updatedAt: string | null } | null
  }

  async putInbound(input: { documentId: string; supplier: string; expectedBatch?: string; comment?: string; lines: WmsInboundLine[] }) {
    const data = await this.call<{ inbound: unknown }>("PUT", `/api/wms/receiving/inbound`, { siteCode: this.siteCode, ...input })
    return data.inbound as { documentId: string; lines: WmsInboundLine[]; updatedAt: string | null }
  }

  async stockPosts(): Promise<WmsStockPost[]> {
    const data = await this.call<{ posts?: WmsStockPost[] }>("GET", `/api/wms/receiving/stock-posts?${this.q({})}`)
    return data.posts ?? []
  }

  /** Внутреннее уведомление SCADA System (колокольчик WMS) — канал доставки уведомлений EDI. */
  async notify(input: { title: string; body: string; userIds: string[]; severity?: string }) {
    return this.call<{ notificationId: string }>("POST", `/api/wms/notifications`, {
      siteCode: this.siteCode,
      title: input.title,
      body: input.body,
      severity: input.severity ?? "info",
      target: "users",
      userIds: input.userIds.map(Number),
    })
  }

  /** Ссылка на карточку в интерфейсе WMS для перехода из EDI. */
  receivingUrl(documentId: string): string {
    return `${this.baseUrl}/receiving?documentId=${encodeURIComponent(documentId)}`
  }
}

export async function wmsClientFor(client: PoolClient, siteId: number, siteCode: string): Promise<WmsClient | null> {
  const cfg = await resolveIntegration(client, siteId, "wms")
  if (!cfg || !cfg.enabled) return null
  const baseUrl = String(cfg.config.baseUrl || "")
  if (!baseUrl || !cfg.secret) return null
  const code = String(cfg.config.siteCode || "") || siteCode
  return new WmsClient({ baseUrl, token: cfg.secret, siteCode: code })
}
