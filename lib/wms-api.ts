import type {
  StorageSlotProfile,
  WmsStorageRecommendResponse,
} from "@/lib/storage-slot-ui"
import {
  dedupeOperatorNomenclatureGroups,
  type OperatorNomenclatureGroup,
  type OperatorPickerGroupsSource,
} from "@/lib/nomenclature-group-catalog"
import { RECEIVING_PRODUCT_GROUPS } from "@/lib/receiving-product-groups"
import { authRequestHeaders, clearAccessToken, setAccessToken } from "@/lib/auth/client-token"
import {
  DEVICE_TOKEN_HEADER,
  getDeviceToken,
  setDeviceToken,
} from "@/lib/wms/device-token-client"

export type ApiError = { error?: string; message?: string; code?: string; details?: unknown }

/** Ошибка HTTP от WMS API (см. поле code в JSON, например device_not_found) */
export type WmsClientError = Error & { status: number; code?: string; details?: unknown }

function throwHttpError(r: Response, data: ApiError): never {
  const msg = (data?.error || data?.message || `HTTP ${r.status}`) as string
  const err = new Error(msg) as WmsClientError
  err.status = r.status
  if (typeof data?.code === "string") err.code = data.code
  if (data?.details !== undefined) err.details = data.details
  throw err
}

export function getWmsClientErrorMeta(e: unknown): { code?: string; status?: number } {
  if (!e || typeof e !== "object") return {}
  const x = e as WmsClientError
  const code = typeof x.code === "string" ? x.code : undefined
  const status = typeof x.status === "number" ? x.status : undefined
  return { code, status }
}

/** Поле `details` из JSON-ответа WMS API (например, предложение ячейки при приёмке). */
export function getWmsClientErrorDetails(e: unknown): unknown {
  if (!e || typeof e !== "object") return undefined
  const x = e as WmsClientError
  return x.details
}

export { receivingScanMatchesGroup } from "@/lib/receiving-product-groups"

export type WmsCursorResponse<T, K extends string> = {
  nextCursor?: string
  total?: number
  limit?: number
  offset?: number
} & Record<K, T[]>

const INTERFACE_SITE_CODE_KEY = "wms.siteCode"
const SHARED_SITE_CODE_KEY = "scadatable_wms_site_code_v1"

export function getSiteCode(): string {
  if (typeof window === "undefined") return "skeet"
  const stored = (
    localStorage.getItem(SHARED_SITE_CODE_KEY) ||
    localStorage.getItem(INTERFACE_SITE_CODE_KEY) ||
    "skeet"
  ).trim()
  const normalized = !stored || stored.toLowerCase() === "default" ? "skeet" : stored
  if (stored !== normalized) {
    localStorage.setItem(INTERFACE_SITE_CODE_KEY, normalized)
    localStorage.setItem(SHARED_SITE_CODE_KEY, normalized)
  }
  return normalized
}

export function setSiteCode(siteCode: string) {
  if (typeof window === "undefined") return
  const normalized = (siteCode || "skeet").trim() || "skeet"
  const value = normalized.toLowerCase() === "default" ? "skeet" : normalized
  localStorage.setItem(INTERFACE_SITE_CODE_KEY, value)
  localStorage.setItem(SHARED_SITE_CODE_KEY, value)
}

/** Оператор ТСД из синхронизации (`tsd_operator_user_id`); иначе сервер возьмёт пользователя с устройства */
export function getMobileOperatorUserId(): string | undefined {
  if (typeof window === "undefined") return undefined
  const v = localStorage.getItem("tsd_operator_user_id")?.trim()
  return v || undefined
}

/**
 * Регистрация ТСД в `localStorage` (`tsd_device_id`) относится к `/mobile/*` и `/pos-terminal`.
 * На десктопной очереди `/tasks` автоматическая подстановка даёт «чужой» deviceUid и API возвращает
 * 403 «Задача назначена на другое устройство» (wrong_device).
 */
function implicitDeviceUidFromBrowser(optsExplicit?: string | null): string | undefined {
  const ex = optsExplicit?.trim()
  if (ex) return ex
  if (typeof window === "undefined") return undefined
  const path = window.location.pathname
  if (!path.startsWith("/mobile") && !path.startsWith("/pos-terminal")) return undefined
  const id = localStorage.getItem("tsd_device_id")?.trim()
  return id || undefined
}

const TSD_WMS_API_ORIGIN_KEY = "tsd_wms_api_origin"
export const DEFAULT_TSD_WMS_API_ORIGIN = "https://wms.scada25.ru"

function isPrivateOrLocalHost(host: string): boolean {
  const h = host.toLowerCase()
  if (h === "localhost" || h.endsWith(".local")) return true
  if (/^127\.\d+\.\d+\.\d+$/.test(h)) return true
  if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true
  if (/^192\.168\.\d+\.\d+$/.test(h)) return true
  const m = /^172\.(\d+)\.\d+\.\d+$/.exec(h)
  if (m) {
    const second = Number(m[1])
    if (second >= 16 && second <= 31) return true
  }
  return false
}

/** Нормализует ввод с экрана синхронизации (хост или полный URL) в origin без завершающего `/`. */
export function normalizeWmsServerInput(input: string): string {
  let s = (input || "").trim().replace(/\/$/, "")
  if (!s) return ""
  if (!/^https?:\/\//i.test(s)) {
    const hostPart = s.split("/")[0]?.split(":")[0] ?? s
    const scheme = isPrivateOrLocalHost(hostPart) ? "http" : "https"
    s = `${scheme}://${s}`
  }
  return s.replace(/\/$/, "")
}

/** База для `fetch('/api/wms/...')`: пусто = тот же origin (браузер + dev). В APK — сохранённый origin. */
export function getWmsApiOrigin(): string {
  const baked = (process.env.NEXT_PUBLIC_WMS_API_ORIGIN || "").trim().replace(/\/$/, "")
  if (typeof window === "undefined") {
    return baked
  }
  if (baked) return baked
  try {
    const saved = (localStorage.getItem(TSD_WMS_API_ORIGIN_KEY) || "").trim().replace(/\/$/, "")
    if (saved) return saved
    const protocol = window.location.protocol
    if (protocol === "file:" || protocol === "capacitor:") return DEFAULT_TSD_WMS_API_ORIGIN
    return ""
  } catch {
    return DEFAULT_TSD_WMS_API_ORIGIN
  }
}

export function setWmsApiOrigin(input: string) {
  if (typeof window === "undefined") return
  const o = normalizeWmsServerInput(input)
  try {
    if (!o) {
      localStorage.removeItem(TSD_WMS_API_ORIGIN_KEY)
      return
    }
    localStorage.setItem(TSD_WMS_API_ORIGIN_KEY, o)
  } catch {
    /* ignore */
  }
}

function wmsFetchUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url
  const origin = getWmsApiOrigin()
  if (!origin) return url
  return `${origin}${url.startsWith("/") ? url : `/${url}`}`
}

function wmsFetchInit(init?: RequestInit): RequestInit {
  const headers = new Headers(authRequestHeaders(init?.headers))
  const deviceToken = getDeviceToken()
  if (deviceToken) headers.set(DEVICE_TOKEN_HEADER, deviceToken)
  const deviceUid = implicitDeviceUidFromBrowser()
  if (deviceUid) headers.set("x-device-uid", deviceUid)
  return {
    ...init,
    cache: init?.cache ?? "no-store",
    credentials: init?.credentials ?? "same-origin",
    headers,
  }
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(wmsFetchUrl(url), wmsFetchInit())
  const data = (await r.json().catch(() => ({}))) as ApiError
  if (!r.ok) throwHttpError(r, data)
  return data as T
}

async function deleteJson<T>(url: string): Promise<T> {
  const r = await fetch(wmsFetchUrl(url), wmsFetchInit({ method: "DELETE" }))
  const data = (await r.json().catch(() => ({}))) as ApiError
  if (!r.ok) throwHttpError(r, data)
  return data as T
}

export type WmsAuthUser = {
  userId?: string
  login: string
  fio?: string
  displayName?: string
  position?: string | null
  roleCodes?: string[]
  roles?: Array<{ code: string; name?: string }>
}

export type WmsLoginResponse = {
  ok: true
  accessToken: string
  tokenType: "Bearer"
  expiresIn: number
  user: WmsAuthUser
}

export async function loginWmsUser(login: string, password: string): Promise<WmsLoginResponse> {
  const r = await fetch(
    wmsFetchUrl("/api/auth/login"),
    wmsFetchInit({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: login.trim(), password }),
    })
  )
  const data = (await r.json().catch(() => ({}))) as ApiError | WmsLoginResponse
  if (!r.ok) throwHttpError(r, data as ApiError)
  const result = data as WmsLoginResponse
  setAccessToken(result.accessToken)
  return result
}

export async function getCurrentAuthUser(): Promise<{ user: WmsAuthUser }> {
  return getJson("/api/auth/me")
}

export function logoutWmsUser() {
  clearAccessToken()
}

export async function identifyWmsUser(input:
  | { method: "rfid"; rfidUid: string }
  | { method: "pin"; identity: string; pin: string }
): Promise<{ user: WmsAuthUser; method: "rfid" | "pin" }> {
  return postJson("/api/wms/users/identify", {
    siteCode: getSiteCode(),
    ...input,
  })
}

export type WmsTaskRow = {
  cursor?: string
  taskId: string
  taskCode: string
  documentId?: string | null
  taskType: string
  taskStatus: string
  priorityCode: string
  itemCode?: string | null
  itemName?: string | null
  lotCode?: string | null
  sourceWarehouseCode?: string | null
  targetWarehouseCode?: string | null
  sourceWarehouseName?: string | null
  targetWarehouseName?: string | null
  sourceLocationCode?: string | null
  targetLocationCode?: string | null
  plannedQty?: number | null
  confirmedQty?: number | null
  assignedUser?: string | null
  assignedDevice?: string | null
  documentNo?: string | null
  dueAt?: string | null
  claimedAt?: string | null
  startedAt?: string | null
  completedAt?: string | null
  exceptionCode?: string | null
}

export async function listTasks(params?: {
  status?: string
  type?: string
  query?: string
  limit?: number
  cursor?: string
  assignedUserId?: string
  assignedDeviceId?: string
}): Promise<WmsCursorResponse<WmsTaskRow, "tasks">> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (params?.status) qp.set("status", params.status)
  if (params?.type) qp.set("type", params.type)
  if (params?.query) qp.set("query", params.query)
  if (params?.limit) qp.set("limit", String(params.limit))
  if (params?.cursor) qp.set("cursor", params.cursor)
  if (params?.assignedUserId) qp.set("assignedUserId", params.assignedUserId)
  if (params?.assignedDeviceId) qp.set("assignedDeviceId", params.assignedDeviceId)
  return getJson(`/api/wms/tasks?${qp.toString()}`)
}

export type WmsDocumentRow = {
  cursor?: string
  documentId: string
  documentType: string
  documentStatus: string
  documentNo: string | null
  sourceWarehouseCode: string | null
  targetWarehouseCode: string | null
  sourceWarehouseName?: string | null
  targetWarehouseName?: string | null
  sourceLocationCode: string | null
  targetLocationCode: string | null
  lineName?: string | null
  operatorName?: string | null
  externalRef: string | null
  comment: string | null
  priorityCode: string | null
  createdAt: string
  appliedAt?: string | null
  receiptAt?: string | null
  releasedAt: string | null
  payloadJson?: Record<string, unknown> | null
  lineCount: number
  taskCount: number
}

export type WmsDocumentTypeCode =
  | "receiving"
  | "putaway"
  | "picking"
  | "shipping"
  | "transfer"
  | "issue"
  | "return"
  | "revision"
  | "replenishment"
  | "interwarehouse_transfer"
  | "writeoff"

/** Подписи типов документа для интерфейса (в API остаётся англ. код). */
export const WMS_DOCUMENT_TYPE_LABEL_RU: Record<WmsDocumentTypeCode, string> = {
  receiving: "Приёмка",
  putaway: "Размещение",
  picking: "Отбор",
  shipping: "Отгрузка",
  transfer: "Перемещение",
  issue: "Выдача",
  return: "Возврат",
  revision: "Ревизия",
  replenishment: "Пополнение",
  interwarehouse_transfer: "Межскладской перенос",
  writeoff: "Списание",
}

export function wmsDocumentTypeLabelRu(code: string | null | undefined): string {
  const c = (code || "").trim() as WmsDocumentTypeCode
  if (c && c in WMS_DOCUMENT_TYPE_LABEL_RU) return WMS_DOCUMENT_TYPE_LABEL_RU[c]
  if (c === "production_consumption") return "Списание с линии"
  return code || "—"
}

export type CreateWmsDocumentInput = {
  documentType: WmsDocumentTypeCode
  sourceWarehouseCode?: string
  targetWarehouseCode?: string
  sourceLocationCode?: string
  targetLocationCode?: string
  priorityCode?: "low" | "normal" | "high" | "urgent"
  documentNo?: string
  externalRef?: string
  comment?: string
  lines: Array<{
    itemCode: string
    qty: number
    sourceLocationCode?: string
    targetLocationCode?: string
    lotCode?: string
    comment?: string
    taskPayload?: Record<string, unknown>
  }>
}

export async function listDocuments(params?: {
  documentType?: string
  status?: string
  cursor?: string
  limit?: number
}): Promise<WmsCursorResponse<WmsDocumentRow, "documents">> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (params?.documentType) qp.set("documentType", params.documentType)
  if (params?.status) qp.set("status", params.status)
  if (params?.cursor) qp.set("cursor", params.cursor)
  if (params?.limit) qp.set("limit", String(params.limit))
  return getJson(`/api/wms/documents?${qp.toString()}`)
}

export async function createWmsDocument(input: CreateWmsDocumentInput): Promise<{
  documentId: string
  lineCount: number
  taskCount: number
  createdLines: Array<{ documentLineId: string; taskId: string }>
}> {
  return postJson("/api/wms/documents", {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    ...input,
  })
}

export async function deleteReceivingScanEvent(id: string): Promise<{ ok: true; deletedId: string }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  return deleteJson(`/api/wms/receiving/scan-events/${encodeURIComponent(id)}?${qp.toString()}`)
}

export async function updateReceivingScanEventQty(
  id: string,
  qty: number
): Promise<{ ok: true; scanEventId: string; qty: number }> {
  return patchJson(`/api/wms/receiving/scan-events/${encodeURIComponent(id)}`, {
    siteCode: getSiteCode(),
    qty,
  })
}

export type ReceivingFinalizeResult = {
  ok?: boolean
  documentId?: string
  locationCode?: string
  alreadyPosted?: boolean
  movementsCreated?: number
  lines?: Array<{ itemCode?: string; qty?: number; emissionDay?: string }>
  postedAtIso?: string
  /** Предупреждение оператору: например, ячейка из настроек не найдена и взята другая. */
  postingNote?: string | null
  error?: string
}

/** Проведение закрытой сессии приёмки на остаток (группировка по эмиссии). */
export async function postReceivingFinalize(input: {
  documentId: string
  deviceUid?: string
  targetLocationCode?: string
  productGroup?: string
  confirmExpired?: boolean
  lineTargets?: Array<{
    itemCode: string
    locationCode: string
    qty?: number
    lpnCode?: string
    lpnKind?: "pallet" | "box" | ""
  }>
}): Promise<ReceivingFinalizeResult> {
  return postJson("/api/wms/receiving/finalize", {
    siteCode: getSiteCode(),
    documentId: input.documentId.trim().toUpperCase(),
    deviceUid: (input.deviceUid?.trim() || "web-operator").replace(/^веб-интерфейс$/i, "web-operator"),
    targetLocationCode: input.targetLocationCode?.trim() || undefined,
    productGroup: input.productGroup?.trim() || undefined,
    confirmExpired: input.confirmExpired === true,
    lineTargets: input.lineTargets,
  })
}

export type ReceivingSiteRulesDto = {
  autoPostStock: boolean
  allowOperatorOverride: boolean
  defaultTargetLocationCode: string
  expiryMode: "block" | "confirm" | "allow"
  defaultAllowedStatuses: string[]
  groupPolicies: Array<{ match: string[]; allowedStatuses: string[]; expiryMode?: "block" | "confirm" | "allow" }>
}

export async function getReceivingSiteRules(): Promise<{ ok: true; rules: ReceivingSiteRulesDto }> {
  const qp = new URLSearchParams({ siteCode: getSiteCode() })
  return getJson(`/api/wms/settings/receiving?${qp.toString()}`)
}

export async function saveReceivingSiteRules(
  rules: ReceivingSiteRulesDto
): Promise<{ ok: true; rules: ReceivingSiteRulesDto }> {
  return putJson("/api/wms/settings/receiving", { siteCode: getSiteCode(), rules })
}

export type ReceivingLineSplitDto = {
  locationCode: string
  qty: number
  lpnCode: string
  lpnKind: "" | "pallet" | "box"
}

export type ReceivingInboundLineDto = {
  itemCode: string
  itemName: string
  expectedQty: number
  lotCode: string
  targetLocationCode: string
  splits?: ReceivingLineSplitDto[]
}

export type ReceivingInboundOrderDto = {
  documentId: string
  supplier: string
  expectedBatch: string
  comment: string
  lines: ReceivingInboundLineDto[]
  updatedAt: string | null
}

export async function getReceivingInbound(
  documentId: string
): Promise<{ ok: true; inbound: ReceivingInboundOrderDto | null }> {
  const qp = new URLSearchParams({
    siteCode: getSiteCode(),
    documentId: documentId.trim().toUpperCase(),
  })
  return getJson(`/api/wms/receiving/inbound?${qp.toString()}`)
}

export async function saveReceivingInbound(input: {
  documentId: string
  supplier?: string
  expectedBatch?: string
  comment?: string
  lines?: ReceivingInboundLineDto[]
}): Promise<{ ok: true; inbound: ReceivingInboundOrderDto }> {
  return putJson("/api/wms/receiving/inbound", {
    siteCode: getSiteCode(),
    documentId: input.documentId.trim().toUpperCase(),
    supplier: input.supplier,
    expectedBatch: input.expectedBatch,
    comment: input.comment,
    lines: input.lines,
  })
}

export async function resolveMissingNomenclature(input: {
  id?: string
  code?: string
  action: "bind" | "create" | "hold"
  comment?: string | null
  itemCode?: string
  itemName?: string
}): Promise<{ ok: true; action?: string; itemCode?: string; itemName?: string }> {
  if (input.id) {
    return patchJson(`/api/wms/receiving/missing-nomenclature/${encodeURIComponent(input.id)}`, {
      siteCode: getSiteCode(),
      action: input.action,
      comment: input.comment,
      itemCode: input.itemCode,
      itemName: input.itemName,
    })
  }
  return postJson("/api/wms/receiving/missing-nomenclature", {
    siteCode: getSiteCode(),
    code: input.code,
    action: input.action,
    comment: input.comment,
    itemCode: input.itemCode,
    itemName: input.itemName,
  })
}

export async function dismissEmptyReceivingSession(input: {
  documentId: string
  deviceUid?: string
}): Promise<{ ok: true; documentId: string; alreadyDismissed?: boolean; dismissedAtIso?: string | null }> {
  return postJson("/api/wms/receiving/dismiss-session", {
    siteCode: getSiteCode(),
    documentId: input.documentId.trim().toUpperCase(),
    deviceUid: (input.deviceUid?.trim() || "web-operator").replace(/^веб-интерфейс$/i, "web-operator"),
  })
}

export type StockLotAvailabilityRow = {
  lotId: string
  lotCode: string
  emissionDay: string
  emissionAtIso: string | null
  availableQty: number
  inProductionQty: number
  bestBeforeAt?: string | null
  expiryAt?: string | null
}

export type ItemFefoPickRecommendation = {
  itemCode: string
  itemName: string
  rotationPolicy: "fifo" | "fefo" | "manual"
  isPerishable: boolean
  locationCode: string
  locationName: string | null
  warehouseCode: string | null
  zoneCode: string | null
  lotId: string
  lotCode: string
  emissionAtIso: string | null
  bestBeforeAt: string | null
  expiryAt: string | null
  receivedAt: string | null
  availableQty: number
}

export type ItemStockAvailability = {
  itemCode: string
  itemName: string
  locationCode: string
  totalAvailable: number
  totalInProduction: number
  rotationPolicy?: "fifo" | "fefo" | "manual"
  isPerishable?: boolean
  recommendedLotId?: string | null
  lots: StockLotAvailabilityRow[]
}

export async function getItemStockAvailability(input: {
  itemCode: string
  locationCode: string
}): Promise<ItemStockAvailability> {
  const qp = new URLSearchParams({
    siteCode: getSiteCode(),
    itemCode: input.itemCode.trim(),
    locationCode: input.locationCode.trim(),
  })
  return getJson(`/api/wms/stock/availability?${qp.toString()}`)
}

export type ItemStockLocationRow = {
  locationCode: string
  displayName: string | null
  warehouseCode: string | null
  zoneCode: string | null
  zoneName: string | null
  slotProfile: WmsLocationRow["slotProfile"]
  slotTitle: string | null
  availableQty: number
  inProductionQty: number
  reservedQty: number
  lotCount: number
  /** Сколько разных артикулов лежит в этой же ячейке — предупредить, что остаток общий. */
  cellSkuCount: number
}

export type ItemStockLocations = {
  itemCode: string
  itemName: string
  totalAvailable: number
  totalInProduction: number
  locations: ItemStockLocationRow[]
}

/** Ячейки, где лежит конкретная позиция, — источник списка «Откуда» при перемещении. */
export async function listItemStockLocations(input: {
  itemCode: string
}): Promise<ItemStockLocations> {
  const qp = new URLSearchParams({
    siteCode: getSiteCode(),
    itemCode: input.itemCode.trim(),
  })
  return getJson(`/api/wms/stock/item-locations?${qp.toString()}`)
}

export async function getItemFefoPickRecommendation(input: {
  itemCode: string
}): Promise<{ recommendation: ItemFefoPickRecommendation | null }> {
  const qp = new URLSearchParams({
    siteCode: getSiteCode(),
    itemCode: input.itemCode.trim(),
  })
  return getJson(`/api/wms/stock/fefo-pick?${qp.toString()}`)
}

export type PosPickPlanRow = {
  priority: number
  itemCode: string
  itemName: string
  locationCode: string
  locationName: string | null
  warehouseCode: string | null
  zoneCode: string | null
  rack: string
  shelf: string
  address: string
  lotId: string
  lotCode: string
  emissionAtIso: string | null
  bestBeforeAt: string | null
  expiryAt: string | null
  receivedAt: string | null
  availableQty: number
  takeQty: number
  selected: boolean
}

export type PosPickPlanResponse = {
  item: {
    itemCode: string
    itemName: string
    rotationPolicy: "fifo" | "fefo" | "manual"
    isPerishable: boolean
  }
  requestedQty: number
  totalAvailable: number
  enough: boolean
  plan: PosPickPlanRow[]
}

export async function getPosPickPlan(input: {
  itemCode: string
  qty?: number
}): Promise<PosPickPlanResponse> {
  const qp = new URLSearchParams({
    siteCode: getSiteCode(),
    itemCode: input.itemCode.trim(),
    qty: String(input.qty ?? 0),
  })
  return getJson(`/api/wms/stock/pos-pick?${qp.toString()}`)
}

export type PosIssueDocumentResult = {
  documentId: string
  itemCode: string
  itemName: string
  sourceLocationCode: string
  targetLocationCode: string
  lotCode: string
  qty: number
  recipientName: string
  lineName: string
}

export type PosIssueResponse = {
  itemCode: string
  itemName: string
  requestedQty: number
  issuedQty: number
  targetLocationCode: string
  recipientName: string
  lineName: string
  documents: PosIssueDocumentResult[]
  disposition: "applied" | "duplicate" | "conflict" | "failed"
}

export async function postPosIssue(input: {
  itemCode: string
  qty: number
  recipientName: string
  targetLocationCode: string
  lineName?: string
}): Promise<PosIssueResponse> {
  const clean = (value: unknown) => (value == null ? "" : String(value).trim())
  return postJson("/api/wms/stock/pos-issue", {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    deviceUid: implicitDeviceUidFromBrowser() ?? undefined,
    itemCode: clean(input.itemCode),
    qty: input.qty,
    recipientName: clean(input.recipientName),
    targetLocationCode: clean(input.targetLocationCode),
    lineName: clean(input.lineName) || undefined,
  })
}

