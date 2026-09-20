"use client"

import { useMemo, useState, type MouseEvent } from "react"
import Link from "next/link"
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  Filter,
  MapPin,
  Package,
  RotateCcw,
  Search,
  SortAsc,
  Timer,
  Truck,
  ClipboardList,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { claimWmsTask } from "@/lib/wms-api"

export type TaskCategory = "receiving" | "shipping" | "moving" | "return" | "replenishment" | "other"

export interface Task {
  id: string
  type: string
  category?: TaskCategory
  priority?: "high" | "medium" | "low" | string
  title: string
  from?: string
  to?: string
  location?: string
  assignee?: string
  estimatedTime?: string
  workStatus?: "pending" | "in_progress"
  dueAtIso?: string | null
}

const priorityLabels = {
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
}

const priorityBadgeColors = {
  high: "bg-red-500/10 text-red-700 border-red-200 dark:text-red-400",
  medium: "bg-orange-500/10 text-orange-700 border-orange-200 dark:text-orange-400",
  low: "bg-slate-500/10 text-slate-600 border-slate-200 dark:text-slate-400",
}

const priorityDotColors = {
  high: "bg-red-500",
  medium: "bg-orange-500",
  low: "bg-slate-400",
}

const typeConfig: Record<
  TaskCategory,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  receiving: {
    label: "Приёмка",
    icon: Package,
    color: "border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  shipping: {
    label: "Отгрузка",
    icon: Truck,
    color: "border-blue-200 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  },
  moving: {
    label: "Перемещение",
    icon: ArrowRight,
    color: "border-violet-200 bg-violet-500/10 text-violet-700 dark:text-violet-400",
  },
  replenishment: {
    label: "Подпитка",
    icon: ArrowRight,
    color: "border-violet-200 bg-violet-500/10 text-violet-700 dark:text-violet-400",
  },
  return: {
    label: "Возврат",
    icon: RotateCcw,
    color: "border-amber-200 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  other: {
    label: "Прочее",
    icon: ClipboardList,
    color: "border-border bg-muted text-muted-foreground",
  },
}

function normalizePriority(priority?: string): "high" | "medium" | "low" {
  if (priority === "high" || priority === "medium" || priority === "low") return priority
  return "medium"
}

function normalizeCategory(category?: TaskCategory): TaskCategory {
  return category ?? "other"
}

interface TaskListProps {
  tasks: Task[]
  className?: string
  onAfterClaim?: () => void
}

