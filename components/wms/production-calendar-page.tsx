"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Factory,
  Info,
  Layers3,
  Loader2,
  Lock,
  MoreHorizontal,
  PackageCheck,
  PackageOpen,
  Pencil,
  Plus,
  RefreshCw,
  Rows3,
  Search,
  Trash2,
  TrendingUp,
  Unlock,
  Upload,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  createProductionPlan,
  createProductionPlanLink,
  createCalendarEvent,
  deleteProductionPlan,
  deleteProductionPlanLink,
  getProductionPlan,
  listCalendarEvents,
  listDirectoryWarehouses,
  listItems,
  listProductionPlans,
  refreshProductionPlanMaterials,
  releaseProductionPlan,
  reserveProductionPlan,
  updateProductionPlan,
  listVekasApsWatches,
  syncVekasApsBatches,
  type ProductionPlanLinkRow,
  type ProductionPlanRow,
  type VekasApsWatchRow,
  type WarehouseDirectoryRow,
  type WmsItemListRow,
} from "@/lib/wms-api"
import { WmsTableSkeleton } from "@/components/wms/wms-shared"
import {
  formatApsUserError,
  isMissingActiveSpecMessage,
  PRODUCTION_SPEC_MISSING_SUMMARY,
  PRODUCTION_SPEC_MISSING_TITLE,
  ProductionSpecHelpPanel,
  ProductionSpecMissingHint,
} from "@/components/wms/production-spec-help-panel"
import { formatApsPlanQty, formatApsItemCompositeLine, planOverlapsDateKey, toDateKey, vekasWatchOverlapsDay } from "@/lib/wms/production-gantt-mapper"
import {
  apsLineEventTypeCode,
  mapCalendarEventsToApsLineEvents,
  type ApsLineEventKind,
  type ApsLineEventRow,
} from "@/lib/wms/aps-line-events"
import { isWorkshopDirectoryRow } from "@/lib/wms/workshop-directory"
import { SkitProductionImportDialog } from "@/components/wms/skit-production-import-dialog"
import { ProductionMonthCalendar } from "@/components/wms/production-month-calendar"
import { ProductionDayCalendar } from "@/components/wms/production-day-calendar"
import { ProductionPlansTable } from "@/components/wms/production-plans-table"
import { ProductionFactDialog } from "@/components/wms/production-fact-dialog"
import { ApsFactLine } from "@/components/wms/production-fact-line"
import {
  apsPlanMatchesQuery,
  formatApsQty,
  formatApsQtyShort,
  summarizeApsFacts,
} from "@/lib/wms/production-plan-fact"

const MONTHS_RU = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
]

const MONTHS_GEN_RU = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
]

const WEEKDAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

type CalendarView = "month" | "day" | "list"

type PlanFilter = "all" | "running" | "done" | "shortage" | "ready" | "reserved"

const SHIFT_NONE = "__none__"
const WORKSHOP_NONE = "__none__"

function matchesFilter(plan: ProductionPlanRow, filter: PlanFilter) {
  if (plan.status === "cancelled") return false
  if (filter === "running") return plan.status === "in_progress"
  if (filter === "done") return plan.status === "done"
  if (filter === "shortage") return plan.shortageCount > 0 && plan.status !== "reserved"
  if (filter === "ready") return plan.isFullyCovered && plan.status !== "reserved"
  if (filter === "reserved") return plan.status === "reserved"
  return true
}

function fmtQty(n: number) {
  return formatApsPlanQty(n)
}

function vekasServerLabel(server: string) {
  return server === "slavda" ? "Славда" : "Скит"
}

function vekasStatusLabel(status: string | null) {
  const s = (status || "").trim()
  if (s === "InProccess" || s === "InProcess") return "в процессе"
  if (s === "InStorage") return "на складе"
  if (s === "Completed" || s === "Finalized") return "завершена"
  if (s === "Cancelled" || s === "Canceled") return "отменена"
  return s || "—"
}

function shiftDateKey(key: string, deltaDays: number): string {
  const [yyyy, mm, dd] = key.split("-").map(Number)
  const date = new Date(yyyy, (mm || 1) - 1, dd || 1)
  date.setDate(date.getDate() + deltaDays)
  return toDateKey(date)
}

function statusBadge(plan: ProductionPlanRow) {
  if (plan.status === "done") {
    return { label: "Выполнен", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" }
  }
  if (plan.status === "in_progress") {
    return {
      label: "В производстве",
      className: "bg-amber-500/15 text-amber-800 dark:text-amber-200",
    }
  }
  if (plan.status === "reserved") {
    return { label: "Зарезервирован", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" }
  }
  if (plan.isFullyCovered) {
    return { label: "MRP OK", className: "bg-sky-500/15 text-sky-700 dark:text-sky-300" }
  }
  if (plan.shortageCount > 0) {
    return { label: `Дефицит: ${plan.shortageCount}`, className: "bg-destructive/15 text-destructive" }
  }
  return { label: "Черновик", className: "bg-muted text-muted-foreground" }
}

function ToolbarIconButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  tone,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  onClick: () => void
  disabled?: boolean
  tone?: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("size-7 rounded-md", tone)}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="size-4" />
    </Button>
  )
}