export type WmsGlobalSearchResult = {
  id: string
  type: "item" | "group" | "location" | "document"
  title: string
  subtitle: string
  href: string
  badge?: string | null
  score: number
}

export async function globalWmsSearch(input: {
  query: string
  limit?: number
}): Promise<{ query: string; results: WmsGlobalSearchResult[] }> {
  const qp = new URLSearchParams({
    siteCode: getSiteCode(),
    query: input.query.trim(),
  })
  if (input.limit) qp.set("limit", String(input.limit))
  return getJson(`/api/wms/global-search?${qp.toString()}`)
}

export type RevisionExpiryCandidateRow = {
  itemCode: string
  itemName: string
  groupName: string
  rotationPolicy: "fifo" | "fefo" | "manual"
  isPerishable: boolean
  warehouseCode: string
  warehouseName: string
  zoneCode: string
  zoneName: string
  locationCode: string
  locationName: string
  lotId: string
  lotCode: string
  emissionAt: string | null
  bestBeforeAt: string | null
  expiryAt: string | null
  receivedAt: string | null
  availableQty: number
  inProductionQty: number
  lastRevisionAt: string | null
  daysLeft: number | null
  revisionPriority: "expired" | "critical" | "warning" | "ok" | "no_date"
  recommendation: string
}

export async function listRevisionExpiryCandidates(params?: {
  horizonDays?: number
  query?: string
}): Promise<{
  generatedAt: string
  horizonDays: number
  rows: RevisionExpiryCandidateRow[]
}> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (params?.horizonDays) qp.set("horizonDays", String(params.horizonDays))
  if (params?.query?.trim()) qp.set("query", params.query.trim())
  return getJson(`/api/wms/revision/expiry-candidates?${qp.toString()}`)
}

export type IssueRecipientOption = {
  id: string
  displayName: string
  subtitle: string | null
}

export async function listIssueRecipients(): Promise<IssueRecipientOption[]> {
  const data = await getJson<{ recipients?: IssueRecipientOption[] }>("/api/wms/issues/recipients")
  return data.recipients ?? []
}

export async function postIssueToProduction(input: {
  itemCode: string
  sourceLocationCode: string
  targetLocationCode: string
  qty: number
  recipientName: string
  lineName?: string
  lotCode?: string
  emissionDay?: string
  emissionAtIso?: string
}): Promise<{ documentId: string; lotCode?: string | null }> {
  return postJson("/api/wms/issues", {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    itemCode: input.itemCode.trim(),
    sourceLocationCode: input.sourceLocationCode.trim(),
    targetLocationCode: input.targetLocationCode.trim(),
    qty: input.qty,
    recipientName: input.recipientName.trim(),
    lineName: input.lineName?.trim() || undefined,
    lotCode: input.lotCode?.trim() || undefined,
    emissionDay: input.emissionDay?.trim() || undefined,
    emissionAtIso: input.emissionAtIso?.trim() || undefined,
  })
}

export async function postStockTransfer(input: {
  itemCode: string
  fromLocationCode: string
  toLocationCode: string
  qty: number
  lotCode?: string
}): Promise<{ documentId?: string; taskId?: string; movementId?: string; [key: string]: unknown }> {
  return postJson("/api/wms/transfers/confirm", {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    itemCode: input.itemCode.trim(),
    fromLocationCode: input.fromLocationCode.trim(),
    toLocationCode: input.toLocationCode.trim(),
    qty: input.qty,
    lotCode: input.lotCode?.trim() || undefined,
  })
}

export async function postRevisionCount(input: {
  locationCode: string
  checkedBy: string
  comment?: string | null
  lines: Array<{ itemCode: string; actualQty: number }>
}): Promise<{ documentId?: string; revisionId?: string; documentType?: string }> {
  return postJson("/api/wms/revisions", {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    locationCode: input.locationCode.trim(),
    checkedBy: input.checkedBy.trim(),
    comment: input.comment?.trim() || null,
    lines: input.lines,
  })
}

export type QuickReceivingMode = "sequential" | "batch"
export type QuickLpnStatus =
  | "CREATED"
  | "WAITING_PRINT"
  | "PRINTING"
  | "PRINTED"
  | "WAITING_VERIFICATION"
  | "VERIFIED"
  | "READY_FOR_PUTAWAY"
  | "STORED"
  | "PRINT_ERROR"
  | "VERIFICATION_ERROR"
  | "BLOCKED"
  | "CANCELLED"

export type QuickLpnRow = {
  lpnId: string
  lpnCode: string
  itemCode: string
  itemName: string
  lotCode: string
  qty: number
  productionDate: string | null
  expiryDate: string | null
  status: QuickLpnStatus
  printedAt: string | null
  verifiedAt: string | null
  reprintCount: number
  lastError: string | null
}

export type QuickReceivingRow = {
  receivingId: string
  number: string
  supplier: string
  documentNumber: string
  status: "open" | "completed" | "cancelled"
  mode: QuickReceivingMode
  createdBy: string
  createdAt: string
  completedAt: string | null
  itemCode: string
  itemName: string
  lotCode: string
  productionDate: string | null
  expiryDate: string | null
  palletCount: number
  qtyPerLpn: number
  totalQty: number
  progress: {
    total: number
    printed: number
    verified: number
    waitingPrint: number
    waitingScan: number
    errors: number
    cancelled: number
  }
  lpns: QuickLpnRow[]
}

export async function listQuickReceivings(): Promise<{ rows: QuickReceivingRow[] }> {
  const qp = new URLSearchParams({ siteCode: getSiteCode() })
  return getJson(`/api/wms/receiving/quick?${qp.toString()}`)
}

export async function getQuickReceiving(id: string): Promise<{ receiving: QuickReceivingRow }> {
  const qp = new URLSearchParams({ siteCode: getSiteCode() })
  return getJson(`/api/wms/receiving/quick/${encodeURIComponent(id)}?${qp.toString()}`)
}

export async function createQuickReceiving(input: {
  itemCode: string
  lotCode: string
  productionDate?: string
  expiryDate?: string
  palletCount: number
  qtyPerLpn: number
  supplier?: string
  documentNumber?: string
  mode?: QuickReceivingMode
}): Promise<{ receiving: QuickReceivingRow }> {
  return postJson("/api/wms/receiving/quick", {
    siteCode: getSiteCode(),
    ...input,
  })
}

export async function actQuickReceiving(
  id: string,
  action: "print" | "reprint" | "print_all" | "cancel" | "complete",
  extra?: { lpnCode?: string; reason?: string; cancelRemaining?: boolean; deviceId?: string }
): Promise<{ receiving: QuickReceivingRow }> {
  return postJson(`/api/wms/receiving/quick/${encodeURIComponent(id)}`, {
    siteCode: getSiteCode(),
    action,
    ...extra,
  })
}

export async function verifyQuickLpn(input: {
  receivingId: string
  scannedCode: string
  deviceId?: string
}): Promise<{ success: true; lpn: string; status: string; next_lpn: string | null; receiving: QuickReceivingRow }> {
  return postJson("/api/wms/receiving/quick/verify", {
    siteCode: getSiteCode(),
    ...input,
  })
}

export async function createQuickReceivingItem(input: {
  name: string
  category?: string
  uom?: string
  manufacturer?: string
  sku?: string
  barcode?: string
  shelfLifeDays?: number
  temp?: boolean
}): Promise<{ item: { itemCode: string; itemName: string; shelfLifeDays: number | null; requiresClassification: boolean } }> {
  return postJson("/api/wms/receiving/quick/item", {
    siteCode: getSiteCode(),
    ...input,
  })
}

/** Прямая приёмка на ячейку (остаток + документ приёмки), см. POST `/api/wms/receivings`. */
export async function postReceivingLine(input: {
  itemCode: string
  targetLocationCode: string
  qty: number
  batchLabel?: string | null
  externalRef1c?: string | null
  receiptAt?: string | null
  lotExpiryAt?: string | null
}): Promise<{
  documentId: string
  documentType: string
  stock: unknown
  disposition: string
}> {
  return postJson("/api/wms/receivings", {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    itemCode: input.itemCode.trim(),
    targetLocationCode: input.targetLocationCode.trim(),
    qty: input.qty,
    batchLabel: input.batchLabel?.trim() ? input.batchLabel.trim() : null,
    externalRef1c: input.externalRef1c?.trim() ? input.externalRef1c.trim() : null,
    receiptAt: input.receiptAt ?? null,
    lotExpiryAt: input.lotExpiryAt ?? null,
  })
}

export type ManualReceivingDocumentLineInput = {
  itemCode: string
  qty: number
  batchLabel?: string | null
  emissionAt?: string | null
  lotExpiryAt?: string | null
  markingCode?: string | null
  comment?: string | null
}

export async function postManualReceivingDocument(input: {
  targetLocationCode: string
  documentNo?: string | null
  comment?: string | null
  groupCode?: string | null
  groupName?: string | null
  receiptAt?: string | null
  lines: ManualReceivingDocumentLineInput[]
}): Promise<{
  documentId: string
  documentType: string
  lineCount: number
  totalQty: number
  stock: unknown
  disposition: string
}> {
  return postJson("/api/wms/receivings/manual-document", {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    deviceUid: implicitDeviceUidFromBrowser() ?? undefined,
    targetLocationCode: input.targetLocationCode.trim(),
    documentNo: input.documentNo?.trim() ? input.documentNo.trim() : null,
    comment: input.comment?.trim() ? input.comment.trim() : null,
    groupCode: input.groupCode?.trim() ? input.groupCode.trim() : null,
    groupName: input.groupName?.trim() ? input.groupName.trim() : null,
    receiptAt: input.receiptAt ?? null,
    lines: input.lines.map((line) => ({
      itemCode: line.itemCode.trim(),
      qty: line.qty,
      batchLabel: line.batchLabel?.trim() ? line.batchLabel.trim() : null,
      emissionAt: line.emissionAt ?? null,
      lotExpiryAt: line.lotExpiryAt ?? null,
      markingCode: line.markingCode?.trim() ? line.markingCode.trim() : null,
      comment: line.comment?.trim() ? line.comment.trim() : null,
    })),
  })
}

export type ResolvedReceivingItemResponse = {
    itemId: string
    itemCode: string
    name: string
    gtin: string
    created: boolean
    packageRole: "unit" | "block"
    productGroup: string | null
    productGroupLabel: string | null
    generalPackageType: string | null
    generalPackageTypeLabel: string | null
    itemClassCode?: string | null
    itemClassLabel?: string | null
    imageUrl?: string | null
}

export type ResolveReceivingScanResponse = {
  scannedCode: string
  normalizedCode: string
  primaryItem: ResolvedReceivingItemResponse
  nestedItem: ResolvedReceivingItemResponse | null
  specLinked: boolean
  specQtyPer: number | null
  crptStatus: string | null
  warnings: string[]
  expiry: {
    emissionAt: string | null
    expiresAt: string | null
    shelfLifeDays: number
    daysRemaining: number | null
    state: "ok" | "warning" | "expired"
    message: string
  }
}

export async function resolveReceivingMarkingCode(code: string): Promise<ResolveReceivingScanResponse> {
  return postJson("/api/wms/receiving/resolve-scan", {
    siteCode: getSiteCode(),
    deviceUid: implicitDeviceUidFromBrowser() ?? undefined,
    code: code.trim(),
  })
}

export async function syncReceivingSession(input: {
  documentId: string
  lines: Array<{ code: string; qty: number; scanEventId?: string | null }>
}): Promise<unknown> {
  return postJson("/api/wms/receiving/sync-session", {
    siteCode: getSiteCode(),
    deviceUid: implicitDeviceUidFromBrowser() ?? undefined,
    documentId: input.documentId.trim(),
    lines: input.lines,
  })
}

export async function updateReceivingSessionStatus(input: {
  documentId: string
  status: "active" | "paused" | "closed"
  lineCount?: number | null
  deviceUid?: string | null
}): Promise<unknown> {
  return postJson("/api/wms/receiving/session-status", {
    siteCode: getSiteCode(),
    documentId: input.documentId.trim(),
    status: input.status,
    lineCount: input.lineCount ?? null,
    deviceUid: input.deviceUid ?? null,
  })
}

export type InternalMarkingCode = {
  codeId: string
  itemCode: string
  itemName: string
  gtin: string
  serial: string
  cryptoTail: string
  raw: string
  display: string
  datamatrixUrl: string
  statusId: number
}

export type InternalMarkingResolveResult = {
  found: boolean
  source: "internal_wms"
  codeId?: string
  itemCode?: string
  itemName?: string
  gtin?: string
  serial?: string
  cryptoTail?: string | null
  statusId?: number
  statusName?: string
  siteCode?: string
  locationCode?: string | null
  linkedAt?: string | null
}

export async function generateInternalMarkingCodes(input: {
  itemCode: string
  qty?: number
  markPrinted?: boolean
}): Promise<{ codes: InternalMarkingCode[] }> {
  return postJson("/api/catalog/internal-marking/generate", {
    siteCode: getSiteCode(),
    itemCode: input.itemCode.trim(),
    qty: input.qty ?? 1,
    markPrinted: input.markPrinted ?? true,
  })
}

export async function resolveInternalMarkingCode(code: string): Promise<InternalMarkingResolveResult> {
  return postJson("/api/catalog/internal-marking/resolve", {
    siteCode: getSiteCode(),
    code: String(code ?? "").trim(),
  })
}

export async function saveStandardizationAlias(input: {
  itemCode: string
  supplierCode?: string | null
  supplierName?: string | null
  supplierArticle?: string | null
  supplierItemName?: string | null
  gtin?: string | null
  sourceCode?: string | null
  codeSource?: "crpt" | "barcode" | "none" | "manual"
  linkBarcode?: boolean
  note?: string | null
}): Promise<{
  ok: true
  itemCode: string
  itemName: string
  canonicalProductId: string
  supplierId: string
  supplierItemAliasId: string | null
  aliasId: string
}> {
  return postJson("/api/wms/standardization/aliases", {
    siteCode: getSiteCode(),
    itemCode: input.itemCode.trim(),
    supplierCode: input.supplierCode?.trim() || null,
    supplierName: input.supplierName?.trim() || null,
    supplierArticle: input.supplierArticle?.trim() || null,
    supplierItemName: input.supplierItemName?.trim() || null,
    gtin: input.gtin?.trim() || null,
    sourceCode: input.sourceCode?.trim() || null,
    codeSource: input.codeSource ?? "manual",
    linkBarcode: input.linkBarcode === true,
    note: input.note?.trim() || null,
  })
}

export type ItemAliasSearchHit = {
  itemCode: string
  itemName: string
  aliasName: string
  aliasSku: string | null
  supplierCode: string | null
  supplierName: string | null
}

/** Поиск эталонной номенклатуры по алиасу контрагента («рукав салатовый» от ИП Сосун). */
export async function searchItemAliases(params: {
  query: string
  supplierCode?: string
  supplierName?: string
}): Promise<{ hits: ItemAliasSearchHit[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  qp.set("query", params.query.trim())
  if (params.supplierCode?.trim()) qp.set("supplierCode", params.supplierCode.trim())
  if (params.supplierName?.trim()) qp.set("supplierName", params.supplierName.trim())
  return getJson(`/api/wms/item-aliases/search?${qp.toString()}`)
}

export type WmsDocumentDetailLine = {
  documentLineId: string
  lineNo: number
  itemCode: string
  itemName: string
  requestedQty: number
  confirmedQty: number
  sourceLocationCode: string | null
  targetLocationCode: string | null
  requestedUomCode: string | null
  loadUnitId: string | null
  loadUnitCode: string | null
  loadUnitType: string | null
  lotCode: string | null
  batchLabel: string | null
  manufacturedAt: string | null
  taskPayload?: unknown
  comment: string | null
}

export type WmsDocumentDetailTask = {
  taskId: string
  taskCode: string
  taskType: string
  taskStatus: string
  priorityCode: string
  plannedQty: number
  confirmedQty: number
  assignedUser: string | null
  assignedDevice: string | null
  dueAt: string | null
  claimedAt: string | null
  startedAt: string | null
  completedAt: string | null
  exceptionCode: string | null
}

export type WmsDocumentDetailLoadUnit = {
  loadUnitId: string
  loadUnitCode: string
  loadUnitType: string | null
  statusCode: string | null
  label: string | null
  mixedItemsAllowed: boolean | null
  lineCount: number
  totalBaseQty: number
}

export type WmsDocumentDetailHeader = {
  documentId: string
  documentType: string
  documentStatus: string
  documentNo: string | null
  externalRef: string | null
  comment: string | null
  priorityCode: string | null
  createdAt: string
  appliedAt: string | null
  receiptAt: string | null
  releasedAt: string | null
  payloadJson?: Record<string, unknown> | null
  sourceWarehouseCode: string | null
  targetWarehouseCode: string | null
  sourceLocationCode: string | null
  targetLocationCode: string | null
}

export type WmsDocumentDetailResponse = {
  document: WmsDocumentDetailHeader
  lines: WmsDocumentDetailLine[]
  loadUnits: WmsDocumentDetailLoadUnit[]
  tasks: WmsDocumentDetailTask[]
}

/** На `/mobile` передайте `deviceUid` или положите `tsd_device_id` в localStorage. Для доступа к документу с ТСД укажите `taskId` задания по этому документу. */
export async function getWmsDocumentDetail(
  documentId: string,
  opts?: { taskId?: string | null; deviceUid?: string; operatorUserId?: string | null }
): Promise<WmsDocumentDetailResponse> {
  const normalizedDocumentId = normalizeDocumentIdForPath(documentId)
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  const du = implicitDeviceUidFromBrowser(opts?.deviceUid)
  if (du?.trim()) qp.set("deviceUid", du.trim())
  const oid = opts?.operatorUserId ?? getMobileOperatorUserId()
  if (oid?.trim()) qp.set("operatorUserId", oid.trim())
  const tid = opts?.taskId?.trim()
  if (tid) qp.set("taskId", tid)
  return getJson(`/api/wms/documents/${encodeURIComponent(normalizedDocumentId)}?${qp.toString()}`)
}

function normalizeDocumentIdForPath(raw: string): string {
  let value = (raw || "").trim()
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(value)
      if (decoded === value) break
      value = decoded
    } catch {
      break
    }
  }
  return value
}

export type WmsItemListRow = {
  cursor?: string
  itemCode: string
  shortName?: string | null
  isActive?: boolean
  itemTypeCode?: string | null
  sku: string | null
  name: string
  /** Код профиля упаковки (`wms_items.packaging_profile`). */
  packagingProfile?: string | null
  /** Расширенные атрибуты; внутри может быть `nomenclature.type` и др. */
  itemAttrs?: Record<string, unknown> | null
  nomenclature?: string | null
  productGroup?: string | null
  itemGroupCode?: string | null
  itemClassCode?: string | null
  materialType?: string | null
  itemSubgroup?: string | null
  uomCode?: string | null
  isMarked?: boolean
  isPerishable?: boolean
  rotationPolicy?: "fifo" | "fefo" | "manual" | null
  shelfLifeDays?: number | null
  expiryWarningDays?: number | null
  hasActiveSpec?: boolean
  /** Мин. дата поступления по партиям с ненулевым available на складе. */
  stockEarliestReceivedAt?: string | null
  /** Мин. дата изготовления (wms_lots) по тем же партиям. */
  lotManufacturedAtMin?: string | null
  /** Ближайший срок из expiry / best_before по остаткам. */
  nearestExpiryAt?: string | null
  anyLotBlocked?: boolean | null
  lotQaStatuses?: string | null
  /** Маркировка: мин. дата эмиссии по привязанным кодам. */
  markingEmittedAt?: string | null
  /** Маркировка: последний по времени статус ref_status.name. */
  markingStatusLabel?: string | null
  /** Основной контрагент из активного алиаса (приёмка без ЧЗ / закупка). */
  primarySupplierName?: string | null
  primarySupplierCode?: string | null
  availableQty: number
  reservedQty: number
  inProductionQty?: number
  inTransitQty?: number
  quarantineQty?: number
  rejectedQty?: number
}

export type WmsProductGroupSummary = {
  productGroup: string
  itemCount: number
  withActiveSpecCount: number
  /** Текст из справочника wms_item_groups.description, если группа сопоставлена с product_group. */
  groupDescription?: string | null
}

export async function listMaterialsWarehouse(params?: {
  query?: string
  productGroups?: string[]
  bareProductGroup?: boolean
  itemTypeCode?: string
}): Promise<{
  rows: import("@/lib/wms/materials-warehouse").MaterialsWarehouseRow[]
  summary: { itemCount: number; issueCount: number; quarantineCount: number; fefoCount: number }
}> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (params?.query?.trim()) qp.set("query", params.query.trim())
  if (params?.itemTypeCode?.trim()) qp.set("itemTypeCode", params.itemTypeCode.trim())
  if (params?.bareProductGroup) qp.set("bareProductGroup", "1")
  for (const g of params?.productGroups ?? []) {
    if (g.trim()) qp.append("productGroup", g.trim())
  }
  return getJson(`/api/wms/warehouse/materials?${qp.toString()}`)
}

export type WarehouseOpsInbox = import("@/lib/wms/warehouse-ops-inbox").WarehouseOpsInbox

export async function getWarehouseOpsInbox(): Promise<{ inbox: WarehouseOpsInbox }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  return getJson(`/api/wms/warehouse/ops?${qp.toString()}`)
}

export async function postWarehouseOpsAction(input: {
  action: "replenish" | "milk-run" | "tugger" | "wave" | "fefo-exception"
  itemCodes?: string[]
  itemCode?: string
  lotCode?: string
  reason?: string
  taskIds?: string[]
  comment?: string
}): Promise<{ ok?: boolean; created?: { documentId: string; taskCount: number }; waveId?: string; taskCount?: number }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  return postJson(`/api/wms/warehouse/ops?${qp.toString()}`, input)
}

export async function listProductGroups(options?: {
  /** Фильтр по wms_items.item_type_code (через запятую). */
  itemTypeCode?: string
}): Promise<{ groups: WmsProductGroupSummary[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (options?.itemTypeCode?.trim()) qp.set("itemTypeCode", options.itemTypeCode.trim())
  return getJson(`/api/wms/item-groups?${qp.toString()}`)
}

export async function listItems(params?: {
  query?: string
  cursor?: string
  limit?: number
  productGroup?: string
  /** Несколько групп (на сервере объединяются через ИЛИ). */
  productGroups?: string[]
  /** Только позиции без поля product_group (совпадает с группой «—» в списке групп). */
  bareProductGroup?: boolean
  materialType?: string
  itemGroupCode?: string
  classCode?: string
  itemTypeCode?: string
  /** @deprecated используйте itemTypeCode */
  itemType?: string
  /** Отгрузка ГП: без этикеток/стикеров, при необходимости завести карточку напитка. */
  role?: "fg" | "finished_goods"
  isActive?: boolean
  offset?: number
}): Promise<WmsCursorResponse<WmsItemListRow, "items">> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (params?.query) qp.set("query", params.query)
  if (params?.cursor) qp.set("cursor", params.cursor)
  if (params?.limit != null) qp.set("limit", String(params.limit))
  if (params?.offset != null) qp.set("offset", String(params.offset))
  if (params?.productGroups != null && params.productGroups.length > 0) {
    for (const g of params.productGroups) {
      const t = g.trim()
      if (t) qp.append("productGroup", t)
    }
  } else if (params?.productGroup != null && params.productGroup !== "") {
    qp.append("productGroup", params.productGroup)
  }
  if (params?.bareProductGroup) qp.set("bareProductGroup", "1")
  if (params?.materialType) qp.set("materialType", params.materialType)
  if (params?.itemGroupCode) qp.set("groupCode", params.itemGroupCode)
  if (params?.classCode) qp.set("classCode", params.classCode)
  const itemTypeCode = params?.itemTypeCode ?? params?.itemType
  if (itemTypeCode) qp.set("itemTypeCode", itemTypeCode)
  if (params?.role) qp.set("role", params.role)
  if (params?.isActive === true) qp.set("isActive", "1")
  if (params?.isActive === false) qp.set("isActive", "0")
  return getJson(`/api/wms/items?${qp.toString()}`)
}

