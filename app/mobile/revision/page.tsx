"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ClipboardCheck,
  AlertTriangle,
  Plus,
  Search,
  RotateCcw,
  Clock,
  CheckCircle2,
  Play,
  Hand,
  Flag,
  MapPin,
  Hash,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  claimWmsTaskByDevice,
  completeWmsTaskByDevice,
  listDeviceTasks,
  reportWmsTaskExceptionByDevice,
  startWmsTaskByDevice,
  type WmsTaskRow,
} from "@/lib/wms-api"
import { useMobileNav } from "@/app/mobile/mobile-nav-provider"

const statusConfig = {
  open: { label: "Ожидает", icon: ClipboardCheck, color: "text-muted-foreground", bg: "bg-secondary" },
  claimed: { label: "Назначено", icon: Hand, color: "text-chart-3", bg: "bg-chart-3/10" },
  in_progress: { label: "В работе", icon: Play, color: "text-chart-2", bg: "bg-chart-2/10" },
  completed: { label: "Выполнено", icon: CheckCircle2, color: "text-success", bg: "bg-success/10" },
}

function toUiStatus(row: WmsTaskRow): keyof typeof statusConfig {
  const raw = (row.taskStatus || "").toLowerCase()
  if (row.completedAt || raw.includes("complete")) return "completed"
  if (raw.includes("progress") || raw.includes("started")) return "in_progress"
  if (raw.includes("claim")) return "claimed"
  return "open"
}

