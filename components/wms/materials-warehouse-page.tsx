"use client"

import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  Factory,
  Filter,
  Package,
  RefreshCw,
  Search,
  Warehouse,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { listMaterialsWarehouse, loadOperatorPickerGroups } from "@/lib/wms-api"
import {
  operatorGroupListFilterNames,
  operatorGroupPickerSectionTitle,
  type OperatorNomenclatureGroup,
  type OperatorPickerGroupsSource,
} from "@/lib/nomenclature-group-catalog"
import { productGroupIconSrc, productGroupIconSrcForRow } from "@/lib/wms-product-group-icons"
import { cn } from "@/lib/utils"
import {
  computeStickerExpiryTier,
  daysSinceEmission,
  DEFAULT_STICKER_SHELF_LIFE_DAYS,
  STICKER_CRITICAL_DAYS_SINCE_EMISSION,
  STICKER_WARN_DAYS_SINCE_EMISSION,
  type StickerExpiryTier,
} from "@/lib/wms/expiry-sticker"
import {
  MATERIAL_FAMILY_META,
  QUALITY_STATUS_META,
  type MaterialFamily,
  type QualityStatus,
} from "@/lib/wms/materials-methods"
import type { MaterialsWarehouseRow } from "@/lib/wms/materials-warehouse"
import {
  WmsEmptyState,
  WmsErrorState,
  WmsLoadingState,
  WmsTableSkeleton,
} from "@/components/wms/wms-shared"
import {
  DraggableColumnHead,
  TableColumnsButton,
  useTableColumnLayout,
} from "@/components/wms/table-columns"

const MATERIALS_WAREHOUSE = {
  title: "Склад материалов",
  itemTypeCode: "stickers,materials,packaging,components,equipment",
  basePath: "/warehouse-stock/materials",
} as const

const VIEW_FILTERS = ["all", "issue", "quarantine", "fefo", "fifo", "min", "dead", "aging", "kanban"] as const
type ViewFilter = (typeof VIEW_FILTERS)[number]

function parseGroupFilterFromUrl(sp: { getAll: (k: string) => string[] }): { bare: boolean; names: string[] } {
  const parts = sp.getAll("g")
  if (parts.length === 0) return { bare: false, names: [] }
  const bare = parts.includes("__bare__")
  const names = parts
    .filter((p) => p !== "__bare__" && p !== "__all__")
    .map((p) => {
      try {
        return decodeURIComponent(p)
      } catch {
        return p
      }
    })
  return { bare, names }
}

function parseViewFilter(raw: string | null): ViewFilter {
  const v = (raw ?? "").trim().toLowerCase()
  return (VIEW_FILTERS as readonly string[]).includes(v) ? (v as ViewFilter) : "all"
}

function writeFiltersUrl(
  router: ReturnType<typeof useRouter>,
  basePath: string,
  bare: boolean,
  names: string[],
  view: ViewFilter
) {
  const params = new URLSearchParams()
  if (view !== "all") params.set("view", view)
  if (bare) params.append("g", "__bare__")
  for (const n of names) params.append("g", n)
  const qs = params.toString()
  router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false })
}

function GroupModalPickItem({
  iconLabel,
  title,
  description,
  selected,
  onSelectionChange,
  badge,
}: {
  iconLabel: string
  title: string
  description?: string | null
  selected: boolean
  onSelectionChange: (next: boolean) => void
  badge?: ReactNode
}) {
  const src = productGroupIconSrc(iconLabel)
  const desc = description?.trim() ?? ""
  const thumbClass = "relative size-16 shrink-0 overflow-hidden rounded-xl bg-muted/30 ring-1 sm:size-[4.5rem]"
  return (
    <Item
      variant="outline"
      size="default"
      role="button"
      tabIndex={0}
      onClick={() => onSelectionChange(!selected)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onSelectionChange(!selected)
        }
      }}
      className={cn(
        "w-full flex-nowrap cursor-pointer rounded-xl shadow-xs transition-colors hover:bg-accent/40",
        selected && "border-primary bg-primary/5 ring-1 ring-primary/25"
      )}
    >
      <ItemMedia className="flex w-auto shrink-0 flex-row items-center gap-3 self-center pr-1">
        <div
          className="flex shrink-0 items-center"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox checked={selected} onCheckedChange={(v) => onSelectionChange(v === true)} />
        </div>
        {src ? (
          <div className={cn(thumbClass, selected ? "ring-primary/50" : "ring-border")}>
            <Image src={src} alt="" width={72} height={72} className="size-full object-cover" sizes="72px" />
          </div>
        ) : (
          <div
            className={cn(
              "flex size-16 shrink-0 items-center justify-center rounded-xl border border-dashed bg-muted/50 text-muted-foreground sm:size-[4.5rem]",
              selected && "border-primary/40 bg-primary/10 text-primary"
            )}
          >
            <Package className="size-6 opacity-70" aria-hidden />
          </div>
        )}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="flex flex-wrap items-center gap-2 text-foreground">
          <span className="min-w-0 truncate">{title}</span>
          {badge}
        </ItemTitle>
        {desc ? <ItemDescription className="line-clamp-4 text-pretty">{desc}</ItemDescription> : null}
      </ItemContent>
      <ItemActions className="shrink-0 text-muted-foreground">
        <ChevronRight className="size-4 opacity-60" aria-hidden />
      </ItemActions>
    </Item>
  )
}

