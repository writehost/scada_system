import { getSiteCode } from "@/lib/wms-api"
import { authRequestHeaders } from "@/lib/auth/client-token"
import { emptyErpCatalogs, type ErpTransferCatalogs } from "@/lib/wms/one-c-transfer-fields"

export type OneCSyncResult = {
  ok: true
  totalIn1C: number
  fetched: number
  pages: number
  inserted: number
  updated: number
  skipped: number
  groupsFilled?: number
  skuFilled?: number
}

export type ErpWarehouse = {
  refKey: string
  code: string
  name: string
  wmsCode: string | null
}

export type ErpTransferOrderRow = {
  refKey: string
  documentNo: string
  docDate: string | null
  posted: boolean
  deletionMark: boolean
  status: string
  comment: string
  sourceWarehouseKey: string
  targetWarehouseKey: string
  sourceWarehouseName: string
  targetWarehouseName: string
  lineCount: number
  wmsDocumentId: string | null
  createdFrom: string
}

export type TransferSyncSettings = {
  continuous: boolean
  lastFullSyncAt: string | null
  lastIncrementalAt: string | null
  lastWatermarkDate: string | null
  lastError: string | null
  defaultOrganizationKey?: string
  defaultRecipientOrganizationKey?: string
  defaultPriorityKey?: string
  defaultAuthorKey?: string
  defaultDepartmentKey?: string
  defaultResponsibleKey?: string
  defaultSourceWarehouseKey?: string
  defaultTargetWarehouseKey?: string
  defaultStatus?: string
  defaultOperation?: string
  defaultDeliveryMethod?: string
  defaultActivity?: string
  defaultAcceptanceVariant?: string
  defaultSupplyVariant?: string
}

export type TransferSyncResult = {
  ok: true
  mode: "full" | "incremental"
  done: boolean
  nextSkip: number
  totalIn1C: number
  fetched: number
  pages: number
  upserted: number
  tasksCreated: number
  warehousesSynced: number
  skippedClosed: number
  unmatchedLines: number
}

export async function listErpTransferOrders(params?: {
  query?: string
  onlyOpen?: boolean
  limit?: number
}): Promise<{
  orders: ErpTransferOrderRow[]
  warehouses: ErpWarehouse[]
  catalogs: ErpTransferCatalogs
  defaults: TransferSyncSettings
  counts: { total: number; open: number; withTasks: number }
}> {
  const qp = new URLSearchParams({ siteCode: getSiteCode() })
  if (params?.query) qp.set("query", params.query)
  if (params?.onlyOpen) qp.set("onlyOpen", "1")
  if (params?.limit) qp.set("limit", String(params.limit))
  const res = await fetch(`/api/wms/transfers/erp?${qp.toString()}`, {
    cache: "no-store",
    headers: authRequestHeaders(),
  })
  const data = (await res.json().catch(() => ({}))) as {
    error?: string
    orders?: ErpTransferOrderRow[]
    warehouses?: ErpWarehouse[]
    catalogs?: ErpTransferCatalogs
    defaults?: TransferSyncSettings
    counts?: { total: number; open: number; withTasks: number }
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return {
    orders: data.orders ?? [],
    warehouses: data.warehouses ?? [],
    catalogs: data.catalogs ?? emptyErpCatalogs(),
    defaults: data.defaults ?? {
      continuous: false,
      lastFullSyncAt: null,
      lastIncrementalAt: null,
      lastWatermarkDate: null,
      lastError: null,
    },
    counts: data.counts ?? { total: 0, open: 0, withTasks: 0 },
  }
}

export async function syncTransferOrdersFrom1CErp(
  mode: "full" | "incremental",
  onProgress?: (partial: TransferSyncResult) => void
): Promise<TransferSyncResult> {
  let skip = 0
  let last: TransferSyncResult | null = null
  for (let step = 0; step < 80; step += 1) {
    const res = await fetch("/api/wms/transfers/erp/sync", {
      method: "POST",
      cache: "no-store",
      headers: authRequestHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ siteCode: getSiteCode(), mode, skip }),
    })
    const data = (await res.json().catch(() => ({}))) as TransferSyncResult & { error?: string }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    last = last
      ? {
          ...data,
          fetched: last.fetched + data.fetched,
          pages: last.pages + data.pages,
          upserted: last.upserted + data.upserted,
          tasksCreated: last.tasksCreated + data.tasksCreated,
          unmatchedLines: last.unmatchedLines + data.unmatchedLines,
          skippedClosed: last.skippedClosed + data.skippedClosed,
        }
      : data
    onProgress?.(last)
    if (data.done) return last
    skip = data.nextSkip
  }
  if (!last) throw new Error("1С не вернула заказы на перемещение")
  return last
}

export async function setTransferOrdersContinuous(continuous: boolean): Promise<TransferSyncSettings> {
  const res = await fetch("/api/wms/transfers/erp/sync", {
    method: "POST",
    cache: "no-store",
    headers: authRequestHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ siteCode: getSiteCode(), continuous }),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string; settings?: TransferSyncSettings }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data.settings ?? { continuous, lastFullSyncAt: null, lastIncrementalAt: null, lastWatermarkDate: null, lastError: null }
}

export async function saveErpTransferSettings(input: {
  defaults?: Partial<TransferSyncSettings>
  syncCatalogs?: boolean
}): Promise<{
  defaults: TransferSyncSettings
  catalogs: ErpTransferCatalogs
  warehouses: ErpWarehouse[]
}> {
  const res = await fetch("/api/wms/transfers/erp/settings", {
    method: "POST",
    cache: "no-store",
    headers: authRequestHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ siteCode: getSiteCode(), ...input }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    error?: string
    defaults?: TransferSyncSettings
    catalogs?: ErpTransferCatalogs
    warehouses?: ErpWarehouse[]
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return {
    defaults: data.defaults ?? {
      continuous: false,
      lastFullSyncAt: null,
      lastIncrementalAt: null,
      lastWatermarkDate: null,
      lastError: null,
    },
    catalogs: data.catalogs ?? emptyErpCatalogs(),
    warehouses: data.warehouses ?? [],
  }
}

export async function createErpTransferOrder(input: {
  requestId: string
  comment?: string
  sourceWarehouseKey: string
  targetWarehouseKey: string
  organizationKey?: string
  recipientOrganizationKey?: string
  priorityKey?: string
  authorKey?: string
  departmentKey?: string
  responsibleKey?: string
  status?: string
  operation?: string
  deliveryMethod?: string
  activity?: string
  acceptanceVariant?: string
  supplyVariant?: string
  lines: Array<{ itemCode: string; nomenclatureKey?: string; qty: number }>
}): Promise<{ refKey: string; documentNo: string; wmsDocumentId: string; taskCount: number }> {
  const res = await fetch("/api/wms/transfers/erp", {
    method: "POST",
    cache: "no-store",
    headers: authRequestHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ siteCode: getSiteCode(), ...input }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    error?: string
    refKey?: string
    documentNo?: string
    wmsDocumentId?: string
    taskCount?: number
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return {
    refKey: data.refKey || "",
    documentNo: data.documentNo || "",
    wmsDocumentId: data.wmsDocumentId || "",
    taskCount: data.taskCount || 0,
  }
}

export async function syncNomenclatureFrom1CErp(): Promise<OneCSyncResult> {
  const res = await fetch("/api/wms/nomenclature/sync-1c-erp", {
    method: "POST",
    cache: "no-store",
    headers: authRequestHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ siteCode: getSiteCode() }),
  })
  const data = (await res.json().catch(() => ({}))) as OneCSyncResult & { error?: string }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}
