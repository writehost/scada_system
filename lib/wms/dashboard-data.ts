import { getSiteCode } from "@/lib/wms-api"

export type DashboardZoneRow = {
  warehouseCode: string
  zoneCode: string
  locationCount: number
  nonEmptyCount: number
  qty: number
}

export type DashboardOpsDay = {
  day: string
  receiving: number
  movement: number
  issue: number
  production: number
  other: number
  scans: number
}

export type DashboardLastOp = {
  documentId: string
  documentType: string
  documentStatus: string
  documentNo: string | null
  comment: string | null
  createdAt: string
  lineCount: number
}

export type DashboardSummary = {
  siteCode: string
  generatedAt: string
  days: number
  stock: {
    locationCount: number
    occupiedCount: number
    emptyCount: number
    skuCount: number
    totalQty: number
    zones: DashboardZoneRow[]
  }
  tasks: { open: number; inProgress: number; overdue: number; exceptions: number }
  operations: {
    series: DashboardOpsDay[]
    totals: { receiving: number; movement: number; issue: number; production: number; other: number }
    today: number
    week: number
  }
  scans: { today: number; week: number; total: number; lastAtIso: string | null }
  lastOps: DashboardLastOp[]
}

export type DashboardTsdSession = {
  documentId: string
  status: string
  lineCount: number | null
  updatedAtIso: string | null
  deviceUid: string | null
  itemName?: string | null
  itemCode?: string | null
  totalQty?: number | null
  scanCount?: number | null
  blockedCount?: number | null
  stockPosted?: boolean
  stockPartiallyPosted?: boolean
  stockDismissedEmpty?: boolean
  stockPendingLineCount?: number
}

export type DashboardReceiving = {
  sessions: DashboardTsdSession[]
  missingNomenclature: Array<{ id: string; code: string; note: string; createdAt: string }>
}

export type ReceivingKpi = {
  active: number
  closedUnposted: number
  pendingLines: number
  blockedScans: number
  missingNomenclature: number
}

async function readJson(res: Response) {
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error((json as { error?: string } | null)?.error || `HTTP ${res.status}`)
  }
  return json
}

export async function fetchDashboardSummary(days: number): Promise<DashboardSummary> {
  const qp = new URLSearchParams({ siteCode: getSiteCode(), days: String(days) })
  const res = await fetch(`/api/wms/dashboard/summary?${qp.toString()}`, { cache: "no-store" })
  return (await readJson(res)) as DashboardSummary
}

/**
 * Приёмка берётся из той же ленты, что и страница приёмки (с теми же параметрами),
 * поэтому цифры на дашборде и в списке сессий всегда совпадают, а ответ отдаётся из общего кэша.
 */
export async function fetchDashboardReceiving(): Promise<DashboardReceiving> {
  const qp = new URLSearchParams({ siteCode: getSiteCode(), limit: "200" })
  const res = await fetch(`/api/wms/receiving/operator-feed?${qp.toString()}`, { cache: "no-store" })
  const json = (await readJson(res)) as {
    tsdSessions?: DashboardTsdSession[]
    missingNomenclature?: Array<{ id: string; code: string; note: string; createdAt: string }>
  }
  return {
    sessions: json.tsdSessions ?? [],
    missingNomenclature: json.missingNomenclature ?? [],
  }
}

const STALE_SESSION_MS = 6 * 60 * 60 * 1000

/** Сессия открыта, но с неё давно ничего не приходило и сканов нет — это мусор, а не работа. */
export function isStaleSession(s: DashboardTsdSession): boolean {
  if ((s.status || "").toLowerCase() === "closed") return false
  if ((s.scanCount ?? 0) > 0) return false
  const ts = Date.parse(s.updatedAtIso || "")
  if (!Number.isFinite(ts)) return true
  return Date.now() - ts > STALE_SESSION_MS
}

export function isSessionActive(s: DashboardTsdSession): boolean {
  return (s.status || "").toLowerCase() !== "closed" && !isStaleSession(s)
}

