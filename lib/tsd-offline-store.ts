/**
 * Локальные данные ТСД для MVP офлайн-режима (localStorage).
 * Не заменяет полноценную синхронизацию — только чтобы UI не был пустым без сети.
 */

const PREFIX = "tsd_offline_"

const KEYS = {
  lastSyncAt: `${PREFIX}last_sync_at`,
  mockTasks: `${PREFIX}mock_tasks_json`,
  scanHistory: `${PREFIX}scan_history_json`,
} as const

export type TsdOfflineMockTask = {
  id: string
  title: string
  type: string
  status: "pending" | "in_progress" | "completed"
  time: string
  location: string
}

const DEFAULT_MOCK: TsdOfflineMockTask[] = [
  {
    id: "local-demo-1",
    title: "Демо: приёмка (локально)",
    type: "receiving",
    status: "pending",
    time: "локальные данные",
    location: "A-01-01",
  },
  {
    id: "local-demo-2",
    title: "Демо: перемещение (локально)",
    type: "movement",
    status: "in_progress",
    time: "локальные данные",
    location: "B-02 → C-03",
  },
]

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function getTsdLastSyncIso(): string | null {
  if (typeof window === "undefined") return null
  try {
    return localStorage.getItem(KEYS.lastSyncAt) || localStorage.getItem("tsd_last_sync_at")
  } catch {
    return null
  }
}

export function setTsdLastSyncNow() {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(KEYS.lastSyncAt, new Date().toISOString())
  } catch {
    /* ignore */
  }
}

export function getTsdOfflineMockTasks(): TsdOfflineMockTask[] {
  if (typeof window === "undefined") return DEFAULT_MOCK
  const merged = safeParse<TsdOfflineMockTask[]>(localStorage.getItem(KEYS.mockTasks), [])
  return merged.length ? merged : DEFAULT_MOCK
}

export function setTsdOfflineMockTasks(tasks: TsdOfflineMockTask[]) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(KEYS.mockTasks, JSON.stringify(tasks))
  } catch {
    /* ignore */
  }
}

export type TsdScanHistoryEntry = { code: string; at: string }

export function appendTsdScanHistory(code: string, max = 50) {
  if (typeof window === "undefined" || !code.trim()) return
  const entry: TsdScanHistoryEntry = { code: code.trim(), at: new Date().toISOString() }
  const prev = safeParse<TsdScanHistoryEntry[]>(localStorage.getItem(KEYS.scanHistory), [])
  const next = [entry, ...prev.filter((e) => e.code !== entry.code)].slice(0, max)
  try {
    localStorage.setItem(KEYS.scanHistory, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

export function getTsdScanHistory(): TsdScanHistoryEntry[] {
  if (typeof window === "undefined") return []
  return safeParse<TsdScanHistoryEntry[]>(localStorage.getItem(KEYS.scanHistory), [])
}