export type FgPickPlanPreview = {
  enough: boolean
  totalAvailable: number
  plannedQty?: number
  reason: string | null
  dateFilter?: string | null
  availableDates?: string[]
  suggested: {
    planRowId: string
    zone: string
    locationCode: string
    rowLabel: string
  } | null
  pallets: Array<{
    pickOrder: number
    lpn: string
    stackLabel: string
    locationCode?: string
    planRowId?: string
    zone?: string
    bottles?: number
    itemName?: string
  }>
}

export async function fetchFgPickPlan(params: {
  itemCode: string
  qty?: number
  manufacturedAt?: string
}): Promise<{ plan: FgPickPlanPreview | null }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  qp.set("itemCode", params.itemCode)
  if (params.qty != null) qp.set("qty", String(params.qty))
  if (params.manufacturedAt) qp.set("manufacturedAt", params.manufacturedAt)
  return getJson(`/api/wms/warehouse/finished-goods/pick-plan?${qp.toString()}`)
}

export type FgPlanInventorySlot = {
  address: string
  status: "free" | "occupied" | "reserved" | "blocked"
  palletId?: string
  nomenclature?: string
  gtin?: string
  batch?: string
  productionDate?: string
  quantity?: number
  unit?: string
  stockPostedQty?: number
  stockPostedAt?: string
  stockPostedItemCode?: string
}

export type FgPlanStockPreview = {
  occupiedSlots: number
  pendingSlots: number
  postedSlots: number
  pendingPallets: number
  pendingBottles: number
}

export type FgPlanStockPostResult = {
  posted: number
  skipped: number
  failed: number
  bottles: number
  pallets: number
  lines: Array<{
    address: string
    planRowId: string
    locationCode: string
    itemCode: string
    itemName: string
    gtin: string
    qty: number
    lotCode: string
    skipped: boolean
    reason?: string
  }>
  preview: FgPlanStockPreview
}

export async function fetchFgPlanInventory(): Promise<{
  updatedAt?: string
  inventory: Record<string, FgPlanInventorySlot>
  stock?: FgPlanStockPreview
}> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  return getJson(`/api/wms/warehouse/finished-goods/plan-inventory?${qp.toString()}`)
}

export async function postFgPlanInventoryToWarehouse(input?: {
  addresses?: string[]
}): Promise<FgPlanStockPostResult> {
  return postJson("/api/wms/warehouse/finished-goods/plan-inventory", {
    siteCode: getSiteCode(),
    action: "post-to-stock",
    addresses: input?.addresses,
  })
}

export type ImportWmsItemRow = {
  itemCode: string
  name: string
  sku?: string
  primaryBarcode?: string
  uomCode?: string
  /** Колонка списка «Тип» (`wms_items.item_type_code`). */
  itemTypeCode?: string
  materialType?: string
  productGroup?: string
  itemGroupCode?: string
  itemClassCode?: string
  itemSubgroup?: string
  packagingFormat?: string
  /** Код из справочника `wms_packaging_profile_defs` (колонка `wms_items.packaging_profile`) */
  packagingProfile?: string
  itemAttrs?: Record<string, unknown>
  nomenclature?: string
  isMarked?: boolean
  isPerishable?: boolean
  rotationPolicy?: string
  shelfLifeDays?: number
  expiryWarningDays?: number
}

export type ImportWmsItemUomRow = {
  itemCode: string
  uomCode: string
  uomName?: string
  qtyInBase: number
  levelNo?: number
  isBase?: boolean
  isShipping?: boolean
  maxPerLoadUnit?: number
  weightKg?: number
  volumeL?: number
}

export async function importWmsItemUoms(rows: ImportWmsItemUomRow[]): Promise<{
  ok: true
  kind: string
  inserted: number
  updated: number
}> {
  return postJson("/api/wms/import", {
    siteCode: getSiteCode(),
    kind: "item_uoms",
    rows,
  })
}

export async function importWmsItems(rows: ImportWmsItemRow[]): Promise<{
  ok: true
  kind: string
  inserted: number
  updated: number
}> {
  return postJson("/api/wms/import", {
    siteCode: getSiteCode(),
    kind: "items",
    rows,
  })
}

export type WmsWarehouseOccupancyZoneRow = {
  warehouseCode: string
  zoneCode: string
  locationCount: number
  nonEmptyCount: number
  emptyCount: number
  totalAvailableQty: number
  declaredCapacityQtySum: number
  fillRatioDeclared: number | null
}

export type WmsWarehouseOccupancyResponse = {
  siteCode: string
  zones: WmsWarehouseOccupancyZoneRow[]
  totals: {
    locationCount: number
    nonEmptyCount: number
    emptyCount: number
    totalAvailableQty: number
    declaredCapacityQtySum: number
    fillRatioDeclared: number | null
  }
}

export async function getWarehouseOccupancy(): Promise<WmsWarehouseOccupancyResponse> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  return getJson(`/api/wms/warehouse/occupancy?${qp.toString()}`)
}

export type WmsLocationRow = {
  locationId?: string
  locationCode: string
  displayName: string
  warehouseCode: string
  zoneId?: string
  zoneCode: string
  zoneName?: string
  locationStatus: string
  accuracyStatus: string
  availableQty: number
  reservedQty: number
  inProductionQty: number
  inTransitQty: number
  skuCount: number
  codeCount?: number
  occupiedItemCode?: string | null
  occupiedItemName?: string | null
  nearestExpiryAt?: string | null
  isWaitingPoint?: boolean
  isEmpty?: boolean
  waitingHandoff?: WaitingCellHandoff | null
  isHandedToProduction?: boolean
  slotProfile?: StorageSlotProfile | null
  slotTitle?: string
}

export async function listLocations(params?: {
  warehouseCode?: string
  zoneCode?: string
  query?: string
  limit?: number
  offset?: number
  workshopOnly?: boolean
  occupiedOnly?: boolean
  emptyOnly?: boolean
  lite?: boolean
}): Promise<{ locations: WmsLocationRow[]; total?: number }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (params?.warehouseCode) qp.set("warehouseCode", params.warehouseCode)
  if (params?.zoneCode) qp.set("zoneCode", params.zoneCode)
  if (params?.query) qp.set("query", params.query)
  if (params?.limit != null) qp.set("limit", String(params.limit))
  if (params?.offset != null) qp.set("offset", String(params.offset))
  if (params?.workshopOnly) qp.set("workshopOnly", "1")
  if (params?.occupiedOnly) qp.set("occupiedOnly", "1")
  if (params?.emptyOnly) qp.set("emptyOnly", "1")
  if (params?.lite) qp.set("lite", "1")
  return getJson(`/api/wms/locations?${qp.toString()}`)
}

export async function syncFgPlanLocations(): Promise<{
  ok: true
  catalogRows: number
  created: number
  updated: number
  warehouseCode: string
  zones: string[]
}> {
  return postJson("/api/wms/locations/sync-fg-plan", { siteCode: getSiteCode() })
}

export type WaitingCellHandoff = {
  status: "handed_to_production"
  lineCode: string
  batchLabel: string | null
  itemCode: string | null
  planId?: string | null
  planCode?: string | null
  planProductName?: string | null
  handedAt: string
}

export async function postWaitingCellHandoff(input: {
  locationCode: string
  lineCode: string
  batchLabel?: string | null
  itemCode?: string | null
  planId?: string | null
  planCode?: string | null
  planProductName?: string | null
}): Promise<{ ok: true; locationCode: string; waitingHandoff: WaitingCellHandoff | null }> {
  return postJson("/api/wms/locations/waiting-handoff", {
    siteCode: getSiteCode(),
    locationCode: input.locationCode.trim(),
    lineCode: input.lineCode.trim(),
    batchLabel: input.batchLabel?.trim() ? input.batchLabel.trim() : null,
    itemCode: input.itemCode?.trim() ? input.itemCode.trim() : null,
    planId: input.planId?.trim() ? input.planId.trim() : null,
    planCode: input.planCode?.trim() ? input.planCode.trim() : null,
    planProductName: input.planProductName?.trim() ? input.planProductName.trim() : null,
  })
}

export async function clearWaitingCellHandoff(input: {
  locationCode: string
}): Promise<{ ok: true; locationCode: string; waitingHandoff: null }> {
  const qp = new URLSearchParams({
    siteCode: getSiteCode(),
    locationCode: input.locationCode.trim(),
  })
  return deleteJson(`/api/wms/locations/waiting-handoff?${qp.toString()}`)
}

export async function createWmsLocation(input: {
  warehouseCode: string
  zoneCode: string
  locationCode: string
  displayName?: string
  warehouseName?: string
  zoneName?: string
  locationStatusCode?: string
  accuracyStatusCode?: string
  isPickFace?: boolean
  locationAttrs?: { slotProfile?: StorageSlotProfile }
}): Promise<{ inserted: number; updated: number; kind: string; siteCode: string }> {
  return postJson("/api/wms/import", {
    siteCode: getSiteCode(),
    kind: "locations",
    rows: [input],
  })
}

export type WaitingCellCreatedRow = {
  locationCode: string
  displayName: string
  warehouseCode: string
  zoneCode: string
  isWaitingPoint: boolean
  isEmpty: boolean
}

export async function createWaitingCellsBatch(input: {
  warehouseCode: string
  zoneCode: string
  count: number
  codePrefix?: string
  namePrefix?: string
  startIndex?: number
  namingMode?: "sequential" | "random"
  receivingCategoryCode?: string
}): Promise<{ locations: WaitingCellCreatedRow[] }> {
  return postJson("/api/wms/locations/waiting-batch", {
    siteCode: getSiteCode(),
    warehouseCode: input.warehouseCode.trim(),
    zoneCode: input.zoneCode.trim(),
    count: input.count,
    codePrefix: input.codePrefix?.trim() || undefined,
    namePrefix: input.namePrefix?.trim() || undefined,
    startIndex: input.startIndex,
    namingMode: input.namingMode ?? "sequential",
    receivingCategoryCode: input.receivingCategoryCode?.trim() || undefined,
  })
}

export async function backfillWaitingCellsProfile(input?: {
  warehouseCode?: string
  receivingCategoryCode?: string
}): Promise<{ updated: number; totalWaiting: number }> {
  return patchJson("/api/wms/locations/waiting-batch", {
    siteCode: getSiteCode(),
    warehouseCode: input?.warehouseCode?.trim() || undefined,
    receivingCategoryCode: input?.receivingCategoryCode?.trim() || undefined,
  })
}

export type ZoneDirectoryRow = {
  zoneId: string
  warehouseCode: string
  warehouseName?: string
  zoneCode: string
  zoneName: string
  isActive: boolean
  locationCount: number
}

export async function listDirectoryZones(
  warehouseCode?: string
): Promise<{ zones: ZoneDirectoryRow[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (warehouseCode?.trim()) qp.set("warehouseCode", warehouseCode.trim())
  return getJson(`/api/wms/directories/zones?${qp.toString()}`)
}

export async function createDirectoryZone(input: {
  warehouseCode: string
  zoneCode: string
  name?: string
}): Promise<{ zone: ZoneDirectoryRow }> {
  return postJson("/api/wms/directories/zones", {
    siteCode: getSiteCode(),
    warehouseCode: input.warehouseCode.trim(),
    zoneCode: input.zoneCode.trim(),
    name: input.name?.trim() || undefined,
  })
}

export async function deleteDirectoryZone(input: {
  warehouseCode: string
  zoneCode: string
  zoneId?: string
}): Promise<{ ok: true; zoneId: string; warehouseCode: string; zoneCode: string }> {
  return postJson("/api/wms/directories/zones/delete", {
    siteCode: getSiteCode(),
    ...input,
  })
}

export async function purgeWorkshopLocations(): Promise<{
  deleted: number
  locationCodes: string[]
}> {
  return postJson("/api/wms/locations/workshop-purge", {
    siteCode: getSiteCode(),
    confirm: true,
  })
}

export type WmsLookupItem = {
  itemCode: string
  barcode: string | null
  name: string
  locationCode: string
  availableQty: number
  reservedQty: number
  quarantineQty: number
  rejectedQty: number
  accuracyStatus: string
  locationStatus?: string
}

export async function lookupWms(query: string): Promise<{ items: WmsLookupItem[] }> {
  return postJson("/api/wms/lookup", {
    siteCode: getSiteCode(),
    query,
  })
}

export type WmsLocationStockLotRow = {
  lotId: string
  lotCode: string
  batchLabel: string | null
  qaStatusCode: string | null
  note: string | null
  isBlocked: boolean
  itemCode: string
  itemName: string
  availableQty: number
  reservedQty: number
  inProductionQty?: number
  inTransitQty: number
  quarantineQty: number
  rejectedQty: number
  manufacturedAt: string | null
  bestBeforeAt: string | null
  expiryAt: string | null
  receivedAt: string | null
  shelfLifeDays?: number | null
}

export type WmsPutawayRecommendation = {
  locationCode: string
  score: number
  forbidden: boolean
  reason: string
  details?: string | null
}

export type WmsLocationDetailResponse = {
  location: {
    locationCode: string
    displayName: string | null
    locationStatus: string
    accuracyStatus: string
    warehouseCode: string
    zoneCode: string
    isPickFace: boolean
    isWorkshop?: boolean
    slotProfile?: StorageSlotProfile | null
    slotTitle?: string
  }
  stock: Array<{
    itemCode: string
    barcode: string | null
    name: string
    availableQty: number
    reservedQty: number
    inProductionQty: number
    quarantineQty: number
    rejectedQty: number
    accuracyStatus: string
    nearestExpiryAt?: string | null
    bestBeforeAt?: string | null
    manufacturedAt?: string | null
  }>
  lots?: WmsLocationStockLotRow[]
  history: Array<{
    at: string
    movementType: string
    qty: number
    itemCode: string
    fromLocationCode: string | null
    toLocationCode: string | null
  }>
  markingCodes?: Array<{
    codeId: string
    itemCode: string
    itemName: string
    gtin: string
    serial: string
    locationCode: string
    locationName: string
    warehouseCode: string
    zoneCode: string
    statusId: number
    statusName: string
    linkedAt: string | null
  }>
  markingCodesTotal?: number
}

export async function getWmsLocationDetail(locationCode: string): Promise<WmsLocationDetailResponse> {
  const c = encodeURIComponent(locationCode)
  return getJson(`/api/wms/locations/${c}?siteCode=${encodeURIComponent(getSiteCode())}`)
}

export async function patchWmsLocationDisplayName(
  locationCode: string,
  displayName: string
): Promise<{ ok: true; locationCode: string; displayName: string }> {
  const c = encodeURIComponent(locationCode)
  return patchJson(`/api/wms/locations/${c}?siteCode=${encodeURIComponent(getSiteCode())}`, {
    displayName,
  })
}

export async function patchWmsLocationSlotProfile(
  locationCode: string,
  input: { displayName?: string; slotProfile: StorageSlotProfile }
): Promise<{
  ok: true
  locationCode: string
  displayName: string
  slotProfile: StorageSlotProfile
  slotTitle: string
}> {
  const c = encodeURIComponent(locationCode)
  return patchJson(`/api/wms/locations/${c}?siteCode=${encodeURIComponent(getSiteCode())}`, input)
}

export async function recommendStorageLocations(input: {
  itemCode: string
  qty?: number
  preferReceiving?: boolean
  limit?: number
}): Promise<WmsStorageRecommendResponse> {
  return postJson("/api/wms/storage/recommend", {
    siteCode: getSiteCode(),
    itemCode: input.itemCode.trim(),
    qty: input.qty,
    preferReceiving: input.preferReceiving,
    limit: input.limit,
  })
}

export type WmsStorageRuleCriteria = {
  storageClass?: string | null
  sizeClass?: string | null
  weightClass?: string | null
  handling?: string | null
  storageForms?: string[] | null
  maxDimensionMm?: number | null
  maxWeightG?: number | null
  hazardous?: boolean | null
  fragile?: boolean | null
  liquid?: boolean | null
  requiresTemperatureControl?: boolean | null
  requiresQuarantine?: boolean | null
  velocityClass?: string | null
}

export type WmsStorageRule = {
  ruleId: string
  name: string
  materialType: string | null
  processType: string | null
  stickerShape: string | null
  productGroup: string | null
  brand: string | null
  productType: string | null
  carbonationType: string | null
  volume: string | null
  applicationPlace: string | null
  storageClass: string | null
  allowedZoneCodes: string[] | null
  forbiddenZoneCodes: string[] | null
  enforcePreferredLocation: boolean
  criteria: WmsStorageRuleCriteria
  preferredZoneId: string | null
  preferredZoneCode: string | null
  preferredZoneName: string | null
  preferredLocationId: string | null
  preferredLocationCode: string | null
  priority: number
  isActive: boolean
  note: string | null
  createdAt: string
  updatedAt: string
}

export async function listStorageRules(activeOnly = false): Promise<{ rules: WmsStorageRule[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (activeOnly) qp.set("activeOnly", "1")
  return getJson(`/api/wms/storage/rules?${qp.toString()}`)
}

type StorageRuleWrite = {
  name: string
  materialType?: string | null
  processType?: string | null
  stickerShape?: string | null
  productGroup?: string | null
  brand?: string | null
  volume?: string | null
  applicationPlace?: string | null
  storageClass?: string | null
  allowedZoneCodes?: string[] | null
  forbiddenZoneCodes?: string[] | null
  enforcePreferredLocation?: boolean
  criteria?: WmsStorageRuleCriteria | null
  preferredZoneId?: string | null
  preferredLocationId?: string | null
  priority?: number
  isActive?: boolean
  note?: string | null
}

export async function createStorageRule(input: StorageRuleWrite): Promise<{ rule: WmsStorageRule }> {
  return postJson("/api/wms/storage/rules", { siteCode: getSiteCode(), ...input })
}

export async function updateStorageRule(
  ruleId: string,
  input: Partial<StorageRuleWrite>
): Promise<{ rule: WmsStorageRule }> {
  return patchJson(
    `/api/wms/storage/rules/${encodeURIComponent(ruleId)}?siteCode=${encodeURIComponent(getSiteCode())}`,
    { siteCode: getSiteCode(), ...input }
  )
}

export async function deleteStorageRule(ruleId: string): Promise<{ ok: true }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  return deleteJson(`/api/wms/storage/rules/${encodeURIComponent(ruleId)}?${qp.toString()}`)
}

export async function matchStorageRules(params: {
  itemCode?: string
  locationCode?: string
}): Promise<{
  requirements: WmsStorageRecommendResponse["requirements"] | null
  forItem: WmsStorageRule[]
  forLocation: WmsStorageRule[]
  location: { locationId: string; zoneId: string; locationCode: string } | null
}> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (params.itemCode) qp.set("itemCode", params.itemCode.trim())
  if (params.locationCode) qp.set("locationCode", params.locationCode.trim())
  return getJson(`/api/wms/storage/rules/match?${qp.toString()}`)
}

export async function recommendWmsPutaway(input: {
  itemCode: string
  lotCode?: string | null
  qty?: number
  limit?: number
}): Promise<{
  itemCode: string
  lotCode: string | null
  policy: Record<string, unknown>
  recommendations: WmsPutawayRecommendation[]
}> {
  return postJson("/api/wms/putaway/recommend", {
    siteCode: getSiteCode(),
    itemCode: input.itemCode.trim(),
    lotCode: input.lotCode?.trim() ? input.lotCode.trim() : undefined,
    qty: input.qty,
    limit: input.limit,
  })
}

export async function setWmsLocationBlocked(locationCode: string, blocked: boolean): Promise<unknown> {
  const c = encodeURIComponent(locationCode)
  return postJson(`/api/wms/locations/${c}/block`, {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    blocked,
  })
}

export async function deleteWmsLocation(locationCode: string): Promise<{
  ok: boolean
  locationCode: string
  deleted: number
}> {
  const c = encodeURIComponent(locationCode.trim())
  return postJson(`/api/wms/locations/${c}/delete`, {
    siteCode: getSiteCode(),
  })
}

export type WmsDeviceRow = {
  deviceId: string
  deviceUid: string
  deviceName: string
  platform: string | null
  appVersion: string | null
  deviceInfo?: unknown
  deviceStatus: string
  assignedUserId?: string | null
  assignedUser: string | null
  lastSeenAt: string | null
  openTaskCount?: number | null
  activeTaskCount?: number | null
  exceptionTaskCount?: number | null
  completedTaskCount?: number | null
  liveTaskCount?: number | null
  totalTaskCount?: number | null
  previewTasks?: WmsTaskRow[] | null
}

export async function listDevices(params?: { query?: string; status?: string }): Promise<{ devices: WmsDeviceRow[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (params?.query) qp.set("query", params.query)
  if (params?.status) qp.set("status", params.status)
  return getJson(`/api/wms/devices?${qp.toString()}`)
}

export async function registerWmsDevice(input: {
  deviceUid: string
  deviceName: string
  platform?: string
  appVersion?: string
  deviceInfo?: Record<string, unknown>
}): Promise<{ device: WmsDeviceRow }> {
  return postJson("/api/wms/devices/register", {
    siteCode: getSiteCode(),
    ...input,
  })
}

/* --- Подключение ТСД по коду -------------------------------------------- */

export type DeviceAuthMode = "off" | "soft" | "strict"

export type DeviceAuthSettings = {
  mode: DeviceAuthMode
  defaultTtlMinutes: number
  defaultMaxUses: number
  updatedAt?: string | null
  updatedBy?: string | null
}

export type DeviceEnrollToken = {
  tokenId: string
  codeHint: string
  deviceName: string
  platform: string
  maxUses: number
  usedCount: number
  expiresAt: string
  createdAt: string
  createdBy: string
  createdOrigin: string
  note: string
  revokedAt: string | null
  revokedBy: string | null
  lastUsedAt: string | null
  lastDeviceUid: string | null
  state: "active" | "used" | "expired" | "revoked"
}

export type DeviceTokenInfo = {
  tokenHint: string
  issuedAt: string
  lastUsedAt: string | null
  issuedBy: string
}

export async function loadDeviceEnrollState(options?: { history?: boolean }): Promise<{
  settings: DeviceAuthSettings
  tokens: DeviceEnrollToken[]
  devicesWithToken: Record<string, DeviceTokenInfo>
}> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (options?.history) qp.set("history", "1")
  return getJson(`/api/wms/devices/enroll-tokens?${qp.toString()}`)
}

export async function issueDeviceEnrollToken(input: {
  deviceName?: string
  platform?: string
  ttlMinutes?: number
  maxUses?: number
  note?: string
}): Promise<{ ok: true; code: string; token: DeviceEnrollToken }> {
  return postJson("/api/wms/devices/enroll-tokens", {
    action: "issue",
    siteCode: getSiteCode(),
    ...input,
  })
}

export async function revokeDeviceEnrollToken(tokenId: string): Promise<{ ok: true }> {
  return postJson("/api/wms/devices/enroll-tokens", {
    action: "revoke",
    siteCode: getSiteCode(),
    tokenId,
  })
}

export async function revokeDeviceToken(deviceUid: string): Promise<{ ok: true; revoked: number }> {
  return postJson("/api/wms/devices/enroll-tokens", {
    action: "revoke-device",
    siteCode: getSiteCode(),
    deviceUid,
  })
}

export async function saveDeviceAuthSettings(
  settings: Partial<DeviceAuthSettings>
): Promise<{ ok: true; settings: DeviceAuthSettings }> {
  return postJson("/api/wms/devices/enroll-tokens", {
    action: "save-settings",
    siteCode: getSiteCode(),
    settings,
  })
}

/** Обмен кода подключения на токен устройства. Вызывается с самого ТСД. */
export async function enrollDeviceByCode(input: {
  code: string
  deviceUid?: string
  deviceName?: string
  platform?: string
  appVersion?: string
  deviceInfo?: Record<string, unknown>
}): Promise<{
  ok: true
  device: WmsDeviceRow
  deviceUid: string
  deviceName: string
  deviceToken: string
  siteCode: string
}> {
  const result = await postJson<{
    ok: true
    device: WmsDeviceRow
    deviceUid: string
    deviceName: string
    deviceToken: string
    siteCode: string
  }>("/api/wms/devices/enroll", input)
  setDeviceToken(result.deviceToken)
  if (result.siteCode) setSiteCode(result.siteCode)
  return result
}

