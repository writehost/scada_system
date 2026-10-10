"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export class ApiError extends Error {
  status: number
  code: string
  details: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
    signal: init.signal,
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/")) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; code?: string; details?: unknown }
    throw new ApiError(res.status, d.code ?? "error", d.error ?? `Ошибка ${res.status}`, d.details)
  }
  return data as T
}

export type Loadable<T> = { data: T | null; error: ApiError | null; loading: boolean; reload: () => void; setData: (d: T) => void }

/** Загрузка данных с отменой устаревших запросов. null в path — не загружать. */
export function useApi<T>(path: string | null): Loadable<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(Boolean(path))
  const [tick, setTick] = useState(0)
  const ctrl = useRef<AbortController | null>(null)
  useEffect(() => {
    if (!path) {
      setLoading(false)
      return
    }
    ctrl.current?.abort()
    const c = new AbortController()
    ctrl.current = c
    setLoading(true)
    api<T>(path, { signal: c.signal })
      .then((d) => {
        if (!c.signal.aborted) {
          setData(d)
          setError(null)
        }
      })
      .catch((e: unknown) => {
        if (c.signal.aborted) return
        setError(e instanceof ApiError ? e : new ApiError(0, "network", "Нет связи с сервером"))
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false)
      })
    return () => c.abort()
  }, [path, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload, setData }
}

export function qs(params: Record<string, string | number | null | undefined | false>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== false && v !== "") p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ""
}
