/**
 * Интеграционный слой Route → WMS.
 *
 * WMS — источник истины по палетам, адресам и остаткам. Route не пишет в таблицы WMS:
 * проверки и перемещение идут через API WMS /api/wms/route/* (см. app/api/wms/route в основном приложении).
 * Перемещение идемпотентно по requestId (wms_request_log), поэтому повторная отправка
 * не создаёт второго движения.
 */

export type WmsProblem = { code: string; message: string }

export type WmsPallet = {
  palletId: string
  code: string
  sscc: string | null
  itemCode: string | null
  itemName: string | null
  lotCode: string | null
  qty: number | null
  expiryAt: string | null
  locationCode: string | null
  locationStatus: "active" | "quarantine" | "blocked" | null
  reservedTaskRef: string | null
  resortOpen: boolean
  status: string
}

export type PalletCheck = {
  found: boolean
  pallet: WmsPallet | null
  problems: WmsProblem[]
}

export type WmsAddress = {
  locationCode: string
  locationId: string
  active: boolean
  quarantine: boolean
  isFgRow: boolean
  capacity: number | null
  occupied: number
  free: number | null
  reservedBy: string[]
}

export type AddressCheck = {
  found: boolean
  address: WmsAddress | null
  problems: WmsProblem[]
  placement: { ok: boolean; reason: string } | null
}

export type MoveResult =
  | {
      ok: true
      /** simulated — учебное задание: WMS не вызывалась, остатки не менялись */
      disposition: "applied" | "duplicate" | "simulated"
      movementId: string
      palletCode: string
      fromLocationCode: string | null
      toLocationCode: string
      movedCodes: number
      ledger: string
      at: string
    }
  | { ok: false; kind: "rejected"; status: number; code: string; message: string }
  | { ok: false; kind: "unavailable"; message: string }

export type DemandItem = {
  wmsTaskId: string
  taskCode: string | null
  type: string
  priority: number
  palletCode: string
  sourceLocationCode: string
  targetLocationCode: string | null
  dueAt: string | null
}

export type RecommendResult = { ok: true; locationCode: string; reason: string } | { ok: false; message: string }

export interface WmsGateway {
  checkPallet(input: { siteCode: string; code: string; taskRef?: string | null }): Promise<PalletCheck>
  checkAddress(input: {
    siteCode: string
    locationCode: string
    palletCode?: string | null
    taskRef?: string | null
  }): Promise<AddressCheck>
  movePallet(input: {
    siteCode: string
    requestId: string
    palletCode: string
    fromLocationCode: string | null
    toLocationCode: string
    taskRef: string
    actorLogin: string
    wmsRef?: { kind: string; id: string } | null
  }): Promise<MoveResult>
  recommendAddress(input: {
    siteCode: string
    palletCode: string
    excludeLocationCodes: string[]
  }): Promise<RecommendResult>
  /** Взять открытые складские задания WMS по палетам ГП (WMS помечает их как переданные в Route). */
  pullDemand(input: { siteCode: string; limit: number }): Promise<DemandItem[]>
  /** Вернуть задание WMS в очередь WMS, если Route не смог его принять. */
  releaseDemand(input: { siteCode: string; wmsTaskId: string; reason: string }): Promise<void>
}

export class WmsUnavailableError extends Error {}

