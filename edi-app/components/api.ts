"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export class ApiError extends Error {
  status: number
  code: string
  details?: unknown
  constructor(status: number, message: string, code: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export async function api<T = any>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {}
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  })
  if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth/login")) {
    window.location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`
    throw new ApiError(401, "Нужен вход", "auth_required")
  }
  const ct = res.headers.get("content-type") || ""
  const data = ct.includes("application/json") ? await res.json().catch(() => ({})) : null
  if (!res.ok) throw new ApiError(res.status, data?.error || `Ошибка ${res.status}`, data?.code || "error", data?.details)
  return (data ?? res) as T
}

export function useApi<T = any>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(Boolean(url))
  const seq = useRef(0)
  const load = useCallback(async () => {
    if (!url) return
    const my = ++seq.current
    setLoading(true)
    try {
      const d = await api<T>(url)
      if (my === seq.current) {
        setData(d)
        setError(null)
      }
    } catch (e) {
      if (my === seq.current) setError(e as ApiError)
    } finally {
      if (my === seq.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps])
  useEffect(() => {
    void load()
  }, [load])
  return { data, error, loading, reload: load, setData }
}

/** Живые обновления: SSE /api/edi/events, с переподключением. */
export function useLiveEvents(onEvent: (e: { kind: string; documentId: string | null }) => void) {
  const ref = useRef(onEvent)
  ref.current = onEvent
  useEffect(() => {
    let es: EventSource | null = null
    let closed = false
    let retry: ReturnType<typeof setTimeout> | null = null
    const open = () => {
      es = new EventSource("/api/edi/events")
      es.onmessage = (m) => {
        try {
          const e = JSON.parse(m.data)
          if (e.kind !== "hello") ref.current(e)
        } catch {
          /* пропускаем */
        }
      }
      es.onerror = () => {
        es?.close()
        if (!closed) retry = setTimeout(open, 5000)
      }
    }
    open()
    return () => {
      closed = true
      es?.close()
      if (retry) clearTimeout(retry)
    }
  }, [])
}

export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, enabled = true) {
  const ref = useRef(map)
  ref.current = map
  useEffect(() => {
    if (!enabled) return
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
      const key = [e.ctrlKey || e.metaKey ? "mod+" : "", e.shiftKey && e.key.length > 1 ? "shift+" : "", e.key].join("")
      const fn = ref.current[key] ?? (!typing ? ref.current[e.key] : undefined)
      if (!fn) return
      if (typing && !key.startsWith("mod+") && e.key !== "Escape") return
      e.preventDefault()
      fn(e)
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [enabled])
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return "—"
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("ru-RU")
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "—"
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })
}

export function fmtMoney(v: number | string | null | undefined, currency = "RUB"): string {
  const n = typeof v === "string" ? Number(v) : v
  if (n == null || !Number.isFinite(n)) return "—"
  const s = n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency === "RUB" ? `${s} ₽` : `${s} ${currency}`
}

export function fmtQty(v: number | null | undefined): string {
  if (v == null) return "—"
  return v.toLocaleString("ru-RU", { maximumFractionDigits: 3 })
}

export function relTime(v: string | null | undefined): string {
  if (!v) return ""
  const diff = Date.now() - new Date(v).getTime()
  const m = Math.round(diff / 60000)
  if (Math.abs(m) < 1) return "только что"
  if (m < 0) {
    const h = Math.round(-m / 60)
    return h < 24 ? `через ${h} ч` : `через ${Math.round(h / 24)} дн`
  }
  if (m < 60) return `${m} мин назад`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} ч назад`
  return fmtDate(v)
}
