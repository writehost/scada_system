"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronRight,
  AlertCircle,
  Clock,
  CheckCircle2,
  User,
  ClipboardList,
  RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ImageActionTile, MOBILE_HOME_IMAGE_ACTIONS } from "@/components/wms/quick-actions"
import { getWmsMobileProfile, listDeviceTasks, type WmsTaskRow } from "@/lib/wms-api"
import {
  getTsdLastSyncIso,
  getTsdOfflineMockTasks,
  type TsdOfflineMockTask,
} from "@/lib/tsd-offline-store"
import { useMobileNav } from "@/app/mobile/mobile-nav-provider"

interface RecentTask {
  id: string
  title: string
  type: string
  status: "pending" | "in_progress" | "completed"
  time: string
  location: string
}

function classifyStatus(taskStatus: string, completedAt?: string | null): RecentTask["status"] {
  const c = (taskStatus || "").trim().toLowerCase().replace(/\s+/g, "_")
  if (completedAt || c === "completed" || c === "cancelled" || c === "failed") return "completed"
  if (c === "open") return "pending"
  return "in_progress"
}

function relativeTime(value?: string | null) {
  if (!value) return "—"
  const diff = Math.max(0, Date.now() - new Date(value).getTime())
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return "только что"
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  return new Date(value).toLocaleDateString("ru-RU")
}

const statusConfig = {
  pending: { label: "Ожидает", icon: Clock, color: "text-chart-3" },
  in_progress: { label: "В работе", icon: AlertCircle, color: "text-chart-2" },
  completed: { label: "Выполнено", icon: CheckCircle2, color: "text-success" },
}