class HttpWmsGateway implements WmsGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs: number
  ) {}

  private async call<T>(path: string, body: Record<string, unknown>): Promise<{ status: number; data: T }> {
    if (!this.baseUrl || !this.token) {
      throw new WmsUnavailableError("WMS API не настроен (WMS_ROUTE_API_URL / WMS_ROUTE_API_TOKEN)")
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.token}`,
          "x-site-code": String(body.siteCode || ""),
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
        cache: "no-store",
      })
      const text = await res.text()
      let data: unknown = {}
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        throw new WmsUnavailableError(`WMS вернул не JSON (HTTP ${res.status})`)
      }
      if (res.status >= 500) {
        const msg = (data as { error?: string }).error || `HTTP ${res.status}`
        throw new WmsUnavailableError(`WMS: ${msg}`)
      }
      return { status: res.status, data: data as T }
    } catch (error) {
      if (error instanceof WmsUnavailableError) throw error
      throw new WmsUnavailableError(
        (error as Error)?.name === "AbortError" ? "WMS не ответил вовремя" : `WMS недоступен: ${(error as Error).message}`
      )
    } finally {
      clearTimeout(timer)
    }
  }

  private static unauthorized(status: number, data: { error?: string; code?: string }) {
    if (status === 401 || status === 403) {
      throw new WmsUnavailableError(`WMS отклонил сервисный доступ Route: ${data.error || status}`)
    }
  }

  async checkPallet(input: { siteCode: string; code: string; taskRef?: string | null }): Promise<PalletCheck> {
    const { status, data } = await this.call<PalletCheck & { error?: string; code?: string }>(
      "/api/wms/route/pallet-check",
      input
    )
    HttpWmsGateway.unauthorized(status, data)
    if (status >= 400) return { found: false, pallet: null, problems: [{ code: data.code || "wms_error", message: data.error || `HTTP ${status}` }] }
    return { found: Boolean(data.found), pallet: data.pallet ?? null, problems: data.problems ?? [] }
  }

  async checkAddress(input: {
    siteCode: string
    locationCode: string
    palletCode?: string | null
    taskRef?: string | null
  }): Promise<AddressCheck> {
    const { status, data } = await this.call<AddressCheck & { error?: string; code?: string }>(
      "/api/wms/route/address-check",
      input
    )
    HttpWmsGateway.unauthorized(status, data)
    if (status >= 400) {
      return { found: false, address: null, problems: [{ code: data.code || "wms_error", message: data.error || `HTTP ${status}` }], placement: null }
    }
    return { found: Boolean(data.found), address: data.address ?? null, problems: data.problems ?? [], placement: data.placement ?? null }
  }

  async movePallet(input: {
    siteCode: string
    requestId: string
    palletCode: string
    fromLocationCode: string | null
    toLocationCode: string
    taskRef: string
    actorLogin: string
    wmsRef?: { kind: string; id: string } | null
  }): Promise<MoveResult> {
    try {
      const { status, data } = await this.call<Record<string, unknown>>("/api/wms/route/move-pallet", input)
      HttpWmsGateway.unauthorized(status, data as { error?: string })
      if (status >= 400) {
        return {
          ok: false,
          kind: "rejected",
          status,
          code: String(data.code || "wms_rejected"),
          message: String(data.error || `WMS отклонил перемещение (HTTP ${status})`),
        }
      }
      return {
        ok: true,
        disposition: data.disposition === "duplicate" ? "duplicate" : "applied",
        movementId: String(data.movementId || input.requestId),
        palletCode: String(data.palletCode || input.palletCode),
        fromLocationCode: (data.fromLocationCode as string | null) ?? input.fromLocationCode,
        toLocationCode: String(data.toLocationCode || input.toLocationCode),
        movedCodes: Number(data.movedCodes) || 0,
        ledger: String(data.ledger || ""),
        at: String(data.at || new Date().toISOString()),
      }
    } catch (error) {
      if (error instanceof WmsUnavailableError) return { ok: false, kind: "unavailable", message: error.message }
      throw error
    }
  }

  async recommendAddress(input: {
    siteCode: string
    palletCode: string
    excludeLocationCodes: string[]
  }): Promise<RecommendResult> {
    try {
      const { status, data } = await this.call<{ locationCode?: string; reason?: string; error?: string }>(
        "/api/wms/route/recommend-address",
        input
      )
      if (status >= 400 || !data.locationCode) return { ok: false, message: data.error || "WMS не предложил адрес" }
      return { ok: true, locationCode: data.locationCode, reason: data.reason || "" }
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    }
  }

  async pullDemand(input: { siteCode: string; limit: number }): Promise<DemandItem[]> {
    const { status, data } = await this.call<{ items?: DemandItem[]; error?: string }>("/api/wms/route/demand", {
      ...input,
      action: "pull",
    })
    HttpWmsGateway.unauthorized(status, data)
    if (status >= 400) throw new WmsUnavailableError(data.error || `HTTP ${status}`)
    return Array.isArray(data.items) ? data.items : []
  }

  async releaseDemand(input: { siteCode: string; wmsTaskId: string; reason: string }): Promise<void> {
    await this.call("/api/wms/route/demand", { ...input, action: "release" })
  }
}

let override: WmsGateway | null = null

export function setWmsGatewayForTests(gw: WmsGateway | null) {
  override = gw
}

export function wmsGateway(): WmsGateway {
  if (override) return override
  return new HttpWmsGateway(
    (process.env.WMS_ROUTE_API_URL || "").trim().replace(/\/+$/, ""),
    (process.env.WMS_ROUTE_API_TOKEN || "").trim(),
    Number(process.env.WMS_ROUTE_API_TIMEOUT_MS || 8000) || 8000
  )
}