function fmtQty(n: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(n)
}

function ruDaysWord(n: number) {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return "дней"
  if (b === 1) return "день"
  if (b >= 2 && b <= 4) return "дня"
  return "дней"
}

function daysUntilMidnightUtc(iso: string): number | null {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(iso)
  end.setHours(0, 0, 0, 0)
  return Math.round((end.getTime() - start.getTime()) / 86400000)
}

function resolveNearestExpiryIso(row: MaterialsWarehouseRow): string | null {
  if (row.nearestExpiryAt) return row.nearestExpiryAt
  if (!row.lotManufacturedAtMin || !row.shelfLifeDays) return null
  const emission = new Date(row.lotManufacturedAtMin)
  if (Number.isNaN(emission.getTime())) return null
  const shelf = Number(row.shelfLifeDays) || DEFAULT_STICKER_SHELF_LIFE_DAYS
  emission.setDate(emission.getDate() + shelf)
  return emission.toISOString()
}

function resolveStickerTier(row: MaterialsWarehouseRow): StickerExpiryTier {
  if (row.urgency === "expired") return "expired"
  if (row.urgency === "issue") return "critical"
  if (row.urgency === "soon") return "warning"
  if (!row.isPerishable || !row.lotManufacturedAtMin) return "ok"
  const daysSince = daysSinceEmission(row.lotManufacturedAtMin)
  if (daysSince == null) return "ok"
  return computeStickerExpiryTier(daysSince)
}

function stickerTierRowClass(tier: StickerExpiryTier): string {
  if (tier === "critical" || tier === "expired") return "wms-ag-row wms-ag-row--critical"
  if (tier === "warning") return "wms-ag-row wms-ag-row--warn"
  return "wms-ag-row"
}

type SortKey =
  | "name"
  | "itemCode"
  | "group"
  | "profile"
  | "policy"
  | "quality"
  | "lot"
  | "available"
  | "reserved"
  | "expiry"

type SortDir = "asc" | "desc"

function compareNullableString(a: string | null | undefined, b: string | null | undefined): number {
  const aa = (a ?? "").trim().toLocaleLowerCase("ru")
  const bb = (b ?? "").trim().toLocaleLowerCase("ru")
  if (!aa && !bb) return 0
  if (!aa) return 1
  if (!bb) return -1
  return aa.localeCompare(bb, "ru")
}

function SortHeader({
  label,
  active,
  dir,
  align = "left",
  onClick,
}: {
  label: string
  active: boolean
  dir: SortDir
  align?: "left" | "right"
  onClick: () => void
}) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("inline-flex w-full items-center gap-1.5", align === "right" && "justify-end")}
    >
      <span>{label}</span>
      <Icon className={cn("h-3 w-3 shrink-0", active ? "text-primary" : "opacity-40")} aria-hidden />
    </button>
  )
}

