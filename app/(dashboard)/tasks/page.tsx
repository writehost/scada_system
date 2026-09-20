"use client"

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  User,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { claimWmsTask, listTasks, type WmsTaskRow } from "@/lib/wms-api"
import { warehouseRouteLabel } from "@/lib/wms-labels"
import { WmsEmptyState, WmsErrorState } from "@/components/wms/wms-shared"
import { TaskConstructorDialog } from "@/components/wms/task-constructor-dialog"
import { useToast } from "@/hooks/use-toast"

const typeConfig: Record<string, { label: string; className: string }> = {
  receipt: { label: "Приёмка", className: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" },
  receiving: { label: "Приёмка", className: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" },
  shipment: { label: "Отгрузка", className: "bg-sky-500/10 text-sky-800 dark:text-sky-300" },
  shipping: { label: "Отгрузка", className: "bg-sky-500/10 text-sky-800 dark:text-sky-300" },
  pick: { label: "Отбор", className: "bg-violet-500/10 text-violet-800 dark:text-violet-300" },
  picking: { label: "Отбор", className: "bg-violet-500/10 text-violet-800 dark:text-violet-300" },
  revision: { label: "Ревизия", className: "bg-amber-500/10 text-amber-800 dark:text-amber-300" },
  transfer: { label: "Перемещение", className: "bg-chart-2/10 text-chart-2" },
  internal_transfer: { label: "Перемещение", className: "bg-chart-2/10 text-chart-2" },
  interwarehouse_transfer: { label: "Перемещение ERP", className: "bg-chart-2/10 text-chart-2" },
}

const statusConfig = {
  open: { label: "В очереди", icon: Clock, color: "text-muted-foreground" },
  claimed: { label: "Взято", icon: Play, color: "text-primary" },
  in_progress: { label: "В работе", icon: Play, color: "text-primary" },
  started: { label: "В работе", icon: Play, color: "text-primary" },
  on_hold: { label: "Пауза", icon: Clock, color: "text-amber-700" },
  exception: { label: "Проблема", icon: AlertTriangle, color: "text-destructive" },
  completed: { label: "Готово", icon: CheckCircle2, color: "text-emerald-700" },
  cancelled: { label: "Отменено", icon: XCircle, color: "text-muted-foreground" },
  failed: { label: "Ошибка", icon: AlertTriangle, color: "text-destructive" },
}

type FilterKey = "all" | "open" | "active" | "done" | "problem"

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "open", label: "Очередь" },
  { key: "active", label: "В работе" },
  { key: "done", label: "Готово" },
  { key: "problem", label: "Проблемы" },
]

function isActiveStatus(s: string) {
  return s === "claimed" || s === "in_progress" || s === "started" || s === "on_hold"
}

function isProblemStatus(s: string) {
  return s === "exception" || s === "failed"
}

function pick<T extends Record<string, unknown>>(map: T, key: string, fallback: T[keyof T]) {
  return (Object.prototype.hasOwnProperty.call(map, key) ? map[key as keyof T] : fallback) as T[keyof T]
}

function fmtQty(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return null
  return Number.isInteger(n) ? String(n) : n.toLocaleString("ru-RU", { maximumFractionDigits: 3 })
}

function fmtDue(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
  } catch {
    return iso
  }
}