export async function deleteWmsDevice(params: { deviceId: string }): Promise<{ ok: true }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  qp.set("deviceId", params.deviceId.trim())
  return deleteJson(`/api/wms/devices?${qp.toString()}`)
}

export async function sendDeviceTestPush(input: {
  deviceUid: string
  message?: string | null
}): Promise<{ ok: true; deviceUid: string; message: string }> {
  return postJson("/api/wms/devices/push-test", {
    siteCode: getSiteCode(),
    deviceUid: input.deviceUid.trim(),
    message: input.message?.trim() || null,
  })
}

export async function assignDeviceUser(input: {
  deviceId: string
  assignedUserId?: string | null
}): Promise<{
  device: {
    deviceId: string
    deviceUid: string
    assignedUserId: string | null
    assignedUser: string | null
  }
}> {
  return postJson("/api/wms/devices/assign-user", {
    siteCode: getSiteCode(),
    deviceId: input.deviceId.trim(),
    assignedUserId: input.assignedUserId?.trim() || null,
  })
}

export type WmsSupportSessionStatus = "pending" | "active" | "declined" | "ended" | "expired"

export type WmsSupportSession = {
  sessionId: string
  deviceUid: string
  deviceId: string
  status: WmsSupportSessionStatus
  requestedBy: string | null
  requestedAt: string
  acceptedAt: string | null
  endedAt: string | null
  expiresAt: string
  currentScreen: string | null
  lastHeartbeatAt: string | null
  screenshotRequestedAt: string | null
  latestScreenshotAt: string | null
  hasScreenshot: boolean
}

export type WmsSupportEvent = {
  eventId: string
  level: string
  eventType: string
  message: string
  details: Record<string, unknown> | null
  createdAt: string
}

export async function getDeviceSupportStatus(params: {
  deviceUid: string
  sessionId?: string
}): Promise<{
  session: WmsSupportSession | null
  events: WmsSupportEvent[]
  screenshotBase64: string | null
}> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  qp.set("deviceUid", params.deviceUid.trim())
  if (params.sessionId?.trim()) qp.set("sessionId", params.sessionId.trim())
  return getJson(`/api/wms/devices/support?${qp.toString()}`)
}

export async function requestDeviceSupport(params: {
  deviceUid: string
  requestedBy?: string | null
}): Promise<{ session: WmsSupportSession; created: boolean }> {
  return postJson("/api/wms/devices/support", {
    siteCode: getSiteCode(),
    deviceUid: params.deviceUid.trim(),
    action: "request",
    requestedBy: params.requestedBy?.trim() || null,
  })
}

export async function endDeviceSupport(params: {
  deviceUid: string
  sessionId: string
  reason?: string | null
}): Promise<{ session: WmsSupportSession }> {
  return postJson("/api/wms/devices/support", {
    siteCode: getSiteCode(),
    deviceUid: params.deviceUid.trim(),
    sessionId: params.sessionId.trim(),
    action: "end",
    reason: params.reason?.trim() || null,
  })
}

export async function requestDeviceSupportScreenshot(params: {
  deviceUid: string
  sessionId: string
}): Promise<{ session: WmsSupportSession }> {
  return postJson("/api/wms/devices/support", {
    siteCode: getSiteCode(),
    deviceUid: params.deviceUid.trim(),
    sessionId: params.sessionId.trim(),
    action: "request_screenshot",
  })
}

export type WmsMobileProfileResponse = {
  siteCode: string
  device: {
    deviceId: string
    deviceUid: string
    deviceName: string
    platform: string | null
    appVersion: string | null
    deviceStatus: string
    lastSeenAt: string | null
    assignedUserId: string | null
  }
  assignedUserId: string | null
  operatorUserId: string | null
  operator: {
    userId: string
    login: string
    displayName: string
    externalCode: string | null
    phone: string | null
    isActive: boolean
    roles: { code: string; name: string }[]
  } | null
  hint: string | null
}

export async function getWmsMobileProfile(params: {
  deviceUid: string
  operatorUserId?: string | null
}): Promise<WmsMobileProfileResponse> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  qp.set("deviceUid", params.deviceUid.trim())
  const oid = params.operatorUserId?.trim()
  if (oid) qp.set("operatorUserId", oid)
  return getJson(`/api/wms/mobile/profile?${qp.toString()}`)
}

export async function listDeviceTasks(params: {
  deviceUid: string
  operatorUserId?: string | null
  status?: string
  type?: string
  query?: string
  limit?: number
  cursor?: string
  /** Веб-карточка терминала: не фильтровать задания по оператору из localStorage ТСД. */
  admin?: boolean
}): Promise<WmsCursorResponse<WmsTaskRow, "tasks">> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  qp.set("deviceUid", params.deviceUid)
  if (params.admin) qp.set("scope", "admin")
  const oid = params.admin ? "" : (params.operatorUserId ?? getMobileOperatorUserId())?.trim()
  if (oid) qp.set("operatorUserId", oid)
  if (params.status) qp.set("status", params.status)
  if (params.type) qp.set("type", params.type)
  if (params.query) qp.set("query", params.query)
  if (params.limit) qp.set("limit", String(params.limit))
  if (params.cursor) qp.set("cursor", params.cursor)
  return getJson(`/api/wms/devices/tasks?${qp.toString()}`)
}

export async function claimWmsTaskByDevice(taskId: string, deviceUid: string) {
  const operatorUserId = getMobileOperatorUserId()
  return postJson<{ taskId: string }>(`/api/wms/devices/tasks/${encodeURIComponent(taskId)}/claim`, {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    deviceUid,
    ...(operatorUserId ? { operatorUserId } : {}),
  })
}

export async function startWmsTaskByDevice(taskId: string, deviceUid: string) {
  const operatorUserId = getMobileOperatorUserId()
  return postJson<{ taskId: string }>(`/api/wms/devices/tasks/${encodeURIComponent(taskId)}/start`, {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    deviceUid,
    ...(operatorUserId ? { operatorUserId } : {}),
  })
}

export type WmsTaskShipScan = {
  code: string
  qty: number
  itemCode?: string | null
  itemName?: string | null
  expiresAt?: string | null
  manufacturedAt?: string | null
  at: string
}

export type WmsTaskShipScanResponse = {
  taskId: string
  deviceUid: string
  plannedQty: number
  scannedQty: number
  remainingQty: number
  scans: WmsTaskShipScan[]
}

export async function scanWmsTaskByDevice(
  taskId: string,
  deviceUid: string,
  input: {
    code: string
    qty?: number
    itemCode?: string | null
    itemName?: string | null
    expiresAt?: string | null
    manufacturedAt?: string | null
  }
) {
  const operatorUserId = getMobileOperatorUserId()
  return postJson<WmsTaskShipScanResponse>(`/api/wms/devices/tasks/${encodeURIComponent(taskId)}/scan`, {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    deviceUid,
    ...(operatorUserId ? { operatorUserId } : {}),
    ...input,
  })
}

export async function completeWmsTaskByDevice(
  taskId: string,
  deviceUid: string,
  input?: { confirmedQty?: number; sourceLocationCode?: string; targetLocationCode?: string; note?: string }
) {
  const operatorUserId = getMobileOperatorUserId()
  return postJson<unknown>(`/api/wms/devices/tasks/${encodeURIComponent(taskId)}/complete`, {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    deviceUid,
    ...(operatorUserId ? { operatorUserId } : {}),
    ...input,
  })
}

export async function reportWmsTaskExceptionByDevice(
  taskId: string,
  deviceUid: string,
  exceptionCode: string,
  exceptionNote?: string
) {
  const operatorUserId = getMobileOperatorUserId()
  return postJson<unknown>(`/api/wms/devices/tasks/${encodeURIComponent(taskId)}/exception`, {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    deviceUid,
    ...(operatorUserId ? { operatorUserId } : {}),
    exceptionCode,
    exceptionNote: exceptionNote || undefined,
  })
}

export type WmsTaskDetailMovementRow = {
  movementId: string
  at: string
  qty: number
  movementType: string
  fromLocationCode: string | null
  toLocationCode: string | null
}

export type WmsTaskDetailTaskRow = {
  taskId: string
  taskCode: string
  taskType: string
  taskStatus: string
  priorityCode: string
  plannedQty: number
  confirmedQty: number
  sequenceNo?: number
  dueAt: string | null
  claimedAt: string | null
  startedAt: string | null
  completedAt: string | null
  releasedAt: string | null
  exceptionCode: string | null
  exceptionNote: string | null
  taskPayload?: unknown
  itemCode: string | null
  itemName: string | null
  lotCode: string | null
  batchLabel: string | null
  documentId: string | null
  documentNo: string | null
  documentType: string | null
  documentStatus: string | null
  sourceWarehouseCode: string | null
  targetWarehouseCode: string | null
  sourceWarehouseName?: string | null
  targetWarehouseName?: string | null
  sourceLocationCode: string | null
  targetLocationCode: string | null
  assignedUser: string | null
  assignedDevice: string | null
}

export type WmsTaskDetailResponse = {
  task: WmsTaskDetailTaskRow
  movements: WmsTaskDetailMovementRow[]
}

export async function getWmsTaskDetail(
  taskId: string,
  opts?: { deviceUid?: string; operatorUserId?: string | null }
): Promise<WmsTaskDetailResponse> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  const du = implicitDeviceUidFromBrowser(opts?.deviceUid)
  if (du?.trim()) qp.set("deviceUid", du.trim())
  const oid = opts?.operatorUserId ?? getMobileOperatorUserId()
  if (oid?.trim()) qp.set("operatorUserId", oid.trim())
  return getJson(`/api/wms/tasks/${encodeURIComponent(taskId)}?${qp.toString()}`)
}

export type WmsUserRow = {
  userId: string
  login: string
  displayName: string
  externalCode: string | null
  phone: string | null
  position?: string | null
  hasPassword?: boolean
  isActive: boolean
  roles: string[]
}

export async function listUsers(params?: { query?: string }): Promise<{ users: WmsUserRow[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (params?.query) qp.set("query", params.query)
  return getJson(`/api/wms/users?${qp.toString()}`)
}

export async function createWmsUser(input: {
  login: string
  displayName: string
  password: string
  position?: string | null
  externalCode?: string | null
  phone?: string | null
  roleCodes?: string[]
}): Promise<{ user: WmsUserRow }> {
  return postJson("/api/wms/users", {
    siteCode: getSiteCode(),
    ...input,
  })
}

export async function updateWmsUser(input: {
  userId: string
  displayName?: string
  password?: string
  position?: string | null
  externalCode?: string | null
  phone?: string | null
  isActive?: boolean
  roleCodes?: string[]
}): Promise<{ user: WmsUserRow }> {
  return patchJson("/api/wms/users", {
    siteCode: getSiteCode(),
    ...input,
  })
}

export async function deleteWmsUser(userId: string): Promise<{ ok: true; deletedUserId: string }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  qp.set("userId", userId)
  return deleteJson(`/api/wms/users?${qp.toString()}`)
}

/** Справочник складов (Настройки → Справочники). */
export type WarehouseDirectoryRow = {
  id: string
  publicId: string
  code: string
  name: string
  shortName: string | null
  description: string | null
  status: string
  warehouseType: string
  isActive: boolean
  meta: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export async function listDirectoryWarehouses(): Promise<{ warehouses: WarehouseDirectoryRow[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  return getJson(`/api/wms/directories/warehouses?${qp.toString()}`)
}

export async function createDirectoryWarehouse(input: {
  code: string
  name: string
  shortName?: string | null
  description?: string | null
  status?: string
  warehouseType?: string
  meta?: Record<string, unknown>
}): Promise<{ warehouse: WarehouseDirectoryRow }> {
  return postJson("/api/wms/directories/warehouses", {
    siteCode: getSiteCode(),
    ...input,
  })
}

export async function patchDirectoryWarehouse(
  id: string,
  patch: Partial<{
    code: string
    name: string
    shortName: string | null
    description: string | null
    status: string
    warehouseType: string
    meta: Record<string, unknown>
  }>
): Promise<{ warehouse: WarehouseDirectoryRow }> {
  return patchJson(`/api/wms/directories/warehouses/${encodeURIComponent(id)}`, {
    siteCode: getSiteCode(),
    ...patch,
  })
}

export async function deleteDirectoryWarehouse(input: {
  id?: string
  code?: string
}): Promise<{ ok: true; id: string; code: string }> {
  return postJson("/api/wms/directories/warehouses/delete", {
    siteCode: getSiteCode(),
    ...input,
  })
}

/** Профили упаковки (`wms_items.packaging_profile`). */
export type PackagingProfileDirectoryRow = {
  code: string
  name: string
  description: string | null
  imageUrl: string | null
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export async function listDirectoryPackagingProfiles(): Promise<{ profiles: PackagingProfileDirectoryRow[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  return getJson(`/api/wms/directories/packaging-profiles?${qp.toString()}`)
}

export async function createDirectoryPackagingProfile(input: {
  code: string
  name: string
  description?: string | null
  sortOrder?: number
}): Promise<{ profile: PackagingProfileDirectoryRow }> {
  return postJson("/api/wms/directories/packaging-profiles", {
    siteCode: getSiteCode(),
    ...input,
  })
}

export async function patchDirectoryPackagingProfile(
  profileCode: string,
  patch: Partial<{ name: string; description: string | null; sortOrder: number; isActive: boolean }>
): Promise<{ profile: PackagingProfileDirectoryRow }> {
  return patchJson(`/api/wms/directories/packaging-profiles/${encodeURIComponent(profileCode)}`, {
    siteCode: getSiteCode(),
    ...patch,
  })
}

/** Типы номенклатуры (`item_attrs_json.nomenclature.type`). */
export type NomenclatureTypeDirectoryRow = {
  code: string
  name: string
  description: string | null
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export async function listDirectoryNomenclatureTypes(): Promise<{ types: NomenclatureTypeDirectoryRow[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  return getJson(`/api/wms/directories/nomenclature-types?${qp.toString()}`)
}

export async function createDirectoryNomenclatureType(input: {
  code: string
  name: string
  description?: string | null
  sortOrder?: number
}): Promise<{ type: NomenclatureTypeDirectoryRow }> {
  return postJson("/api/wms/directories/nomenclature-types", {
    siteCode: getSiteCode(),
    ...input,
  })
}

export async function patchDirectoryNomenclatureType(
  typeCode: string,
  patch: Partial<{ name: string; description: string | null; sortOrder: number; isActive: boolean }>
): Promise<{ type: NomenclatureTypeDirectoryRow }> {
  return patchJson(`/api/wms/directories/nomenclature-types/${encodeURIComponent(typeCode)}`, {
    siteCode: getSiteCode(),
    ...patch,
  })
}

/** Группы товаров (ЧЗ product_group / wms_items.item_group_code). */
export type ItemGroupDirectoryRow = {
  code: string
  name: string
  description: string | null
  imageUrl: string | null
  sortOrder: number
  isActive: boolean
  defaultShelfLifeDays?: number | null
  createdAt: string
  updatedAt: string
  itemCount?: number
  withStockCount?: number
}

export async function listDirectoryItemGroups(options?: {
  withCounts?: boolean
}): Promise<{
  groups: ItemGroupDirectoryRow[]
  tableMissing?: boolean
}> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (options?.withCounts) qp.set("withCounts", "1")
  return getJson(`/api/wms/directories/item-groups?${qp.toString()}`)
}

export type ItemClassDirectoryRow = {
  code: string
  groupCode: string | null
  name: string
  sortOrder: number
  isActive: boolean
  createdAt?: string
  updatedAt?: string
  itemCount?: number
  kind?: "storage" | "legacy" | "custom"
}

export async function listDirectoryItemClasses(options?: {
  seedDefaults?: boolean
}): Promise<{ classes: ItemClassDirectoryRow[]; tableMissing?: boolean }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (options?.seedDefaults) qp.set("seedDefaults", "1")
  return getJson(`/api/wms/directories/item-classes?${qp.toString()}`)
}

export async function createDirectoryItemClass(input: {
  code: string
  name: string
  groupCode?: string | null
  sortOrder?: number
}): Promise<{ class: ItemClassDirectoryRow }> {
  return postJson("/api/wms/directories/item-classes", {
    siteCode: getSiteCode(),
    code: input.code,
    name: input.name,
    groupCode: input.groupCode ?? null,
    sortOrder: input.sortOrder,
  })
}

export async function patchDirectoryItemClass(input: {
  code: string
  name?: string
  groupCode?: string | null
  sortOrder?: number
  isActive?: boolean
}): Promise<{ class: ItemClassDirectoryRow }> {
  return patchJson("/api/wms/directories/item-classes", {
    siteCode: getSiteCode(),
    ...input,
  })
}

export async function deleteDirectoryItemClass(code: string): Promise<{ ok: boolean }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  qp.set("code", code)
  return deleteJson(`/api/wms/directories/item-classes?${qp.toString()}`)
}

export async function seedDirectoryItemClasses(): Promise<{
  ok: boolean
  rematerialized?: number
}> {
  return postJson("/api/wms/directories/item-classes", {
    siteCode: getSiteCode(),
    seedDefaults: true,
  })
}

/** Группы из справочника для операторских экранов (приёмка, перемещение, выдача). */
export async function listOperatorNomenclatureGroups(): Promise<{
  groups: Array<{
    code: string
    name: string
    description: string | null
    imageUrl: string | null
    sortOrder: number
    itemCount: number
    withStockCount: number
    aliasCodes?: string[]
  }>
  tableMissing?: boolean
}> {
  const res = await listDirectoryItemGroups({ withCounts: true })
  const raw = (res.groups ?? [])
    .filter((g) => g.isActive)
    .map((g) => ({
      code: g.code,
      name: g.name,
      description: g.description,
      imageUrl: g.imageUrl,
      sortOrder: g.sortOrder,
      itemCount: g.itemCount ?? 0,
      withStockCount: g.withStockCount ?? 0,
    }))
  const groups = dedupeOperatorNomenclatureGroups(raw)
  return { groups, tableMissing: res.tableMissing }
}

function receivingCategoriesToOperatorGroups(
  categories: ReceivingCategoryDirectoryRow[]
): OperatorNomenclatureGroup[] {
  return categories
    .filter((c) => c.isActive && c.code.trim())
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ru"))
    .map((c) => {
      const linked = (c.linkedGroupCodes ?? []).map((x) => x.trim()).filter(Boolean)
      return {
        code: c.code.trim(),
        name: c.name.trim() || c.code.trim(),
        description: c.description,
        imageUrl: c.imageUrl,
        sortOrder: c.sortOrder,
        itemCount: 0,
        withStockCount: 0,
        linkedGroupCodes: linked,
        aliasCodes: linked.length > 0 ? linked : [c.code.trim()],
      }
    })
}

function legacyOperatorPickerGroups(): OperatorNomenclatureGroup[] {
  return RECEIVING_PRODUCT_GROUPS.filter((g) => g.enabled).map((g) => ({
    code: g.key,
    name: g.title,
    description: g.subtitle,
    itemCount: 0,
    withStockCount: 0,
    sortOrder: 0,
  }))
}

/** Подгруппы приёмки (настройки) → иначе группы ЧЗ → иначе Стикеры/Вода. */
export async function loadOperatorPickerGroups(): Promise<{
  groups: OperatorNomenclatureGroup[]
  source: OperatorPickerGroupsSource
}> {
  try {
    const catsRes = await listDirectoryReceivingCategories()
    const active = (catsRes.categories ?? []).filter((c) => c.isActive && c.code.trim())
    if (!catsRes.tableMissing && active.length > 0) {
      return {
        groups: receivingCategoriesToOperatorGroups(active),
        source: "receiving-categories",
      }
    }
  } catch {
    /* fall through */
  }

  try {
    const itemRes = await listOperatorNomenclatureGroups()
    if ((itemRes.groups ?? []).length > 0) {
      return { groups: itemRes.groups, source: "item-groups" }
    }
  } catch {
    /* fall through */
  }

  return { groups: legacyOperatorPickerGroups(), source: "legacy" }
}

export async function createDirectoryItemGroup(input: {
  code: string
  name: string
  description?: string | null
  imageUrl?: string | null
  sortOrder?: number
  defaultShelfLifeDays?: number | null
  applyShelfLifeToItems?: boolean
}): Promise<{ group: ItemGroupDirectoryRow }> {
  return postJson("/api/wms/directories/item-groups", {
    siteCode: getSiteCode(),
    ...input,
  })
}

export async function patchDirectoryItemGroup(
  groupCode: string,
  patch: Partial<{
    name: string
    description: string | null
    imageUrl: string | null
    sortOrder: number
    isActive: boolean
    defaultShelfLifeDays: number | null
    applyShelfLifeToItems: boolean
  }>
): Promise<{ group: ItemGroupDirectoryRow }> {
  return patchJson("/api/wms/directories/item-groups", {
    siteCode: getSiteCode(),
    code: groupCode,
    ...patch,
  })
}

export async function applyDirectoryItemGroupShelfLife(input: {
  groupCode: string
  shelfLifeDays?: number
}): Promise<{ ok: boolean; groupCode: string; shelfLifeDays: number; updatedItems: number }> {
  return postJson("/api/wms/directories/item-groups/apply-shelf-life", {
    siteCode: getSiteCode(),
    ...input,
  })
}

export async function deleteDirectoryItemGroup(
  groupCode: string
): Promise<{ ok: boolean; mode: "deleted" | "disabled"; usedCount: number; group?: ItemGroupDirectoryRow }> {
  const qp = new URLSearchParams({ siteCode: getSiteCode(), code: groupCode })
  return deleteJson(`/api/wms/directories/item-groups?${qp.toString()}`)
}

/** Подгруппы приёмки (Стикеры, Вода, …) — настраиваются в WMS, синхронизируются на ТСД. */
export type ReceivingCategoryDirectoryRow = {
  code: string
  name: string
  description: string | null
  imageUrl: string | null
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  linkedGroupCodes: string[]
}

export async function listDirectoryReceivingCategories(): Promise<{
  categories: ReceivingCategoryDirectoryRow[]
  tableMissing?: boolean
}> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  return getJson(`/api/wms/directories/receiving-categories?${qp.toString()}`)
}

export async function createDirectoryReceivingCategory(input: {
  code: string
  name: string
  description?: string | null
  imageUrl?: string | null
  sortOrder?: number
  linkedGroupCodes?: string[]
}): Promise<{ category: ReceivingCategoryDirectoryRow }> {
  return postJson("/api/wms/directories/receiving-categories", {
    siteCode: getSiteCode(),
    ...input,
  })
}

export async function patchDirectoryReceivingCategory(
  categoryCode: string,
  patch: Partial<{
    name: string
    description: string | null
    imageUrl: string | null
    sortOrder: number
    isActive: boolean
    linkedGroupCodes: string[]
  }>
): Promise<{ category: ReceivingCategoryDirectoryRow }> {
  return patchJson("/api/wms/directories/receiving-categories", {
    siteCode: getSiteCode(),
    code: categoryCode,
    ...patch,
  })
}

export async function deleteDirectoryReceivingCategory(
  categoryCode: string
): Promise<{ ok: boolean; mode: "disabled"; category?: ReceivingCategoryDirectoryRow }> {
  const qp = new URLSearchParams({ siteCode: getSiteCode(), code: categoryCode })
  return deleteJson(`/api/wms/directories/receiving-categories?${qp.toString()}`)
}

export async function uploadDirectoryReceivingCategoryImage(input: {
  categoryCode: string
  file: File
}): Promise<{ imageUrl: string }> {
  const fd = new FormData()
  fd.set("categoryCode", input.categoryCode)
  fd.set("file", input.file)
  const r = await fetch(
    wmsFetchUrl("/api/wms/directories/receiving-categories/upload-image"),
    wmsFetchInit({
      method: "POST",
      body: fd,
    })
  )
  const data = (await r.json().catch(() => ({}))) as ApiError | { imageUrl: string }
  if (!r.ok) throwHttpError(r, data as ApiError)
  return data as { imageUrl: string }
}

export async function uploadDirectoryItemGroupImage(input: {
  groupCode: string
  file: File
}): Promise<{ imageUrl: string }> {
  const fd = new FormData()
  fd.set("siteCode", getSiteCode())
  fd.set("groupCode", input.groupCode)
  fd.set("file", input.file)
  const r = await fetch(
    wmsFetchUrl("/api/wms/directories/item-groups/upload-image"),
    wmsFetchInit({
      method: "POST",
      body: fd,
    })
  )
  const data = (await r.json().catch(() => ({}))) as ApiError | { imageUrl: string }
  if (!r.ok) throwHttpError(r, data as ApiError)
  return data as { imageUrl: string }
}

export async function syncDirectoryItemGroupsFromItems(): Promise<{
  ok: boolean
  insertedFromItemGroupCode: number
  insertedFromProductGroup: number
  note?: string
}> {
  return postJson("/api/wms/directories/item-groups/sync-from-items", {
    siteCode: getSiteCode(),
  })
}

export async function deduplicateDirectoryItemGroups(): Promise<{
  ok: boolean
  fixedSwapped: number
  mergedGroups: number
  removedGroups: number
  reassignedItems: number
}> {
  return postJson("/api/wms/directories/item-groups/deduplicate", {
    siteCode: getSiteCode(),
  })
}

/** Единицы измерения (подписи; код в wms_items.uom_code). */
export type UomDirectoryRow = {
  code: string
  name: string
  description: string | null
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export async function listDirectoryUoms(): Promise<{ uoms: UomDirectoryRow[]; tableMissing?: boolean }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  return getJson(`/api/wms/directories/uoms?${qp.toString()}`)
}

export async function createDirectoryUom(input: {
  code: string
  name: string
  description?: string | null
  sortOrder?: number
}): Promise<{ uom: UomDirectoryRow }> {
  return postJson("/api/wms/directories/uoms", {
    siteCode: getSiteCode(),
    ...input,
  })
}

export async function patchDirectoryUom(
  uomCode: string,
  patch: Partial<{ name: string; description: string | null; sortOrder: number; isActive: boolean }>
): Promise<{ uom: UomDirectoryRow }> {
  return patchJson(`/api/wms/directories/uoms/${encodeURIComponent(uomCode)}`, {
    siteCode: getSiteCode(),
    ...patch,
  })
}

/** Значения полей профиля ячейки (тип материала, этап, линейка…). */
export type SlotProfileOptionDirectoryRow = {
  fieldKey: string
  code: string
  name: string
  description: string | null
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export async function listDirectorySlotProfileOptions(fieldKey?: string): Promise<{
  options: SlotProfileOptionDirectoryRow[]
}> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (fieldKey?.trim()) qp.set("fieldKey", fieldKey.trim())
  return getJson(`/api/wms/directories/slot-profile-options?${qp.toString()}`)
}

export async function createDirectorySlotProfileOption(input: {
  fieldKey: string
  code: string
  name: string
  description?: string | null
  sortOrder?: number
}): Promise<{ option: SlotProfileOptionDirectoryRow }> {
  return postJson("/api/wms/directories/slot-profile-options", {
    siteCode: getSiteCode(),
    ...input,
  })
}

export async function patchDirectorySlotProfileOption(
  fieldKey: string,
  code: string,
  patch: Partial<{ name: string; description: string | null; sortOrder: number; isActive: boolean }>
): Promise<{ option: SlotProfileOptionDirectoryRow }> {
  return patchJson(
    `/api/wms/directories/slot-profile-options/${encodeURIComponent(fieldKey)}/${encodeURIComponent(code)}`,
    { siteCode: getSiteCode(), ...patch }
  )
}

export async function deleteDirectorySlotProfileOption(
  fieldKey: string,
  code: string
): Promise<{ ok: true; fieldKey: string; code: string }> {
  return postJson("/api/wms/directories/slot-profile-options/delete", {
    siteCode: getSiteCode(),
    fieldKey,
    code,
  })
}

export type WmsNotificationRow = {
  notificationId: string
  title: string
  body: string
  severity: string
  createdAt: string
  readAt: string | null
}

export async function listNotifications(params?: { userId?: string }): Promise<{
  notifications: WmsNotificationRow[]
  unreadCount: number
  currentUserId: string | null
}> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (params?.userId) qp.set("userId", params.userId)
  return getJson(`/api/wms/notifications?${qp.toString()}`)
}

export type WmsExpiryStickerAlert = {
  itemCode?: string | null
  itemName?: string | null
  lotCode?: string | null
  emissionDay?: string | null
  emissionAtIso?: string | null
  ageDays?: number | null
  severity?: string | null
  [key: string]: unknown
}

export type WmsNavCounters = {
  receiving: number
  movement: number
  tasks: number
}

/** Счётчики бокового меню одним запросом вместо двух списков по сотне строк. */
export async function getNavCounters(): Promise<WmsNavCounters> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  return getJson(`/api/wms/nav-counters?${qp.toString()}`)
}