function ExpiryCell({ row }: { row: MaterialsWarehouseRow }) {
  if (!row.isPerishable && !row.nearestExpiryAt && !row.lotManufacturedAtMin) {
    return <span className="text-muted-foreground">FIFO · без срока</span>
  }
  const iso = resolveNearestExpiryIso(row)
  const tier = resolveStickerTier(row)
  const daysSince =
    row.lotManufacturedAtMin != null ? daysSinceEmission(row.lotManufacturedAtMin) : null

  if (!iso) {
    if (daysSince != null && tier !== "ok") {
      const shelf = Number(row.shelfLifeDays) || DEFAULT_STICKER_SHELF_LIFE_DAYS
      const daysLeft = Math.max(0, shelf - daysSince)
      return (
        <span className={cn(tier === "critical" || tier === "expired" ? "text-destructive" : "text-sky-700 dark:text-sky-300")}>
          эмиссия +{daysSince} дн. · осталось ~{daysLeft} дн.
        </span>
      )
    }
    return <span className="text-muted-foreground">нет даты срока</span>
  }

  const d = daysUntilMidnightUtc(iso)
  const dateStr = new Date(iso).toLocaleDateString("ru-RU")
  if (d == null) return <span>{dateStr}</span>

  if (tier === "critical" || tier === "expired") {
    return (
      <span className="font-medium text-destructive">
        {d < 0 ? "просрочено" : `${d} ${ruDaysWord(d)}`} · {dateStr}
        {daysSince != null ? (
          <span className="mt-0.5 block text-[11px] font-normal opacity-90">
            эмиссия +{daysSince} дн. (красная зона с {STICKER_CRITICAL_DAYS_SINCE_EMISSION})
          </span>
        ) : null}
      </span>
    )
  }

  if (tier === "warning") {
    return (
      <span className="font-medium text-sky-700 dark:text-sky-300">
        {d} {ruDaysWord(d)} · {dateStr}
        {daysSince != null ? (
          <span className="mt-0.5 block text-[11px] font-normal opacity-90">
            эмиссия +{daysSince} дн. (синяя зона с {STICKER_WARN_DAYS_SINCE_EMISSION})
          </span>
        ) : null}
      </span>
    )
  }

  const warn = row.expiryWarningDays != null && d >= 0 && d <= row.expiryWarningDays
  if (d < 0) {
    return <span className="text-destructive">просрочено · {dateStr}</span>
  }
  if (d === 0) {
    return <span className="font-medium text-chart-4">сегодня · {dateStr}</span>
  }
  return (
    <span className={cn(warn && "font-medium text-chart-4")}>
      {d} {ruDaysWord(d)} · {dateStr}
    </span>
  )
}

function QualityCell({ status }: { status: QualityStatus }) {
  const meta = QUALITY_STATUS_META[status]
  return (
    <span
      title={meta.hint}
      className={cn(
        "wms-ag-status",
        status === "RELEASED" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
        status === "QUARANTINE" && "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
        status === "HOLD" && "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200",
        status === "REJECTED" && "border-destructive/40 bg-destructive/10 text-destructive"
      )}
    >
      {meta.label}
    </span>
  )
}

function LotCell({ row }: { row: MaterialsWarehouseRow }) {
  if (!row.lotCode && !row.vendorLot) {
    return <span className="text-muted-foreground">{row.lotCount > 0 ? `${row.lotCount} парт.` : "—"}</span>
  }
  return (
    <span className="leading-snug">
      <span className="font-mono text-xs text-foreground">{row.lotCode || "—"}</span>
      {row.vendorLot && row.vendorLot !== row.lotCode ? (
        <span className="mt-0.5 block text-[11px] text-muted-foreground">пост. {row.vendorLot}</span>
      ) : null}
      {row.fefoLocationCode ? (
        <span className="mt-0.5 block text-[11px] text-muted-foreground">{row.fefoLocationCode}</span>
      ) : null}
    </span>
  )
}

function itemGroupDisplay(
  row: MaterialsWarehouseRow,
  groupByCode: Map<string, OperatorNomenclatureGroup>
): string {
  const ig = row.itemGroupCode?.trim()
  if (ig) {
    const g = groupByCode.get(ig)
    if (g?.name) return g.name
    for (const grp of groupByCode.values()) {
      if ((grp.aliasCodes ?? []).some((a) => a.toLowerCase() === ig.toLowerCase())) return grp.name
    }
    return ig
  }
  return row.productGroup?.trim() || "—"
}

const MATERIALS_TABLE_COLUMNS = [
  { id: "name", label: "Наименование" },
  { id: "itemCode", label: "Артикул/GTIN" },
  { id: "group", label: "Группа" },
  { id: "profile", label: "Профиль" },
  { id: "policy", label: "Политика" },
  { id: "quality", label: "Статус" },
  { id: "lot", label: "Партия" },
  { id: "available", label: "Доступно" },
  { id: "reserved", label: "Резерв" },
  { id: "expiry", label: "Срок / FEFO" },
  { id: "actions", label: "Действия", locked: true },
] as const

const VIEW_CHIPS: Array<{ id: ViewFilter; label: string }> = [
  { id: "all", label: "Все остатки" },
  { id: "issue", label: "В производство" },
  { id: "min", label: "Min / max" },
  { id: "kanban", label: "Kanban" },
  { id: "dead", label: "Dead stock" },
  { id: "aging", label: "Возраст" },
  { id: "quarantine", label: "Карантин / брак" },
  { id: "fefo", label: "FEFO" },
  { id: "fifo", label: "FIFO" },
]

