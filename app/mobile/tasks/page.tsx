"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Truck,
  Package,
  ScanBarcode,
  ArrowRightLeft,
  Filter,
  ChevronRight,
  Clock,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Hand,
  Play,
  Flag,
  ClipboardCheck,
  Pause,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  claimWmsTaskByDevice,
  listDeviceTasks,
  reportWmsTaskExceptionByDevice,
  type WmsTaskRow,
} from "@/lib/wms-api"
import { useMobileNav } from "@/app/mobile/mobile-nav-provider"

type TaskType = "all" | "receiving" | "loading" | "picking" | "movement" | "revision"

function classifyTaskType(taskType: string): TaskType {
  const value = (taskType || "").toLowerCase()
  if (value.includes("receipt") || value.includes("receiv")) return "receiving"
  if (value.includes("revision")) return "revision"
  if (value.includes("pick") || value.includes("issue")) return "picking"
  if (value.includes("ship") || value.includes("load")) return "loading"
  if (value.includes("transfer") || value.includes("move") || value.includes("putaway")) return "movement"
  return "movement"
}

/** Код статуса из API (`ref_wms_task_status.code`), нижний регистр */
function normalizeTaskStatusCode(raw: string): string {
  return (raw || "").trim().toLowerCase().replace(/\s+/g, "_")
}

function isTerminalTaskStatus(code: string, completedAt?: string | null): boolean {
  const c = normalizeTaskStatusCode(code)
  return Boolean(completedAt) || ["completed", "cancelled", "failed"].includes(c)
}

/** Подпись и иконка по коду статуса */
function taskStatusMeta(taskStatus: string, completedAt?: string | null) {
  const c = normalizeTaskStatusCode(taskStatus)
  if (completedAt || c === "completed") {
    return { label: "Выполнено", Icon: CheckCircle2, color: "text-success" as const }
  }
  if (c === "cancelled") {
    return { label: "Отменено", Icon: CheckCircle2, color: "text-muted-foreground" as const }
  }
  if (c === "failed") {
    return { label: "Ошибка", Icon: AlertTriangle, color: "text-destructive" as const }
  }
  if (c === "open") {
    return { label: "В очереди", Icon: Clock, color: "text-muted-foreground" as const }
  }
  if (c === "claimed") {
    return { label: "Назначено", Icon: Hand, color: "text-chart-3" as const }
  }
  if (c === "in_progress") {
    return { label: "В работе", Icon: AlertTriangle, color: "text-chart-3" as const }
  }
  if (c === "on_hold") {
    return { label: "Пауза", Icon: Pause, color: "text-chart-3" as const }
  }
  if (c === "exception") {
    return { label: "Исключение", Icon: AlertTriangle, color: "text-destructive" as const }
  }
  return { label: "В работе", Icon: AlertTriangle, color: "text-chart-3" as const }
}

/**
 * Доступные действия по статусу (совпадают с сервером: claim/start/complete/exception).
 * Завершение на бэкенде допустимо из open | claimed | in_progress | exception (не из on_hold).
 */
function taskActionFlags(statusCode: string) {
  const c = normalizeTaskStatusCode(statusCode)
  return {
    claim: c === "open",
    execute: ["open", "claimed", "in_progress", "exception", "on_hold"].includes(c),
    exception: ["open", "claimed", "in_progress", "exception", "on_hold"].includes(c),
  }
}

type MobileTask = {
  id: string
  title: string
  itemLabel: string
  type: TaskType
  statusCode: string
  completedAt?: string | null
  priority: "low" | "medium" | "high"
  location: string
  items: number
  scanned: number
  createdAt: string
  dueTime?: string
}

const priorityConfig = {
  low: { label: "Низкий", color: "bg-secondary text-foreground" },
  medium: { label: "Средний", color: "bg-chart-3/20 text-chart-3" },
  high: { label: "Срочно", color: "bg-destructive/10 text-destructive" },
}

const typeIcons = {
  all: Package,
  receiving: Truck,
  loading: Package,
  picking: ScanBarcode,
  movement: ArrowRightLeft,
  revision: ClipboardCheck,
}