export async function listExpiryStickerAlerts(): Promise<{ alerts: WmsExpiryStickerAlert[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  return getJson(`/api/wms/expiry-alerts/active?${qp.toString()}`)
}

export async function syncExpiryStickerAlerts(): Promise<unknown> {
  return postJson("/api/wms/expiry-alerts/sync", { siteCode: getSiteCode() })
}

export type WmsExpiryProductMailSettings = {
  enabled: boolean
  recipients: string[]
  includeWarning: boolean
  includeCritical: boolean
  includeExpired: boolean
  timeZone: string
  sendHour: number
  lastSentAt: string | null
  lastSentCount: number
  lastError: string | null
  lastSkipReason: string | null
  updatedAt?: string | null
}

export async function getExpiryProductMailSettings(): Promise<{
  settings: WmsExpiryProductMailSettings
  previewCount: number
  previewAlerts: WmsExpiryStickerAlert[]
}> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  return getJson(`/api/wms/expiry-alerts/mail?${qp.toString()}`)
}

export async function saveExpiryProductMailSettings(
  settings: Partial<WmsExpiryProductMailSettings> & { recipientsText?: string }
): Promise<{ settings: WmsExpiryProductMailSettings }> {
  return postJson("/api/wms/expiry-alerts/mail", {
    siteCode: getSiteCode(),
    action: "save",
    settings,
  })
}

export async function sendExpiryProductMail(input?: { force?: boolean; dryRun?: boolean }): Promise<{
  ok: boolean
  skipped?: boolean
  reason?: string
  sentCount?: number
  alertCount?: number
  recipients?: string[]
  settings: WmsExpiryProductMailSettings
}> {
  return postJson("/api/wms/expiry-alerts/mail", {
    siteCode: getSiteCode(),
    action: "send",
    force: input?.force ?? true,
    dryRun: input?.dryRun === true,
  })
}

function parseNotificationField(body: string, field: "itemCode" | "lotCode"): string | null {
  const prefix = `${field}:`
  const line = body
    .split(/\r?\n/)
    .map((v) => v.trim())
    .find((v) => v.toLowerCase().startsWith(prefix.toLowerCase()))
  return line ? line.slice(prefix.length).trim() || null : null
}

export function parseExpiryNotificationItemCode(body: string): string | null {
  return parseNotificationField(body, "itemCode")
}

export function parseExpiryNotificationLotCode(body: string): string | null {
  return parseNotificationField(body, "lotCode")
}

export type IssueRecipientDirectoryRow = {
  code: string
  displayName: string
  position: string | null
  sortOrder: number
  isActive: boolean
}