function MaterialsWarehousePageInner() {
  const config = MATERIALS_WAREHOUSE
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pickerGroups, setPickerGroups] = useState<OperatorNomenclatureGroup[]>([])
  const [groupsSource, setGroupsSource] = useState<OperatorPickerGroupsSource>("legacy")
  const [groupsLoading, setGroupsLoading] = useState(true)
  const [groupsError, setGroupsError] = useState<string | null>(null)
  const [groupModalOpen, setGroupModalOpen] = useState(false)
  const [modalGroupFilter, setModalGroupFilter] = useState("")
  const [draftBare, setDraftBare] = useState(false)
  const [draftNames, setDraftNames] = useState<string[]>([])

  const { bare: appliedBare, names: appliedNames } = useMemo(
    () => parseGroupFilterFromUrl(searchParams),
    [searchParams]
  )
  const viewFilter = parseViewFilter(searchParams.get("view"))

  const [filter, setFilter] = useState("")
  const [rows, setRows] = useState<MaterialsWarehouseRow[]>([])
  const [tableLoading, setTableLoading] = useState(false)
  const [tableError, setTableError] = useState<string | null>(null)
  const [reloadTrigger, setReloadTrigger] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey>(viewFilter === "issue" ? "expiry" : "name")
  const [sortDir, setSortDir] = useState<SortDir>(viewFilter === "issue" ? "asc" : "asc")
  const tableCols = useTableColumnLayout("materials-stock-v3", MATERIALS_TABLE_COLUMNS)

  const hasGroupFilter = appliedBare || appliedNames.length > 0

  const groupByCode = useMemo(() => {
    const m = new Map<string, OperatorNomenclatureGroup>()
    for (const g of pickerGroups) m.set(g.code, g)
    return m
  }, [pickerGroups])

  const appliedFilterNames = useMemo(() => {
    const names = new Set<string>()
    for (const code of appliedNames) {
      const g = groupByCode.get(code)
      if (g) {
        for (const n of operatorGroupListFilterNames(g)) names.add(n)
      } else {
        names.add(code)
      }
    }
    return [...names]
  }, [appliedNames, groupByCode])

  function groupBadgeLabel(code: string): string {
    return groupByCode.get(code)?.name ?? code
  }

  function openGroupModal() {
    setDraftBare(appliedBare)
    setDraftNames([...appliedNames])
    setModalGroupFilter("")
    setGroupModalOpen(true)
  }

  function toggleDraftName(name: string, checked: boolean) {
    setDraftNames((prev) => (checked ? [...prev, name] : prev.filter((x) => x !== name)))
  }

  function applyDraftFilters() {
    writeFiltersUrl(router, config.basePath, draftBare, draftNames, viewFilter)
    setGroupModalOpen(false)
  }

  function setView(next: ViewFilter) {
    writeFiltersUrl(router, config.basePath, appliedBare, appliedNames, next)
    if (next === "issue") {
      setSortKey("expiry")
      setSortDir("asc")
    }
  }

  const modalFilterNorm = modalGroupFilter.trim().toLowerCase()
  const visibleModalGroups = useMemo(() => {
    if (!modalFilterNorm) return pickerGroups
    return pickerGroups.filter((g) => {
      const label = g.name.toLowerCase()
      return label.includes(modalFilterNorm) || g.code.toLowerCase().includes(modalFilterNorm)
    })
  }, [pickerGroups, modalFilterNorm])

  const issueRows = useMemo(
    () => rows.filter((r) => r.urgency === "issue" || r.urgency === "expired"),
    [rows]
  )
  const quarantineRows = useMemo(
    () => rows.filter((r) => r.qualityStatus !== "RELEASED"),
    [rows]
  )

  const visibleRows = useMemo(() => {
    return rows.filter((r) => {
      if (viewFilter === "issue") return r.urgency === "issue" || r.urgency === "expired"
      if (viewFilter === "quarantine") return r.qualityStatus !== "RELEASED"
      if (viewFilter === "fefo") return r.rotationPolicy === "fefo"
      if (viewFilter === "fifo") return r.rotationPolicy === "fifo"
      if (viewFilter === "min") {
        return (
          r.policyState === "below_min" ||
          r.policyState === "safety" ||
          r.policyState === "reorder" ||
          r.policyState === "above_max"
        )
      }
      if (viewFilter === "kanban") return r.kanban
      if (viewFilter === "dead") return r.deadStock
      if (viewFilter === "aging") return r.agingBand === "old" || r.agingBand === "stale" || r.obsolescence === "high"
      return true
    })
  }, [rows, viewFilter])

  const sortedRows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1
    return [...visibleRows].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case "name":
          cmp = compareNullableString(a.name, b.name)
          break
        case "itemCode":
          cmp = compareNullableString(a.itemCode, b.itemCode)
          break
        case "group":
          cmp = compareNullableString(itemGroupDisplay(a, groupByCode), itemGroupDisplay(b, groupByCode))
          break
        case "profile":
          cmp = compareNullableString(a.profile, b.profile)
          break
        case "policy":
          cmp = compareNullableString(a.policyShort, b.policyShort)
          break
        case "quality":
          cmp = compareNullableString(a.qualityStatus, b.qualityStatus)
          break
        case "lot":
          cmp = compareNullableString(a.lotCode, b.lotCode)
          break
        case "available":
          cmp = Number(a.availableQty ?? 0) - Number(b.availableQty ?? 0)
          break
        case "reserved":
          cmp = Number(a.reservedQty ?? 0) - Number(b.reservedQty ?? 0)
          break
        case "expiry": {
          const rank = (u: MaterialsWarehouseRow["urgency"]) =>
            u === "expired" ? 0 : u === "issue" ? 1 : u === "soon" ? 2 : 3
          cmp = rank(a.urgency) - rank(b.urgency)
          if (cmp !== 0) break
          const ae = resolveNearestExpiryIso(a)
          const be = resolveNearestExpiryIso(b)
          const at = ae ? new Date(ae).getTime() : Number.POSITIVE_INFINITY
          const bt = be ? new Date(be).getTime() : Number.POSITIVE_INFINITY
          cmp = at - bt
          break
        }
      }
      if (cmp === 0) cmp = compareNullableString(a.itemCode, b.itemCode)
      return cmp * dir
    })
  }, [visibleRows, sortKey, sortDir, groupByCode])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
      return
    }
    setSortKey(key)
    setSortDir(key === "available" || key === "reserved" ? "desc" : "asc")
  }

  useEffect(() => {
    let ignore = false
    async function load() {
      setGroupsLoading(true)
      setGroupsError(null)
      try {
        const { groups, source } = await loadOperatorPickerGroups()
        if (!ignore) {
          setPickerGroups(groups || [])
          setGroupsSource(source)
        }
      } catch (e) {
        if (!ignore) setGroupsError(e instanceof Error ? e.message : "Не удалось загрузить группы")
      } finally {
        if (!ignore) setGroupsLoading(false)
      }
    }
    void load()
    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    let ignore = false
    const t = window.setTimeout(async () => {
      setTableLoading(true)
      setTableError(null)
      try {
        const data = await listMaterialsWarehouse({
          query: filter.trim(),
          itemTypeCode: config.itemTypeCode,
          productGroups: hasGroupFilter ? appliedFilterNames : undefined,
          bareProductGroup: hasGroupFilter ? appliedBare : undefined,
        })
        if (ignore) return
        setRows(data.rows || [])
      } catch (e) {
        if (!ignore) {
          setRows([])
          setTableError(e instanceof Error ? e.message : "Не удалось загрузить данные")
        }
      } finally {
        if (!ignore) setTableLoading(false)
      }
    }, 280)
    return () => {
      ignore = true
      window.clearTimeout(t)
    }
  }, [hasGroupFilter, appliedBare, appliedFilterNames, filter, config.itemTypeCode, reloadTrigger])

  return (
    <div>
      <section className="wms-panel w-full min-w-0 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border bg-muted/20 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="mr-1 text-base font-semibold tracking-tight text-foreground">{config.title}</h1>
            <span className="hidden h-4 w-px bg-border sm:block" aria-hidden />
            <Button type="button" variant="default" size="sm" className="rounded-lg" onClick={openGroupModal}>
              <Filter className="mr-1.5 h-3.5 w-3.5" />
              Группы
              {hasGroupFilter ? (
                <Badge variant="secondary" className="ml-1.5 rounded-md tabular-nums">
                  {(appliedBare ? 1 : 0) + appliedNames.length}
                </Badge>
              ) : null}
            </Button>
            {hasGroupFilter ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="rounded-lg text-muted-foreground"
                  onClick={() => writeFiltersUrl(router, config.basePath, false, [], viewFilter)}
                >
                  Сбросить
                </Button>
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {appliedBare ? (
                    <Badge variant="secondary" className="gap-1 rounded-md pr-1 font-normal">
                      Без группы
                      <button
                        type="button"
                        className="inline-flex h-5 w-5 items-center justify-center rounded-md hover:bg-background/80"
                        aria-label="Убрать «Без группы»"
                        onClick={() => writeFiltersUrl(router, config.basePath, false, appliedNames, viewFilter)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </Badge>
                  ) : null}
                  {appliedNames.map((n) => (
                    <Badge key={n} variant="secondary" className="gap-1 rounded-md pr-1 font-normal">
                      {groupBadgeLabel(n)}
                      <button
                        type="button"
                        className="inline-flex h-5 w-5 items-center justify-center rounded-md hover:bg-background/80"
                        aria-label={`Убрать группу ${n}`}
                        onClick={() =>
                          writeFiltersUrl(
                            router,
                            config.basePath,
                            appliedBare,
                            appliedNames.filter((x) => x !== n),
                            viewFilter
                          )
                        }
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </>
            ) : null}
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
            <div className="relative min-w-[12rem] flex-1 lg:w-72 lg:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Поиск по названию, артикулу или партии…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="h-9 rounded-lg bg-card pl-9 shadow-sm"
              />
            </div>
            <span className="tabular-nums text-xs text-muted-foreground">
              {tableLoading ? "…" : `${sortedRows.length} из ${rows.length} поз.`}
            </span>
            <Button variant="outline" size="sm" className="shrink-0 rounded-lg" asChild>
              <Link href="/virtual-warehouse">
                <Warehouse className="mr-1.5 h-3.5 w-3.5" />
                Виртуальный склад
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 rounded-lg"
              onClick={() => setReloadTrigger((t) => t + 1)}
              disabled={tableLoading}
            >
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", tableLoading && "animate-spin")} />
              Обновить
            </Button>
            <TableColumnsButton
              columns={[...MATERIALS_TABLE_COLUMNS]}
              order={tableCols.order}
              hidden={tableCols.hidden}
              setHidden={tableCols.setHidden}
              reorder={tableCols.reorder}
              reset={tableCols.reset}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2">
          {VIEW_CHIPS.map((chip) => {
            const count =
              chip.id === "issue"
                ? issueRows.length
                : chip.id === "quarantine"
                  ? quarantineRows.length
                  : chip.id === "fefo"
                    ? rows.filter((r) => r.rotationPolicy === "fefo").length
                    : chip.id === "fifo"
                      ? rows.filter((r) => r.rotationPolicy === "fifo").length
                      : chip.id === "min"
                        ? rows.filter(
                            (r) =>
                              r.policyState === "below_min" ||
                              r.policyState === "safety" ||
                              r.policyState === "reorder" ||
                              r.policyState === "above_max"
                          ).length
                        : chip.id === "kanban"
                          ? rows.filter((r) => r.kanban).length
                          : chip.id === "dead"
                            ? rows.filter((r) => r.deadStock).length
                            : chip.id === "aging"
                              ? rows.filter(
                                  (r) =>
                                    r.agingBand === "old" ||
                                    r.agingBand === "stale" ||
                                    r.obsolescence === "high"
                                ).length
                              : rows.length
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setView(chip.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  viewFilter === chip.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                {chip.label}
                <span className="tabular-nums opacity-80">{tableLoading ? "…" : count}</span>
              </button>
            )
          })}
          <Link
            href="/warehouse-stock/ops"
            className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Очередь методов
          </Link>
        </div>

        {!tableLoading && issueRows.length > 0 && viewFilter !== "issue" ? (
          <div className="mx-4 mt-3 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-2.5 text-sm">
            <div className="font-medium text-foreground">
              {issueRows.length}{" "}
              {issueRows.length === 1 ? "позиция" : issueRows.length < 5 ? "позиции" : "позиций"} пора запускать в
              производство
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Стикеры, клей и химия со сроком на исходе. FEFO: сначала эта партия, иначе в цех уйдёт свежий приход, а
              старый просрочится на полке.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" size="sm" className="rounded-lg" onClick={() => setView("issue")}>
                Показать эти позиции
              </Button>
              <Button type="button" size="sm" variant="outline" className="rounded-lg" asChild>
                <Link href="/warehouse-stock/workshop">
                  <Factory className="mr-1.5 h-3.5 w-3.5" />
                  Выдача в цех
                </Link>
              </Button>
            </div>
          </div>
        ) : null}

        {tableError ? (
          <WmsErrorState
            className="mx-4 mt-4"
            title="Не удалось загрузить остатки"
            message={tableError}
            onRetry={() => setReloadTrigger((t) => t + 1)}
          />
        ) : null}

        <div className="max-h-[min(82vh,960px)] w-full overflow-auto">
          {tableLoading ? (
            <WmsTableSkeleton rows={10} columns={8} />
          ) : (
            <table className="wms-ag-grid min-w-[1280px]">
              <thead className="sticky top-0 z-10">
                <tr>
                  {tableCols.visible.map((id) => (
                    <DraggableColumnHead
                      key={id}
                      id={id}
                      locked={id === "actions"}
                      className={cn(
                        id !== "actions" && "wms-ag-sortable",
                        id === "name" && "min-w-[22rem]",
                        (id === "itemCode" || id === "expiry" || id === "lot") && "min-w-[8rem]",
                        (id === "group" || id === "profile" || id === "quality") && "min-w-[7rem]",
                        id === "actions" && "w-40 text-right"
                      )}
                      onReorder={tableCols.reorder}
                    >
                      {id === "actions" ? null : (
                        <SortHeader
                          label={MATERIALS_TABLE_COLUMNS.find((c) => c.id === id)?.label || id}
                          active={sortKey === id}
                          dir={sortDir}
                          align={id === "available" || id === "reserved" ? "right" : "left"}
                          onClick={() => toggleSort(id as SortKey)}
                        />
                      )}
                    </DraggableColumnHead>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.length === 0 ? (
                  <tr>
                    <td colSpan={Math.max(1, tableCols.visible.length)} className="!border-0 p-0">
                      <WmsEmptyState
                        title={
                          filter.trim() || hasGroupFilter || viewFilter !== "all"
                            ? "Нет позиций по фильтру"
                            : "На складе материалов нет остатков"
                        }
                        description={
                          viewFilter === "min"
                            ? "Никто не вне min/max и не на точке заказа. Пороги — с карточки или по расходу за 90 дней."
                            : viewFilter === "kanban"
                              ? "Нет сигнала e-Kanban: у линии не меньше min либо нет расхода с OS."
                              : viewFilter === "dead"
                                ? "У всех позиций с остатком был расход за 90 дней."
                                : viewFilter === "aging"
                                  ? "Нет партий старше 90 дней и без близкого срока."
                                  : filter.trim() || hasGroupFilter || viewFilter !== "all"
                                    ? "Измените поиск, сбросьте группы или откройте «Все остатки»."
                                    : "Стикеры, упаковка и материалы появятся после приёмки. Карточки без остатка здесь не показываем — это склад, не справочник."
                        }
                        action={
                          !filter.trim() && !hasGroupFilter && viewFilter === "all" ? (
                            <Button asChild variant="outline" className="rounded-xl">
                              <Link href="/nomenclature">Номенклатура</Link>
                            </Button>
                          ) : undefined
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  sortedRows.map((r) => {
                    const tier = resolveStickerTier(r)
                    return (
                      <tr key={r.itemCode} className={stickerTierRowClass(tier)}>
                        {tableCols.visible.map((id) => (
                          <td
                            key={id}
                            className={cn(
                              id === "itemCode" && "font-mono text-xs text-muted-foreground",
                              id === "group" && "text-muted-foreground",
                              id === "available" && "wms-ag-cell-num font-semibold text-foreground",
                              id === "reserved" && "wms-ag-cell-num text-muted-foreground",
                              (id === "expiry" || id === "lot" || id === "profile") && "text-xs leading-snug",
                              id === "actions" && "text-right"
                            )}
                          >
                            {id === "name" ? (
                              <div className="flex max-w-[28rem] items-center gap-2.5">
                                {(() => {
                                  const src = productGroupIconSrcForRow(r.productGroup, r.name, r.itemCode)
                                  return src ? (
                                    <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-md ring-1 ring-border">
                                      <Image src={src} alt="" width={28} height={28} className="h-full w-full object-cover" sizes="28px" />
                                    </span>
                                  ) : null
                                })()}
                                <div className="min-w-0">
                                  <div className="font-medium leading-snug text-foreground">{r.name}</div>
                                  {r.issueHint ? (
                                    <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                                      {r.issueHint}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            ) : null}
                            {id === "itemCode" ? r.itemCode : null}
                            {id === "group" ? itemGroupDisplay(r, groupByCode) : null}
                            {id === "profile" ? (
                              <span title={`${MATERIAL_FAMILY_META[r.family as MaterialFamily].hint} · ${r.rotationPolicy.toUpperCase()}`}>
                                {r.profile}
                              </span>
                            ) : null}
                            {id === "policy" ? (
                              <span className="text-xs leading-snug" title={r.opsHint || undefined}>
                                {r.policyShort ||
                                  (r.kanban ? "Kanban" : r.deadStock ? "Dead stock" : r.supermarket ? "Супермаркет" : "—")}
                                {r.policyInferred ? (
                                  <span className="mt-0.5 block text-[11px] text-muted-foreground">по расходу</span>
                                ) : null}
                                {r.opsHint && r.policyShort ? (
                                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{r.opsHint}</span>
                                ) : null}
                              </span>
                            ) : null}
                            {id === "quality" ? <QualityCell status={r.qualityStatus} /> : null}
                            {id === "lot" ? <LotCell row={r} /> : null}
                            {id === "available" ? (
                              <span>
                                {fmtQty(Number(r.availableQty ?? 0))}
                                {r.uomCode ? (
                                  <span className="ml-1 text-[11px] font-normal text-muted-foreground">{r.uomCode}</span>
                                ) : null}
                              </span>
                            ) : null}
                            {id === "reserved" ? fmtQty(Number(r.reservedQty ?? 0)) : null}
                            {id === "expiry" ? <ExpiryCell row={r} /> : null}
                            {id === "actions" ? (
                              <div className="inline-flex items-center justify-end gap-1">
                                <Button variant="ghost" size="sm" className="h-7 rounded-md px-2 text-xs" asChild>
                                  <Link href={`/nomenclature/${encodeURIComponent(r.itemCode)}`}>Карточка</Link>
                                </Button>
                                {r.issuable && r.availableQty > 0 ? (
                                  <Button variant="ghost" size="sm" className="h-7 rounded-md px-2 text-xs" asChild>
                                    <Link href={`/warehouse-stock/workshop?item=${encodeURIComponent(r.itemCode)}`}>
                                      В цех
                                    </Link>
                                  </Button>
                                ) : null}
                              </div>
                            ) : null}
                          </td>
                        ))}
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <Dialog open={groupModalOpen} onOpenChange={setGroupModalOpen}>
        <DialogContent className="max-h-[min(90vh,800px)] max-w-lg overflow-hidden sm:max-w-2xl" showCloseButton>
          <DialogHeader>
            <DialogTitle>Фильтр по группам</DialogTitle>
            <p className="text-xs text-muted-foreground">{operatorGroupPickerSectionTitle(groupsSource)}</p>
          </DialogHeader>
          {groupsError ? (
            <WmsErrorState
              className="mb-2"
              title="Не удалось загрузить группы"
              message={groupsError}
            />
          ) : null}
          <Input
            placeholder="Поиск группы…"
            value={modalGroupFilter}
            onChange={(e) => setModalGroupFilter(e.target.value)}
            className="rounded-xl"
          />
          <div className="max-h-[min(52vh,480px)] space-y-3 overflow-y-auto pr-1">
            <GroupModalPickItem
              iconLabel="Без группы"
              title="Без группы"
              selected={draftBare}
              onSelectionChange={setDraftBare}
            />
            {groupsLoading ? (
              <WmsTableSkeleton rows={4} columns={1} />
            ) : visibleModalGroups.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Группы не найдены</div>
            ) : (
              visibleModalGroups.map((g) => {
                const checked = draftNames.includes(g.code)
                return (
                  <GroupModalPickItem
                    key={g.code}
                    iconLabel={g.name}
                    title={g.name}
                    description={g.description}
                    selected={checked}
                    onSelectionChange={(next) => toggleDraftName(g.code, next)}
                    badge={
                      g.itemCount > 0 ? (
                        <Badge variant="outline" className="rounded-md tabular-nums text-[10px] font-normal">
                          {g.itemCount}
                        </Badge>
                      ) : null
                    }
                  />
                )
              })
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => {
                setDraftBare(false)
                setDraftNames([])
              }}
            >
              Очистить
            </Button>
            <Button type="button" variant="secondary" className="rounded-xl" onClick={() => setGroupModalOpen(false)}>
              Отмена
            </Button>
            <Button type="button" className="rounded-xl" onClick={applyDraftFilters}>
              Применить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function MaterialsWarehousePage() {
  return (
    <Suspense fallback={<WmsLoadingState label="Загрузка склада материалов…" className="min-h-[40vh]" />}>
      <MaterialsWarehousePageInner />
    </Suspense>
  )
}