export default function MobileDashboard() {
  const router = useRouter()
  const { visibility, loading: navLoading, serverUnreachable, refresh } = useMobileNav()
  const [rows, setRows] = useState<WmsTaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [operatorLabel, setOperatorLabel] = useState("Оператор")
  const [terminalId, setTerminalId] = useState("—")

  const [online, setOnline] = useState(true)

  useEffect(() => {
    const up = () => setOnline(typeof navigator !== "undefined" ? navigator.onLine : true)
    up()
    window.addEventListener("online", up)
    window.addEventListener("offline", up)
    return () => {
      window.removeEventListener("online", up)
      window.removeEventListener("offline", up)
    }
  }, [])

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const uidRaw = typeof window !== "undefined" ? localStorage.getItem("tsd_device_id")?.trim() : ""
      let uid = uidRaw || ""
      if (!uid && typeof window !== "undefined") {
        uid = `TSD-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
        localStorage.setItem("tsd_device_id", uid)
      }
      setTerminalId(uid || "—")

      if (!uid) {
        setRows([])
        setOperatorLabel("Оператор")
        setLoading(false)
        return
      }

      const synced = localStorage.getItem("tsd_synced") === "true"
      if (!synced) {
        setOperatorLabel("Оператор")
        setRows([])
        setLoading(false)
        return
      }

      const profile = await getWmsMobileProfile({ deviceUid: uid })
      setOperatorLabel(profile.operator?.displayName?.trim() || "Оператор")

      if (!visibility.tasks) {
        setRows([])
        return
      }

      const taskData = await listDeviceTasks({ deviceUid: uid, limit: 50 })
      setRows(taskData.tasks || [])
    } catch (e) {
      setRows([])
      setError(e instanceof Error ? e.message : "Не удалось загрузить данные")
    } finally {
      setLoading(false)
    }
  }, [visibility.tasks])

  useEffect(() => {
    if (navLoading) return
    void loadDashboard()
  }, [navLoading, loadDashboard])

  const tasksTotal = rows.length
  const urgentCount = rows.filter((t) => ["urgent", "high"].includes((t.priorityCode || "").toLowerCase())).length

  const showOfflineUi = serverUnreachable || !online

  const recentTasks: RecentTask[] = useMemo(() => {
    if (rows.length > 0) {
      const sorted = [...rows].sort((a, b) => {
        const da = new Date(a.claimedAt || a.startedAt || a.dueAt || 0).getTime()
        const db = new Date(b.claimedAt || b.startedAt || b.dueAt || 0).getTime()
        return db - da
      })
      return sorted.slice(0, 6).map((t) => ({
        id: t.taskId,
        title: t.taskCode || `Задание #${t.taskId}`,
        type: t.taskType,
        status: classifyStatus(t.taskStatus, t.completedAt ?? null),
        time: relativeTime(t.claimedAt || t.startedAt || t.dueAt),
        location: [t.sourceLocationCode, t.targetLocationCode].filter(Boolean).join(" → ") || "—",
      }))
    }
    const mocks = getTsdOfflineMockTasks()
    return mocks.slice(0, 6).map((m: TsdOfflineMockTask) => ({
      id: m.id,
      title: m.title,
      type: m.type,
      status: m.status,
      time: m.time,
      location: m.location,
    }))
  }, [rows])

  const lastSyncLabel = useMemo(() => {
    const iso = getTsdLastSyncIso()
    if (!iso) return "нет данных"
    try {
      return new Date(iso).toLocaleString("ru-RU")
    } catch {
      return iso
    }
  }, [rows.length, serverUnreachable, online])

  const showTaskPanel = visibility.tasks || showOfflineUi

  return (
    <div className="flex min-h-full flex-col p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
            <User className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold text-foreground">{operatorLabel}</h1>
            <p className="truncate text-xs text-muted-foreground">Терминал: {terminalId}</p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-10 w-10 shrink-0 rounded-xl"
          onClick={() => {
            refresh()
            void loadDashboard()
          }}
          disabled={loading}
          aria-label="Обновить"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </div>

      {showOfflineUi && (
        <div className="mb-4 rounded-2xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm text-foreground shadow-sm">
          <div className="mb-1 font-semibold text-amber-950">Офлайн-режим</div>
          <p className="mb-2 text-muted-foreground">
            {serverUnreachable
              ? "Сервер недоступен. Интерфейс и локальные примеры доступны; при появлении сети нажмите «Повторить синхронизацию»."
              : "Нет подключения к сети. Доступны локальные данные и сканирование."}
          </p>
          <p className="mb-3 text-xs text-muted-foreground">Последняя синхронизация: {lastSyncLabel}</p>
          <Button
            type="button"
            className="h-11 w-full rounded-xl bg-primary text-primary-foreground"
            onClick={() => {
              refresh()
              void loadDashboard()
            }}
            disabled={loading}
          >
            Повторить синхронизацию
          </Button>
        </div>
      )}

      {visibility.tasks && rows.length > 0 && (
        <div className="mb-4 rounded-2xl bg-primary p-4 text-primary-foreground">
          <div className="mb-1 text-xs font-medium opacity-80">Задач на сегодня</div>
          <div className="flex items-end justify-between gap-2">
            <div className="text-3xl font-bold tabular-nums">{loading ? "—" : tasksTotal}</div>
            <div className="text-right">
              <div className="text-xl font-bold tabular-nums">{loading ? "—" : urgentCount}</div>
              <div className="text-[10px] opacity-80">срочных</div>
            </div>
          </div>
        </div>
      )}

      {error && !serverUnreachable && (
        <div className="mb-4 rounded-2xl bg-card p-3 text-sm text-destructive shadow-sm">{error}</div>
      )}

      {!navLoading && !visibility.tasks && (
        <div className="mb-4 rounded-2xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          Задачи на этом терминале недоступны для вашей роли. Используйте сканирование и плитки ниже.
        </div>
      )}

      <div className="mb-2">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Операции</h2>
        <div className="grid grid-cols-2 gap-2">
          {MOBILE_HOME_IMAGE_ACTIONS.map((action) => (
            <ImageActionTile
              key={action.href}
              href={action.href}
              src={action.src}
              srLabel={action.srLabel}
              className="aspect-[4/5] rounded-2xl"
            />
          ))}
        </div>
      </div>

      {showTaskPanel && (
        <div className="mb-4">
          <Button
            type="button"
            variant="secondary"
            className="h-11 w-full rounded-xl text-sm font-medium"
            onClick={() => router.push("/mobile/tasks")}
            disabled={!visibility.tasks && showOfflineUi}
          >
            <ClipboardList className="mr-2 h-4 w-4" />
            Все задачи
          </Button>
        </div>
      )}

      {showTaskPanel && (
        <div className="mt-auto border-t border-border pt-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {rows.length > 0 ? "Последние задачи" : "Локальные примеры заданий"}
            </h2>
            <button
              type="button"
              className="text-xs font-medium text-muted-foreground disabled:opacity-40"
              disabled={!visibility.tasks}
              onClick={() => router.push("/mobile/tasks")}
            >
              Все <ChevronRight className="inline h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-2">
            {recentTasks.map((task) => {
              const status = statusConfig[task.status]
              return (
                <button
                  type="button"
                  key={task.id}
                  className="flex w-full items-center gap-3 rounded-2xl bg-card p-3 text-left shadow-sm transition-all active:scale-[0.99]"
                  onClick={() => {
                    if (task.id.startsWith("local-demo-")) return
                    router.push(`/mobile/tasks/${task.id}`)
                  }}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary">
                    <status.icon className={cn("h-4 w-4", status.color)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground">{task.title}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {task.location} • {task.time}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
