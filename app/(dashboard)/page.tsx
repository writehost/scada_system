"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  Boxes,
  ClipboardList,
  PackageCheck,
  RefreshCw,
  ScanLine,
  Truck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { DashboardKpiTile } from "@/components/wms/dashboard-kpi-tile"
import { DashboardActionInbox } from "@/components/wms/dashboard-action-inbox"
import { DashboardActivityChart } from "@/components/wms/dashboard-activity-chart"
import { DashboardOccupancyPanel } from "@/components/wms/dashboard-occupancy-panel"
import { DashboardQuickActions } from "@/components/wms/dashboard-quick-actions"
import { DashboardRecentOperations } from "@/components/wms/dashboard-recent-operations"
import { TaskList, type Task } from "@/components/wms/task-list"
import { getSiteCode, listExpiryStickerAlerts, listTasks, type WmsTaskRow } from "@/lib/wms-api"
import {
  fetchDashboardReceiving,
  fetchDashboardSummary,
  fmtCompactQty,
  plural,
  receivingKpi,
  relativeTime,
  type DashboardReceiving,
  type DashboardSummary,
} from "@/lib/wms/dashboard-data"
import { buildDashboardInbox } from "@/lib/wms/dashboard-inbox"
import { mapWmsError } from "@/lib/wms-error-messages"
import { warehouseDisplayName } from "@/lib/wms-labels"
import { cn } from "@/lib/utils"

const DAYS_STORAGE_KEY = "wms:dashboard:days"
const REFRESH_MS = 60_000

function toTaskPriority(priority?: string | null): Task["priority"] {
  const value = (priority || "").toLowerCase()
  if (value === "urgent" || value === "high") return "high"
  if (value === "normal" || value === "medium") return "medium"
  return "low"
}

function taskCategory(taskType: string): Task["category"] {
  const v = (taskType || "").toLowerCase()
  if (v.includes("receiv") || v.includes("putaway")) return "receiving"
  if (v.includes("pick") || v.includes("ship") || v.includes("issue")) return "shipping"
  if (v.includes("return")) return "return"
  if (v.includes("replenish") || v.includes("подпит")) return "replenishment"
  if (v.includes("transfer") || v.includes("move")) return "moving"
  return "other"
}

function taskTypeLabel(taskType: string): string {
  const v = (taskType || "").toLowerCase()
  if (v.includes("receiv") || v.includes("receipt")) return "Приёмка"
  if (v.includes("issue") || v.includes("ship")) return "Выдача"
  if (v.includes("return")) return "Возврат"
  if (v.includes("revision") || v.includes("count")) return "Ревизия"
  if (v.includes("replenish")) return "Подпитка"
  return "Перемещение"
}

function isActiveTask(task: WmsTaskRow): boolean {
  const status = (task.taskStatus || "").toLowerCase()
  return !["completed", "complete", "done", "cancelled", "canceled", "closed"].some((d) =>
    status.includes(d)
  )
}