export default function MobileTasksPage() {
  const router = useRouter()
  const { visibility, loading: navLoading } = useMobileNav()

  useEffect(() => {
    if (navLoading) return
    if (!visibility.tasks) router.replace("/mobile")
  }, [navLoading, visibility.tasks, router])

  const [activeFilter, setActiveFilter] = useState<TaskType>("all")
  const [rows, setRows] = useState<WmsTaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null)
  const [deviceUid, setDeviceUid] = useState<string | null>(null)
  const [exceptionOpen, setExceptionOpen] = useState(false)
  const [activeTask, setActiveTask] = useState<WmsTaskRow | null>(null)
  const [exceptionForm, setExceptionForm] = useState({
    exceptionCode: "shortage",
    exceptionNote: "",
  })

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const uid = deviceUid || localStorage.getItem("tsd_device_id")
      if (!uid) {
        setRows([])
        setError("Терминал не настроен. Пройдите /mobile/sync.")
        return
      }
      const data = await listDeviceTasks({ deviceUid: uid, limit: 50 })
      setRows(data.tasks || [])
    } catch (e) {
      setRows([])
      setError(e instanceof Error ? e.message : "Не удалось загрузить задачи")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const uid = localStorage.getItem("tsd_device_id")
    setDeviceUid(uid)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function claim(taskId: string) {
    const uid = deviceUid || localStorage.getItem("tsd_device_id") || ""
    if (!uid) {
      setError("Терминал не настроен. Пройдите /mobile/sync.")
      return
    }
    setBusyTaskId(taskId)
    try {
      await claimWmsTaskByDevice(taskId, uid)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось назначить задание")
    } finally {
      setBusyTaskId(null)
    }
  }

  function openException(taskId: string) {
    const t = rows.find((x) => x.taskId === taskId) || null
    setActiveTask(t)
    setExceptionForm({ exceptionCode: "shortage", exceptionNote: "" })
    setExceptionOpen(true)
  }

  async function submitException() {
    const uid = deviceUid || localStorage.getItem("tsd_device_id") || ""
    if (!uid) {
      setError("Терминал не настроен. Пройдите /mobile/sync.")
      return
    }
    if (!activeTask) return
    setBusyTaskId(activeTask.taskId)
    try {
      await reportWmsTaskExceptionByDevice(
        activeTask.taskId,
        uid,
        exceptionForm.exceptionCode.trim(),
        exceptionForm.exceptionNote.trim() || undefined
      )
      setExceptionOpen(false)
      setActiveTask(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить исключение")
    } finally {
      setBusyTaskId(null)
    }
  }

  const tasks: MobileTask[] = useMemo(() => {
    return (rows || []).map((t) => {
      const type = classifyTaskType(t.taskType)
      const statusCode = normalizeTaskStatusCode(t.taskStatus)
      const location =
        [t.sourceWarehouseName || t.sourceWarehouseCode, t.targetWarehouseName || t.targetWarehouseCode]
          .filter(Boolean)
          .join(" → ") ||
        [t.sourceLocationCode, t.targetLocationCode].filter(Boolean).join(" → ") ||
        "—"
      const priority = (t.priorityCode || "").toLowerCase()
      const p: "low" | "medium" | "high" =
        priority === "urgent" || priority === "high" ? "high" : priority === "normal" ? "medium" : "low"
      return {
        id: t.taskId,
        title: t.taskCode || `Задание #${t.taskId}`,
        itemLabel: t.itemName || t.itemCode || "Откройте карточку — сканирование товара и ячеек",
        type,
        statusCode,
        completedAt: t.completedAt ?? null,
        priority: p,
        location,
        items: t.plannedQty != null ? Math.round(t.plannedQty) : 0,
        scanned: t.confirmedQty != null ? Math.round(t.confirmedQty) : 0,
        createdAt: t.claimedAt || t.startedAt || t.dueAt || "",
        dueTime: t.dueAt ? new Date(t.dueAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : undefined,
      }
    })
  }, [rows])

  const counts = useMemo(() => {
    const byType: Record<TaskType, number> = {
      all: tasks.length,
      receiving: 0,
      loading: 0,
      picking: 0,
      movement: 0,
      revision: 0,
    }
    for (const t of tasks) byType[t.type] += 1
    return byType
  }, [tasks])

  const filterTabs = useMemo(
    () => [
      { id: "all" as TaskType, label: "Все", count: counts.all },
      { id: "receiving" as TaskType, label: "Приёмка", icon: Truck, count: counts.receiving },
      { id: "loading" as TaskType, label: "Загрузка", icon: Package, count: counts.loading },
      { id: "picking" as TaskType, label: "Изъятие", icon: ScanBarcode, count: counts.picking },
      { id: "movement" as TaskType, label: "Перемещение", icon: ArrowRightLeft, count: counts.movement },
      { id: "revision" as TaskType, label: "Ревизия", icon: ClipboardCheck, count: counts.revision },
    ],
    [counts]
  )

  const filteredTasks = activeFilter === "all" 
    ? tasks 
    : tasks.filter(t => t.type === activeFilter)

  return (
    <div className="flex min-h-0 flex-col gap-8">
      {/* Header */}
      <div className="sticky top-0 z-40 border-b border-border/70 bg-background px-4 pb-4 pt-4 shadow-[0_1px_0_0_rgba(0,0,0,0.04)]">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-foreground">Задачи</h1>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void load()} disabled={loading}>
            <Filter className="mr-2 h-4 w-4" />
            Обновить
          </Button>
        </div>

        {/* Filter Tabs — scrollbar hidden so the track doesn’t look like a stray tab underline */}
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all",
                activeFilter === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground shadow-sm"
              )}
            >
              {tab.icon && <tab.icon className="h-4 w-4" />}
              {tab.label}
              <span className={cn(
                "rounded-full px-1.5 py-0.5 text-xs",
                activeFilter === tab.id
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-secondary"
              )}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Task List — gap-5 above separates from sticky header; extra top padding so cards never tuck under chips */}
      <div className="space-y-3 px-4 pb-6 pt-1">
        {error && (
          <div className="rounded-2xl bg-card p-4 text-sm text-destructive shadow-sm">
            {error}
          </div>
        )}
        {loading ? (
          <div className="rounded-2xl bg-card p-4 text-sm text-muted-foreground shadow-sm">
            Загрузка...
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="rounded-2xl bg-card p-4 text-sm text-muted-foreground shadow-sm">
            Нет задач по выбранному фильтру
          </div>
        ) : null}
        {filteredTasks.map((task) => {
          const statusMeta = taskStatusMeta(task.statusCode, task.completedAt)
          const StatusIcon = statusMeta.Icon
          const actions = taskActionFlags(task.statusCode)
          const terminal = isTerminalTaskStatus(task.statusCode, task.completedAt)
          const TaskIcon = typeIcons[task.type]
          const showAnyAction = actions.claim || actions.execute || actions.exception
          const actionCount = [actions.claim, actions.execute, actions.exception].filter(Boolean).length

          return (
            <div
              key={task.id}
              className={cn(
                "rounded-2xl bg-card p-4 shadow-sm transition-colors",
                task.priority === "high" && "border-l-4 border-destructive"
              )}
            >
              <button
                type="button"
                className="mb-3 flex w-full items-start justify-between text-left"
                onClick={() => router.push(`/mobile/tasks/${task.id}`)}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
                    <TaskIcon className="h-5 w-5 text-foreground" />
                  </div>
                  <div>
                    <div className="font-medium text-foreground">{task.title}</div>
                    <div className="text-sm text-foreground">{task.itemLabel}</div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {task.location === "—" ? "Ячейки укажете сканом" : task.location}
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
              </button>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className={cn("rounded-lg", priorityConfig[task.priority].color)}>
                    {priorityConfig[task.priority].label}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {task.scanned > 0
                      ? `${task.scanned} из ${task.items} кодов`
                      : `нужно отсканировать ${task.items} кодов`}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-xs">
                  <StatusIcon className={cn("h-4 w-4 shrink-0", statusMeta.color)} />
                  <span className={statusMeta.color}>{statusMeta.label}</span>
                </div>
              </div>

              {task.dueTime && !terminal && (
                <div className="mt-3 flex items-center gap-2 rounded-xl bg-secondary p-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    Выполнить до {task.dueTime}
                  </span>
                </div>
              )}

              {!terminal ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Нажмите «Выполнить задание» и сканируйте коды маркировки.
                </p>
              ) : null}

              {showAnyAction ? (
                <div
                  className={cn(
                    "mt-3 grid gap-2",
                    actionCount === 1 && "grid-cols-1",
                    actionCount === 2 && "grid-cols-2",
                    actionCount >= 3 && "grid-cols-2 min-[400px]:grid-cols-4"
                  )}
                >
                  {actions.claim ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 w-full gap-1 rounded-xl px-2 text-xs sm:h-10"
                      onClick={() => void claim(task.id)}
                      disabled={busyTaskId === task.id}
                    >
                      <Hand className="h-3.5 w-3.5 shrink-0" />
                      Взять
                    </Button>
                  ) : null}
                  {actions.execute ? (
                    <Button
                      size="sm"
                      className="h-9 w-full gap-1 rounded-xl bg-primary px-2 text-xs text-primary-foreground sm:h-10"
                      onClick={() => router.push(`/mobile/tasks/${task.id}`)}
                    >
                      <Play className="h-3.5 w-3.5 shrink-0" />
                      Выполнить задание
                    </Button>
                  ) : null}
                  {actions.exception ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 w-full gap-1 rounded-xl px-2 text-xs sm:h-10"
                      onClick={() => openException(task.id)}
                      disabled={busyTaskId === task.id}
                    >
                      <Flag className="h-3.5 w-3.5 shrink-0" />
                      Искл.
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <Dialog
        open={exceptionOpen}
        onOpenChange={(next) => {
          if (busyTaskId != null) return
          setExceptionOpen(next)
          if (!next) setActiveTask(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Исключение</DialogTitle>
            <DialogDescription>Сообщить о проблеме при выполнении задания.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <label className="text-sm font-medium text-foreground">
              exceptionCode
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={exceptionForm.exceptionCode}
                onChange={(e) => setExceptionForm((p) => ({ ...p, exceptionCode: e.target.value }))}
                disabled={busyTaskId != null}
              >
                <option value="shortage">shortage</option>
                <option value="damaged">damaged</option>
                <option value="blocked">blocked</option>
                <option value="other">other</option>
              </select>
            </label>
            <label className="text-sm font-medium text-foreground">
              exceptionNote (опц.)
              <Input
                value={exceptionForm.exceptionNote}
                onChange={(e) => setExceptionForm((p) => ({ ...p, exceptionNote: e.target.value }))}
                placeholder="Комментарий"
                disabled={busyTaskId != null}
              />
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setExceptionOpen(false)} disabled={busyTaskId != null}>
              Отмена
            </Button>
            <Button onClick={() => void submitException()} disabled={busyTaskId != null}>
              Отправить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