export async function listDirectoryIssueRecipients(): Promise<{ recipients: IssueRecipientDirectoryRow[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  return getJson(`/api/wms/directories/issue-recipients?${qp.toString()}`)
}

export async function createDirectoryIssueRecipient(input: {
  code?: string
  displayName: string
  position?: string | null
  sortOrder?: number
}): Promise<{ recipient: IssueRecipientDirectoryRow }> {
  return postJson("/api/wms/directories/issue-recipients", { siteCode: getSiteCode(), ...input })
}

export async function patchDirectoryIssueRecipient(
  recipientCode: string,
  patch: Partial<{
    displayName: string
    position: string | null
    sortOrder: number
    isActive: boolean
  }>
): Promise<{ recipient: IssueRecipientDirectoryRow }> {
  return postJson("/api/wms/directories/issue-recipients/update", {
    siteCode: getSiteCode(),
    recipientCode,
    ...patch,
  })
}

export async function deleteDirectoryIssueRecipient(
  recipientCode: string
): Promise<{ ok: true; recipientCode: string }> {
  return postJson("/api/wms/directories/issue-recipients/delete", {
    siteCode: getSiteCode(),
    recipientCode,
  })
}

export async function importDirectoryIssueRecipientsFromUsers(): Promise<{ imported: number; message?: string }> {
  return postJson("/api/wms/directories/issue-recipients/import", { siteCode: getSiteCode() })
}

export type WriteoffReasonRow = {
  code: string
  displayName: string
  sortOrder: number
  isActive: boolean
}

export async function listDirectoryWriteoffReasons(opts?: {
  activeOnly?: boolean
}): Promise<{ reasons: WriteoffReasonRow[] }> {
  const qp = new URLSearchParams({ siteCode: getSiteCode() })
  if (opts?.activeOnly) qp.set("activeOnly", "1")
  return getJson(`/api/wms/directories/writeoff-reasons?${qp.toString()}`)
}

export async function createDirectoryWriteoffReason(input: {
  code?: string
  displayName: string
  sortOrder?: number
}): Promise<{ reason: WriteoffReasonRow }> {
  return postJson("/api/wms/directories/writeoff-reasons", { siteCode: getSiteCode(), ...input })
}

export async function patchDirectoryWriteoffReason(
  reasonCode: string,
  patch: Partial<{ displayName: string; sortOrder: number; isActive: boolean }>
): Promise<{ reason: WriteoffReasonRow }> {
  return postJson("/api/wms/directories/writeoff-reasons/update", {
    siteCode: getSiteCode(),
    reasonCode,
    ...patch,
  })
}

export async function deleteDirectoryWriteoffReason(
  reasonCode: string
): Promise<{ ok: true; reasonCode: string }> {
  return postJson("/api/wms/directories/writeoff-reasons/delete", {
    siteCode: getSiteCode(),
    reasonCode,
  })
}

export type WriteoffPreviewLine = {
  itemCode: string
  itemName: string
  lotCode: string | null
  lotId: string | null
  uom: string
  availableQty: number
  inProductionQty: number
  quarantineQty: number
  qty: number
  manufacturedAt: string | null
  expiryAt: string | null
  expired: boolean
}

export type WriteoffPreview = {
  locationCode: string
  locationName: string | null
  warehouseCode: string | null
  warehouseName: string | null
  lines: WriteoffPreviewLine[]
  codes: Array<{ codeId: string; itemCode: string; value: string }>
}

export async function getWriteoffPreview(locationCode: string): Promise<{ preview: WriteoffPreview }> {
  const qp = new URLSearchParams({
    siteCode: getSiteCode(),
    locationCode,
  })
  return getJson(`/api/wms/writeoff?${qp.toString()}`)
}

export async function createLocationWriteoff(input: {
  locationCode: string
  reasonCode: string
  comment?: string
  lines?: Array<{ itemCode: string; lotCode?: string | null; qty?: number | null }>
}): Promise<{
  ok: true
  documentId: string
  documentNo: string
  lineCount: number
  codesCount: number
}> {
  return postJson("/api/wms/writeoff", {
    siteCode: getSiteCode(),
    requestId: newRequestId(),
    ...input,
  })
}

export type WmsTorg16Settings = {
  orgName: string
  orgAddress: string
  orgPhone: string
  okpo: string
  okdp: string
  approveTitle: string
  approveName: string
  commissionChair: string
  commissionMember1: string
  commissionMember2: string
  materiallyResponsible: string
  updatedAt?: string | null
}

export type WmsTorg16Fields = {
  orgName: string
  orgAddress: string
  orgPhone: string
  okpo: string
  okud: string
  okdp: string
  structuralUnit: string
  documentNo: string
  composedAt: string
  operationKind: string
  reasonCode: string
  reasonName: string
  basisDoc: string
  basisNo: string
  basisDate: string
  locationCode: string
  locationName: string
  warehouseCode: string
  warehouseName: string
  comment: string
  materiallyResponsible: string
  commissionChair: string
  commissionMember1: string
  commissionMember2: string
  approveTitle: string
  approveName: string
  approveDate: string
  codes: string
  codesCount: string
  linesQtyTotal: string
  lines: Array<{
    lineNo: number
    name: string
    itemCode: string
    uom: string
    qty: string
    lotCode: string
    expiryAt: string
    codes: string
    note: string
  }>
}

export type WmsTorg16FormRecord = {
  formId: string | null
  documentId: string | null
  title: string
  fields: WmsTorg16Fields
  overrides: Partial<WmsTorg16Fields>
  auto: WmsTorg16Fields
  updatedAt: string | null
}

export async function getTorg16Settings(): Promise<{
  settings: WmsTorg16Settings
  defaults: WmsTorg16Settings
  variables: Array<{ key: string; hint: string }>
}> {
  const qp = new URLSearchParams({ siteCode: getSiteCode() })
  return getJson(`/api/wms/settings/torg16?${qp.toString()}`)
}

export async function saveTorg16Settings(
  settings: Partial<WmsTorg16Settings>
): Promise<{
  settings: WmsTorg16Settings
  defaults: WmsTorg16Settings
  variables: Array<{ key: string; hint: string }>
}> {
  return putJson("/api/wms/settings/torg16", { siteCode: getSiteCode(), settings })
}

export type WmsTorg16TemplateMeta = {
  originalName: string
  mimeType: string
  updatedAt: string
  bytes: number
  kind: "xlsx" | "docx"
  variables: string[]
}

export async function getTorg16TemplateMeta(): Promise<{
  hasCustomTemplate: boolean
  template: WmsTorg16TemplateMeta | null
  variables: Array<{ key: string; hint: string }>
}> {
  const qp = new URLSearchParams({ siteCode: getSiteCode(), meta: "1" })
  return getJson(`/api/wms/settings/torg16/template?${qp.toString()}`)
}

export async function downloadTorg16TemplateFile(fileName = "TORG-16-shablon.xlsx"): Promise<void> {
  const qp = new URLSearchParams({ siteCode: getSiteCode() })
  const r = await fetch(wmsFetchUrl(`/api/wms/settings/torg16/template?${qp.toString()}`), wmsFetchInit())
  if (!r.ok) {
    const data = (await r.json().catch(() => ({}))) as ApiError
    throwHttpError(r, data)
  }
  const blob = await r.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export async function uploadTorg16Template(file: File): Promise<{
  ok: boolean
  hasCustomTemplate: boolean
  template: WmsTorg16TemplateMeta
  variables: Array<{ key: string; hint: string }>
}> {
  const fd = new FormData()
  fd.set("siteCode", getSiteCode())
  fd.set("file", file)
  const r = await fetch(
    wmsFetchUrl("/api/wms/settings/torg16/template"),
    wmsFetchInit({ method: "POST", body: fd })
  )
  const data = (await r.json().catch(() => ({}))) as ApiError | {
    ok: boolean
    hasCustomTemplate: boolean
    template: WmsTorg16TemplateMeta
    variables: Array<{ key: string; hint: string }>
  }
  if (!r.ok) throwHttpError(r, data as ApiError)
  return data as {
    ok: boolean
    hasCustomTemplate: boolean
    template: WmsTorg16TemplateMeta
    variables: Array<{ key: string; hint: string }>
  }
}

export async function deleteTorg16Template(): Promise<{ ok: boolean; hasCustomTemplate: boolean }> {
  const qp = new URLSearchParams({ siteCode: getSiteCode() })
  return deleteJson(`/api/wms/settings/torg16/template?${qp.toString()}`)
}

export async function getDocumentTorg16(documentId: string): Promise<{ form: WmsTorg16FormRecord }> {
  const qp = new URLSearchParams({ siteCode: getSiteCode() })
  return getJson(`/api/wms/documents/${encodeURIComponent(documentId)}/forms/torg16?${qp.toString()}`)
}

export async function saveDocumentTorg16(
  documentId: string,
  fields: WmsTorg16Fields,
  title?: string
): Promise<{ form: WmsTorg16FormRecord }> {
  return putJson(`/api/wms/documents/${encodeURIComponent(documentId)}/forms/torg16`, {
    siteCode: getSiteCode(),
    fields,
    title,
  })
}

export async function downloadDocumentTorg16File(documentId: string, fileName?: string): Promise<void> {
  const qp = new URLSearchParams({ siteCode: getSiteCode() })
  const r = await fetch(
    wmsFetchUrl(`/api/wms/documents/${encodeURIComponent(documentId)}/forms/torg16/file?${qp.toString()}`),
    wmsFetchInit()
  )
  if (!r.ok) {
    const data = (await r.json().catch(() => ({}))) as ApiError
    throwHttpError(r, data)
  }
  const blob = await r.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName || `TORG-16-${documentId}`
  a.click()
  URL.revokeObjectURL(url)
}

export type ProductionLineDirectoryRow = {
  code: string
  displayName: string
  sortOrder: number
  isActive: boolean
}

export async function listDirectoryProductionLines(opts?: {
  activeOnly?: boolean
}): Promise<{ lines: ProductionLineDirectoryRow[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (opts?.activeOnly) qp.set("activeOnly", "1")
  return getJson(`/api/wms/directories/production-lines?${qp.toString()}`)
}

export async function createDirectoryProductionLine(input: {
  code?: string
  displayName: string
  sortOrder?: number
}): Promise<{ line: ProductionLineDirectoryRow }> {
  return postJson("/api/wms/directories/production-lines", { siteCode: getSiteCode(), ...input })
}

export async function patchDirectoryProductionLine(
  lineCode: string,
  patch: Partial<{
    displayName: string
    sortOrder: number
    isActive: boolean
  }>
): Promise<{ line: ProductionLineDirectoryRow }> {
  return postJson("/api/wms/directories/production-lines/update", {
    siteCode: getSiteCode(),
    lineCode,
    ...patch,
  })
}

export async function deleteDirectoryProductionLine(
  lineCode: string
): Promise<{ ok: true; lineCode: string }> {
  return postJson("/api/wms/directories/production-lines/delete", {
    siteCode: getSiteCode(),
    lineCode,
  })
}

export type SupplierAddressMeta = {
  legal?: string
  actual?: string
  delivery?: string
  postal?: string
}

export type SupplierMeta = {
  legalName?: string
  kpp?: string
  ogrn?: string
  addresses?: SupplierAddressMeta
  phone?: string
  email?: string
  contactPerson?: string
  website?: string
  bankName?: string
  bankBik?: string
  bankAccount?: string
  corrAccount?: string
  note?: string
}

export type SupplierDirectoryRow = {
  supplierId: string
  code: string
  name: string
  taxId: string | null
  meta?: SupplierMeta
  isActive: boolean
  createdAt: string
  updatedAt: string
  contractCount?: number
  defaultContractNumber?: string | null
}

export type SupplierContractType = "supply" | "purchase" | "service" | "framework" | "other"

export type SupplierContractExternalSource = "manual" | "1c" | "import" | "api"

export type SupplierContractRow = {
  contractId: string
  supplierCode: string
  code: string
  number: string | null
  name: string
  contractType: SupplierContractType
  validFrom: string | null
  validTo: string | null
  currency: string | null
  isDefault: boolean
  isActive: boolean
  externalSource: SupplierContractExternalSource
  externalId: string | null
  externalRef?: Record<string, unknown>
  meta?: Record<string, unknown>
  note: string | null
  createdAt: string
  updatedAt: string
}

export async function listSupplierContracts(
  supplierCode: string,
  params?: { activeOnly?: boolean }
): Promise<{ contracts: SupplierContractRow[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  qp.set("supplierCode", supplierCode)
  if (params?.activeOnly) qp.set("activeOnly", "1")
  return getJson(`/api/wms/directories/suppliers/contracts?${qp.toString()}`)
}

export async function createSupplierContract(input: {
  supplierCode: string
  code?: string
  number?: string | null
  name: string
  contractType?: SupplierContractType
  validFrom?: string | null
  validTo?: string | null
  currency?: string | null
  isDefault?: boolean
  externalId?: string | null
  externalSource?: SupplierContractExternalSource
  externalRef?: Record<string, unknown>
  meta?: Record<string, unknown>
  note?: string | null
}): Promise<{ contract: SupplierContractRow }> {
  return postJson("/api/wms/directories/suppliers/contracts", { siteCode: getSiteCode(), ...input })
}

export async function patchSupplierContract(
  contractCode: string,
  patch: Partial<{
    number: string | null
    name: string
    contractType: SupplierContractType
    validFrom: string | null
    validTo: string | null
    currency: string | null
    isDefault: boolean
    isActive: boolean
    externalId: string | null
    externalSource: SupplierContractExternalSource
    externalRef: Record<string, unknown>
    meta: Record<string, unknown>
    note: string | null
  }>
): Promise<{ contract: SupplierContractRow }> {
  return postJson("/api/wms/directories/suppliers/contracts/update", {
    siteCode: getSiteCode(),
    contractCode,
    ...patch,
  })
}

export async function deleteSupplierContract(
  contractCode: string
): Promise<{ ok: true; contractCode: string }> {
  return postJson("/api/wms/directories/suppliers/contracts/delete", {
    siteCode: getSiteCode(),
    contractCode,
  })
}

export async function upsertExternalSupplierContracts(input: {
  supplierCode: string
  externalSource?: SupplierContractExternalSource
  contracts: Array<{
    externalId: string
    externalSource?: SupplierContractExternalSource
    code?: string
    number?: string | null
    name?: string
    contractType?: SupplierContractType
    validFrom?: string | null
    validTo?: string | null
    currency?: string | null
    isDefault?: boolean
    isActive?: boolean
    externalRef?: Record<string, unknown>
    meta?: Record<string, unknown>
    note?: string | null
  }>
}): Promise<{ contracts: SupplierContractRow[]; upserted: number }> {
  return postJson("/api/wms/directories/suppliers/contracts/upsert-external", {
    siteCode: getSiteCode(),
    ...input,
  })
}

export async function listDirectorySuppliers(params?: {
  activeOnly?: boolean
}): Promise<{ suppliers: SupplierDirectoryRow[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  const res = await getJson<{ suppliers: SupplierDirectoryRow[] }>(`/api/wms/directories/suppliers?${qp.toString()}`)
  if (params?.activeOnly) {
    return { suppliers: (res.suppliers || []).filter((s) => s.isActive) }
  }
  return res
}

export async function createDirectorySupplier(input: {
  code?: string
  name: string
  taxId?: string | null
  meta?: SupplierMeta
}): Promise<{ supplier: SupplierDirectoryRow }> {
  return postJson("/api/wms/directories/suppliers", { siteCode: getSiteCode(), ...input })
}

export async function patchDirectorySupplier(
  supplierCode: string,
  patch: Partial<{ name: string; taxId: string | null; isActive: boolean; meta: SupplierMeta }>
): Promise<{ supplier: SupplierDirectoryRow }> {
  return postJson("/api/wms/directories/suppliers/update", {
    siteCode: getSiteCode(),
    supplierCode,
    ...patch,
  })
}

export async function deleteDirectorySupplier(
  supplierCode: string
): Promise<{ ok: true; supplierCode: string }> {
  return postJson("/api/wms/directories/suppliers/delete", {
    siteCode: getSiteCode(),
    supplierCode,
  })
}

export type RackCellRow = {
  locationId: string
  locationCode: string
  displayName: string
  physicalAddress: string | null
  sortOrder: number
}

export type RackDirectoryRow = {
  rackId: string
  code: string
  name: string
  addressLabel: string | null
  warehouseCode: string | null
  zoneCode: string | null
  meta?: Record<string, unknown>
  isActive: boolean
  cellCount: number
  cells: RackCellRow[]
  createdAt: string
  updatedAt: string
}

export async function listDirectoryRacks(params?: {
  includeCells?: boolean
}): Promise<{ racks: RackDirectoryRow[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (params?.includeCells) qp.set("includeCells", "1")
  return getJson(`/api/wms/directories/racks?${qp.toString()}`)
}

export async function getDirectoryRack(rackCode: string): Promise<{ rack: RackDirectoryRow }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  qp.set("rackCode", rackCode)
  return getJson(`/api/wms/directories/racks/detail?${qp.toString()}`)
}

export async function getRackByLocation(locationCode: string): Promise<{ rack: RackDirectoryRow | null }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  qp.set("locationCode", locationCode)
  return getJson(`/api/wms/directories/racks/by-location?${qp.toString()}`)
}

export async function createDirectoryRack(input: {
  code?: string
  name: string
  addressLabel?: string | null
  warehouseCode?: string | null
  zoneCode?: string | null
  meta?: Record<string, unknown>
}): Promise<{ rack: RackDirectoryRow }> {
  return postJson("/api/wms/directories/racks", { siteCode: getSiteCode(), ...input })
}

export async function patchDirectoryRack(
  rackCode: string,
  patch: Partial<{
    name: string
    addressLabel: string | null
    warehouseCode: string | null
    zoneCode: string | null
    isActive: boolean
    meta: Record<string, unknown>
  }>
): Promise<{ rack: RackDirectoryRow }> {
  return postJson("/api/wms/directories/racks/update", { siteCode: getSiteCode(), rackCode, ...patch })
}

export async function deleteDirectoryRack(rackCode: string): Promise<{ ok: true; rackCode: string }> {
  return postJson("/api/wms/directories/racks/delete", { siteCode: getSiteCode(), rackCode })
}

export async function setDirectoryRackCells(
  rackCode: string,
  locationCodes: string[]
): Promise<{ rack: RackDirectoryRow }> {
  return postJson("/api/wms/directories/racks/set-cells", {
    siteCode: getSiteCode(),
    rackCode,
    locationCodes,
  })
}

export async function suggestDirectoryRackCells(rackCode: string): Promise<{ cells: RackCellRow[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  qp.set("rackCode", rackCode)
  return getJson(`/api/wms/directories/racks/suggest-cells?${qp.toString()}`)
}

export type ItemAliasRow = {
  aliasId: string
  itemCode: string
  supplierCode: string | null
  supplierName: string | null
  aliasName: string
  aliasSku: string | null
  gtin: string | null
  source: string | null
  confidence: number | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export async function listItemAliases(itemCode: string): Promise<{ aliases: ItemAliasRow[] }> {
  const c = encodeURIComponent(itemCode)
  return getJson(`/api/wms/items/${c}/aliases?siteCode=${encodeURIComponent(getSiteCode())}`)
}

export async function createItemAlias(
  itemCode: string,
  input: {
    supplierCode?: string | null
    supplierName?: string | null
    aliasName: string
    aliasSku?: string | null
    gtin?: string | null
    source?: string | null
  }
): Promise<{ alias: ItemAliasRow }> {
  const c = encodeURIComponent(itemCode)
  return postJson(`/api/wms/items/${c}/aliases`, {
    siteCode: getSiteCode(),
    ...input,
  })
}

export type WmsCalendarEvent = {
  eventId: string
  typeCode: string
  title: string
  description: string | null
  startAt: string
  endAt: string | null
  allDay: boolean
  statusCode: string
  severityCode: string
  tags: string[]
  refs: Record<string, unknown>
  meta: Record<string, unknown>
  createdByUserId: string | null
  createdByDeviceUid: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type WmsCalendarRule = {
  ruleId: string
  name: string
  kind: string
  isActive: boolean
  priority: number
  config: Record<string, unknown>
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export async function listCalendarRules(params?: { includeDeleted?: boolean }): Promise<{ rules: WmsCalendarRule[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (params?.includeDeleted) qp.set("includeDeleted", "1")
  return getJson(`/api/wms/calendar/rules?${qp.toString()}`)
}

export async function createCalendarRule(input: {
  name: string
  kind: string
  isActive?: boolean
  priority?: number
  config?: Record<string, unknown>
}): Promise<{ rule: WmsCalendarRule }> {
  return postJson("/api/wms/calendar/rules", { siteCode: getSiteCode(), ...input })
}

export async function updateCalendarRule(input: {
  ruleId: string
  patch: Partial<{
    name: string
    kind: string
    isActive: boolean
    priority: number
    config: Record<string, unknown>
  }>
}): Promise<{ rule: WmsCalendarRule }> {
  return patchJson("/api/wms/calendar/rules", { siteCode: getSiteCode(), ruleId: input.ruleId, ...input.patch })
}

export async function deleteCalendarRule(ruleId: string): Promise<{ ok: true }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  qp.set("ruleId", ruleId)
  return deleteJson(`/api/wms/calendar/rules?${qp.toString()}`)
}

export async function listCalendarEvents(params?: {
  from?: string
  to?: string
  types?: string[]
  includeDeleted?: boolean
}): Promise<{ events: WmsCalendarEvent[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (params?.from) qp.set("from", params.from)
  if (params?.to) qp.set("to", params.to)
  if (params?.types && params.types.length > 0) qp.set("types", params.types.join(","))
  if (params?.includeDeleted) qp.set("includeDeleted", "1")
  return getJson(`/api/wms/calendar/events?${qp.toString()}`)
}

export async function createCalendarEvent(input: {
  typeCode: string
  title: string
  description?: string | null
  startAt: string
  endAt?: string | null
  allDay?: boolean
  statusCode?: string
  severityCode?: string
  tags?: string[]
  refs?: Record<string, unknown>
  meta?: Record<string, unknown>
  createdByUserId?: string | null
  createdByDeviceUid?: string | null
}): Promise<{ event: WmsCalendarEvent }> {
  return postJson("/api/wms/calendar/events", {
    siteCode: getSiteCode(),
    ...input,
  })
}

export async function updateCalendarEvent(input: {
  eventId: string
  patch: Partial<{
    typeCode: string
    title: string
    description: string | null
    startAt: string
    endAt: string | null
    allDay: boolean
    statusCode: string
    severityCode: string
    tags: string[]
    refs: Record<string, unknown>
    meta: Record<string, unknown>
  }>
}): Promise<{ event: WmsCalendarEvent }> {
  return patchJson("/api/wms/calendar/events", {
    siteCode: getSiteCode(),
    eventId: input.eventId,
    ...input.patch,
  })
}

export async function deleteCalendarEvent(eventId: string): Promise<{ ok: true }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  qp.set("eventId", eventId)
  return deleteJson(`/api/wms/calendar/events?${qp.toString()}`)
}

export async function createNotification(input: {
  title: string
  body: string
  severity?: string
  target: "all" | "users"
  userIds?: string[]
  createdByUserId?: string | null
}): Promise<{ notificationId: string; recipientCount: number }> {
  return postJson("/api/wms/notifications", {
    siteCode: getSiteCode(),
    ...input,
  })
}

export async function markNotificationRead(input: {
  notificationId: string
  userId: string
}): Promise<{ ok: true }> {
  return postJson(`/api/wms/notifications/${encodeURIComponent(input.notificationId)}/read`, {
    siteCode: getSiteCode(),
    userId: input.userId,
  })
}

/** UUID v4 для идемпотентности API (работает и по HTTP, без secure context). */
export function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID()
    } catch {
      /* randomUUID требует secure context — см. fallback */
    }
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(
    wmsFetchUrl(url),
    wmsFetchInit({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  )
  const data = (await r.json().catch(() => ({}))) as ApiError
  if (!r.ok) throwHttpError(r, data)
  return data as T
}

async function putJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(
    wmsFetchUrl(url),
    wmsFetchInit({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  )
  const data = (await r.json().catch(() => ({}))) as ApiError
  if (!r.ok) throwHttpError(r, data)
  return data as T
}

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(
    wmsFetchUrl(url),
    wmsFetchInit({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  )
  const data = (await r.json().catch(() => ({}))) as ApiError
  if (!r.ok) throwHttpError(r, data)
  return data as T
}

export type WmsItemResourceRow = {
  specComponentId?: string
  itemCode: string
  name: string
  materialType?: string | null
  productGroup?: string | null
  componentRoleCode?: string | null
  qtyPer: number
  uomCode: string
  availableQty?: number
  reservedQty?: number
  inProductionQty?: number
  inTransitQty?: number
  quarantineQty?: number
  rejectedQty?: number
  earliestExpiryAt?: string | null
  lotCount?: number
}

export type WmsItemDetailResponse = {
  item: Record<string, unknown>
  activeSpec: unknown
  totals: { availableQty: number; reservedQty: number; [k: string]: number }
  stockByLocation: unknown[]
  lots: unknown[]
  receivingReceipts?: Array<{
    documentId: string
    postedAtIso: string | null
    locationCode: string | null
    emissionDay: string
    emissionAtIso: string | null
    emissionLabel: string
    qty: number
    postedQty: number
    scanCount: number
    lotCode: string
    stockPosted: boolean
    sessionPostedOtherLines: boolean
  }>
  itemUoms: unknown[]
  resources: WmsItemResourceRow[]
}

export async function getWmsItemDetail(
  itemCode: string,
  options?: { includeMovements?: boolean }
): Promise<WmsItemDetailResponse> {
  const c = encodeURIComponent(itemCode)
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (options?.includeMovements) qp.set("includeMovements", "1")
  return getJson(`/api/wms/items/${c}?${qp.toString()}`)
}

export type WmsItemMovementRow = {
  movementId: string
  movementAt: string
  movementType: string
  qty: number
  fromLocationCode: string | null
  toLocationCode: string | null
  lotCode: string | null
  documentId: string | null
}

export async function listWmsItemMovements(
  itemCode: string,
  opts?: { limit?: number; offset?: number; days?: number | null }
): Promise<{ movements: WmsItemMovementRow[]; hasMore: boolean }> {
  const c = encodeURIComponent(itemCode)
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (opts?.limit != null) qp.set("limit", String(opts.limit))
  if (opts?.offset != null) qp.set("offset", String(opts.offset))
  if (opts?.days != null) qp.set("days", String(opts.days))
  return getJson(`/api/catalog/items/${c}/movements?${qp.toString()}`)
}

export type QpassPass = {
  publicId: string
  url: string
  title: string | null
  inventoryCode: string | null
  serial: string | null
  orgName: string | null
  qrImageUrl?: string | null
}

export async function lookupQpass(q: string): Promise<{ found: true; pass: QpassPass }> {
  const qp = new URLSearchParams()
  qp.set("q", q)
  return getJson(`/api/wms/qpass/lookup?${qp.toString()}`)
}

export async function getItemQpass(
  itemCode: string
): Promise<{ found: boolean; pass: QpassPass | null }> {
  const c = encodeURIComponent(itemCode)
  return getJson(`/api/wms/items/${c}/qpass?siteCode=${encodeURIComponent(getSiteCode())}`)
}

export async function saveItemQpass(
  itemCode: string,
  q: string | null
): Promise<{ found: boolean; pass: QpassPass | null; created?: boolean }> {
  const c = encodeURIComponent(itemCode)
  return putJson(`/api/wms/items/${c}/qpass`, { siteCode: getSiteCode(), q })
}

export async function ensureItemQpass(
  itemCode: string,
  keys: { name: string; serial: string }
): Promise<{ found: boolean; pass: QpassPass | null; created?: boolean }> {
  const c = encodeURIComponent(itemCode)
  return putJson(`/api/wms/items/${c}/qpass`, {
    siteCode: getSiteCode(),
    name: keys.name,
    serial: keys.serial,
  })
}

export async function updateWmsItem(
  itemCode: string,
  patch: Record<string, unknown>
): Promise<WmsItemDetailResponse> {
  const c = encodeURIComponent(itemCode)
  return patchJson(`/api/wms/items/${c}`, {
    siteCode: getSiteCode(),
    ...patch,
  })
}

export async function updateWmsItemResources(
  itemCode: string,
  components: Array<{
    itemCode: string
    qtyPer: number | string
    uomCode?: string | null
    componentRoleCode?: string | null
  }>
): Promise<WmsItemDetailResponse> {
  return postJson("/api/wms/items/resources/update", {
    siteCode: getSiteCode(),
    itemCode,
    components,
  })
}

export async function backfillWmsItemSkus(input: {
  dryRun?: boolean
  limit?: number
}): Promise<{
  dryRun: boolean
  limit: number
  updated?: number
  count?: number
  items: Array<{ itemCode: string; gtin14: string; nextSku: string }>
}> {
  return postJson("/api/wms/items/backfill-sku", {
    siteCode: getSiteCode(),
    dryRun: Boolean(input.dryRun),
    limit: input.limit ?? 50,
  })
}

export type WmsScannerMode = "info" | "collect"
export type WmsScannerSource = "tsd" | "serial"
export type WmsScannerScanEvent = {
  siteId: number
  siteCode: string
  sessionId: string
  deviceUid?: string | null
  source: WmsScannerSource
  mode: WmsScannerMode
  code: string
  atIso: string
}

export async function createScannerSession(): Promise<{ sessionId: string; expiresAtIso: string }> {
  return postJson("/api/wms/scanner-sessions", { siteCode: getSiteCode() })
}

export type ProductionConsumeInput = {
  requestId?: string
  locationCode: string
  itemCode?: string
  datamatrix?: string
  qty?: number
  sourceSystem?: string
  externalEventId?: string
  lineCode?: string
  lotCode?: string
  batchLabel?: string
  operatorName?: string
  dryRun?: boolean
}

export type ProductionConsumeResponse = {
  disposition: "applied" | "duplicate" | "dry_run"
  consumptionId?: string
  documentId?: string | null
  movementId?: string | null
  itemCode?: string
  itemName?: string
  locationCode?: string
  qty?: number
  beforeInProductionQty?: number
  afterInProductionQty?: number
  beforeAvailableQty?: number
  afterAvailableQty?: number
  lotCode?: string | null
  lineCode?: string | null
  mode?: "datamatrix" | "qty"
  codeValue?: string | null
  gtin?: string | null
  serial?: string | null
}

export async function consumeProductionLineStock(
  input: ProductionConsumeInput
): Promise<ProductionConsumeResponse> {
  return postJson("/api/wms/production/consume", {
    siteCode: getSiteCode(),
    ...input,
  })
}

export async function returnWorkshopStockToWarehouse(input: {
  fromLocationCode: string
  toLocationCode: string
  itemCode: string
  qty: number
  lotCode?: string | null
  operatorName?: string | null
}): Promise<{
  disposition: string
  documentId?: string
  fromLocationCode?: string
  toLocationCode?: string
  qty?: number
}> {
  return postJson("/api/wms/production/workshop-return", {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    fromLocationCode: input.fromLocationCode.trim(),
    toLocationCode: input.toLocationCode.trim(),
    itemCode: input.itemCode.trim(),
    qty: input.qty,
    lotCode: input.lotCode?.trim() || undefined,
    operatorName: input.operatorName?.trim() || undefined,
  })
}

export type WorkshopStockRow = {
  locationCode: string
  displayName: string
  warehouseCode: string
  warehouseName: string
  zoneCode: string
  zoneName: string
  lineLabel: string
  itemCode: string
  itemName: string
  packagingProfile: string | null
  inProductionQty: number
  availableQty: number
  markingCodesCount?: number
  isSticker: boolean
}

export type WorkshopCodeRow = {
  codeId: string
  itemCode: string
  itemName: string
  gtin: string
  serial: string
  locationCode: string
  locationName: string
  warehouseCode: string
  zoneCode: string
  statusId: number
  statusName: string
  linkedAt: string | null
}

export type WorkshopStockOverviewResponse = {
  rows: WorkshopStockRow[]
  summary: {
    locationCount: number
    itemCount: number
    totalInProduction: number
    stickerInProduction: number
    totalMarkingCodes?: number
    lowStockCells: number
  }
  fetchedAt: string
}

export async function getWorkshopStockOverview(params?: {
  stickersOnly?: boolean
}): Promise<WorkshopStockOverviewResponse> {
  const qp = new URLSearchParams({ siteCode: getSiteCode() })
  if (params?.stickersOnly) qp.set("stickersOnly", "1")
  return getJson(`/api/wms/production/workshop-overview?${qp.toString()}`)
}

export type WorkshopCellSuggestRow = {
  locationCode: string
  displayName: string
  zoneCode: string
  score: number
  reasons: string[]
  preferredMatch: boolean
  hasSameItem: boolean
  isEmpty: boolean
  inProductionQty: number
  rememberNomenclature: boolean
}

export async function suggestWorkshopCells(input: {
  itemCode: string
  limit?: number
}): Promise<{
  itemCode: string
  itemName: string
  suggestions: WorkshopCellSuggestRow[]
}> {
  const qp = new URLSearchParams({
    siteCode: getSiteCode(),
    itemCode: input.itemCode.trim(),
  })
  if (input.limit != null) qp.set("limit", String(input.limit))
  return getJson(`/api/wms/production/workshop-suggest?${qp.toString()}`)
}

export async function getWorkshopCodes(params?: {
  locationCode?: string
  warehouseCode?: string
  itemCode?: string
  limit?: number
  offset?: number
}): Promise<{ rows: WorkshopCodeRow[]; total: number; limit: number; offset: number }> {
  const qp = new URLSearchParams({ siteCode: getSiteCode() })
  if (params?.locationCode) qp.set("locationCode", params.locationCode)
  if (params?.warehouseCode) qp.set("warehouseCode", params.warehouseCode)
  if (params?.itemCode) qp.set("itemCode", params.itemCode)
  if (params?.limit) qp.set("limit", String(params.limit))
  if (params?.offset) qp.set("offset", String(params.offset))
  return getJson(`/api/wms/production/workshop-codes?${qp.toString()}`)
}

export type ProductionConsumptionFeedRow = {
  consumptionId: string
  createdAt: string
  locationCode: string
  displayName: string
  lineCode: string | null
  itemCode: string
  itemName: string
  packagingProfile: string | null
  qty: number
  mode: string
  sourceSystem: string
  codeValue: string | null
  isSticker: boolean
}

export type ProductionConsumptionsResponse = {
  consumptions: ProductionConsumptionFeedRow[]
  summary: { todayQty: number }
  fetchedAt: string
}

export async function listProductionConsumptions(params?: {
  limit?: number
  since?: string
  stickersOnly?: boolean
}): Promise<ProductionConsumptionsResponse> {
  const qp = new URLSearchParams({ siteCode: getSiteCode() })
  if (params?.limit) qp.set("limit", String(params.limit))
  if (params?.since) qp.set("since", params.since)
  if (params?.stickersOnly) qp.set("stickersOnly", "1")
  return getJson(`/api/wms/production/consumptions?${qp.toString()}`)
}

export async function subscribeScannerSession(params: {
  sessionId: string
  timeoutSec?: number
}): Promise<{ event: WmsScannerScanEvent | { eventType: "timeout"; atIso: string } }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  qp.set("timeout", String(params.timeoutSec ?? 30))
  return getJson(`/api/wms/scanner-sessions/${encodeURIComponent(params.sessionId)}/subscribe?${qp.toString()}`)
}

export async function emitScannerSessionScan(input: {
  sessionId: string
  code: string
  mode: WmsScannerMode
  source: WmsScannerSource
  deviceUid?: string
}): Promise<{ ok: true }> {
  return postJson(`/api/wms/scanner-sessions/${encodeURIComponent(input.sessionId)}/scan`, {
    siteCode: getSiteCode(),
    code: input.code,
    mode: input.mode,
    source: input.source,
    deviceUid: input.deviceUid,
  })
}

export type WmsCodeListEntry = { kind: "code"; code: string }

export async function createWmsCodeList(input: {
  deviceUid: string
  listType: "scanner_collect"
  entries: WmsCodeListEntry[]
}): Promise<{ codeListId: string | null }> {
  return postJson("/api/wms/devices/code-lists", {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    deviceUid: input.deviceUid,
    listType: input.listType,
    entries: input.entries,
  })
}

export async function updateWmsLot(
  lotId: string,
  patch: Partial<{ qaStatusCode: string | null; note: string | null; isBlocked: boolean }>
): Promise<{ ok: true }> {
  return patchJson(`/api/wms/lots/${encodeURIComponent(lotId)}`, {
    siteCode: getSiteCode(),
    ...patch,
  })
}

export async function moveWmsLotBucket(input: {
  lotId: string
  fromBucket: "available" | "quarantine"
  toBucket: "available" | "quarantine"
  qty: number
}): Promise<{ ok: true }> {
  return postJson(`/api/wms/lots/${encodeURIComponent(input.lotId)}/bucket`, {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    fromBucket: input.fromBucket,
    toBucket: input.toBucket,
    qty: input.qty,
  })
}

export async function claimWmsTask(taskId: string, assignedUserId?: string) {
  return postJson<{ taskId: string }>(`/api/wms/tasks/${encodeURIComponent(taskId)}/claim`, {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    assignedUserId: assignedUserId || undefined,
  })
}

export type CreateOperationalTaskLine = {
  itemCode: string
  qty: number
  uomCode?: string
  lotCode?: string
  batchLabel?: string
  manufacturedAt?: string
  bestBeforeAt?: string
  expiryAt?: string
  sourceLocationCode?: string
  targetLocationCode?: string
  comment?: string
}

/** Создать документ и задания из конструктора очереди. */
export async function createOperationalTaskBatch(input: {
  operationType: "receipt" | "shipment" | "revision"
  priorityCode?: "low" | "normal" | "high" | "urgent"
  comment?: string
  sourceLocationCode?: string
  targetLocationCode?: string
  lines: CreateOperationalTaskLine[]
}): Promise<{
  documentId?: string
  taskCount?: number
  createdLines?: Array<{ documentLineId?: string; taskId?: string }>
}> {
  return postJson("/api/wms/tasks", {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    ...input,
  })
}

export async function startWmsTask(taskId: string) {
  return postJson<{ taskId: string }>(`/api/wms/tasks/${encodeURIComponent(taskId)}/start`, {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
  })
}

export async function completeWmsTask(
  taskId: string,
  input?: { confirmedQty?: number; targetLocationCode?: string; note?: string }
) {
  return postJson<unknown>(`/api/wms/tasks/${encodeURIComponent(taskId)}/complete`, {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    ...input,
  })
}

export async function reportWmsTaskException(taskId: string, exceptionCode: string, exceptionNote?: string) {
  return postJson<unknown>(`/api/wms/tasks/${encodeURIComponent(taskId)}/exception`, {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    exceptionCode,
    exceptionNote: exceptionNote || undefined,
  })
}

export async function cancelWmsTask(taskId: string, note?: string) {
  return postJson<unknown>(`/api/wms/tasks/${encodeURIComponent(taskId)}/cancel`, {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    note: note || undefined,
  })
}

export async function assignWmsTaskDevice(taskId: string, deviceUid: string, assignedUserId?: string) {
  return postJson<unknown>(`/api/wms/tasks/${encodeURIComponent(taskId)}/assign-device`, {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    deviceUid: deviceUid.trim(),
    assignedUserId: assignedUserId || undefined,
  })
}

/** Вернуть задание в общую очередь (снять терминал и исполнителя). */
export async function releaseWmsTaskToQueue(taskId: string, note?: string) {
  return postJson<unknown>(`/api/wms/tasks/${encodeURIComponent(taskId)}/release`, {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    note: note || undefined,
  })
}

export type WmsIssueActResult = {
  formId: string
  documentId: string
  formCode: string
  title: string
  bodyText: string
  createdAt: string
}

export async function getDocumentIssueAct(documentId: string): Promise<{ act: WmsIssueActResult }> {
  const qp = new URLSearchParams({ siteCode: getSiteCode() })
  return getJson(`/api/wms/documents/${encodeURIComponent(documentId)}/forms/issue-act?${qp.toString()}`)
}

export async function createDocumentIssueAct(documentId: string): Promise<{ act: WmsIssueActResult }> {
  const qp = new URLSearchParams({ siteCode: getSiteCode() })
  return postJson(`/api/wms/documents/${encodeURIComponent(documentId)}/forms/issue-act?${qp.toString()}`, {})
}

export type WmsTorg1Line = {
  lineNo: number
  name: string
  itemCode: string
  uom: string
  qtyDoc: string
  qtyFact: string
  lotCode: string
  note: string
}

export type WmsTorg1Fields = {
  orgName: string
  orgAddress: string
  orgPhone: string
  okpo: string
  okud: string
  okdp: string
  structuralUnit: string
  cameraNo: string
  sectionNo: string
  basisDoc: string
  basisNo: string
  basisDate: string
  operationKind: string
  documentNo: string
  composedAt: string
  approveTitle: string
  approveName: string
  approveSign: string
  approveDate: string
  place: string
  commissionNote: string
  commissionDate: string
  accompanyingDocs: string
  representativeCall: string
  callDocNo: string
  callDocDate: string
  shipper: string
  manufacturer: string
  supplier: string
  insurer: string
  contractNo: string
  contractDate: string
  invoiceNo: string
  invoiceDate: string
  commercialAct: string
  commercialActDate: string
  vetCert: string
  vetCertDate: string
  railWaybill: string
  railWaybillDate: string
  deliveryMethod: string
  vehicleNo: string
  shipDate: string
  fromStation: string
  fromStationOrWarehouse: string
  meatTemp: string
  arrivedAt: string
  arrivedTime: string
  acceptStart: string
  acceptStartTime: string
  acceptPause: string
  acceptPauseTime: string
  acceptResume: string
  acceptResumeTime: string
  acceptEnd: string
  acceptEndTime: string
  lines: WmsTorg1Line[]
}

export type WmsTorg1Settings = {
  orgName: string
  orgAddress: string
  orgPhone: string
  okpo: string
  okdp: string
  approveTitle: string
  approveName: string
  updatedAt?: string | null
}

export type WmsTorg1FormRecord = {
  formId: string | null
  documentId: string | null
  sessionId: string | null
  formCode: string
  title: string
  fields: WmsTorg1Fields
  overrides: Partial<WmsTorg1Fields>
  auto: WmsTorg1Fields
  updatedAt: string | null
}

export async function getTorg1Settings(): Promise<{
  settings: WmsTorg1Settings
  defaults: WmsTorg1Settings
  variables: Array<{ key: string; hint: string }>
}> {
  const qp = new URLSearchParams({ siteCode: getSiteCode() })
  return getJson(`/api/wms/settings/torg1?${qp.toString()}`)
}

export async function saveTorg1Settings(settings: Partial<WmsTorg1Settings>): Promise<{
  settings: WmsTorg1Settings
  defaults: WmsTorg1Settings
  variables: Array<{ key: string; hint: string }>
}> {
  return putJson("/api/wms/settings/torg1", { siteCode: getSiteCode(), settings })
}

export type WmsTorg1ExcelTemplateSlot = {
  key: string
  label: string
  documentType: string
  categoryCode: string | null
  originalName: string
  updatedAt: string
  bytes: number
  sheets: string[]
  variables: string[]
}

export async function getTorg1ExcelTemplateMeta(): Promise<{
  hasCustomTemplate: boolean
  templates: WmsTorg1ExcelTemplateSlot[]
  variables: Array<{ key: string; hint: string }>
  placeholderStyle: string
}> {
  const qp = new URLSearchParams({ siteCode: getSiteCode(), meta: "1" })
  return getJson(`/api/wms/settings/torg1/excel-template?${qp.toString()}`)
}

/** Скачать Excel-шаблон сайта. Если своего нет — клиентский стартовый с {{переменными}}. */
export async function downloadTorg1ExcelTemplateFile(
  fileName = "TORG-1-shablon.xlsx",
  opts?: { slot?: string; documentType?: string }
): Promise<"custom" | "starter"> {
  const qp = new URLSearchParams({ siteCode: getSiteCode() })
  if (opts?.slot) qp.set("slot", opts.slot)
  if (opts?.documentType) qp.set("documentType", opts.documentType)
  const r = await fetch(wmsFetchUrl(`/api/wms/settings/torg1/excel-template?${qp.toString()}`), wmsFetchInit())
  if (r.status === 404) {
    const { downloadTorg1PlaceholderTemplate } = await import("@/lib/wms/torg1-excel")
    downloadTorg1PlaceholderTemplate(fileName)
    return "starter"
  }
  if (!r.ok) {
    const data = (await r.json().catch(() => ({}))) as ApiError
    throwHttpError(r, data)
  }
  const blob = await r.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
  return "custom"
}

/** Байты шаблона. null = использовать локальный стартовый с {{переменными}}. */
export async function fetchTorg1ExcelTemplateBytes(opts?: {
  slot?: string
  documentType?: string
  categoryCode?: string
}): Promise<ArrayBuffer | null> {
  const qp = new URLSearchParams({ siteCode: getSiteCode() })
  if (opts?.slot) qp.set("slot", opts.slot)
  if (opts?.documentType) qp.set("documentType", opts.documentType)
  if (opts?.categoryCode) qp.set("categoryCode", opts.categoryCode)
  const r = await fetch(wmsFetchUrl(`/api/wms/settings/torg1/excel-template?${qp.toString()}`), wmsFetchInit())
  if (r.status === 404) return null
  if (!r.ok) {
    const data = (await r.json().catch(() => ({}))) as ApiError
    throwHttpError(r, data)
  }
  return r.arrayBuffer()
}

export async function uploadTorg1ExcelTemplate(
  file: File,
  opts?: {
    slot?: string
    label?: string
    documentType?: string
    categoryCode?: string | null
  }
): Promise<{
  ok: boolean
  hasCustomTemplate: boolean
  template: WmsTorg1ExcelTemplateSlot
  templates: WmsTorg1ExcelTemplateSlot[]
  variables: Array<{ key: string; hint: string }>
}> {
  const fd = new FormData()
  fd.set("siteCode", getSiteCode())
  fd.set("file", file)
  fd.set("slot", opts?.slot || "default")
  if (opts?.label) fd.set("label", opts.label)
  fd.set("documentType", opts?.documentType || "receiving")
  if (opts?.categoryCode) fd.set("categoryCode", opts.categoryCode)
  const r = await fetch(
    wmsFetchUrl("/api/wms/settings/torg1/excel-template"),
    wmsFetchInit({ method: "POST", body: fd })
  )
  const data = (await r.json().catch(() => ({}))) as ApiError | {
    ok: boolean
    hasCustomTemplate: boolean
    template: WmsTorg1ExcelTemplateSlot
    templates: WmsTorg1ExcelTemplateSlot[]
    variables: Array<{ key: string; hint: string }>
  }
  if (!r.ok) throwHttpError(r, data as ApiError)
  return data as {
    ok: boolean
    hasCustomTemplate: boolean
    template: WmsTorg1ExcelTemplateSlot
    templates: WmsTorg1ExcelTemplateSlot[]
    variables: Array<{ key: string; hint: string }>
  }
}

export async function deleteTorg1ExcelTemplate(slot = "default"): Promise<{
  ok: boolean
  hasCustomTemplate: boolean
  templates: WmsTorg1ExcelTemplateSlot[]
}> {
  const qp = new URLSearchParams({ siteCode: getSiteCode(), slot })
  return deleteJson(`/api/wms/settings/torg1/excel-template?${qp.toString()}`)
}

export type Torg1RefreshMode = "template" | "full_reset"

/** Пересобрать ТОРГ-1 в документах приёмки по текущему шаблону (без Excel). */
export async function refreshReceivingTorg1Documents(input?: {
  mode?: Torg1RefreshMode
  documentIds?: string[]
  sessionIds?: string[]
  sessions?: Array<{
    sessionId: string
    hints?: {
      documentNo?: string | null
      composedAt?: string | null
      locationCode?: string | null
      comment?: string | null
      externalRef?: string | null
      warehouseCode?: string | null
    }
  }>
}): Promise<{
  ok: boolean
  mode: Torg1RefreshMode
  documentsUpdated: number
  sessionsUpdated: number
  totalUpdated: number
  errors: Array<{ id: string; kind: "document" | "session"; message: string }>
}> {
  return postJson("/api/wms/settings/torg1/refresh-documents", {
    siteCode: getSiteCode(),
    mode: input?.mode ?? "template",
    documentIds: input?.documentIds,
    sessionIds: input?.sessionIds,
    sessions: input?.sessions,
  })
}

export async function getDocumentTorg1(documentId: string): Promise<{ form: WmsTorg1FormRecord }> {
  const qp = new URLSearchParams({ siteCode: getSiteCode() })
  return getJson(`/api/wms/documents/${encodeURIComponent(documentId)}/forms/torg1?${qp.toString()}`)
}

export async function saveDocumentTorg1(
  documentId: string,
  fields: WmsTorg1Fields,
  title?: string
): Promise<{ form: WmsTorg1FormRecord }> {
  return putJson(`/api/wms/documents/${encodeURIComponent(documentId)}/forms/torg1`, {
    siteCode: getSiteCode(),
    fields,
    title,
  })
}

export async function getSessionTorg1(
  sessionId: string,
  hints?: {
    documentNo?: string | null
    composedAt?: string | null
    locationCode?: string | null
    comment?: string | null
    externalRef?: string | null
    warehouseCode?: string | null
  }
): Promise<{ form: WmsTorg1FormRecord }> {
  const qp = new URLSearchParams({ siteCode: getSiteCode() })
  if (hints?.documentNo) qp.set("documentNo", hints.documentNo)
  if (hints?.composedAt) qp.set("composedAt", hints.composedAt)
  if (hints?.locationCode) qp.set("locationCode", hints.locationCode)
  if (hints?.comment) qp.set("comment", hints.comment)
  if (hints?.externalRef) qp.set("externalRef", hints.externalRef)
  if (hints?.warehouseCode) qp.set("warehouseCode", hints.warehouseCode)
  return getJson(`/api/wms/receiving/sessions/${encodeURIComponent(sessionId)}/torg1?${qp.toString()}`)
}

export async function saveSessionTorg1(
  sessionId: string,
  fields: WmsTorg1Fields,
  hints?: {
    documentNo?: string | null
    composedAt?: string | null
    locationCode?: string | null
    comment?: string | null
    externalRef?: string | null
    warehouseCode?: string | null
  }
): Promise<{ form: WmsTorg1FormRecord }> {
  return putJson(`/api/wms/receiving/sessions/${encodeURIComponent(sessionId)}/torg1`, {
    siteCode: getSiteCode(),
    fields,
    hints,
  })
}


/** Приостановить (статус on_hold), назначения сохраняются. */
export async function suspendWmsTask(taskId: string, note?: string) {
  return postJson<unknown>(`/api/wms/tasks/${encodeURIComponent(taskId)}/hold`, {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
    note: note || undefined,
  })
}

/** Снять приостановку (on_hold → claimed). */
export async function resumeWmsTask(taskId: string) {
  return postJson<unknown>(`/api/wms/tasks/${encodeURIComponent(taskId)}/resume`, {
    requestId: newRequestId(),
    siteCode: getSiteCode(),
  })
}

export type WmsVirtualLayoutSummary = {
  layoutId: string
  layoutCode: string
  name: string
  description: string | null
  warehouseCode: string | null
  zoneCode: string | null
  updatedAt: string
  nodeCount?: number | null
}

export async function listVirtualLayouts(params?: { warehouseCode?: string; query?: string }): Promise<{ layouts: WmsVirtualLayoutSummary[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (params?.warehouseCode) qp.set("warehouseCode", params.warehouseCode)
  if (params?.query) qp.set("query", params.query)
  return getJson(`/api/wms/virtual/layouts?${qp.toString()}`)
}

export type WmsVirtualLayoutDetail = {
  layout: WmsVirtualLayoutSummary & { scenePrefs?: Record<string, unknown> | null }
  nodes: Array<{
    nodeId: string
    layoutId: string
    parentNodeId: string | null
    nodeType: string
    code: string | null
    label: string
    sortOrder?: number | null
    props?: Record<string, unknown> | null
    contents?: WmsVirtualNodeContent[]
  }>
  links?: Array<Record<string, unknown>>
}

export type WmsVirtualNodeContent = {
  contentId?: string
  itemCode: string
  itemName?: string | null
  qty: number
  uomCode?: string | null
  lotCode?: string | null
  note?: string | null
}

export async function getVirtualLayoutDetail(layoutId: string): Promise<WmsVirtualLayoutDetail> {
  const qp = new URLSearchParams({ siteCode: getSiteCode(), includeContents: "1" })
  return getJson(`/api/wms/virtual/layouts/${encodeURIComponent(layoutId)}?${qp.toString()}`)
}

export async function getVirtualNodeContents(nodeId: string): Promise<{ contents: WmsVirtualNodeContent[] }> {
  const qp = new URLSearchParams({ siteCode: getSiteCode() })
  return getJson(`/api/wms/virtual/nodes/${encodeURIComponent(nodeId)}/contents?${qp.toString()}`)
}

export async function resolveVirtualLocation(locationCode: string): Promise<{
  layoutId: string | null
  nodeId: string | null
}> {
  const qp = new URLSearchParams({ siteCode: getSiteCode(), locationCode: locationCode.trim() })
  return getJson(`/api/wms/virtual/resolve-location?${qp.toString()}`)
}

export function getBackendBase(): string {
  // Used only for opening existing backend pages (3D viewer/editor).
  // If not set, assume same host (works when interface is served by main app).
  if (typeof window === "undefined") return ""
  return (localStorage.getItem("wms.backendBase") || "").trim()
}

export function setBackendBase(url: string) {
  if (typeof window === "undefined") return
  localStorage.setItem("wms.backendBase", (url || "").trim())
}

export type CrptCisInfo = Record<string, unknown>

export type CrptInfoResponseItem = {
  cisInfo?: CrptCisInfo
  [key: string]: unknown
}

/** Проверка кодов маркировки в Честном знаке через `/api/wms/crpt/info` (прокси WMS). */
export async function fetchCrptInfo(codes: string[] | string): Promise<CrptInfoResponseItem[]> {
  const payload =
    typeof codes === "string"
      ? { codes }
      : { codes: codes.map((code) => code.trim()).filter(Boolean) }

  const r = await fetch(
    wmsFetchUrl("/api/wms/crpt/info"),
    wmsFetchInit({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  )
  const data = (await r.json().catch(() => ({}))) as ApiError | CrptInfoResponseItem[]
  if (!r.ok) throwHttpError(r, data as ApiError)
  return data as CrptInfoResponseItem[]
}

export async function lookupFgPlanPalletInCz(input: {
  sscc: string
  planGtin?: string
  planBottles?: number
}): Promise<import("@/lib/wms/fg-plan-pallet-cz").FgPlanPalletCzSummary> {
  const { normalizeSscc, summarizeCrptPallet } = await import("@/lib/wms/fg-plan-pallet-cz")
  const sscc = normalizeSscc(input.sscc)
  if (!sscc) throw new Error("Нет SSCC у палеты")
  const rows = await fetchCrptInfo([sscc])
  const first = rows[0]
  if (first && !first.cisInfo && first.errorMessage) {
    throw new Error(String(first.errorMessage))
  }
  const children = Array.isArray(first?.cisInfo?.child)
    ? (first?.cisInfo?.child as unknown[]).map((value) => String(value || "")).filter(Boolean)
    : []
  let productName = String(first?.cisInfo?.productName || "").trim()
  if (!productName && children[0]) {
    try {
      const childRows = await fetchCrptInfo([children[0]])
      productName = String(childRows[0]?.cisInfo?.productName || "").trim()
    } catch {
      /* parent SSCC is enough */
    }
  }
  return summarizeCrptPallet(first?.cisInfo, {
    sscc,
    planGtin: input.planGtin,
    productName,
    planBottles: input.planBottles,
  })
}

export type {
  FgCodeLookupHit,
  FgExpiryBucket,
  FgMarkingNode,
  FgMarkingTag,
  FgNomenclatureRow,
  FgPagedResult,
  FgPalletRow,
  FgRowPalletSummary,
  FgStorageRowSummary,
  FgSummaryStats,
} from "@/lib/wms/finished-goods-types"

export async function getFgWarehouseSummary(): Promise<{ summary: import("@/lib/wms/finished-goods-types").FgSummaryStats }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  return getJson(`/api/fg/summary?${qp.toString()}`)
}

export async function listFgWarehouseNomenclature(params?: {
  query?: string
  fsnDays?: number
}): Promise<{ rows: import("@/lib/wms/finished-goods-types").FgNomenclatureRow[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (params?.query) qp.set("query", params.query)
  if (params?.fsnDays) qp.set("fsnDays", String(params.fsnDays))
  return getJson(`/api/fg/nomenclature?${qp.toString()}`)
}

export async function getFgWarehouseNomenclatureTree(itemCode: string): Promise<{
  tree: import("@/lib/wms/finished-goods-types").FgMarkingNode[]
}> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  const encoded = encodeURIComponent(itemCode)
  return getJson(`/api/fg/nomenclature/${encoded}/tree?${qp.toString()}`)
}

export async function getFgWarehouseMarkingCodeChildren(
  itemCode: string,
  codeId: string
): Promise<{ children: import("@/lib/wms/finished-goods-types").FgMarkingNode[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  const encItem = encodeURIComponent(itemCode)
  const encCode = encodeURIComponent(codeId)
  return getJson(
    `/api/fg/nomenclature/${encItem}/codes/${encCode}/children?${qp.toString()}`
  )
}

export async function listFgWarehouseExpiry(): Promise<{
  buckets: import("@/lib/wms/finished-goods-types").FgExpiryBucket[]
}> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  return getJson(`/api/wms/warehouse/finished-goods/expiry?${qp.toString()}`)
}

export async function listFgWarehousePallets(params?: {
  query?: string
}): Promise<{ pallets: import("@/lib/wms/finished-goods-types").FgPalletRow[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (params?.query) qp.set("query", params.query)
  return getJson(`/api/wms/warehouse/finished-goods/pallets?${qp.toString()}`)
}

export type FgVekasLotDetail = {
  batchNumber: string
  gtin: string | null
  bottles: number
  blocks: number
  palletCount: number
  palletCodes: string[]
  palletQty: Array<{ palletId: string; quantity: number | null }>
  productionDate: string | null
  vekasServer: string
}

export async function listFgVekasLots(params: {
  itemCode: string
  gtin?: string | null
}): Promise<{ lots: FgVekasLotDetail[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (params.itemCode) qp.set("itemCode", params.itemCode)
  if (params.gtin) qp.set("gtin", params.gtin)
  return getJson(`/api/wms/warehouse/finished-goods/vekas-lots?${qp.toString()}`)
}

export type FgResortReason = "extra_physical" | "extra_system" | "other"
export type FgResortStatus = "open" | "in_progress" | "done" | "cancelled"
export type FgResortOutcome = "confirmed" | "found_extra" | "found_missing"

export type FgResortJob = {
  jobId: string
  palletId: string
  palletCode: string
  itemCode: string
  itemName: string
  locationCode: string
  rowLabel: string
  bottles: number
  reason: FgResortReason
  reasonLabel: string
  comment: string | null
  status: FgResortStatus
  documentId: string | null
  taskId: string | null
  createdBy: string
  createdAt: string
  completedAt: string | null
  completedBy: string | null
  completeNote: string | null
  outcome: FgResortOutcome | null
}

export async function listFgResortJobs(status: "open" | "done" | "all" = "open"): Promise<{
  jobs: FgResortJob[]
}> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  qp.set("status", status)
  return getJson(`/api/wms/warehouse/finished-goods/resort?${qp.toString()}`)
}

export async function sendFgPalletsToResort(input: {
  palletIds: string[]
  reason: FgResortReason
  comment?: string
  itemCode?: string
}): Promise<{ created: number; skipped: number; documentId: string | null; jobs: FgResortJob[] }> {
  return postJson("/api/wms/warehouse/finished-goods/resort", {
    siteCode: getSiteCode(),
    requestId: newRequestId(),
    palletIds: input.palletIds,
    reason: input.reason,
    comment: input.comment,
    itemCode: input.itemCode,
  })
}

export async function completeFgResortJob(input: {
  jobId: string
  action: "complete" | "cancel"
  outcome?: FgResortOutcome
  note?: string
}): Promise<{ job: FgResortJob }> {
  return postJson(`/api/wms/warehouse/finished-goods/resort/${encodeURIComponent(input.jobId)}`, {
    siteCode: getSiteCode(),
    action: input.action,
    outcome: input.outcome,
    note: input.note,
  })
}

export async function listFgWarehouseRows(params?: {
  query?: string
  tag?: import("@/lib/wms/finished-goods-types").FgMarkingTag | "all"
}): Promise<{ rows: import("@/lib/wms/finished-goods-types").FgStorageRowSummary[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (params?.query) qp.set("query", params.query)
  if (params?.tag) qp.set("tag", params.tag)
  return getJson(`/api/wms/warehouse/finished-goods/rows?${qp.toString()}`)
}

export async function listFgWarehouseRowPallets(
  rowId: string,
  params?: { page?: number; pageSize?: number; query?: string }
): Promise<import("@/lib/wms/finished-goods-types").FgPagedResult<import("@/lib/wms/finished-goods-types").FgRowPalletSummary>> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (params?.page != null) qp.set("page", String(params.page))
  if (params?.pageSize != null) qp.set("pageSize", String(params.pageSize))
  if (params?.query) qp.set("query", params.query)
  const encoded = encodeURIComponent(rowId)
  return getJson(`/api/wms/warehouse/finished-goods/rows/${encoded}/pallets?${qp.toString()}`)
}

export async function lookupFgWarehouseCode(code: string): Promise<{
  hit: import("@/lib/wms/finished-goods-types").FgCodeLookupHit | null
}> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  qp.set("code", code)
  return getJson(`/api/wms/warehouse/finished-goods/lookup?${qp.toString()}`)
}

export type VekasBatchRow = {
  id: string
  batchNumber: string | null
  status: string | null
  gtin: string | null
  productName: string | null
  productionDate: string | null
  createdOn: string | null
}

export type VekasUtilizationCodeRow = {
  code: string
  status: string | null
  printedOn: string | null
  validatedOn: string | null
  reportId: string | null
  reportType: string | null
  gtin: string | null
  serial: string | null
}

export type VekasPlantServer = "skit" | "slavda"

export const VEKAS_PLANT_SERVERS: { key: VekasPlantServer; label: string; host: string }[] = [
  { key: "skit", label: "Скит", host: "192.168.254.2" },
  { key: "slavda", label: "Славда", host: "192.168.253.11" },
]

/** Партии Vekas (Скит / Славда) со статусом нанесения — для склада ГП. */
export async function listVekasAppliedBatches(opts?: {
  skip?: number
  take?: number
  gtin?: string
  batchNumber?: string
  productName?: string
  status?: string
  server?: VekasPlantServer
}): Promise<{ total: number; items: VekasBatchRow[] }> {
  const qp = new URLSearchParams()
  if (opts?.skip != null) qp.set("skip", String(opts.skip))
  if (opts?.take != null) qp.set("take", String(opts.take))
  if (opts?.gtin) qp.set("gtin", opts.gtin)
  if (opts?.batchNumber) qp.set("batchNumber", opts.batchNumber)
  if (opts?.productName) qp.set("productName", opts.productName)
  if (opts?.status) qp.set("status", opts.status)
  if (opts?.server) qp.set("server", opts.server)
  const q = qp.toString()
  return getJson(`/api/wms/vekas/batches${q ? `?${q}` : ""}`)
}

export type VekasAggregationPalletRow = {
  palletId: string
  nomenclature?: string | null
  gtin?: string | null
  batch?: string | null
  productionDate?: string | null
  quantity?: number | null
  unit?: string | null
}

/** Паллеты SSCC из отчёта AGGREGATION по партии Vekas. */
export async function listVekasBatchPallets(
  batchId: string,
  opts?: { server?: VekasPlantServer }
): Promise<{
  batchId: string
  batchNumber?: string | null
  productName?: string | null
  gtin?: string | null
  productionDate?: string | null
  total: number
  items: VekasAggregationPalletRow[]
}> {
  const qp = new URLSearchParams()
  if (opts?.server) qp.set("server", opts.server)
  const q = qp.toString()
  return getJson(
    `/api/wms/vekas/batches/${encodeURIComponent(batchId)}/pallets${q ? `?${q}` : ""}`
  )
}

/** Коды UTILIZATION (нанесение) по партии Vekas. */
export async function listVekasUtilizationCodes(
  batchId: string,
  opts?: {
    skip?: number
    take?: number
    validatedOnly?: boolean
    sortBy?: "printedOn" | "validatedOn"
    sortDir?: "asc" | "desc"
    timeFrom?: string
    timeTo?: string
    timeField?: "printedOn" | "validatedOn"
    codeQuery?: string
    server?: VekasPlantServer
  }
): Promise<{ batchId: string; total: number; items: VekasUtilizationCodeRow[] }> {
  const qp = new URLSearchParams()
  if (opts?.skip != null) qp.set("skip", String(opts.skip))
  if (opts?.take != null) qp.set("take", String(opts.take))
  if (opts?.validatedOnly === false) qp.set("validatedOnly", "0")
  if (opts?.sortBy) qp.set("sortBy", opts.sortBy)
  if (opts?.sortDir) qp.set("sortDir", opts.sortDir)
  if (opts?.timeFrom) qp.set("timeFrom", opts.timeFrom)
  if (opts?.timeTo) qp.set("timeTo", opts.timeTo)
  if (opts?.timeField) qp.set("timeField", opts.timeField)
  if (opts?.codeQuery) qp.set("codeQuery", opts.codeQuery)
  if (opts?.server) qp.set("server", opts.server)
  const q = qp.toString()
  return getJson(`/api/wms/vekas/batches/${encodeURIComponent(batchId)}/codes${q ? `?${q}` : ""}`)
}

export type ProductionPlanMaterialRow = {
  planMaterialId: string
  itemCode: string
  itemName: string
  qtyPer: number
  scrapPct: number
  requiredQty: number
  availableQty: number
  reservedQty: number
  shortageQty: number
  uomCode: string
  sortOrder: number
}

export type ProductionPlanRow = {
  planId: string
  code: string
  planDate: string
  planDateTo: string | null
  workshopCode: string | null
  lineCode: string | null
  itemCode: string
  itemName: string
  /** Составное наименование / формат упаковки (`wms_items.nomenclature`). */
  itemNomenclature?: string | null
  itemSku?: string | null
  packagingFormat?: string | null
  packagingProfile?: string | null
  plannedQty: number
  status: string
  materialWarehouseCode: string
  externalSource: string
  externalId: string | null
  actualPercent: number
  actualQty: number | null
  actualUpdatedAt: string | null
  actualSource: string | null
  note: string | null
  shortageCount: number
  isFullyCovered: boolean
  reservedAt: string | null
  materials?: ProductionPlanMaterialRow[]
  createdAt: string
  updatedAt: string
  startedAt?: string | null
  finishedAt?: string | null
  vekasProducedQty?: number | null
}

export type ProductionPlanLinkRow = {
  linkId: string
  sourcePlanId: string
  targetPlanId: string
  type: "s2s" | "s2e" | "e2s" | "e2e"
  lagDays: number
}

export async function listProductionPlans(params?: {
  from?: string
  to?: string
  status?: string
  includeMaterials?: boolean
}): Promise<{ plans: ProductionPlanRow[]; links?: ProductionPlanLinkRow[] }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (params?.from) qp.set("from", params.from)
  if (params?.to) qp.set("to", params.to)
  if (params?.status) qp.set("status", params.status)
  if (params?.includeMaterials) qp.set("includeMaterials", "1")
  qp.set("includeLinks", "1")
  return getJson(`/api/wms/production/plans?${qp.toString()}`)
}

export async function getProductionPlan(planCode: string): Promise<{ plan: ProductionPlanRow }> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  qp.set("planCode", planCode)
  return getJson(`/api/wms/production/plans/detail?${qp.toString()}`)
}

export async function createProductionPlan(input: {
  code?: string
  planDate: string
  planDateTo?: string | null
  itemCode: string
  plannedQty: number
  workshopCode?: string | null
  lineCode?: string | null
  materialWarehouseCode?: string
  note?: string | null
  syncCalendar?: boolean
}): Promise<{ plan: ProductionPlanRow }> {
  return postJson("/api/wms/production/plans", { siteCode: getSiteCode(), ...input })
}

export async function updateProductionPlan(
  planCode: string,
  patch: Partial<{
    planDate: string
    planDateTo: string | null
    itemCode: string
    plannedQty: number
    workshopCode: string | null
    lineCode: string | null
    materialWarehouseCode: string
    note: string | null
    status: string
    syncCalendar: boolean
  }>
): Promise<{ plan: ProductionPlanRow }> {
  return postJson("/api/wms/production/plans/update", { siteCode: getSiteCode(), planCode, ...patch })
}

export async function deleteProductionPlan(planCode: string): Promise<{ ok: true; planCode: string }> {
  return postJson("/api/wms/production/plans/delete", { siteCode: getSiteCode(), planCode })
}

export async function refreshProductionPlanMaterials(
  planCode: string
): Promise<{ plan: ProductionPlanRow; materials: ProductionPlanMaterialRow[] }> {
  return postJson("/api/wms/production/plans/refresh", { siteCode: getSiteCode(), planCode })
}

export async function reserveProductionPlan(planCode: string): Promise<{ plan: ProductionPlanRow }> {
  return postJson("/api/wms/production/plans/reserve", { siteCode: getSiteCode(), planCode })
}

export async function releaseProductionPlan(planCode: string): Promise<{ plan: ProductionPlanRow }> {
  return postJson("/api/wms/production/plans/release", { siteCode: getSiteCode(), planCode })
}

export async function updateProductionPlanProgress(input: {
  planCode: string
  percent: number
  doneQty?: number | null
  source?: string | null
}): Promise<{ plan: ProductionPlanRow }> {
  return postJson("/api/wms/production/plans/progress", { siteCode: getSiteCode(), ...input })
}

export async function createProductionPlanLink(input: {
  sourcePlanId: string
  targetPlanId: string
  type?: ProductionPlanLinkRow["type"]
  lagDays?: number
}): Promise<{ link: ProductionPlanLinkRow }> {
  return postJson("/api/wms/production/plans/links", { siteCode: getSiteCode(), ...input })
}

export async function updateProductionPlanLink(
  linkId: string,
  patch: Partial<{ type: ProductionPlanLinkRow["type"]; lagDays: number }>
): Promise<{ link: ProductionPlanLinkRow }> {
  return postJson("/api/wms/production/plans/links/update", { siteCode: getSiteCode(), linkId, ...patch })
}

export async function deleteProductionPlanLink(linkId: string): Promise<{ ok: true; linkId: string }> {
  return postJson("/api/wms/production/plans/links/delete", { siteCode: getSiteCode(), linkId })
}

export async function upsertExternalProductionPlan(input: {
  externalId: string
  planDate: string
  planDateTo?: string | null
  itemCode: string
  plannedQty: number
  workshopCode?: string | null
  lineCode?: string | null
  note?: string | null
  code?: string
}): Promise<{ plan: ProductionPlanRow }> {
  return postJson("/api/wms/production/plans/upsert-external", { siteCode: getSiteCode(), ...input })
}

export type SkitLabelMatch = {
  itemCode: string
  itemName: string
  score: number
}

export async function resolveSkitProductLabels(labels: string[]): Promise<{ matches: Record<string, SkitLabelMatch | null> }> {
  return postJson("/api/wms/production/plans/resolve-skit-labels", { siteCode: getSiteCode(), labels })
}

export type SkitPlanImportRow = {
  externalId: string
  planDate: string
  planDateTo?: string | null
  productLabel: string
  lineCode?: string | null
  plannedQty: number
  workshopCode?: string | null
  note?: string | null
}

export type SkitPlanImportResultRow = {
  externalId: string
  productLabel: string
  planDate: string
  status: "created" | "updated" | "skipped" | "error"
  planCode?: string
  error?: string
}

export async function importSkitProductionPlans(input: {
  rows: SkitPlanImportRow[]
  itemMapping?: Record<string, string>
  autoMatches?: Record<string, SkitLabelMatch | null>
}): Promise<{
  results: SkitPlanImportResultRow[]
  summary: { total: number; created: number; updated: number; skipped: number; errors: number }
}> {
  return postJson("/api/wms/production/plans/import-skit", { siteCode: getSiteCode(), ...input })
}

export type VekasApsWatchRow = {
  watchId: string
  vekasServer: VekasPlantServer
  vekasBatchId: string
  batchNumber: string | null
  vekasStatus: string | null
  watchState: "watching" | "completed" | "skipped"
  gtin: string | null
  productName: string | null
  lineCode: string | null
  productionDate: string | null
  planId: string | null
  planCode: string | null
  producedQty: number | null
  lastError: string | null
  firstSeenAt: string | null
  lastPolledAt: string | null
  completedAt: string | null
  startedAt?: string | null
  finishedAt?: string | null
}

export type VekasApsSyncResult = {
  ok?: boolean
  listed: number
  watching: number
  createdPlans: number
  attachedPlans: number
  completed: number
  skipped: number
  historyImported?: number
  historyRemaining?: number
  qtyBackfilled?: number
  fgImported?: number
  fgHistoryRemaining?: number
  errors: string[]
  watches: VekasApsWatchRow[]
}

export async function listVekasApsWatches(opts?: {
  state?: "watching" | "completed" | "skipped" | "all"
}): Promise<{ watching: number; watches: VekasApsWatchRow[] }> {
  const qp = new URLSearchParams({ siteCode: getSiteCode() })
  if (opts?.state) qp.set("state", opts.state)
  return getJson(`/api/wms/production/plans/sync-vekas?${qp}`)
}

export async function syncVekasApsBatches(): Promise<VekasApsSyncResult> {
  return postJson("/api/wms/production/plans/sync-vekas", { siteCode: getSiteCode() })
}

export type FgPathTag = {
  index: number
  id: string
  kind: "way" | "pickup" | "drop" | "resume"
  title: string
}

export type FgKaraStop = {
  tagId: number
  kind: "waypoint" | "pickup" | "drop"
  label?: string
  rowId?: string
  source?: "path" | "apriltag"
  nodeId?: string
}

export type FgKaraRoute = {
  id: string
  name: string
  lineCode: string | null
  itemCode: string | null
  itemName: string | null
  recommendedRowIds: string[]
  stops: FgKaraStop[]
  enabled: boolean
  hidden?: boolean
}

export type FgLoadingPoint = {
  id: string
  name: string
  lineCode: string | null
  tagId: number | null
  enabled: boolean
}

export type FgKaraUnit = {
  id: string
  name: string
  boardName?: string | null
  boardNumber?: string | null
  externalId?: string | null
  enabled: boolean
  lineCode: string | null
  routeIds: string[]
}

export type FgKaraDriverScheduleSlot = {
  weekday: number
  from: string
  to: string
}

export type FgKaraDriver = {
  id: string
  fullName: string
  photoUrl: string | null
  karaId: string | null
  lineCode: string | null
  shiftCode: string | null
  schedule: FgKaraDriverScheduleSlot[]
  enabled: boolean
  permissions?: string[]
  createdAt?: string
  updatedAt?: string
  note?: string
}

export type FgKaraMission = {
  id: string
  karaId: string
  routeId: string | null
  routeName: string
  lineCode: string | null
  itemCode: string | null
  status: "queued" | "active" | "done" | "cancelled" | "refused"
  stops: FgKaraStop[]
  currentIndex: number
  createdAt: string
  updatedAt: string
  note?: string
  kind?: "main" | "interleave" | "urgent"
  source?: "mes" | "wms" | "manual"
  driverId?: string | null
  lotCode?: string | null
  palletId?: string | null
  targetRowId?: string | null
  priority?: number
  acceptedAt?: string | null
  doneAt?: string | null
  refusedAt?: string | null
  refuseReason?: string | null
}

export type FgKaraViolationKind =
  | "refuse"
  | "wrong_row"
  | "wrong_task"
  | "ignored_urgent"
  | "other"

export type FgKaraViolation = {
  id: string
  kind: FgKaraViolationKind
  driverId: string | null
  karaId: string | null
  missionId: string | null
  message: string
  createdAt: string
  meta?: Record<string, string>
}

export type FgKaraDriverStats = {
  driverId: string
  fullName: string
  shiftCode: string | null
  lineCode: string | null
  karaId: string | null
  tasksTotal: number
  tasksDone: number
  tasksMain: number
  tasksInterleave: number
  tasksUrgent: number
  tasksRefused: number
  palletsDone: number
  workMinutes: number
  violations: number
}

export type FgKaraFleetSnapshot = {
  updatedAt: string
  karas: FgKaraUnit[]
  drivers?: FgKaraDriver[]
  routes: FgKaraRoute[]
  missions: FgKaraMission[]
  violations?: FgKaraViolation[]
  tags: Array<{ tagId: number; label: string; rows: string[] }>
  pathTags?: FgPathTag[]
  loadingPoints?: FgLoadingPoint[]
  settings?: { hideAllRoutes: boolean; hideEditorRoute: boolean }
}

export async function getFgKaraFleet(): Promise<FgKaraFleetSnapshot> {
  return getJson(`/api/wms/warehouse/finished-goods/fleet?siteCode=${encodeURIComponent(getSiteCode())}`)
}

export async function createFgKara(input: {
  name: string
  lineCode?: string | null
  routeIds?: string[]
  boardName?: string | null
  boardNumber?: string | null
  externalId?: string | null
}): Promise<{ kara: FgKaraUnit; fleet: FgKaraFleetSnapshot }> {
  return postJson("/api/wms/warehouse/finished-goods/karas", { siteCode: getSiteCode(), ...input })
}

export async function updateFgKara(
  id: string,
  patch: Partial<{
    name: string
    lineCode: string | null
    routeIds: string[]
    enabled: boolean
    boardName: string | null
    boardNumber: string | null
    externalId: string | null
  }>
): Promise<{ kara: FgKaraUnit; fleet: FgKaraFleetSnapshot }> {
  const r = await fetch(
    wmsFetchUrl(`/api/wms/warehouse/finished-goods/karas/${encodeURIComponent(id)}`),
    wmsFetchInit({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteCode: getSiteCode(), ...patch }),
    })
  )
  const data = (await r.json().catch(() => ({}))) as { error?: string }
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
  return data as { kara: FgKaraUnit; fleet: FgKaraFleetSnapshot }
}

export async function deleteFgKara(id: string): Promise<void> {
  await deleteJson(`/api/wms/warehouse/finished-goods/karas/${encodeURIComponent(id)}?siteCode=${encodeURIComponent(getSiteCode())}`)
}

export async function listFgKaraDrivers(): Promise<{
  drivers: FgKaraDriver[]
  karas: FgKaraUnit[]
  updatedAt: string
}> {
  return getJson(
    `/api/wms/warehouse/finished-goods/drivers?siteCode=${encodeURIComponent(getSiteCode())}`
  )
}

export async function createFgKaraDriver(input: {
  fullName: string
  photoUrl?: string | null
  karaId?: string | null
  lineCode?: string | null
  shiftCode?: string | null
  schedule?: FgKaraDriverScheduleSlot[]
  enabled?: boolean
  permissions?: string[]
  note?: string
}): Promise<{ driver: FgKaraDriver; fleet: FgKaraFleetSnapshot }> {
  return postJson("/api/wms/warehouse/finished-goods/drivers", { siteCode: getSiteCode(), ...input })
}

export async function updateFgKaraDriver(
  id: string,
  patch: Partial<{
    fullName: string
    photoUrl: string | null
    karaId: string | null
    lineCode: string | null
    shiftCode: string | null
    schedule: FgKaraDriverScheduleSlot[]
    enabled: boolean
    permissions: string[]
    note: string
  }>
): Promise<{ driver: FgKaraDriver; fleet: FgKaraFleetSnapshot }> {
  const r = await fetch(
    wmsFetchUrl(`/api/wms/warehouse/finished-goods/drivers/${encodeURIComponent(id)}`),
    wmsFetchInit({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteCode: getSiteCode(), ...patch }),
    })
  )
  const data = (await r.json().catch(() => ({}))) as { error?: string }
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
  return data as { driver: FgKaraDriver; fleet: FgKaraFleetSnapshot }
}

export async function deleteFgKaraDriver(id: string): Promise<void> {
  await deleteJson(
    `/api/wms/warehouse/finished-goods/drivers/${encodeURIComponent(id)}?siteCode=${encodeURIComponent(getSiteCode())}`
  )
}

export async function getFgKaraDriverStats(): Promise<{
  stats: FgKaraDriverStats[]
  violations: FgKaraViolation[]
  updatedAt: string
}> {
  return getJson(
    `/api/wms/warehouse/finished-goods/driver-stats?siteCode=${encodeURIComponent(getSiteCode())}`
  )
}

export async function reportFgKaraViolation(input: {
  kind: FgKaraViolationKind | string
  message: string
  driverId?: string | null
  karaId?: string | null
  missionId?: string | null
  meta?: Record<string, string>
}): Promise<{ violation: FgKaraViolation; fleet: FgKaraFleetSnapshot }> {
  return postJson("/api/wms/warehouse/finished-goods/violations", {
    siteCode: getSiteCode(),
    ...input,
  })
}


export async function createFgKaraRoute(input: {
  name: string
  lineCode?: string | null
  itemCode?: string | null
  itemName?: string | null
  recommendedRowIds?: string[]
  stops: FgKaraStop[]
}): Promise<{ route: FgKaraRoute; fleet: FgKaraFleetSnapshot }> {
  return postJson("/api/wms/warehouse/finished-goods/kara-routes", { siteCode: getSiteCode(), ...input })
}

export async function updateFgKaraRoute(
  id: string,
  patch: Partial<FgKaraRoute>
): Promise<{ route: FgKaraRoute; fleet: FgKaraFleetSnapshot }> {
  const r = await fetch(
    wmsFetchUrl(`/api/wms/warehouse/finished-goods/kara-routes/${encodeURIComponent(id)}`),
    wmsFetchInit({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteCode: getSiteCode(), ...patch }),
    })
  )
  const data = (await r.json().catch(() => ({}))) as { error?: string }
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
  return data as { route: FgKaraRoute; fleet: FgKaraFleetSnapshot }
}

export async function deleteFgKaraRoute(id: string): Promise<void> {
  await deleteJson(
    `/api/wms/warehouse/finished-goods/kara-routes/${encodeURIComponent(id)}?siteCode=${encodeURIComponent(getSiteCode())}`
  )
}

export type FgInterleaveOffer = {
  karaId: string
  karaName: string
  fromLabel: string
  routeId: string
  routeName: string
  pickupLabel: string
  distance: number
  reason: string
}

export async function dispatchFgKara(input: {
  karaId?: string
  karaName?: string
  lineCode?: string
  itemCode?: string
  routeId?: string
  path?: string
  pickupIndex?: number
  dropIndex?: number
  stops?: FgKaraStop[]
  note?: string
  kind?: "main" | "interleave" | "urgent"
  source?: "mes" | "wms" | "manual"
  driverId?: string | null
  lotCode?: string | null
  palletId?: string | null
  targetRowId?: string | null
  priority?: number
  startStatus?: "queued" | "active"
}): Promise<{
  mission: FgKaraMission
  kara: FgKaraUnit
  currentStop: FgKaraStop | null
  remaining: FgKaraStop[]
  interleave?: FgInterleaveOffer | null
  fleet?: FgKaraFleetSnapshot
}> {
  return postJson("/api/wms/warehouse/finished-goods/dispatch", { siteCode: getSiteCode(), ...input })
}

export async function advanceFgMission(
  id: string,
  action: "advance" | "cancel" | "complete" | "accept" | "refuse" | "wrong_row" = "advance",
  opts?: { driverId?: string | null; refuseReason?: string | null; actualRowId?: string | null }
): Promise<{
  mission: FgKaraMission
  currentStop: FgKaraStop | null
  interleave?: FgInterleaveOffer | null
  fleet?: FgKaraFleetSnapshot
}> {
  const r = await fetch(
    wmsFetchUrl(`/api/wms/warehouse/finished-goods/missions/${encodeURIComponent(id)}`),
    wmsFetchInit({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteCode: getSiteCode(),
        action,
        driverId: opts?.driverId ?? null,
        refuseReason: opts?.refuseReason ?? null,
        actualRowId: opts?.actualRowId ?? null,
      }),
    })
  )
  const data = (await r.json().catch(() => ({}))) as { error?: string }
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
  return data as { mission: FgKaraMission; currentStop: FgKaraStop | null; interleave?: FgInterleaveOffer | null }
}

export async function recommendFgKaraRoute(params?: {
  karaId?: string
  lineCode?: string
  itemCode?: string
  routeId?: string
}): Promise<{
  kara: FgKaraUnit | null
  route: FgKaraRoute | null
  itemCode: string | null
  itemName: string | null
  lineCode: string | null
  rows: Array<{ rowId: string; label: string; fillPercent: number; tagId: number | null; reason: string }>
  interleave?: FgInterleaveOffer | null
}> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  if (params?.karaId) qp.set("karaId", params.karaId)
  if (params?.lineCode) qp.set("lineCode", params.lineCode)
  if (params?.itemCode) qp.set("itemCode", params.itemCode)
  if (params?.routeId) qp.set("routeId", params.routeId)
  return getJson(`/api/wms/warehouse/finished-goods/recommend-route?${qp.toString()}`)
}

