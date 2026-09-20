import { authRequestHeaders } from "@/lib/auth/client-token"
import type { HealthFinding, HealthQuery, HealthSummary } from "@/lib/wms/db-health"

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    headers: authRequestHeaders(),
  })
  const data = (await r.json().catch(() => ({}))) as { error?: string }
  if (!r.ok) {
    const err = new Error(data.error || `HTTP ${r.status}`) as Error & { status: number }
    err.status = r.status
    throw err
  }
  return data as T
}

export function fetchDbHealthSummary() {
  return getJson<HealthSummary>("/api/wms/db-health/summary")
}

export function fetchDbHealthQueries() {
  return getJson<{ queries: HealthQuery[] }>("/api/wms/db-health/queries")
}

export function fetchDbHealthTables() {
  return getJson<{ tables: HealthSummary["largestTables"] }>("/api/wms/db-health/tables")
}

export function fetchDbHealthIndexes() {
  return getJson<{
    indexes: Array<{
      name: string
      table: string
      sizeBytes: number
      scans: number
      unusedCandidate: boolean
      definition: string
    }>
  }>("/api/wms/db-health/indexes")
}

export function fetchDbHealthRecommendations() {
  return getJson<{ recommendations: HealthFinding[]; readOnly: true }>("/api/wms/db-health/recommendations")
}

export type HistoryPoint = { ts: string; value: number | null }
export type HistoryPayload = {
  count: number
  snapshots: Array<{
    timestamp: string
    databaseName: string
    databaseSize: number
    cacheHitRatio: number | null
    connections: number
    longTransactions: number
    locks: number
  }>
  compareFrom?: string | null
  compareTo?: string | null
  series: {
    databaseSize: HistoryPoint[]
    tableBytes: HistoryPoint[]
    cacheHit: HistoryPoint[]
    connections: HistoryPoint[]
    deadTuples: HistoryPoint[]
    seqScan: HistoryPoint[]
    rows: HistoryPoint[]
    indexBytes: HistoryPoint[]
    queryMean: HistoryPoint[]
  }
  topGrowingTables: Array<{ name: string; before: number; after: number; delta: number }>
  topGrowingRows: Array<{ name: string; before: number; after: number; delta: number }>
  topGrowingIndexes: Array<{ name: string; before: number; after: number; delta: number }>
  warnings: Array<{ severity: string; kind: string; objectName: string; detail: string }>
}

export function fetchDbHealthHistory(from?: string, to?: string) {
  const q = new URLSearchParams()
  if (from) q.set("from", from)
  if (to) q.set("to", to)
  const suffix = q.toString() ? `?${q.toString()}` : ""
  return getJson<HistoryPayload>(`/api/wms/db-health/history${suffix}`)
}