function mapTask(task: WmsTaskRow): Task {
  return {
    id: task.taskId,
    type: taskTypeLabel(task.taskType),
    category: taskCategory(task.taskType),
    workStatus: task.startedAt ? "in_progress" : "pending",
    priority: toTaskPriority(task.priorityCode),
    title: `${task.taskCode}: ${task.itemName || task.itemCode || task.documentNo || task.taskCode}`,
    from:
      warehouseDisplayName(task.sourceWarehouseCode, task.sourceWarehouseName) ||
      task.sourceLocationCode ||
      "Источник не задан",
    to:
      warehouseDisplayName(task.targetWarehouseCode, task.targetWarehouseName) ||
      task.targetLocationCode ||
      "Назначение не задано",
    assignee: task.assignedUser || task.assignedDevice || undefined,
    estimatedTime: task.dueAt
      ? `до ${new Date(task.dueAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
      : "без срока",
    dueAtIso: task.dueAt ?? null,
  }
}

export default function DashboardPage() {
  const [days, setDays] = useState(14)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [receiving, setReceiving] = useState<DashboardReceiving | null>(null)
  const [expiryAlerts, setExpiryAlerts] = useState<Array<Record<string, unknown>>>([])
  const [tasks, setTasks] = useState<WmsTaskRow[]>([])
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [receivingLoading, setReceivingLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const requestId = useRef(0)

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(DAYS_STORAGE_KEY))
    if ([7, 14, 30].includes(stored)) setDays(stored)
  }, [])

  const changeDays = useCallback((next: number) => {
    setDays(next)
    window.localStorage.setItem(DAYS_STORAGE_KEY, String(next))
  }, [])

  /**
   * Сводка приходит за ~0,2 с и рисует страницу, приёмка догружается следом.
   * Считается только последний запрос: при быстром переключении периода ответы
   * приходят вперемешку, и без этого график оставался бы от предыдущего периода.
   */
  const load = useCallback(async (period: number) => {
    const id = requestId.current + 1
    requestId.current = id
    const current = () => requestId.current === id
    setRefreshing(true)
    setError(null)

    const summaryTask = fetchDashboardSummary(period)
      .then((data) => {
        if (!current()) return
        setSummary(data)
        setRefreshedAt(data.generatedAt)
      })
      .catch((e) => {
        if (current()) setError(mapWmsError(e))
      })
      .finally(() => {
        if (current()) setSummaryLoading(false)
      })

    const receivingTask = fetchDashboardReceiving()
      .then((data) => {
        if (current()) setReceiving(data)
      })
      .catch(() => undefined)
      .finally(() => {
        if (current()) setReceivingLoading(false)
      })

    const extrasTask = Promise.allSettled([
      listExpiryStickerAlerts(),
      listTasks({ limit: 50 }),
    ]).then(([alertsRes, tasksRes]) => {
      if (!current()) return
      if (alertsRes.status === "fulfilled") {
        setExpiryAlerts((alertsRes.value.alerts ?? []) as Array<Record<string, unknown>>)
      }
      if (tasksRes.status === "fulfilled") setTasks(tasksRes.value.tasks ?? [])
    })

    await Promise.allSettled([summaryTask, receivingTask, extrasTask])
    if (current()) setRefreshing(false)
  }, [])

  useEffect(() => {
    void load(days)
  }, [days, load])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden) return
      void load(days)
    }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [days, load])

  const kpi = useMemo(() => receivingKpi(receiving), [receiving])
  const inbox = useMemo(
    () => buildDashboardInbox({ summary, receiving, expiryAlerts }),
    [summary, receiving, expiryAlerts]
  )
  const activeTasks = useMemo(() => tasks.filter(isActiveTask).map(mapTask), [tasks])

  const stock = summary?.stock
  const fillPct =
    stock && stock.locationCount > 0 ? Math.round((stock.occupiedCount / stock.locationCount) * 100) : 0
  const criticalCount = inbox.filter((i) => i.severity === "critical").length

  return (
    <div className="space-y-3">
      <header className="wms-panel rounded-2xl px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="text-sm font-semibold tracking-tight text-foreground">Дашборд склада</h1>
          <span className="truncate text-xs text-muted-foreground">Площадка {getSiteCode()}</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {summaryLoading && !summary ? "загрузка…" : `обновлено ${relativeTime(refreshedAt)}`}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={() => void load(days)}
              disabled={refreshing}
              aria-label="Обновить данные"
              title="Обновить данные"
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </Button>
          </div>
        </div>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Данные WMS недоступны</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <DashboardKpiTile
          label="Приёмка"
          value={kpi.active}
          suffix={plural(kpi.active, "сессия", "сессии", "сессий")}
          hint="Открытые сессии ТСД"
          alert={kpi.closedUnposted > 0 ? `${kpi.closedUnposted} закрыто без проведения` : null}
          icon={Truck}
          href="/receiving"
          tone={kpi.closedUnposted > 0 ? "danger" : "primary"}
          loading={receivingLoading && !receiving}
        />
        <DashboardKpiTile
          label="Сканы сегодня"
          value={summary ? summary.scans.today.toLocaleString("ru-RU") : null}
          hint={
            summary
              ? `за 7 дней ${summary.scans.week.toLocaleString("ru-RU")} · последний скан ${relativeTime(summary.scans.lastAtIso)}`
              : null
          }
          icon={ScanLine}
          href="/receiving"
          tone="neutral"
          loading={summaryLoading && !summary}
        />
        <DashboardKpiTile
          label="Задания"
          value={summary?.tasks.open ?? null}
          suffix="в очереди"
          hint={
            summary
              ? summary.tasks.inProgress > 0
                ? `${summary.tasks.inProgress} в работе`
                : "никто не взял в работу"
              : null
          }
          alert={summary && summary.tasks.overdue > 0 ? `${summary.tasks.overdue} просрочено` : null}
          icon={ClipboardList}
          href="/tasks"
          tone={summary && summary.tasks.overdue > 0 ? "warning" : "neutral"}
          loading={summaryLoading && !summary}
        />
        <DashboardKpiTile
          label="Операции"
          value={summary?.operations.week ?? null}
          suffix="за 7 дней"
          hint={
            summary
              ? `сегодня ${summary.operations.today} · приёмка ${summary.operations.totals.receiving} · перемещения ${summary.operations.totals.movement}`
              : null
          }
          icon={PackageCheck}
          href="/documents"
          tone="neutral"
          loading={summaryLoading && !summary}
        />
        <DashboardKpiTile
          label="Склад"
          value={stock ? `${fillPct}%` : null}
          hint={
            stock
              ? `занято ${stock.occupiedCount} из ${stock.locationCount} ячеек · ${fmtCompactQty(stock.totalQty)} ед.`
              : null
          }
          icon={Boxes}
          href="/occupancy"
          tone="neutral"
          loading={summaryLoading && !summary}
        />
        <DashboardKpiTile
          label="Требует действий"
          value={inbox.length}
          hint={
            inbox.length === 0
              ? "Открытых вопросов нет"
              : `${criticalCount} ${plural(criticalCount, "срочная задача", "срочные задачи", "срочных задач")}`
          }
          icon={AlertTriangle}
          href="/attention"
          tone={criticalCount > 0 ? "danger" : inbox.length > 0 ? "warning" : "success"}
          loading={(summaryLoading || receivingLoading) && !summary}
        />
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          <DashboardActionInbox items={inbox} loading={receivingLoading && !receiving} />
          <DashboardActivityChart
            series={summary?.operations.series ?? []}
            days={days}
            onDaysChange={changeDays}
            loading={summaryLoading && !summary}
          />
          <TaskList tasks={activeTasks} onAfterClaim={() => void load(days)} />
        </div>

        <div className="min-w-0 space-y-3">
          <DashboardQuickActions />
          <DashboardOccupancyPanel
            zones={stock?.zones ?? []}
            occupiedCount={stock?.occupiedCount ?? 0}
            locationCount={stock?.locationCount ?? 0}
            skuCount={stock?.skuCount ?? 0}
            totalQty={stock?.totalQty ?? 0}
            loading={summaryLoading && !summary}
          />
          <DashboardRecentOperations
            operations={summary?.lastOps ?? []}
            loading={summaryLoading && !summary}
          />
        </div>
      </div>
    </div>
  )
}