export async function setFgFleetVisibility(input: {
  hideAllRoutes?: boolean
  hideEditorRoute?: boolean
  hiddenRouteIds?: string[]
  routeId?: string
  hidden?: boolean
}): Promise<{ fleet: FgKaraFleetSnapshot }> {
  return postJson("/api/wms/warehouse/finished-goods/fleet/visibility", { siteCode: getSiteCode(), ...input })
}

export async function createFgLoadingPoint(input: {
  name: string
  lineCode?: string | null
  tagId?: number | null
}): Promise<{ point: FgLoadingPoint; fleet: FgKaraFleetSnapshot }> {
  return postJson("/api/wms/warehouse/finished-goods/loading-points", { siteCode: getSiteCode(), ...input })
}

export async function updateFgLoadingPoint(
  id: string,
  patch: Partial<FgLoadingPoint>
): Promise<{ point: FgLoadingPoint; fleet: FgKaraFleetSnapshot }> {
  const r = await fetch(
    wmsFetchUrl(`/api/wms/warehouse/finished-goods/loading-points/${encodeURIComponent(id)}`),
    wmsFetchInit({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteCode: getSiteCode(), ...patch }),
    })
  )
  const data = (await r.json().catch(() => ({}))) as { error?: string }
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
  return data as { point: FgLoadingPoint; fleet: FgKaraFleetSnapshot }
}