export default function MobileRevisionPage() {
  const router = useRouter()
  const { visibility, loading: navLoading } = useMobileNav()

  useEffect(() => {
    if (navLoading) return
    if (!visibility.revision) router.replace("/mobile")
  }, [navLoading, visibility.revision, router])

  const [searchQuery, setSearchQuery] = useState("")
  const [rows, setRows] = useState<WmsTaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null)
  const [deviceUid, setDeviceUid] = useState<string | null>(null)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [exceptionOpen, setExceptionOpen] = useState(false)
  const [activeTask, setActiveTask] = useState<WmsTaskRow | null>(null)
  const [completeForm, setCompleteForm] = useState({
    confirmedQty: "",
    targetLocationCode: "",
    note: "",
  })
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
      const data = await listDeviceTasks({ deviceUid: uid, type: "revision", limit: 50 })
      setRows(data.tasks || [])
    } catch (e) {
      setRows([])
      setError(e instanceof Error ? e.message : "Не удалось загрузить задания ревизии")
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

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((t) => {
      return [
        t.taskCode,
        t.itemCode,
        t.itemName,
        t.sourceLocationCode,
        t.targetLocationCode,
        t.documentNo,
      ].some((v) => (v || "").toLowerCase().includes(q))
    })
  }, [rows, searchQuery])

  const stats = useMemo(() => {
    const s = { open: 0, claimed: 0, in_progress: 0, completed: 0 }
    for (const r of rows) s[toUiStatus(r)] += 1
    return s
  }, [rows])

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

  async function start(taskId: string) {
    const uid = deviceUid || localStorage.getItem("tsd_device_id") || ""
    if (!uid) {
      setError("Терминал не настроен. Пройдите /mobile/sync.")
      return
    }
    setBusyTaskId(taskId)
    try {
      await startWmsTaskByDevice(taskId, uid)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось начать задание")
    } finally {
      setBusyTaskId(null)
    }
  }

  async function complete(taskId: string) {
    const uid = deviceUid || localStorage.getItem("tsd_device_id") || ""
    if (!uid) {
      setError("Терминал не настроен. Пройдите /mobile/sync.")
      return
    }
    setBusyTaskId(taskId)
    try {
      await completeWmsTaskByDevice(taskId, uid)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось завершить задание")
    } finally {
      setBusyTaskId(null)
    }
  }

  function openComplete(task: WmsTaskRow) {
    setActiveTask(task)
    setCompleteForm({
      confirmedQty: task.plannedQty != null ? String(task.plannedQty) : "",
      targetLocationCode: task.targetLocationCode || "",
      note: "",
    })
    setCompleteOpen(true)
  }

  function openException(task: WmsTaskRow) {
    setActiveTask(task)
    setExceptionForm({
      exceptionCode: "shortage",
      exceptionNote: "",
    })
    setExceptionOpen(true)
  }

  async function submitComplete() {
    const task = activeTask
    const uid = deviceUid || localStorage.getItem("tsd_device_id") || ""
    if (!task || !uid) {
      setError("Терминал не настроен. Пройдите /mobile/sync.")
      return
    }
    const confirmedQty = completeForm.confirmedQty.trim() === "" ? undefined : Number(completeForm.confirmedQty)
    if (confirmedQty != null && (!Number.isFinite(confirmedQty) || confirmedQty < 0)) {
      setError("confirmedQty должен быть числом >= 0")
      return
    }
    setBusyTaskId(task.taskId)
    try {
      await completeWmsTaskByDevice(task.taskId, uid, {
        confirmedQty,
        targetLocationCode: completeForm.targetLocationCode.trim() || undefined,
        note: completeForm.note.trim() || undefined,
      })
      setCompleteOpen(false)
      setActiveTask(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось завершить задание")
    } finally {
      setBusyTaskId(null)
    }
  }

  async function submitException() {
    const task = activeTask
    const uid = deviceUid || localStorage.getItem("tsd_device_id") || ""
    if (!task || !uid) {
      setError("Терминал не настроен. Пройдите /mobile/sync.")
      return
    }
    if (!exceptionForm.exceptionCode.trim()) {
      setError("Укажите exceptionCode")
      return
    }
    setBusyTaskId(task.taskId)
    try {
      await reportWmsTaskExceptionByDevice(
        task.taskId,
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

  if (!loading && rows.length === 0 && !error) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-secondary">
          <ClipboardCheck className="h-10 w-10 text-muted-foreground" />
        </div>
        <h2 className="mb-2 text-lg font-semibold text-foreground">Нет активной ревизии</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          В очереди WMS нет заданий типа `revision`.
        </p>
        <Button className="rounded-xl bg-primary text-primary-foreground" onClick={() => void load()}>
          <Plus className="mr-2 h-4 w-4" />
          Обновить
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background px-4 pb-3 pt-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-foreground">Ревизия</h1>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void load()} disabled={loading}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Обновить
          </Button>
        </div>

        {/* Stats Row */}
        <div className="mb-4 grid grid-cols-4 gap-2">
          <div className="rounded-xl bg-card p-2 text-center shadow-sm">
            <div className="text-lg font-bold text-muted-foreground">{stats.open}</div>
            <div className="text-[10px] text-muted-foreground">Ожидает</div>
          </div>
          <div className="rounded-xl bg-card p-2 text-center shadow-sm">
            <div className="text-lg font-bold text-chart-3">{stats.claimed}</div>
            <div className="text-[10px] text-muted-foreground">Назначено</div>
          </div>
          <div className="rounded-xl bg-card p-2 text-center shadow-sm">
            <div className="text-lg font-bold text-chart-2">{stats.in_progress}</div>
            <div className="text-[10px] text-muted-foreground">В работе</div>
          </div>
          <div className="rounded-xl bg-card p-2 text-center shadow-sm">
            <div className="text-lg font-bold text-success">{stats.completed}</div>
            <div className="text-[10px] text-muted-foreground">Выполнено</div>
          </div>
        </div>

        {/* Search & Scan */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Поиск по коду/товару/ячейке"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-xl bg-card pl-10 shadow-sm"
            />
          </div>
        </div>
      </div>

      {/* Items List */}
      <div className="space-y-3 p-4 pt-0">
        {error && (
          <div className="rounded-2xl bg-card p-4 text-sm text-destructive shadow-sm">
            {error}
          </div>
        )}
        {loading ? (
          <div className="rounded-2xl bg-card p-4 text-sm text-muted-foreground shadow-sm">
            Загрузка...
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl bg-card p-4 text-sm text-muted-foreground shadow-sm">
            Ничего не найдено
          </div>
        ) : null}

        {filtered.map((task) => {
          const uiStatus = toUiStatus(task)
          const status = statusConfig[uiStatus]
          const StatusIcon = status.icon
          
          return (
            <div
              key={task.taskId}
              className={cn(
                "rounded-2xl bg-card p-4 shadow-sm transition-all active:scale-[0.98]",
                uiStatus === "in_progress" && "border-l-4 border-chart-2",
                uiStatus === "claimed" && "border-l-4 border-chart-3"
              )}
            >
              <button
                type="button"
                className="mb-2 flex w-full items-start justify-between gap-2 text-left"
                onClick={() => router.push(`/mobile/tasks/${task.taskId}`)}
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="rounded-lg font-mono text-xs">
                      {task.taskCode || `#${task.taskId}`}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {task.documentNo ? `Док: ${task.documentNo}` : ""}
                    </span>
                  </div>
                  <div className="font-medium text-foreground">{task.itemName || task.itemCode || "Ревизия"}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {(task.sourceLocationCode || "—")} → {(task.targetLocationCode || "—")}
                  </div>
                  {task.lotCode ? (
                    <div className="mt-1 rounded-lg bg-amber-500/10 px-2 py-1 text-xs text-amber-900">
                      FEFO партия: {task.lotCode}
                    </div>
                  ) : null}
                </div>
                <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
              </button>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground">Кол-во</div>
                    <div className="text-lg font-bold text-foreground">{task.plannedQty ?? "—"}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <Clock className="inline h-4 w-4 mr-1" />
                    {task.dueAt ? new Date(task.dueAt).toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—"}
                  </div>
                </div>
                <Badge variant="secondary" className={cn("rounded-lg", status.bg, status.color)}>
                  <StatusIcon className="mr-1 h-3 w-3" />
                  {status.label}
                </Badge>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <Button
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => void claim(task.taskId)}
                  disabled={busyTaskId === task.taskId || uiStatus !== "open"}
                >
                  <Hand className="mr-2 h-4 w-4" />
                  Claim
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => void start(task.taskId)}
                  disabled={busyTaskId === task.taskId || (uiStatus !== "claimed" && uiStatus !== "open")}
                >
                  <Play className="mr-2 h-4 w-4" />
                  Start
                </Button>
                <Button
                  className="rounded-xl bg-primary text-primary-foreground"
                  onClick={() => openComplete(task)}
                  disabled={busyTaskId === task.taskId || uiStatus === "completed"}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Complete
                </Button>
              </div>

              <div className="mt-2">
                <Button
                  variant="outline"
                  className="w-full rounded-xl"
                  onClick={() => openException(task)}
                  disabled={busyTaskId === task.taskId || uiStatus === "completed"}
                >
                  <Flag className="mr-2 h-4 w-4" />
                  Exception
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      <Dialog open={completeOpen} onOpenChange={(next) => busyTaskId == null && setCompleteOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Завершить задание</DialogTitle>
            <DialogDescription>Передайте фактические данные выполнения (опционально).</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="rounded-xl bg-secondary/40 p-3 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Hash className="h-4 w-4" />
                <span className="font-mono">{activeTask?.taskCode || activeTask?.taskId || "—"}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <span>{activeTask?.sourceLocationCode || "—"} → {activeTask?.targetLocationCode || "—"}</span>
              </div>
            </div>

            <label className="text-sm font-medium text-foreground">
              confirmedQty (опц.)
              <Input
                value={completeForm.confirmedQty}
                onChange={(e) => setCompleteForm((p) => ({ ...p, confirmedQty: e.target.value }))}
                placeholder="Например 10"
                inputMode="decimal"
                disabled={busyTaskId != null}
              />
            </label>
            <label className="text-sm font-medium text-foreground">
              targetLocationCode (опц.)
              <Input
                value={completeForm.targetLocationCode}
                onChange={(e) => setCompleteForm((p) => ({ ...p, targetLocationCode: e.target.value }))}
                placeholder="B-02"
                disabled={busyTaskId != null}
              />
            </label>
            <label className="text-sm font-medium text-foreground">
              note (опц.)
              <Input
                value={completeForm.note}
                onChange={(e) => setCompleteForm((p) => ({ ...p, note: e.target.value }))}
                placeholder="Комментарий"
                disabled={busyTaskId != null}
              />
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteOpen(false)} disabled={busyTaskId != null}>
              Отмена
            </Button>
            <Button onClick={() => void submitComplete()} disabled={busyTaskId != null}>
              Завершить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={exceptionOpen} onOpenChange={(next) => busyTaskId == null && setExceptionOpen(next)}>
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
