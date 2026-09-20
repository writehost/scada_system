"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Camera, Headphones, Loader2, MonitorSmartphone, RefreshCw, StopCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  endDeviceSupport,
  getDeviceSupportStatus,
  requestDeviceSupport,
  requestDeviceSupportScreenshot,
  type WmsSupportEvent,
  type WmsSupportSession,
} from "@/lib/wms-api"
import { cn } from "@/lib/utils"

function statusLabel(status: WmsSupportSession["status"]): string {
  if (status === "pending") return "Ожидание оператора"
  if (status === "active") return "Активна"
  if (status === "declined") return "Отклонена"
  if (status === "expired") return "Истекла"
  return "Завершена"
}

function statusVariant(status: WmsSupportSession["status"]): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active") return "default"
  if (status === "pending") return "secondary"
  if (status === "declined" || status === "expired") return "destructive"
  return "outline"
}

function eventLevelClass(level: string): string {
  if (level === "error") return "text-destructive"
  if (level === "warn") return "text-amber-700 dark:text-amber-300"
  return "text-muted-foreground"
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  } catch {
    return iso
  }
}

type Props = {
  deviceUid: string
  enabled?: boolean
}

export function DeviceSupportPanel({ deviceUid, enabled = true }: Props) {
  const [session, setSession] = useState<WmsSupportSession | null>(null)
  const [events, setEvents] = useState<WmsSupportEvent[]>([])
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    if (!enabled || !deviceUid.trim()) return
    setLoading(true)
    setError(null)
    try {
      const data = await getDeviceSupportStatus({
        deviceUid,
        sessionId: sessionIdRef.current ?? undefined,
      })
      setSession(data.session)
      setEvents(data.events ?? [])
      if (data.session?.sessionId) sessionIdRef.current = data.session.sessionId
      if (data.screenshotBase64) {
        setScreenshot(`data:image/jpeg;base64,${data.screenshotBase64}`)
      } else if (!data.session?.hasScreenshot) {
        setScreenshot(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить режим поддержки")
    } finally {
      setLoading(false)
    }
  }, [deviceUid, enabled])

  useEffect(() => {
    sessionIdRef.current = null
    setSession(null)
    setEvents([])
    setScreenshot(null)
    void refresh()
  }, [deviceUid, refresh])

  useEffect(() => {
    if (!enabled || !session || !["pending", "active"].includes(session.status)) return
    const t = window.setInterval(() => void refresh(), session.status === "pending" ? 2500 : 3500)
    return () => window.clearInterval(t)
  }, [enabled, session, refresh])

  async function startSupport() {
    setActionLoading(true)
    setError(null)
    try {
      const data = await requestDeviceSupport({ deviceUid })
      sessionIdRef.current = data.session.sessionId
      setSession(data.session)
      void refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось запросить поддержку")
    } finally {
      setActionLoading(false)
    }
  }

  async function stopSupport() {
    if (!session) return
    setActionLoading(true)
    setError(null)
    try {
      await endDeviceSupport({
        deviceUid,
        sessionId: session.sessionId,
        reason: "Завершено администратором",
      })
      sessionIdRef.current = null
      setSession(null)
      setScreenshot(null)
      setEvents([])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось завершить сессию")
    } finally {
      setActionLoading(false)
    }
  }

  async function askScreenshot() {
    if (!session) return
    setActionLoading(true)
    setError(null)
    try {
      await requestDeviceSupportScreenshot({ deviceUid, sessionId: session.sessionId })
      void refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось запросить снимок")
    } finally {
      setActionLoading(false)
    }
  }

  const live = session && (session.status === "pending" || session.status === "active")

  return (
    <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <Headphones className="h-4 w-4 text-violet-700" />
          Режим поддержки
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {session ? (
            <Badge variant={statusVariant(session.status)} className="rounded-md">
              {statusLabel(session.status)}
            </Badge>
          ) : null}
          <Button type="button" variant="outline" size="sm" className="rounded-xl" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
            Обновить
          </Button>
        </div>
      </div>

      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        Запросите сессию — на ТСД оператор увидит диалог «Разрешить поддержку». После согласия видны экран, ошибки API и
        снимок по кнопке.
      </p>

      {error ? <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{error}</div> : null}

      <div className="mb-4 flex flex-wrap gap-2">
        {!live ? (
          <Button type="button" className="rounded-xl" disabled={actionLoading} onClick={() => void startSupport()}>
            {actionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MonitorSmartphone className="mr-2 h-4 w-4" />}
            Запросить поддержку
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              disabled={actionLoading || session?.status !== "active"}
              onClick={() => void askScreenshot()}
            >
              <Camera className="mr-2 h-4 w-4" />
              Снимок экрана
            </Button>
            <Button type="button" variant="destructive" className="rounded-xl" disabled={actionLoading} onClick={() => void stopSupport()}>
              <StopCircle className="mr-2 h-4 w-4" />
              Завершить
            </Button>
          </>
        )}
      </div>

      {session?.status === "active" ? (
        <div className="mb-3 grid gap-2 text-xs sm:grid-cols-2">
          <div className="rounded-lg border border-border/70 bg-background/60 p-2.5">
            <div className="text-muted-foreground">Текущий экран</div>
            <div className="mt-1 font-medium text-foreground">{session.currentScreen || "—"}</div>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/60 p-2.5">
            <div className="text-muted-foreground">Последний сигнал</div>
            <div className="mt-1 font-medium text-foreground">
              {session.lastHeartbeatAt ? new Date(session.lastHeartbeatAt).toLocaleString("ru-RU") : "—"}
            </div>
          </div>
        </div>
      ) : null}

      {session?.status === "pending" ? (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-100">
          Ожидаем ответ оператора на ТСД… Попросите его нажать «Разрешить» в диалоге поддержки.
        </div>
      ) : null}

      {screenshot ? (
        <div className="mb-3 overflow-hidden rounded-xl border border-border bg-black/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={screenshot} alt="Снимок экрана ТСД" className="max-h-[360px] w-full object-contain" />
        </div>
      ) : null}

      <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-background/50">
        {events.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground">Событий пока нет</div>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((ev) => (
              <li key={ev.eventId} className="px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="tabular-nums text-muted-foreground">{fmtTime(ev.createdAt)}</span>
                  <span className={cn("min-w-0 flex-1", eventLevelClass(ev.level))}>{ev.message}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