export function ProductionCalendarPage() {
  const [month, setMonth] = useState(() => new Date())
  const [plans, setPlans] = useState<ProductionPlanRow[]>([])
  const [planLinks, setPlanLinks] = useState<ProductionPlanLinkRow[]>([])
  const [loading, setLoading] = useState(false)
  const [booting, setBooting] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<PlanFilter>("all")
  const [query, setQuery] = useState("")
  const [calendarView, setCalendarView] = useState<CalendarView>("month")
  const [factDialogPlan, setFactDialogPlan] = useState<ProductionPlanRow | null>(null)
  const [factDialogOpen, setFactDialogOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const [dayKey, setDayKey] = useState(() => toDateKey(new Date()))
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [dependencySourcePlanId, setDependencySourcePlanId] = useState<string | null>(null)
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
  const [selectedPlanDetail, setSelectedPlanDetail] = useState<ProductionPlanRow | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editPlanCode, setEditPlanCode] = useState<string | null>(null)
  const [skitImportOpen, setSkitImportOpen] = useState(false)
  const [vekasWatches, setVekasWatches] = useState<VekasApsWatchRow[]>([])
  const [vekasInfoOpen, setVekasInfoOpen] = useState(false)
  const [vekasSyncing, setVekasSyncing] = useState(false)
  const [vekasSyncHint, setVekasSyncHint] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [itemCode, setItemCode] = useState("")
  const [itemSuggestions, setItemSuggestions] = useState<WmsItemListRow[]>([])
  const [itemSuggestLoading, setItemSuggestLoading] = useState(false)
  const [itemSuggestOpen, setItemSuggestOpen] = useState(false)
  const [itemSuggestNoHits, setItemSuggestNoHits] = useState(false)
  const [selectedItem, setSelectedItem] = useState<{
    itemCode: string
    name: string
    hasActiveSpec: boolean
  } | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const itemFieldRef = useRef<HTMLDivElement>(null)
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [plannedQty, setPlannedQty] = useState("")
  const [planDate, setPlanDate] = useState(() => toDateKey(new Date()))
  const [planDateTo, setPlanDateTo] = useState("")
  const [workshopCode, setWorkshopCode] = useState("")
  const [lineCode, setLineCode] = useState("")
  const [note, setNote] = useState("")
  const [workshopOptions, setWorkshopOptions] = useState<WarehouseDirectoryRow[]>([])
  const [lineEvents, setLineEvents] = useState<ApsLineEventRow[]>([])
  const [lineEventDialogOpen, setLineEventDialogOpen] = useState(false)
  const [lineEventKind, setLineEventKind] = useState<ApsLineEventKind>("wash")
  const [lineEventDate, setLineEventDate] = useState("")
  const [lineEventAfterPlan, setLineEventAfterPlan] = useState<ProductionPlanRow | null>(null)
  const [lineEventSaving, setLineEventSaving] = useState(false)

  const year = month.getFullYear()
  const monthIdx = month.getMonth()

  const loadPlans = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (silent) {
      setRefreshing(true)
    } else {
      setLoading(true)
      setPlans([])
      setPlanLinks([])
    }
    setError(null)
    try {
      const from = toDateKey(new Date(year, monthIdx, 1))
      const to = toDateKey(new Date(year, monthIdx + 1, 0))
      const [res, eventsRes, watchesRes] = await Promise.all([
        listProductionPlans({ from, to }),
        listCalendarEvents({ from, to, types: ["aps_line_wash", "aps_line_maint"] }),
        listVekasApsWatches({ state: "all" }).catch(() => null),
      ])
      setPlans(res.plans || [])
      setPlanLinks(res.links || [])
      setLineEvents(mapCalendarEventsToApsLineEvents(eventsRes.events || []))
      if (watchesRes?.watches) setVekasWatches(watchesRes.watches)
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Не удалось загрузить планы"
      setError(formatApsUserError(errMsg).title)
      if (!silent) {
        setPlans([])
        setPlanLinks([])
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
      setBooting(false)
    }
  }, [year, monthIdx])

  useEffect(() => {
    void loadPlans()
  }, [loadPlans])

  const loadVekasWatches = useCallback(async () => {
    try {
      const res = await listVekasApsWatches({ state: "all" })
      setVekasWatches(res.watches || [])
    } catch {
      /* таблица появится после первой синхронизации */
    }
  }, [])

  useEffect(() => {
    void loadVekasWatches()
  }, [loadVekasWatches])

  const handleVekasSync = useCallback(async () => {
    setVekasSyncing(true)
    setVekasSyncHint(null)
    try {
      const res = await syncVekasApsBatches()
      setVekasWatches(res.watches || [])
      const parts = [
        `в процессе ${res.watching}`,
        res.createdPlans ? `новых планов ${res.createdPlans}` : "",
        res.completed ? `закрыто ${res.completed}` : "",
        res.historyImported ? `история ${res.historyImported}` : "",
        res.historyRemaining ? `ещё ${res.historyRemaining} старых` : "",
        res.qtyBackfilled ? `факт ${res.qtyBackfilled}` : "",
        res.skipped ? `пропуск ${res.skipped}` : "",
      ].filter(Boolean)
      setVekasSyncHint(parts.join(" · "))
      if (res.errors.length) {
        setError(res.errors.slice(0, 3).join("; "))
      }
      await loadPlans({ silent: true })
    } catch (e) {
      setError(formatApsUserError(e instanceof Error ? e.message : "Не удалось опросить Векас").title)
    } finally {
      setVekasSyncing(false)
    }
  }, [loadPlans])

  useEffect(() => {
    let active = true
    void listDirectoryWarehouses()
      .then((res) => {
        if (!active) return
        setWorkshopOptions((res.warehouses || []).filter(isWorkshopDirectoryRow))
      })
      .catch(() => {
        if (active) setWorkshopOptions([])
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!selectedPlanId) {
      setSelectedPlanDetail(null)
      return
    }
    const fromList = plans.find((p) => p.planId === selectedPlanId)
    if (fromList?.materials?.length) {
      setSelectedPlanDetail(fromList)
      return
    }
    const code = fromList?.code
    if (!code) {
      setSelectedPlanDetail(fromList ?? null)
      return
    }
    let active = true
    setDetailLoading(true)
    void getProductionPlan(code)
      .then((res) => {
        if (active) setSelectedPlanDetail(res.plan)
      })
      .catch(() => {
        if (active) setSelectedPlanDetail(fromList ?? null)
      })
      .finally(() => {
        if (active) setDetailLoading(false)
      })
    return () => {
      active = false
    }
  }, [selectedPlanId, plans])

  const runPlanAction = useCallback(async (fn: () => Promise<{ plan: ProductionPlanRow }>) => {
    setActionLoading(true)
    setError(null)
    try {
      const res = await fn()
      setSelectedPlanDetail(res.plan)
      setPlans((prev) => prev.map((p) => (p.planId === res.plan.planId ? res.plan : p)))
    } catch (e) {
      setError(formatApsUserError(e instanceof Error ? e.message : "Не удалось выполнить действие").title)
    } finally {
      setActionLoading(false)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current)
    }
  }, [])

  const fetchItemSuggestions = useCallback(async (q: string) => {
    const t = q.trim()
    if (t.length < 2) {
      setItemSuggestions([])
      setItemSuggestOpen(false)
      setItemSuggestNoHits(false)
      return
    }
    setItemSuggestLoading(true)
    setItemSuggestNoHits(false)
    try {
      const res = await listItems({ query: t, limit: 20, isActive: true })
      if (!itemFieldRef.current?.contains(document.activeElement)) return
      const rows = res.items ?? []
      setItemSuggestions(rows)
      setItemSuggestNoHits(rows.length === 0)
      setItemSuggestOpen(true)
    } catch {
      setItemSuggestions([])
      setItemSuggestOpen(false)
      setItemSuggestNoHits(false)
    } finally {
      setItemSuggestLoading(false)
    }
  }, [])

  function resetCreateDialog() {
    setEditPlanCode(null)
    setItemCode("")
    setPlannedQty("")
    setPlanDateTo("")
    setWorkshopCode("")
    setLineCode("")
    setNote("")
    setItemSuggestions([])
    setItemSuggestOpen(false)
    setItemSuggestLoading(false)
    setItemSuggestNoHits(false)
    setSelectedItem(null)
    setDialogError(null)
  }

  function onItemCodeInput(value: string) {
    setItemCode(value)
    setDialogError(null)
    setSelectedItem((prev) => (prev && prev.itemCode === value.trim() ? prev : null))
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current)
    const trimmed = value.trim()
    if (trimmed.length < 2) {
      setItemSuggestions([])
      setItemSuggestOpen(false)
      setItemSuggestNoHits(false)
      return
    }
    suggestTimerRef.current = setTimeout(() => {
      void fetchItemSuggestions(value)
    }, 280)
  }

  function pickItem(row: WmsItemListRow) {
    setItemCode(row.itemCode)
    setSelectedItem({
      itemCode: row.itemCode,
      name: row.name,
      hasActiveSpec: row.hasActiveSpec !== false,
    })
    setItemSuggestions([])
    setItemSuggestOpen(false)
    setItemSuggestNoHits(false)
    setDialogError(null)
  }

  const filteredPlans = useMemo(
    () => plans.filter((p) => matchesFilter(p, filter) && apsPlanMatchesQuery(p, query)),
    [plans, filter, query]
  )
  const dayPlans = useMemo(
    () =>
      filteredPlans.filter((p) => {
        if (planOverlapsDateKey(p, dayKey)) return true
        const watch =
          vekasWatches.find((w) => w.planId && w.planId === p.planId) ??
          vekasWatches.find((w) => w.planCode && w.planCode === p.code)
        return vekasWatchOverlapsDay(watch, dayKey)
      }),
    [dayKey, filteredPlans, vekasWatches]
  )
  const visiblePlanIds = useMemo(() => new Set(filteredPlans.map((plan) => plan.planId)), [filteredPlans])
  const filteredPlanLinks = useMemo(
    () => planLinks.filter((link) => visiblePlanIds.has(link.sourcePlanId) && visiblePlanIds.has(link.targetPlanId)),
    [planLinks, visiblePlanIds]
  )

  const handlePlanDelete = useCallback(
    async (planCode: string) => {
      await deleteProductionPlan(planCode)
      setSelectedPlanId((current) => {
        const deleted = plans.find((p) => p.code === planCode)
        return deleted?.planId === current ? null : current
      })
      setSelectedPlanDetail(null)
      await loadPlans({ silent: true })
    },
    [loadPlans, plans]
  )

  const handleShiftPlan = useCallback(
    async (planCode: string, deltaDays: number) => {
      const plan = plans.find((p) => p.code === planCode)
      if (!plan || deltaDays === 0) return
      if (plan.status === "reserved") {
        setError("Зарезервированный заказ нельзя смещать. Сначала снимите резерв.")
        return
      }

      const nextPlanDate = shiftDateKey(plan.planDate, deltaDays)
      const nextPlanDateTo =
        plan.planDateTo && plan.planDateTo >= plan.planDate
          ? shiftDateKey(plan.planDateTo, deltaDays)
          : null
      setError(null)
      try {
        const res = await updateProductionPlan(plan.code, {
          planDate: nextPlanDate,
          planDateTo: nextPlanDateTo,
          syncCalendar: true,
        })
        setPlans((prev) => prev.map((p) => (p.planId === res.plan.planId ? res.plan : p)))
        setSelectedPlanDetail((current) => (current?.planId === res.plan.planId ? res.plan : current))
      } catch (e) {
        setError(formatApsUserError(e instanceof Error ? e.message : "Не удалось сместить план").title)
        await loadPlans({ silent: true })
      }
    },
    [loadPlans, plans]
  )

  const handleResizePlan = useCallback(
    async (planCode: string, patch: { planDate?: string; planDateTo?: string | null }) => {
      const plan = plans.find((p) => p.code === planCode)
      if (!plan) return
      if (plan.status === "reserved") {
        setError("Зарезервированный заказ нельзя менять. Сначала снимите резерв.")
        return
      }
      const endKey =
        plan.planDateTo && plan.planDateTo >= plan.planDate ? plan.planDateTo : plan.planDate
      const nextStart = patch.planDate ?? plan.planDate
      const nextEnd = patch.planDateTo === undefined ? endKey : patch.planDateTo ?? endKey
      if (nextEnd < nextStart) return

      setError(null)
      try {
        const res = await updateProductionPlan(plan.code, {
          planDate: nextStart,
          planDateTo: nextEnd === nextStart ? null : nextEnd,
          syncCalendar: true,
        })
        setPlans((prev) => prev.map((p) => (p.planId === res.plan.planId ? res.plan : p)))
        setSelectedPlanDetail((current) => (current?.planId === res.plan.planId ? res.plan : current))
      } catch (e) {
        setError(formatApsUserError(e instanceof Error ? e.message : "Не удалось изменить длительность плана").title)
        await loadPlans({ silent: true })
      }
    },
    [loadPlans, plans]
  )

  const handleCreateDependency = useCallback(
    async (sourcePlanId: string, targetPlanId: string) => {
      if (sourcePlanId === targetPlanId) return
      const source = plans.find((p) => p.planId === sourcePlanId)
      const target = plans.find((p) => p.planId === targetPlanId)
      if (!source || !target) return
      if (source.status === "reserved" || target.status === "reserved") {
        setError("Связи нельзя менять у зарезервированных планов.")
        return
      }
      setError(null)
      try {
        await createProductionPlanLink({ sourcePlanId, targetPlanId, type: "e2s", lagDays: 0 })
        setDependencySourcePlanId(null)
        await loadPlans({ silent: true })
        setSelectedPlanId(targetPlanId)
      } catch (e) {
        setError(formatApsUserError(e instanceof Error ? e.message : "Не удалось создать зависимость").title)
      }
    },
    [loadPlans, plans]
  )

  const handleDeleteDependency = useCallback(
    async (linkId: string) => {
      setError(null)
      try {
        await deleteProductionPlanLink(linkId)
        await loadPlans({ silent: true })
      } catch (e) {
        setError(formatApsUserError(e instanceof Error ? e.message : "Не удалось удалить зависимость").title)
      }
    },
    [loadPlans]
  )

  const kpis = useMemo(() => {
    const shortage = plans.filter((p) => p.shortageCount > 0 && p.status !== "reserved").length
    const ready = plans.filter((p) => p.isFullyCovered && p.status !== "reserved").length
    const reserved = plans.filter((p) => p.status === "reserved").length
    const facts = summarizeApsFacts(plans)
    return { total: plans.length, shortage, ready, reserved, ...facts }
  }, [plans])

  const openFactDialog = useCallback((plan: ProductionPlanRow) => {
    setFactDialogPlan(plan)
    setFactDialogOpen(true)
  }, [])

  const openPlanEdit = useCallback(
    (code: string) => {
      const plan = plans.find((p) => p.code === code)
      if (!plan) return
      if (plan.status === "reserved") {
        setError("Зарезервированный заказ нельзя менять. Сначала снимите резерв.")
        return
      }
      setEditPlanCode(code)
      setSelectedPlanId(plan.planId)
      setItemCode(plan.itemCode)
      setSelectedItem({
        itemCode: plan.itemCode,
        name: plan.itemName,
        hasActiveSpec: true,
      })
      setPlannedQty(String(plan.plannedQty))
      setPlanDate(plan.planDate)
      setPlanDateTo(plan.planDateTo && plan.planDateTo >= plan.planDate ? plan.planDateTo : "")
      setWorkshopCode(plan.workshopCode || "")
      setLineCode(plan.lineCode || "")
      setNote(plan.note || "")
      setDialogError(null)
      setDialogOpen(true)
    },
    [plans]
  )

  const openPlanDetail = useCallback((code: string) => {
    const plan = plans.find((p) => p.code === code)
    if (!plan) return
    setSelectedPlanId(plan.planId)
    setDetailDialogOpen(true)
  }, [plans])

  const openLineEventDialog = useCallback((kind: ApsLineEventKind, plan: ProductionPlanRow) => {
    const endKey = plan.planDateTo && plan.planDateTo >= plan.planDate ? plan.planDateTo : plan.planDate
    setLineEventKind(kind)
    setLineEventAfterPlan(plan)
    setLineEventDate(shiftDateKey(endKey, 1))
    setLineEventDialogOpen(true)
  }, [])

  async function handleSaveLineEvent() {
    if (!lineEventAfterPlan || !lineEventDate.trim()) return
    if (!lineEventAfterPlan.workshopCode?.trim()) {
      setError("Сначала укажите цех / линию у заказа — иначе событие не попадёт на нужную шкалу.")
      return
    }
    setLineEventSaving(true)
    setError(null)
    try {
      const [yyyy, mm, dd] = lineEventDate.trim().split("-").map(Number)
      const startAt = new Date(yyyy, (mm || 1) - 1, dd || 1, 9, 0, 0, 0).toISOString()
      const title = lineEventKind === "wash" ? "Мойка линии" : "Профилактика линии"
      await createCalendarEvent({
        typeCode: apsLineEventTypeCode(lineEventKind),
        title,
        description: `После заказа ${lineEventAfterPlan.code}`,
        startAt,
        allDay: true,
        statusCode: "planned",
        severityCode: "info",
        tags: ["aps", lineEventKind],
        refs: {
          workshopCode: lineEventAfterPlan.workshopCode,
          shiftCode: lineEventAfterPlan.lineCode,
          afterPlanId: lineEventAfterPlan.planId,
        },
      })
      setLineEventDialogOpen(false)
      setLineEventAfterPlan(null)
      await loadPlans({ silent: true })
    } catch (e) {
      setError(formatApsUserError(e instanceof Error ? e.message : "Не удалось добавить событие линии").title)
    } finally {
      setLineEventSaving(false)
    }
  }

  const workshopLabel = useCallback(
    (code: string | null | undefined) => {
      const c = (code || "").trim()
      if (!c) return "Без цеха / линии"
      const row = workshopOptions.find((w) => w.code === c)
      return row ? `${row.code} · ${row.name}` : c
    },
    [workshopOptions]
  )

  async function handleSavePlan() {
    const qty = Number(plannedQty.replace(/\s/g, "").replace(",", "."))
    if (!planDate.trim()) {
      setDialogError("Укажите дату начала выпуска.")
      return
    }
    if (planDateTo.trim() && planDateTo.trim() < planDate.trim()) {
      setDialogError("Дата окончания не может быть раньше даты начала.")
      return
    }
    if (!itemCode.trim()) {
      setDialogError("Выберите готовую продукцию из списка или введите точный код номенклатуры.")
      return
    }
    if (!editPlanCode && selectedItem?.hasActiveSpec === false) {
      setDialogError(PRODUCTION_SPEC_MISSING_TITLE)
      return
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setDialogError("Количество должно быть больше 0")
      return
    }
    setSaving(true)
    setDialogError(null)
    setError(null)
    try {
      if (editPlanCode) {
        await updateProductionPlan(editPlanCode, {
          planDate: planDate.trim(),
          planDateTo: planDateTo.trim() || null,
          plannedQty: qty,
          workshopCode: workshopCode.trim() || null,
          lineCode: lineCode.trim() || null,
          note: note.trim() || null,
          syncCalendar: true,
        })
        setDialogOpen(false)
        resetCreateDialog()
        await loadPlans({ silent: true })
        const mrp = await refreshProductionPlanMaterials(editPlanCode)
        setSelectedPlanId(mrp.plan.planId)
        setSelectedPlanDetail(mrp.plan)
        setPlans((prev) => prev.map((p) => (p.planId === mrp.plan.planId ? mrp.plan : p)))
      } else {
        const res = await createProductionPlan({
          planDate: planDate.trim(),
          planDateTo: planDateTo.trim() || null,
          itemCode: itemCode.trim(),
          plannedQty: qty,
          workshopCode: workshopCode.trim() || null,
          lineCode: lineCode.trim() || null,
          note: note.trim() || null,
          syncCalendar: true,
        })
        setDialogOpen(false)
        resetCreateDialog()
        await loadPlans({ silent: true })
        setSelectedPlanId(res.plan.planId)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : editPlanCode ? "Не удалось сохранить план" : "Не удалось создать план"
      if (isMissingActiveSpecMessage(message)) {
        setDialogError(PRODUCTION_SPEC_MISSING_TITLE)
      } else {
        setDialogError(message)
      }
    } finally {
      setSaving(false)
    }
  }

  function shiftMonth(delta: number) {
    setMonth(new Date(year, monthIdx + delta, 1))
  }

  function openDayView(key: string) {
    setDayKey(key)
    setCalendarView("day")
    const [y, m] = key.split("-").map(Number)
    if (y !== year || m - 1 !== monthIdx) {
      setMonth(new Date(y, (m || 1) - 1, 1))
    }
  }

  function shiftCalendar(delta: number) {
    if (calendarView === "day") {
      openDayView(shiftDateKey(dayKey, delta))
      return
    }
    shiftMonth(delta)
  }

  function goToday() {
    const today = toDateKey(new Date())
    setMonth(new Date())
    setDayKey(today)
  }

  function setCalendarScale(view: CalendarView) {
    if (view === "day") {
      const today = toDateKey(new Date())
      const currentMonth = today.startsWith(`${year}-${String(monthIdx + 1).padStart(2, "0")}`)
      const selected = selectedPlanDetail ?? plans.find((p) => p.planId === selectedPlanId) ?? null
      const nextKey = selected?.planDate || (currentMonth ? today : toDateKey(new Date(year, monthIdx, 1)))
      setDayKey(nextKey)
    }
    setCalendarView(view)
  }

  const weekKeys = useMemo(() => {
    const [y, m, d] = dayKey.split("-").map(Number)
    const date = new Date(y, (m || 1) - 1, d || 1)
    const monday = new Date(date)
    monday.setDate(date.getDate() - ((date.getDay() + 6) % 7))
    return Array.from({ length: 7 }, (_, i) => {
      const next = new Date(monday)
      next.setDate(monday.getDate() + i)
      return toDateKey(next)
    })
  }, [dayKey])

  const dayTitle = useMemo(() => {
    const [y, m, d] = dayKey.split("-").map(Number)
    const date = new Date(y, (m || 1) - 1, d || 1)
    const weekday = WEEKDAYS_RU[(date.getDay() + 6) % 7]
    return `${weekday}, ${d} ${MONTHS_GEN_RU[(m || 1) - 1]}`
  }, [dayKey])

  const isTodayView = useMemo(() => {
    const now = new Date()
    if (calendarView === "day") return dayKey === toDateKey(now)
    return year === now.getFullYear() && monthIdx === now.getMonth()
  }, [calendarView, dayKey, monthIdx, year])

  const periodTitle = calendarView === "day" ? dayTitle : `${MONTHS_RU[monthIdx]} ${year}`
  const visibleCount = calendarView === "day" ? dayPlans.length : filteredPlans.length
  const periodHint =
    query || filter !== "all"
      ? `${visibleCount} из ${plans.length}`
      : calendarView === "day"
        ? `${visibleCount} на день`
        : `${visibleCount} на месяц`

  const filterChips = useMemo(
    () => [
      {
        id: "all" as PlanFilter,
        label: "Все",
        count: kpis.total,
        tone: "text-foreground",
        hint: "Все заказы месяца",
      },
      {
        id: "running" as PlanFilter,
        label: "На линии",
        count: kpis.running,
        tone: "text-amber-600 dark:text-amber-400",
        hint: "Партии, которые сейчас в производстве",
      },
      {
        id: "done" as PlanFilter,
        label: "Выпущены",
        count: kpis.done,
        tone: "text-emerald-600 dark:text-emerald-400",
        hint: "Партии с подтверждённым фактом выпуска",
      },
      {
        id: "shortage" as PlanFilter,
        label: "Дефицит",
        count: kpis.shortage,
        tone: "text-red-600 dark:text-red-400",
        hint: "Не хватает материалов по MRP",
      },
      {
        id: "ready" as PlanFilter,
        label: "Готовы",
        count: kpis.ready,
        tone: "text-sky-600 dark:text-sky-400",
        hint: "Материалы посчитаны и покрыты полностью",
      },
      {
        id: "reserved" as PlanFilter,
        label: "Резерв",
        count: kpis.reserved,
        tone: "text-emerald-600 dark:text-emerald-400",
        hint: "Материалы зарезервированы под заказ",
      },
    ],
    [kpis]
  )

  const pageError = useMemo(() => (error ? formatApsUserError(error) : null), [error])
  const selectedPlan = useMemo(
    () => selectedPlanDetail ?? plans.find((p) => p.planId === selectedPlanId) ?? null,
    [plans, selectedPlanDetail, selectedPlanId]
  )
  const pageErrorItemCode = (selectedPlan?.itemCode || itemCode.trim()) || null
  const vekasWatching = useMemo(
    () => vekasWatches.filter((w) => w.watchState === "watching"),
    [vekasWatches]
  )
  const vekasRecentDone = useMemo(() => {
    const live = new Set(
      vekasWatches
        .filter((w) => w.watchState === "watching")
        .map((w) => `${w.vekasServer}:${w.batchNumber || ""}:${w.gtin || w.vekasBatchId}`)
    )
    const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    return vekasWatches.filter((w) => {
      if (w.watchState !== "completed") return false
      if (live.has(`${w.vekasServer}:${w.batchNumber || ""}:${w.gtin || w.vekasBatchId}`)) return false
      const at = w.finishedAt || w.completedAt || w.productionDate
      if (!at) return false
      const t = new Date(at)
      return !Number.isNaN(t.getTime()) && t >= since
    })
  }, [vekasWatches])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border bg-card px-2.5 py-1.5">
        <h1 className="truncate text-sm font-semibold tracking-tight sm:text-base">
          APS<span className="hidden xl:inline"> · план выпуска</span>
        </h1>

        {/* Счётчики совмещены с фильтрами: одно место вместо KPI-плашек и
            дублирующей полосы статусов. */}
        <div
          role="group"
          aria-label="Фильтр заказов"
          className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {filterChips.map((chip) => {
            const active = filter === chip.id
            return (
              <button
                key={chip.id}
                type="button"
                aria-pressed={active}
                title={chip.hint}
                onClick={() => setFilter(chip.id)}
                className={cn(
                  "flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition-colors",
                  active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {chip.label}
                <span
                  className={cn(
                    "tabular-nums",
                    chip.count === 0 ? "text-muted-foreground/60" : active ? chip.tone : "text-muted-foreground"
                  )}
                >
                  {chip.count}
                </span>
              </button>
            )
          })}
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          {selectedPlan ? (
            <div className="flex items-center gap-0.5 rounded-lg border bg-muted/40 px-1 py-0.5">
              <span
                className="hidden max-w-[130px] truncate px-1 font-mono text-[11px] text-muted-foreground 2xl:inline"
                title={`${selectedPlan.code} · ${selectedPlan.itemName}`}
              >
                {selectedPlan.code}
              </span>
              <ToolbarIconButton
                label="Изменить заказ"
                icon={Pencil}
                disabled={selectedPlan.status === "reserved"}
                onClick={() => openPlanEdit(selectedPlan.code)}
              />
              <ToolbarIconButton
                label="Внести факт выпуска"
                icon={PackageCheck}
                onClick={() => openFactDialog(selectedPlan)}
              />
              <ToolbarIconButton
                label="Материалы и MRP"
                icon={Layers3}
                onClick={() => openPlanDetail(selectedPlan.code)}
              />
              {selectedPlan.status === "reserved" ? (
                <ToolbarIconButton
                  label="Снять резерв материалов"
                  icon={Unlock}
                  disabled={actionLoading}
                  onClick={() => void runPlanAction(() => releaseProductionPlan(selectedPlan.code))}
                />
              ) : (
                <ToolbarIconButton
                  label={
                    selectedPlan.isFullyCovered
                      ? "Зарезервировать материалы"
                      : "Резерв недоступен: есть дефицит материалов"
                  }
                  icon={Lock}
                  disabled={actionLoading || !selectedPlan.isFullyCovered}
                  onClick={() => void runPlanAction(() => reserveProductionPlan(selectedPlan.code))}
                />
              )}
              <ToolbarIconButton
                label="Снять выделение"
                icon={X}
                onClick={() => {
                  setSelectedPlanId(null)
                  setSelectedPlanDetail(null)
                }}
              />
            </div>
          ) : null}
          <ToolbarIconButton
            label={refreshing || loading ? "Обновляем данные…" : "Обновить данные"}
            icon={RefreshCw}
            disabled={loading || refreshing}
            tone={cn("border bg-background", (loading || refreshing) && "[&_svg]:animate-spin")}
            onClick={() => void loadPlans({ silent: plans.length > 0 })}
          />
          <Button
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => {
              resetCreateDialog()
              setPlanDate(calendarView === "day" ? dayKey : toDateKey(new Date(year, monthIdx, 1)))
              setDialogOpen(true)
            }}
          >
            <Plus className="mr-1 size-3.5" />
            Новый заказ
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="size-7 rounded-md"
                title="Ещё действия"
                aria-label="Ещё действия"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Данные с линии</DropdownMenuLabel>
              <DropdownMenuItem disabled={vekasSyncing} onSelect={() => void handleVekasSync()}>
                {vekasSyncing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Factory className="size-4" />
                )}
                Забрать выпуск из Векаса
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setVekasInfoOpen(true)}>
                <Info className="size-4" />
                Партии с линии
                {vekasWatching.length ? (
                  <Badge variant="outline" className="ml-auto font-normal">
                    {vekasWatching.length} в работе
                  </Badge>
                ) : null}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSkitImportOpen(true)}>
                <Upload className="size-4" />
                Импорт плана из СКИТ
              </DropdownMenuItem>
              {selectedPlan ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Партия {selectedPlan.code}
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={selectedPlan.status === "reserved" || actionLoading}
                    onSelect={() => {
                      if (!confirm(`Удалить заказ «${selectedPlan.itemName}»?`)) return
                      void handlePlanDelete(selectedPlan.code)
                    }}
                  >
                    <Trash2 className="size-4" />
                    Удалить заказ
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {pageError ? (
        <div className="max-h-[min(40vh,320px)] shrink-0 overflow-y-auto rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{pageError.title}</p>
                  {pageError.detail ? <p className="mt-1 text-xs font-normal text-destructive/90">{pageError.detail}</p> : null}
                </div>
                <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-destructive" onClick={() => setError(null)}>
                  Закрыть
                </Button>
              </div>
              {pageError.isSpec && pageErrorItemCode ? (
                <ProductionSpecMissingHint
                  itemCode={pageErrorItemCode}
                  itemName={selectedPlan?.itemName ?? selectedItem?.name}
                  className="border-destructive/20 bg-background/80 text-foreground"
                />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Card className="flex h-full min-h-0 flex-col gap-0 overflow-hidden py-0 shadow-none">
            {/* CardHeader по умолчанию добавляет pb-6 при border-b — гасим, иначе
                шапка съедает лишние 24 px высоты у сетки. */}
            <CardHeader className="flex flex-row flex-wrap items-center gap-x-2 gap-y-1.5 border-b px-2 py-1.5 [.border-b]:pb-1.5">
              <Tabs value={calendarView} onValueChange={(v) => setCalendarScale(v as CalendarView)}>
                <TabsList className="h-7 p-0.5">
                  <TabsTrigger value="month" className="h-6 gap-1 px-2 text-[11px]">
                    <CalendarDays className="size-3.5" />
                    Месяц
                  </TabsTrigger>
                  <TabsTrigger value="day" className="h-6 gap-1 px-2 text-[11px]">
                    <Clock className="size-3.5" />
                    День
                  </TabsTrigger>
                  <TabsTrigger value="list" className="h-6 gap-1 px-2 text-[11px]">
                    <Rows3 className="size-3.5" />
                    Список
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="flex items-center gap-0.5">
                <ToolbarIconButton
                  label={calendarView === "day" ? "Предыдущий день" : "Предыдущий месяц"}
                  icon={ChevronLeft}
                  onClick={() => shiftCalendar(-1)}
                />
                <button
                  type="button"
                  onClick={goToday}
                  title="Перейти к сегодняшнему дню"
                  className="flex items-baseline gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-muted"
                >
                  <span className="whitespace-nowrap text-sm font-semibold">{periodTitle}</span>
                  <span className="whitespace-nowrap text-[11px] text-muted-foreground">{periodHint}</span>
                </button>
                <ToolbarIconButton
                  label={calendarView === "day" ? "Следующий день" : "Следующий месяц"}
                  icon={ChevronRight}
                  onClick={() => shiftCalendar(1)}
                />
                {isTodayView ? null : (
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={goToday}>
                    Сегодня
                  </Button>
                )}
              </div>
              <span
                className="hidden items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground xl:inline-flex"
                title={`Выпущено за ${MONTHS_RU[monthIdx].toLowerCase()} ${year}: ${formatApsQty(kpis.producedQty)} шт`}
              >
                <TrendingUp className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                Выпущено
                <strong className="tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatApsQtyShort(kpis.producedQty)}
                </strong>
                шт
              </span>

              <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-1.5 sm:w-auto">
                <div className="relative w-full sm:w-[210px]">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setQuery("")
                    }}
                    placeholder="Партия, номенклатура…"
                    aria-label="Поиск по заказам"
                    className="h-7 pl-7 pr-7 text-xs"
                  />
                  {query ? (
                    <button
                      type="button"
                      aria-label="Очистить поиск"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setQuery("")
                        searchRef.current?.focus()
                      }}
                    >
                      <X className="size-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
            </CardHeader>
            {calendarView === "day" ? (
              <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1">
                {weekKeys.map((key) => {
                  const [, , d] = key.split("-")
                  const date = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(d))
                  const weekday = WEEKDAYS_RU[(date.getDay() + 6) % 7]
                  const active = key === dayKey
                  return (
                    <Button
                      key={key}
                      type="button"
                      variant={active ? "default" : "ghost"}
                      size="sm"
                      className="h-6 min-w-11 gap-1 px-1.5 text-[11px]"
                      onClick={() => openDayView(key)}
                    >
                      <span className={cn(!active && "text-muted-foreground")}>{weekday}</span>
                      <span className="tabular-nums">{Number(d)}</span>
                    </Button>
                  )
                })}
              </div>
            ) : null}
            <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
              <div className="relative min-h-0 flex-1">
                {booting || (loading && plans.length === 0) ? (
                  <WmsTableSkeleton rows={8} columns={6} className="h-full min-h-[240px] rounded-xl border" />
                ) : (calendarView === "day" ? dayPlans : filteredPlans).length === 0 ? (
                  <div className="absolute inset-0 flex min-h-[240px] items-center justify-center rounded-xl border border-dashed bg-muted/15 p-6 text-center">
                    <div className="max-w-md space-y-3">
                      <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        {query ? <Search className="size-6" /> : <PackageOpen className="size-6" />}
                      </div>
                      <div className="space-y-1">
                        <p className="font-medium">
                          {query
                            ? `По запросу «${query}» ничего не нашлось`
                            : calendarView === "day"
                              ? `На ${dayTitle.toLowerCase()} заказов нет`
                              : plans.length === 0
                                ? `На ${MONTHS_RU[monthIdx].toLowerCase()} ${year} заказов нет`
                                : "По выбранному фильтру заказов нет"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {query
                            ? "Поиск идёт по номеру партии, номенклатуре, артикулу, цеху и смене в пределах выбранного месяца."
                            : calendarView === "day"
                              ? "Переключите день стрелками или вернитесь к месяцу."
                              : plans.length === 0
                                ? "Создайте первый производственный заказ. После расчёта он появится в списке и на календаре."
                                : "Выберите другой статус, чтобы снова увидеть планы месяца."}
                        </p>
                      </div>
                      {query ? (
                        <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                          Сбросить поиск
                        </Button>
                      ) : calendarView === "day" ? (
                        <Button variant="outline" size="sm" onClick={() => setCalendarView("month")}>
                          К месяцу
                        </Button>
                      ) : plans.length > 0 ? (
                        <Button variant="outline" size="sm" onClick={() => setFilter("all")}>
                          Показать все заказы
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="absolute inset-0 min-h-0">
                    {calendarView === "list" ? (
                      <ProductionPlansTable
                        plans={filteredPlans}
                        selectedPlanId={selectedPlanId}
                        onSelectPlan={setSelectedPlanId}
                        onOpenMrp={openPlanDetail}
                        onEditPlan={openPlanEdit}
                        onEnterFact={openFactDialog}
                        query={query}
                      />
                    ) : calendarView === "day" ? (
                      <ProductionDayCalendar
                        plans={dayPlans}
                        links={filteredPlanLinks}
                        lineEvents={lineEvents}
                        dayKey={dayKey}
                        watches={vekasWatches}
                        selectedPlanId={selectedPlanId}
                        dependencySourcePlanId={dependencySourcePlanId}
                        onSelectPlan={setSelectedPlanId}
                        onOpenMrp={openPlanDetail}
                        onEditPlan={openPlanEdit}
                        onShiftPlan={handleShiftPlan}
                        onCreateDependency={handleCreateDependency}
                        onDeleteDependency={handleDeleteDependency}
                        onSetDependencySource={setDependencySourcePlanId}
                        onRequestLineEvent={openLineEventDialog}
                      />
                    ) : (
                      <ProductionMonthCalendar
                        plans={filteredPlans}
                        links={filteredPlanLinks}
                        lineEvents={lineEvents}
                        year={year}
                        monthIdx={monthIdx}
                        selectedPlanId={selectedPlanId}
                        dependencySourcePlanId={dependencySourcePlanId}
                        onSelectPlan={setSelectedPlanId}
                        onOpenMrp={openPlanDetail}
                        onEditPlan={openPlanEdit}
                        onShiftPlan={handleShiftPlan}
                        onResizePlan={handleResizePlan}
                        onCreateDependency={handleCreateDependency}
                        onDeleteDependency={handleDeleteDependency}
                        onSetDependencySource={setDependencySourcePlanId}
                        onRequestLineEvent={openLineEventDialog}
                        onOpenDay={openDayView}
                      />
                    )}
                  </div>
                )}
                {refreshing ? (
                  <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden rounded-t-xl bg-primary/20">
                    <div className="h-full w-1/3 animate-pulse bg-primary" />
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
      </div>

      <Dialog
        open={detailDialogOpen && Boolean(selectedPlan)}
        onOpenChange={(open) => {
          setDetailDialogOpen(open)
          if (!open) setSelectedPlanId(null)
        }}
      >
        <DialogContent className="flex max-h-[92dvh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
          {selectedPlan ? (
            <>
              <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <DialogTitle className="text-left leading-tight">{selectedPlan.itemName}</DialogTitle>
                    <DialogDescription className="text-left">
                      {selectedPlan.code} · {selectedPlan.itemCode} · {selectedPlan.planDate}
                      {selectedPlan.planDateTo ? ` — ${selectedPlan.planDateTo}` : ""}
                    </DialogDescription>
                    {formatApsItemCompositeLine(selectedPlan) ? (
                      <p className="text-sm text-sky-800 dark:text-sky-200">
                        {formatApsItemCompositeLine(selectedPlan)}
                      </p>
                    ) : null}
                    <ApsFactLine plan={selectedPlan} className="!text-sm" />
                  </div>
                  <Badge variant="outline" className={statusBadge(selectedPlan).className}>
                    {statusBadge(selectedPlan).label}
                  </Badge>
                </div>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
                <div className="mb-4 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={actionLoading || detailLoading || selectedPlan.status === "reserved"}
                    onClick={() => void runPlanAction(() => refreshProductionPlanMaterials(selectedPlan.code))}
                  >
                    <RefreshCw className={cn("mr-1.5 size-4", actionLoading && "animate-spin")} />
                    Пересчёт MRP
                  </Button>
                  {selectedPlan.status === "reserved" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={actionLoading || detailLoading}
                      onClick={() => void runPlanAction(() => releaseProductionPlan(selectedPlan.code))}
                    >
                      <Unlock className="mr-1.5 size-4" />
                      Снять резерв
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={actionLoading || detailLoading || !selectedPlan.isFullyCovered}
                      onClick={() => void runPlanAction(() => reserveProductionPlan(selectedPlan.code))}
                    >
                      <Lock className="mr-1.5 size-4" />
                      Зарезервировать
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={actionLoading || detailLoading || selectedPlan.status === "reserved"}
                    onClick={() => {
                      if (!confirm(`Удалить заказ «${selectedPlan.itemName}»?`)) return
                      void handlePlanDelete(selectedPlan.code).then(() => setDetailDialogOpen(false))
                    }}
                  >
                    <Trash2 className="mr-1.5 size-4" />
                    Удалить
                  </Button>
                </div>
                {detailLoading ? (
                  <WmsTableSkeleton rows={4} className="rounded-lg border" />
                ) : (
                  <>
                    {!selectedPlan.isFullyCovered && selectedPlan.status !== "reserved" && selectedPlan.status !== "in_progress" ? (
                      <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                        <AlertTriangle className="size-4 shrink-0" />
                        Не хватает материалов по {selectedPlan.shortageCount} позициям. Резерв недоступен.
                      </div>
                    ) : selectedPlan.status === "in_progress" ? (
                      <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/35 bg-amber-500/8 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                        <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                        План в производстве — резерв нельзя снять до списания по партии в цехе. Остаток может
                        остаться в точке ожидания или быть возвращён на склад материалов.
                      </div>
                    ) : selectedPlan.status === "reserved" ? (
                      <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm">
                        <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                        Материалы зарезервированы на складе OS.
                      </div>
                    ) : (
                      <div className="mb-4 flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-sm">
                        <CheckCircle2 className="size-4 shrink-0 text-sky-600" />
                        Все материалы в наличии — можно резервировать.
                      </div>
                    )}
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/40 text-muted-foreground">
                            <th className="px-4 py-2 text-left font-medium">Материал</th>
                            <th className="px-4 py-2 text-right font-medium">Норма</th>
                            <th className="px-4 py-2 text-right font-medium">Нужно</th>
                            <th className="px-4 py-2 text-right font-medium">Доступно</th>
                            <th className="px-4 py-2 text-right font-medium">Дефицит</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(selectedPlan.materials || []).length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                                Нажмите «Пересчёт MRP», чтобы посчитать потребность по составу.
                              </td>
                            </tr>
                          ) : (
                            (selectedPlan.materials || []).map((m) => (
                              <tr key={m.planMaterialId} className="border-b last:border-0">
                                <td className="px-4 py-2">
                                  <div>{m.itemName}</div>
                                  <div className="text-xs text-muted-foreground">{m.itemCode}</div>
                                </td>
                                <td className="px-4 py-2 text-right tabular-nums">
                                  {fmtQty(m.qtyPer)}
                                  {m.scrapPct > 0 ? ` (+${m.scrapPct}%)` : ""}
                                </td>
                                <td className="px-4 py-2 text-right tabular-nums">{fmtQty(m.requiredQty)}</td>
                                <td className="px-4 py-2 text-right tabular-nums">{fmtQty(m.availableQty)}</td>
                                <td
                                  className={cn(
                                    "px-4 py-2 text-right tabular-nums font-medium",
                                    m.shortageQty > 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
                                  )}
                                >
                                  {m.shortageQty > 0 ? fmtQty(m.shortageQty) : "—"}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
              <DialogFooter className="shrink-0 border-t px-6 py-4">
                <Button variant="outline" onClick={() => setDetailDialogOpen(false)}>
                  Закрыть
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) resetCreateDialog()
        }}
      >
        <DialogContent className="flex max-h-[92dvh] max-w-lg flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
            <DialogTitle>{editPlanCode ? "Изменить производственный заказ" : "Новый производственный заказ"}</DialogTitle>
            <DialogDescription>
              {editPlanCode
                ? "Измените даты, количество, цех/линию и смену. Номенклатура не меняется — MRP пересчитается после сохранения."
                : "Укажите готовую продукцию и объём. Система посчитает, какие материалы понадобятся, по составу продукта в WMS."}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-4">
            <ProductionSpecHelpPanel variant="compact" itemCode={itemCode} />
            <div className="space-y-2">
              <Label htmlFor="aps-item">Номенклатура ГП</Label>
              <p className="text-xs text-muted-foreground">
                Введите код, название или артикул и выберите позицию из списка.
              </p>
              <div ref={itemFieldRef} className="relative">
                <Input
                  id="aps-item"
                  value={itemCode}
                  readOnly={Boolean(editPlanCode)}
                  onChange={(e) => onItemCodeInput(e.target.value)}
                  onFocus={() => {
                    if (itemCode.trim().length >= 2) void fetchItemSuggestions(itemCode)
                  }}
                  onBlur={() => {
                    if (suggestTimerRef.current) {
                      clearTimeout(suggestTimerRef.current)
                      suggestTimerRef.current = null
                    }
                    window.setTimeout(() => setItemSuggestOpen(false), 180)
                  }}
                  placeholder="Например: пиво или GP-BEER-001"
                  disabled={saving || Boolean(editPlanCode)}
                  autoComplete="off"
                />
                {itemSuggestOpen &&
                  itemCode.trim().length >= 2 &&
                  (itemSuggestLoading || itemSuggestions.length > 0 || itemSuggestNoHits) && (
                    <ul
                      className={cn(
                        "absolute left-0 right-0 top-full z-[100] mt-1 max-h-56 overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md",
                        "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95"
                      )}
                      role="listbox"
                    >
                      {itemSuggestLoading && itemSuggestions.length === 0 && !itemSuggestNoHits && (
                        <li className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                          <Loader2 className="size-4 shrink-0 animate-spin" />
                          Поиск…
                        </li>
                      )}
                      {itemSuggestions.map((row) => (
                        <li
                          key={row.itemCode}
                          role="option"
                          aria-selected={selectedItem?.itemCode === row.itemCode}
                        >
                          <button
                            type="button"
                            className="flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => pickItem(row)}
                          >
                            <span className="font-medium leading-tight text-foreground">{row.name}</span>
                            <span className="font-mono text-xs text-muted-foreground">{row.itemCode}</span>
                            {row.nomenclature || row.packagingFormat ? (
                              <span className="text-xs text-sky-800 dark:text-sky-200">
                                {row.nomenclature || row.packagingFormat}
                              </span>
                            ) : null}
                            {row.sku ? (
                              <span className="text-xs text-muted-foreground">Артикул: {row.sku}</span>
                            ) : null}
                            {row.hasActiveSpec === false ? (
                              <span className="text-xs text-amber-600 dark:text-amber-400">
                                Состав не заведён — заказ создать нельзя
                              </span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                      {!itemSuggestLoading && itemSuggestNoHits && (
                        <li className="px-3 py-2 text-sm text-muted-foreground">
                          Ничего не найдено — проверьте написание или создайте позицию в справочнике номенклатуры.
                        </li>
                      )}
                    </ul>
                  )}
              </div>
              {selectedItem?.hasActiveSpec === false ? (
                <ProductionSpecMissingHint itemCode={selectedItem.itemCode} itemName={selectedItem.name} />
              ) : null}
            </div>
            {dialogError ? (
              <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="font-medium">{dialogError}</p>
                    {isMissingActiveSpecMessage(dialogError) ? (
                      <p className="mt-1 text-xs font-normal text-destructive/90">{PRODUCTION_SPEC_MISSING_SUMMARY}</p>
                    ) : null}
                  </div>
                </div>
                {isMissingActiveSpecMessage(dialogError) && itemCode.trim() && selectedItem?.hasActiveSpec !== false ? (
                  <ProductionSpecMissingHint itemCode={itemCode.trim()} itemName={selectedItem?.name} className="border-destructive/20 bg-background/80 text-foreground" />
                ) : null}
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="aps-start">Начало</Label>
                <Input id="aps-start" type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="aps-end">Окончание</Label>
                <Input id="aps-end" type="date" value={planDateTo} onChange={(e) => setPlanDateTo(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="aps-qty">Плановый выпуск</Label>
              <Input id="aps-qty" value={plannedQty} onChange={(e) => setPlannedQty(e.target.value)} className="tabular-nums" />
            </div>
            <Separator />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="aps-workshop">Цех / линия</Label>
                <Select
                  value={workshopCode.trim() || WORKSHOP_NONE}
                  onValueChange={(v) => setWorkshopCode(v === WORKSHOP_NONE ? "" : v)}
                >
                  <SelectTrigger id="aps-workshop">
                    <SelectValue placeholder="Выберите из справочника цехов" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={WORKSHOP_NONE}>Не указан</SelectItem>
                    {workshopOptions.map((row) => (
                      <SelectItem key={row.code} value={row.code}>
                        {row.code} · {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="aps-shift">Смена</Label>
                <Select value={lineCode.trim() || SHIFT_NONE} onValueChange={(v) => setLineCode(v === SHIFT_NONE ? "" : v)}>
                  <SelectTrigger id="aps-shift">
                    <SelectValue placeholder="Смена" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SHIFT_NONE}>Не указана</SelectItem>
                    <SelectItem value="1">Смена 1</SelectItem>
                    <SelectItem value="2">Смена 2</SelectItem>
                    <SelectItem value="3">Смена 3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="aps-note">Комментарий</Label>
              <Textarea id="aps-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t bg-background px-6 py-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => void handleSavePlan()}
              disabled={saving || (!editPlanCode && selectedItem?.hasActiveSpec === false)}
            >
              {saving ? "Сохранение…" : editPlanCode ? "Сохранить и пересчитать MRP" : "Создать и рассчитать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lineEventDialogOpen} onOpenChange={setLineEventDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{lineEventKind === "wash" ? "Мойка линии" : "Профилактика линии"}</DialogTitle>
            <DialogDescription>
              {lineEventAfterPlan
                ? `Вставка между заказами на линии ${workshopLabel(lineEventAfterPlan.workshopCode)} после ${lineEventAfterPlan.code}.`
                : "Укажите день события на шкале."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="line-event-date">День на календаре</Label>
            <Input
              id="line-event-date"
              type="date"
              value={lineEventDate}
              onChange={(e) => setLineEventDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              По умолчанию — следующий день после окончания выбранного заказа. Сдвиньте дату, если мойка нужна между двумя планами.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLineEventDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={() => void handleSaveLineEvent()} disabled={lineEventSaving || !lineEventDate.trim()}>
              {lineEventSaving ? "Сохранение…" : "Добавить на шкалу"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SkitProductionImportDialog
        open={skitImportOpen}
        onOpenChange={setSkitImportOpen}
        defaultMonthKey={`${year}-${String(monthIdx + 1).padStart(2, "0")}`}
        onImported={() => void loadPlans({ silent: false })}
      />

      <ProductionFactDialog
        plan={factDialogPlan}
        open={factDialogOpen}
        onOpenChange={setFactDialogOpen}
        onSaved={() => loadPlans({ silent: true })}
      />

      <Dialog open={vekasInfoOpen} onOpenChange={setVekasInfoOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Партии с линии</DialogTitle>
            <DialogDescription>
              {vekasSyncHint || "Данные приходят из Векаса: пока партия в работе, количество не публикуется."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Сейчас в работе</p>
              {vekasWatching.length ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {vekasWatching.map((w) => (
                    <Badge key={w.watchId} variant="outline" className="font-normal">
                      {w.batchNumber || w.vekasBatchId} · {vekasServerLabel(w.vekasServer)} · {vekasStatusLabel(w.vekasStatus)}
                      {w.productName ? ` · ${w.productName}` : ""}
                      {w.lastError ? ` · ${w.lastError}` : ""}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-muted-foreground">Отслеживаемых партий в производстве нет.</p>
              )}
            </div>
            {vekasRecentDone.length ? (
              <div className="border-t border-border/60 pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Закрыты за 3 дня
                </p>
                <div className="mt-1.5 flex max-h-60 flex-wrap gap-1.5 overflow-y-auto">
                  {vekasRecentDone.map((w) => (
                    <Badge key={w.watchId} variant="secondary" className="font-normal">
                      {w.batchNumber || w.vekasBatchId}
                      {w.producedQty != null ? ` · ${fmtQty(w.producedQty)} шт` : ""}
                      {w.productName ? ` · ${w.productName}` : ""}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={vekasSyncing}
              onClick={() => void handleVekasSync()}
            >
              {vekasSyncing ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Factory className="mr-1.5 size-4" />
              )}
              Забрать выпуск из Векаса
            </Button>
            <Button onClick={() => setVekasInfoOpen(false)}>Закрыть</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