export function TaskList({ tasks, className, onAfterClaim }: TaskListProps) {
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategories, setSelectedCategories] = useState<TaskCategory[]>([])
  const [selectedPriorities, setSelectedPriorities] = useState<Array<"high" | "medium" | "low">>([])
  const [sortMode, setSortMode] = useState<"priority" | "due">("priority")

  const toggleCategory = (c: TaskCategory) => {
    setSelectedCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  const togglePriority = (p: "high" | "medium" | "low") => {
    setSelectedPriorities((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))
  }

  const filteredSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    let rows = tasks.filter((task) => {
      const matchesSearch =
        !q ||
        task.title.toLowerCase().includes(q) ||
        task.type.toLowerCase().includes(q) ||
        (task.from && task.from.toLowerCase().includes(q)) ||
        (task.to && task.to.toLowerCase().includes(q))
      const cat = normalizeCategory(task.category)
      const matchesCat = selectedCategories.length === 0 || selectedCategories.includes(cat)
      const pri = normalizePriority(task.priority)
      const matchesPri = selectedPriorities.length === 0 || selectedPriorities.includes(pri)
      return matchesSearch && matchesCat && matchesPri
    })

    const priorityOrder = { high: 0, medium: 1, low: 2 }
    rows = [...rows].sort((a, b) => {
      if (sortMode === "due") {
        const ta = a.dueAtIso ? new Date(a.dueAtIso).getTime() : Number.POSITIVE_INFINITY
        const tb = b.dueAtIso ? new Date(b.dueAtIso).getTime() : Number.POSITIVE_INFINITY
        return ta - tb
      }
      return priorityOrder[normalizePriority(a.priority)] - priorityOrder[normalizePriority(b.priority)]
    })
    return rows
  }, [tasks, searchQuery, selectedCategories, selectedPriorities, sortMode])

  const pendingCount = tasks.filter((t) => t.workStatus !== "in_progress").length
  const inProgressCount = tasks.filter((t) => t.workStatus === "in_progress").length
  const highPriorityCount = tasks.filter((t) => normalizePriority(t.priority) === "high").length

  const activeFilters = selectedCategories.length + selectedPriorities.length

  async function handleTake(e: MouseEvent, taskId: string) {
    e.preventDefault()
    e.stopPropagation()
    setActionError(null)
    setClaimingId(taskId)
    try {
      await claimWmsTask(taskId)
      onAfterClaim?.()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Не удалось взять задание")
    } finally {
      setClaimingId(null)
    }
  }

  return (
    <div className={cn("w-full rounded-2xl border border-border bg-card shadow-sm", className)}>
      <div className="rounded-t-2xl border-b border-border bg-card p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-bold text-foreground">Задания на выполнение</h2>
              <Badge className="font-semibold">{filteredSorted.length}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-slate-400" />
                Ожидают: {pendingCount}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-primary" />
                В работе: {inProgressCount}
              </span>
              {highPriorityCount > 0 && (
                <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                  <AlertCircle className="size-3.5 shrink-0" />
                  Срочных: {highPriorityCount}
                </span>
              )}
            </div>
          </div>
          <Button variant="outline" className="shrink-0 rounded-xl" asChild>
            <Link href="/tasks" className="no-underline">
              Все задания
              <ChevronRight className="ml-1 size-4" />
            </Link>
          </Button>
        </div>

        {actionError && <p className="mb-3 text-xs text-destructive">{actionError}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Поиск по коду или названию..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-xl border-secondary bg-secondary/50 pl-10"
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="rounded-xl gap-2">
                <Filter className="size-4" />
                Фильтры
                {activeFilters > 0 && (
                  <Badge className="flex size-5 items-center justify-center bg-accent p-0 text-xs text-accent-foreground">
                    {activeFilters}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Тип задания</DropdownMenuLabel>
              {(Object.keys(typeConfig) as TaskCategory[]).map((cat) => (
                <DropdownMenuCheckboxItem
                  key={cat}
                  checked={selectedCategories.includes(cat)}
                  onCheckedChange={() => toggleCategory(cat)}
                >
                  {typeConfig[cat].label}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Приоритет</DropdownMenuLabel>
              {(["high", "medium", "low"] as const).map((p) => (
                <DropdownMenuCheckboxItem key={p} checked={selectedPriorities.includes(p)} onCheckedChange={() => togglePriority(p)}>
                  <span className={cn("mr-2 size-2 rounded-full", priorityDotColors[p])} />
                  {priorityLabels[p]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="outline"
            size="icon"
            className="rounded-xl shrink-0"
            type="button"
            title={sortMode === "priority" ? "Сортировка: приоритет" : "Сортировка: срок"}
            onClick={() => setSortMode((m) => (m === "priority" ? "due" : "priority"))}
          >
            <SortAsc className="size-4" />
          </Button>
        </div>
      </div>

      <div className="rounded-b-2xl border-t-0 bg-secondary/30">
        <div className="space-y-2 p-3">
            {filteredSorted.map((task) => {
              const priority = normalizePriority(task.priority)
              const priorityInfo = {
                label: priorityLabels[priority],
                badge: priorityBadgeColors[priority],
                dot: priorityDotColors[priority],
              }
              const cat = normalizeCategory(task.category)
              const typeInfo = typeConfig[cat]
              const TypeIcon = typeInfo.icon
              const isUrgent = priority === "high"
              const inProgress = task.workStatus === "in_progress"

              return (
                <div
                  key={task.id}
                  className={cn(
                    "group rounded-xl border bg-card p-3 transition-all duration-200",
                    "hover:border-primary/30 hover:shadow-md",
                    isUrgent && "border-l-4 border-l-red-500",
                    inProgress && "border-primary/20 bg-primary/5"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Badge variant="outline" className={cn("gap-1.5 font-medium", typeInfo.color)}>
                        <TypeIcon className="size-3.5" />
                        {typeInfo.label}
                      </Badge>
                      <Badge variant="outline" className={cn("gap-1.5", priorityInfo.badge)}>
                        <span className={cn("size-1.5 rounded-full", priorityInfo.dot)} />
                        {priorityInfo.label}
                      </Badge>
                      {inProgress && (
                        <Badge className="gap-1 bg-primary text-primary-foreground">
                          <Timer className="size-3" />
                          В работе
                        </Badge>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                      <Clock className="size-4 shrink-0" />
                      <span className={cn("whitespace-nowrap text-sm font-medium", isUrgent && "text-red-600 dark:text-red-400")}>
                        {task.estimatedTime ?? "—"}
                      </span>
                    </div>
                  </div>

                  <Link
                    href={`/tasks/${encodeURIComponent(task.id)}`}
                    className="mt-3 block min-w-0 rounded-lg text-inherit no-underline outline-offset-2 hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <h4 className="line-clamp-1 break-words font-semibold leading-tight text-foreground">{task.title}</h4>
                    {task.assignee ? (
                      <p className="mt-1.5 truncate text-sm text-muted-foreground">Исполнитель: {task.assignee}</p>
                    ) : null}
                  </Link>

                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2 text-sm text-muted-foreground">
                      <MapPin className="mt-0.5 size-4 shrink-0" />
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="max-w-[min(220px,40vw)] truncate" title={task.from}>
                          {task.from || "Не указан"}
                        </span>
                        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/60" />
                        <span className="max-w-[min(220px,40vw)] truncate" title={task.to}>
                          {task.to || "Не указано"}
                        </span>
                      </div>
                    </div>
                    {inProgress ? (
                      <Button size="sm" className="shrink-0 rounded-xl shadow-sm" asChild>
                        <Link href={`/tasks/${encodeURIComponent(task.id)}`}>
                          <CheckCircle2 className="mr-1.5 size-4" />
                          Открыть
                        </Link>
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="shrink-0 rounded-xl shadow-sm"
                        disabled={claimingId === task.id}
                        onClick={(e) => void handleTake(e, task.id)}
                      >
                        {claimingId === task.id ? (
                          "…"
                        ) : (
                          <>
                            Взять
                            <ChevronRight className="ml-1 size-4" />
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}

            {filteredSorted.length === 0 && (
              <div className="py-12 text-center text-muted-foreground">
                <Package className="mx-auto mb-3 size-12 opacity-50" />
                <p className="text-lg font-medium text-foreground">Заданий не найдено</p>
                <p className="text-sm">{tasks.length === 0 ? "Активных заданий нет" : "Попробуйте изменить параметры поиска"}</p>
              </div>
            )}
          </div>
      </div>
    </div>
  )
}