export async function deleteFgLoadingPoint(id: string): Promise<void> {
  await deleteJson(
    `/api/wms/warehouse/finished-goods/loading-points/${encodeURIComponent(id)}?siteCode=${encodeURIComponent(getSiteCode())}`
  )
}

export type FgAprilTagPlanRow = {
  id: string
  tagId: number
  label: string | null
  rows: string[]
}

export type FgAprilTagFamilyInfo = {
  id: "tag16h5" | "tag25h9" | "tag36h10" | "tag36h11"
  bits: number
  hamming: number
  dataSize: number
  tagCells: number
  maxId: number
  count: number
  warehouse: boolean
}

export type FgAprilTagCatalog = {
  family: FgAprilTagFamilyInfo["id"]
  maxId: number
  families: FgAprilTagFamilyInfo[]
  updatedAt: string
  planCount: number
  plan: FgAprilTagPlanRow[]
}

export async function getFgAprilTagCatalog(): Promise<FgAprilTagCatalog> {
  return getJson(`/api/wms/warehouse/finished-goods/apriltags?siteCode=${encodeURIComponent(getSiteCode())}`)
}

export function getFgAprilTagImageUrl(input: {
  id: number
  family?: FgAprilTagFamilyInfo["id"]
  sizeCm?: number
  dpi?: number
  quiet?: number
  preview?: boolean
  format?: "png" | "pdf"
}): string {
  const qp = new URLSearchParams({
    siteCode: getSiteCode(),
    id: String(input.id),
    family: input.family ?? "tag36h11",
    sizeCm: String(input.sizeCm ?? 80),
    dpi: String(input.dpi ?? 150),
    quiet: String(input.quiet ?? 1),
  })
  if (input.preview) qp.set("preview", "1")
  if (input.format === "pdf") qp.set("format", "pdf")
  return wmsFetchUrl(`/api/wms/warehouse/finished-goods/apriltags/image?${qp.toString()}`)
}

export function getFgAprilTagPackUrl(input: {
  family?: FgAprilTagFamilyInfo["id"]
  scope?: "plan" | "all"
  kind?: "zip" | "pdf" | "mosaic"
  ids?: number[]
  sizeCm?: number
  dpi?: number
  quiet?: number
}): string {
  const qp = new URLSearchParams({
    siteCode: getSiteCode(),
    family: input.family ?? "tag36h11",
    scope: input.scope ?? "plan",
    kind: input.kind ?? "zip",
    sizeCm: String(input.sizeCm ?? 80),
    dpi: String(input.dpi ?? 150),
    quiet: String(input.quiet ?? 1),
  })
  if (input.ids?.length) qp.set("ids", input.ids.join(","))
  return wmsFetchUrl(`/api/wms/warehouse/finished-goods/apriltags/pack?${qp.toString()}`)
}