export default function TasksPage() {
  const { toast } = useToast()
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<FilterKey>("all")
  const [rows, setRows] = useState<WmsTaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [constructorOpen, setConstructorOpen] = useState(false)

  const load = useCallback(async (q?: string) => {
    setError(null)
    try {
      const data = await listTasks({ status: "", query: q?.trim() || "", limit: 100 })
      setRows(data.tasks ?? [])
    } catch (e) {
      setRows([])
      setError(e instanceof Error ? e.message : "Не удалось загрузить очередь")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    const t = window.setTimeout(() => void load(query), query.trim() ? 180 : 0)
    return () => window.clearTimeout(t)
  }, [load, query])

  useEffect(() => {
    if (constructorOpen) return
    const t = window.setInterval(() => void load(query), 20_000)
    return () => window.clearInterval(t)
  }, [constructorOpen, load, query])

  const counts = useMemo(() => {
    const next: Record<FilterKey, number> = { all: rows.length, open: 0, active: 0, done: 0, problem: 0 }
    for (const t of rows) {
      if (t.taskStatus === "open") next.open += 1
      if (isActiveStatus(t.taskStatus)) next.active += 1
      if (t.taskStatus === "completed") next.done += 1
      if (isProblemStatus(t.taskStatus)) next.problem += 1
    }
    return next
  }, [rows])

  const visible = useMemo(() => {
    return rows.filter((t) => {
      if (filter === "open") return t.taskStatus === "open"
      if (filter === "active") return isActiveStatus(t.taskStatus)
      if (filter === "done") return t.taskStatus === "completed"
      if (filter === "problem") return isProblemStatus(t.taskStatus)
      return true
    })
  }, [rows, filter])

  const handleClaim = async (e: MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    setClaimingId(id)
    try {
      await claimWmsTask(id)
      await load(query)
    } catch (err) {
      toast({
        title: "Не удалось взять задание",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      })
    } finally {
      setClaimingId(null)
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="wms-panel sticky top-0 z-20 rounded-2xl px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-sm font-semibold tracking-tight text-foreground">Задания</h1>
          <div className="flex max-w-full overflow-x-auto rounded-lg border border-border/60 bg-muted/40 p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  filter === f.key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f.label}
                {counts[f.key] > 0 ? (
                  <Badge variant="secondary" className="rounded px-1 py-0 text-[10px] leading-4">
                    {counts[f.key]}
                  </Badge>
                ) : null}
              </button>
            ))}
          </div>
          <div className="relative min-w-[10rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Код, номенклатура, документ"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => void load(query)}
            disabled={loading}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
          <Button type="button" size="sm" className="h-8" onClick={() => setConstructorOpen(true)}>
            <Plus className="mr-1 size-3.5" />
            Конструктор
          </Button>
        </div>
      </div>

      {error ? (
        <WmsErrorState title="Очередь недоступна" message={error} onRetry={() => void load(query)} />
      ) : null}

      {!error && loading && rows.length === 0 ? (
        <div className="wms-panel space-y-1.5 p-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      ) : null}

      {!error && !loading && visible.length === 0 ? (
        <WmsEmptyState
          title={rows.length === 0 ? "Очередь пуста" : "Нет заданий в этом фильтре"}
          description={
            rows.length === 0
              ? "Соберите задание в конструкторе — номенклатура, партия, срок и количество."
              : "Смените фильтр или поиск."
          }
          action={
            rows.length === 0 ? (
              <Button type="button" size="sm" onClick={() => setConstructorOpen(true)}>
                <Plus className="mr-1 size-3.5" />
                Открыть конструктор
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {visible.length > 0 ? (
        <div className="wms-panel divide-y divide-border/50 overflow-hidden rounded-2xl">
          {visible.map((task) => {
            const type = pick(typeConfig, task.taskType, {
              label: task.taskType,
              className: "bg-secondary text-foreground",
            })
            const st = pick(statusConfig, task.taskStatus, statusConfig.open)
            const qty = fmtQty(task.plannedQty)
            const route = warehouseRouteLabel(task)
            const urgent = (task.priorityCode || "").toLowerCase() === "high" && task.taskStatus !== "completed"
            return (
              <div
                key={task.taskId}
                className={cn(
                  "flex items-stretch gap-2 px-3 py-2.5 transition-colors hover:bg-muted/30",
                  urgent && "border-l-2 border-destructive"
                )}
              >
                <Link
                  href={`/tasks/${encodeURIComponent(task.taskId)}`}
                  className="flex min-w-0 flex-1 items-start gap-3 rounded-lg outline-offset-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold text-foreground">{task.taskCode}</span>
                      <Badge variant="secondary" className={cn("rounded px-1.5 py-0 text-[10px]", type.className)}>
                        {type.label}
                      </Badge>
                      {urgent ? (
                        <Badge variant="destructive" className="rounded px-1.5 py-0 text-[10px]">
                          срочно
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-sm text-foreground">
                      {task.itemName || task.itemCode || "Без номенклатуры"}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                      {task.lotCode ? <span>партия {task.lotCode}</span> : null}
                      {qty ? <span>{qty}</span> : null}
                      {task.documentNo ? <span>{task.documentNo}</span> : null}
                      {route ? <span>{route}</span> : null}
                      {task.dueAt ? (
                        <span className="inline-flex items-center gap-0.5 text-destructive">
                          <AlertTriangle className="size-3" />
                          до {fmtDue(task.dueAt)}
                        </span>
                      ) : null}
                      {task.assignedUser ? (
                        <span className="inline-flex items-center gap-0.5">
                          <User className="size-3" />
                          {task.assignedUser}
                        </span>
                      ) : null}
                    </p>
                  </div>
                </Link>
                <div className="flex shrink-0 items-center gap-1.5 self-center">
                  <span className={cn("hidden items-center gap-1 text-[11px] font-medium sm:inline-flex", st.color)}>
                    <st.icon className="size-3.5" />
                    {st.label}
                  </span>
                  {task.taskStatus === "open" ? (
                    <Button
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      disabled={claimingId === task.taskId}
                      onClick={(e) => void handleClaim(e, task.taskId)}
                    >
                      {claimingId === task.taskId ? <Loader2 className="size-3.5 animate-spin" /> : "Взять"}
                    </Button>
                  ) : null}
                  <Link
                    href={`/tasks/${encodeURIComponent(task.taskId)}`}
                    className="text-muted-foreground hover:text-foreground"
                    title="Карточка"
                  >
                    <ChevronRight className="size-4" />
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      <TaskConstructorDialog
        open={constructorOpen}
        onOpenChange={setConstructorOpen}
        onCreated={(message) => {
          toast({ title: "Задание создано", description: message })
          void load(query)
        }}
      />
    </div>
  )
}
