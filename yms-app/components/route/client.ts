"use client"

/**
 * Клиент API Route для экранов водителя, диспетчера и редактора.
 * Каждая команда несёт clientRequestId: повтор после обрыва связи идёт с тем же ID,
 * и сервер не выполнит действие дважды.
 */

export const SITE_CODE = (typeof window !== "undefined" && (window as unknown as { __ROUTE_SITE__?: string }).__ROUTE_SITE__) || "skeet"

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null,
    public readonly details: unknown = null
  ) {
    super(message)
  }
  get offline() {
    return this.status === 0
  }
}

export function newRequestId(): string {
  const c = typeof crypto !== "undefined" ? crypto : null
  if (c && "randomUUID" in c) return `r-${c.randomUUID()}`
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export async function api<T = unknown>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
  const url = `${path}${path.includes("?") ? "&" : "?"}siteCode=${encodeURIComponent(SITE_CODE)}`
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify({ ...body, siteCode: SITE_CODE }) : undefined,
      cache: "no-store",
      credentials: "same-origin",
    })
  } catch {
    throw new ApiError("Нет соединения с сервером", 0, "offline")
  }
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`
  }
  const text = await res.text()
  let data: Record<string, unknown> = {}
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    data = { error: text.slice(0, 200) }
  }
  if (!res.ok) {
    throw new ApiError(String(data.error || `Ошибка ${res.status}`), res.status, (data.code as string) || null, data.details ?? null)
  }
  return data as T
}

/** Лёгкий кэш последних подтверждённых сервером данных (для просмотра без сети). */
export const cache = {
  get<T>(key: string): T | null {
    try {
      const raw = window.localStorage.getItem(`route:${SITE_CODE}:${key}`)
      return raw ? (JSON.parse(raw) as T) : null
    } catch {
      return null
    }
  },
  set(key: string, value: unknown) {
    try {
      window.localStorage.setItem(`route:${SITE_CODE}:${key}`, JSON.stringify(value))
    } catch {
      /* хранилище недоступно — работаем без кэша */
    }
  },
}

export type RouteEventMessage = { topic: string; data: Record<string, unknown> }

/** Подписка на SSE с переподключением и дочиткой по Last-Event-ID (браузер делает сам). */
export function subscribe(onEvent: (e: RouteEventMessage) => void, onStatus: (online: boolean) => void): () => void {
  let es: EventSource | null = null
  let closed = false
  const topics = [
    "task.assigned",
    "task.updated",
    "task.cancelled",
    "forklift.position.updated",
    "forklift.localization.lost",
    "route.blocked",
    "route.unblocked",
    "route.recalculated",
    "pallet.scan.accepted",
    "pallet.scan.rejected",
    "address.scan.accepted",
    "address.scan.rejected",
    "wms.movement.confirmed",
    "wms.movement.rejected",
    "map.published",
    "exception.created",
    "exception.resolved",
    "session.started",
    "session.ended",
  ]
  const open = () => {
    if (closed) return
    es = new EventSource(`/api/route/events?siteCode=${encodeURIComponent(SITE_CODE)}`)
    es.onopen = () => onStatus(true)
    es.onerror = () => onStatus(false)
    for (const t of topics) {
      es.addEventListener(t, (ev) => {
        try {
          onEvent({ topic: t, data: JSON.parse((ev as MessageEvent).data) })
        } catch {
          /* битое событие пропускаем */
        }
      })
    }
  }
  open()
  return () => {
    closed = true
    es?.close()
  }
}

/** Сканер в режиме клавиатуры: быстрые символы + Enter. Ручной набор (медленный) игнорируется. */
export function listenKeyboardScanner(onCode: (code: string) => void): () => void {
  let buf = ""
  let last = 0
  const handler = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return
    const now = performance.now()
    if (now - last > 80) buf = ""
    last = now
    if (e.key === "Enter") {
      if (buf.length >= 4) onCode(buf)
      buf = ""
      return
    }
    if (e.key.length === 1) buf += e.key
    else if (e.key === "Unidentified" || e.key === "F8") buf += "\u001d"
  }
  window.addEventListener("keydown", handler)
  return () => window.removeEventListener("keydown", handler)
}

export function fmtMeters(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return "—"
  return m >= 1000 ? `${(m / 1000).toFixed(1)} км` : `${Math.round(m)} м`
}

export function fmtEta(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return "—"
  if (s < 60) return `${Math.max(1, Math.round(s))} с`
  return `${Math.round(s / 60)} мин`
}