/** Закрыта, что-то в ней есть, но на остаток не встало — самая дорогая ошибка на складе. */
export function isClosedUnposted(s: DashboardTsdSession): boolean {
  if ((s.status || "").toLowerCase() !== "closed") return false
  if (s.stockPosted || s.stockDismissedEmpty) return false
  return (s.stockPendingLineCount ?? 0) > 0 || (s.lineCount ?? 0) > 0
}

export function receivingKpi(data: DashboardReceiving | null): ReceivingKpi {
  const sessions = data?.sessions ?? []
  return {
    active: sessions.filter(isSessionActive).length,
    closedUnposted: sessions.filter(isClosedUnposted).length,
    pendingLines: sessions
      .filter(isClosedUnposted)
      .reduce((sum, s) => sum + (s.stockPendingLineCount ?? s.lineCount ?? 0), 0),
    blockedScans: sessions.reduce((sum, s) => sum + (s.blockedCount ?? 0), 0),
    missingNomenclature: data?.missingNomenclature.length ?? 0,
  }
}

const OP_LABELS: Record<string, string> = {
  receiving: "Приёмка",
  receipt: "Приёмка",
  transfer: "Перемещение",
  interwarehouse_transfer: "Межскладское перемещение",
  putaway: "Размещение",
  replenishment: "Подпитка",
  picking: "Сборка",
  issue: "Выдача",
  shipping: "Отгрузка",
  return: "Возврат",
  revision: "Ревизия",
  writeoff: "Списание",
  production_consumption: "Списание с линии",
  aggregation_block_doc: "Агрегация",
}

export function operationLabel(code: string | null | undefined): string {
  const key = (code || "").trim().toLowerCase()
  return OP_LABELS[key] ?? (key ? key.replace(/_/g, " ") : "Документ")
}

export type OperationKind = "receiving" | "movement" | "issue" | "production" | "other"

export function operationKind(code: string | null | undefined): OperationKind {
  const v = (code || "").toLowerCase()
  if (v.includes("receiv") || v.includes("receipt")) return "receiving"
  if (v.includes("issue") || v.includes("ship") || v.includes("pick")) return "issue"
  if (v.includes("transfer") || v.includes("putaway") || v.includes("replenish")) return "movement"
  if (v.includes("production")) return "production"
  return "other"
}

const STATUS_LABELS: Record<string, string> = {
  applied: "Проведён",
  draft: "Черновик",
  in_progress: "В работе",
  released: "В работе",
  cancelled: "Отменён",
  completed: "Завершён",
}

export function documentStatusLabel(code: string | null | undefined): string {
  const key = (code || "").trim().toLowerCase()
  return STATUS_LABELS[key] ?? (key || "—")
}

export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.round(n)) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return many
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}

export function fmtQty(value: number): string {
  if (!Number.isFinite(value)) return "0"
  const rounded = Math.round(value * 100) / 100
  return rounded.toLocaleString("ru-RU", { maximumFractionDigits: 2 })
}

/** Крупные остатки в плитке: 2 679 914 → 2,7 млн, иначе плитка расползается. */
export function fmtCompactQty(value: number): string {
  if (!Number.isFinite(value)) return "0"
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млн`
  if (abs >= 10_000) return `${Math.round(value / 1000).toLocaleString("ru-RU")} тыс`
  return fmtQty(value)
}

export function relativeTime(value?: string | null): string {
  if (!value) return "нет данных"
  const ts = Date.parse(value)
  if (!Number.isFinite(ts)) return "нет данных"
  const diff = Date.now() - ts
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return "только что"
  if (minutes < 60) return `${minutes} ${plural(minutes, "минуту", "минуты", "минут")} назад`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ${plural(hours, "час", "часа", "часов")} назад`
  const days = Math.round(hours / 24)
  if (days <= 30) return `${days} ${plural(days, "день", "дня", "дней")} назад`
  return new Date(ts).toLocaleDateString("ru-RU")
}

export function fmtDayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00`)
  if (Number.isNaN(d.getTime())) return day
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })
}
