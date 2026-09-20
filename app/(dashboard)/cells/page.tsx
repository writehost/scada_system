"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  LayoutGrid,
  Layers,
  List,
  Map as MapIcon,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Plus,
  RefreshCw,
  Scale,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { CellsLocationCard } from "@/components/wms/cells/cells-location-card"
import { CellLocationBarcode } from "@/components/wms/cells/cell-location-barcode"
import { CellsPreviewPanel } from "@/components/wms/cells/cells-preview-panel"
import { CellsProfileTemplates } from "@/components/wms/cells/cells-profile-templates"
import { CellsTopologyPanel } from "@/components/wms/cells/cells-topology-panel"
import { useCellsRequestGuard } from "@/components/wms/cells/cells-request-guard"
import {
  CELL_STATUS_META,
  cellHasProfile,
  cellStatusOf,
  buildCreateParentSelectGroups,
  defaultZoneForCreate,
  exportCellsCsv,
  isWorkshopWarehouseCode,
  extractZoneOptions,
  filterCells,
  groupCellsByZone,
  sortCells,
  type CellsFilterState,
  type CellsSortBy,
} from "@/components/wms/cells/cells-utils"
import {
  CELLS_PAGE_SIZE_OPTIONS,
  getCellsPageSize,
  getCellsSortBy,
  getCellsViewMode,
  setCellsPageSize,
  setCellsSortBy,
  setCellsViewMode,
  type CellsPageSize,
} from "@/lib/cells-prefs"
import { StorageSlotProfileForm } from "@/components/wms/storage-slot-profile-form"
import { WaitingCellsCreateDialog } from "@/components/wms/waiting-cells-create-dialog"
import { CellsAiFillDialog } from "@/components/wms/cells-ai-fill-dialog"
import {
  createWmsLocation,
  listDirectoryWarehouses,
  listDirectoryZones,
  listLocations,
  syncFgPlanLocations,
  type WmsLocationRow,
  type WarehouseDirectoryRow,
  type ZoneDirectoryRow,
} from "@/lib/wms-api"
import {
  buildSlotTitle,
  DEFAULT_ZONE_OPTIONS,
  EMPTY_SLOT_PROFILE,
  hasLineEquipment,
  resolveLocationCode,
  formatCellQty,
  formatZoneSelectLabel,
  SLOT_FIELD_HINTS,
  SLOT_FIELD_LABELS,
  SLOT_SELECT_OPTIONS,
  WAREHOUSE_LABELS,
  type StorageSlotProfile,
} from "@/lib/storage-slot-ui"
import { isWorkshopDirectoryRow } from "@/lib/wms/workshop-directory"
import { cn } from "@/lib/utils"

function cellsListHref(opts: { warehouseCode?: string; zoneCode?: string; locationCode?: string } = {}) {
  const qp = new URLSearchParams()
  const warehouseCode = opts.warehouseCode?.trim()
  const zoneCode = opts.zoneCode?.trim()
  const locationCode = opts.locationCode?.trim()
  if (warehouseCode) qp.set("warehouseCode", warehouseCode)
  if (zoneCode) qp.set("zoneCode", zoneCode)
  if (locationCode) qp.set("locationCode", locationCode)
  const qs = qp.toString()
  return qs ? `/cells?${qs}` : "/cells"
}

function replaceWindowPath(href: string) {
  if (typeof window === "undefined") return
  const current = `${window.location.pathname}${window.location.search}`
  if (current === href) return
  window.history.replaceState(window.history.state, "", href)
}

const CONTROL =
  "h-8 rounded-md border border-input bg-background px-2 text-[13px] text-foreground shadow-none outline-none focus-visible:border-ring"

function paginationItems(current: number, total: number): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const items: Array<number | "ellipsis"> = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  if (start > 2) items.push("ellipsis")
  for (let i = start; i <= end; i++) items.push(i)
  if (end < total - 1) items.push("ellipsis")
  items.push(total)
  return items
}

function CellsPageInner() {
  const router = useRouter()
  const search = useSearchParams()

  const [locations, setLocations] = useState<WmsLocationRow[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseDirectoryRow[]>([])
  const [directoryZones, setDirectoryZones] = useState<ZoneDirectoryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [hasFetched, setHasFetched] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [syncingPlan, setSyncingPlan] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const planSyncedRef = useRef(false)

  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<CellsFilterState["status"]>("all")
  const [materialFilter, setMaterialFilter] = useState("")
  const [processFilter, setProcessFilter] = useState("")
  const [profileFilter, setProfileFilter] = useState<CellsFilterState["profile"]>("all")
  const [viewMode, setViewMode] = useState<"cards" | "compact">("cards")
  const [sortBy, setSortBy] = useState<CellsSortBy>("code")
  const [groupByZone, setGroupByZone] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [listPage, setListPage] = useState(1)
  const [pageSize, setPageSize] = useState<CellsPageSize>(25)

  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [mobilePreview, setMobilePreview] = useState(false)
  const [layoutMode, setLayoutMode] = useState<"mobile" | "tablet" | "desktop" | null>(null)
  const [topologyOpen, setTopologyOpen] = useState(true)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const { nextGeneration, isCurrent } = useCellsRequestGuard()

  const [createOpen, setCreateOpen] = useState(false)
  const [aiFillOpen, setAiFillOpen] = useState(false)
  const [waitingCreateOpen, setWaitingCreateOpen] = useState(false)
  const [createdBarcodeCode, setCreatedBarcodeCode] = useState<string | null>(null)
  const [createAdvancedOpen, setCreateAdvancedOpen] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createForm, setCreateForm] = useState({
    warehouseCode: "OS",
    zoneCode: "RECV",
    locationCode: "",
    displayName: "",
    slotProfile: { ...EMPTY_SLOT_PROFILE } as StorageSlotProfile,
  })

  const locationFromUrl = (search.get("locationCode") || search.get("loc") || "").trim()
  const [warehouseCode, setWarehouseCode] = useState(() => (search.get("warehouseCode") || "").trim())
  const [zoneCode, setZoneCode] = useState(() => (search.get("zoneCode") || "").trim())
  const writtenHrefRef = useRef(
    cellsListHref({
      warehouseCode: (search.get("warehouseCode") || "").trim(),
      zoneCode: (search.get("zoneCode") || "").trim(),
    })
  )
  const listFromQuery = useMemo(() => {
    const href = cellsListHref({ warehouseCode, zoneCode })
    return href.includes("?") ? href.slice(href.indexOf("?") + 1) : ""
  }, [warehouseCode, zoneCode])

  const activeZoneKey = warehouseCode && zoneCode ? `${warehouseCode}::${zoneCode}` : null

  const loadLocations = useCallback(
    async (silent = false) => {
      const generation = nextGeneration()
      if (!silent) setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const data = await listLocations({
          warehouseCode: warehouseCode || undefined,
          zoneCode: zoneCode || undefined,
          limit: 2000,
          lite: true,
        })
        if (!isCurrent(generation)) return
        setLocations(data.locations || [])
      } catch (e) {
        if (!isCurrent(generation)) return
        setError(e instanceof Error ? e.message : "Не удалось загрузить ячейки")
      } finally {
        if (isCurrent(generation)) {
          setLoading(false)
          setRefreshing(false)
          setHasFetched(true)
        }
      }
    },
    [warehouseCode, zoneCode, nextGeneration, isCurrent]
  )

  const ensurePlanRows = useCallback(async (force = false): Promise<string | null> => {
    if (!force && planSyncedRef.current) return null
    setSyncingPlan(true)
    try {
      await syncFgPlanLocations()
      planSyncedRef.current = true
      void Promise.all([listDirectoryWarehouses(), listDirectoryZones()])
        .then(([whRes, zoneRes]) => {
          setWarehouses((whRes.warehouses ?? []).filter((w) => w.isActive))
          setDirectoryZones((zoneRes.zones ?? []).filter((z) => z.isActive !== false))
        })
        .catch(() => undefined)
      return null
    } catch (e) {
      return e instanceof Error ? e.message : "Не удалось создать ряды с плана ГП"
    } finally {
      setSyncingPlan(false)
    }
  }, [])

  useEffect(() => {
    void loadLocations()
  }, [loadLocations])

  useEffect(() => {
    setHydrated(true)
  }, [])

  useEffect(() => {
    const syncFromWindow = () => {
      const qp = new URLSearchParams(window.location.search)
      const wh = (qp.get("warehouseCode") || "").trim()
      const zone = (qp.get("zoneCode") || "").trim()
      writtenHrefRef.current = cellsListHref({ warehouseCode: wh, zoneCode: zone })
      setWarehouseCode(wh)
      setZoneCode(zone)
    }
    window.addEventListener("popstate", syncFromWindow)
    return () => window.removeEventListener("popstate", syncFromWindow)
  }, [])

  useEffect(() => {
    if (!locationFromUrl || !hasFetched) return
    setSelectedCode(locationFromUrl.toUpperCase())
    setSearchQuery(locationFromUrl)
  }, [locationFromUrl, hasFetched])

  useEffect(() => {
    void Promise.all([listDirectoryWarehouses(), listDirectoryZones()])
      .then(([whRes, zoneRes]) => {
        setWarehouses((whRes.warehouses ?? []).filter((w) => w.isActive))
        setDirectoryZones((zoneRes.zones ?? []).filter((z) => z.isActive !== false))
      })
      .catch(() => {
        setWarehouses([])
        setDirectoryZones([])
      })
  }, [])

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1440px)")
    const tablet = window.matchMedia("(min-width: 1024px)")
    const apply = () => {
      if (desktop.matches) setLayoutMode("desktop")
      else if (tablet.matches) setLayoutMode("tablet")
      else setLayoutMode("mobile")
    }
    apply()
    desktop.addEventListener("change", apply)
    tablet.addEventListener("change", apply)
    return () => {
      desktop.removeEventListener("change", apply)
      tablet.removeEventListener("change", apply)
    }
  }, [])

  useEffect(() => {
    setViewMode(getCellsViewMode())
    setSortBy(getCellsSortBy())
    setPageSize(getCellsPageSize())
  }, [])

  useEffect(() => {
    setListPage(1)
  }, [
    searchQuery,
    statusFilter,
    materialFilter,
    processFilter,
    profileFilter,
    warehouseCode,
    zoneCode,
    sortBy,
    groupByZone,
    pageSize,
  ])

  const filters: CellsFilterState = useMemo(
    () => ({
      search: searchQuery,
      status: statusFilter,
      warehouseCode,
      zoneCode,
      materialType: materialFilter,
      processType: processFilter,
      profile: profileFilter,
    }),
    [
      searchQuery,
      statusFilter,
      warehouseCode,
      zoneCode,
      materialFilter,
      processFilter,
      profileFilter,
    ]
  )

  const filtered = useMemo(() => filterCells(locations, filters), [locations, filters])
  const sorted = useMemo(() => sortCells(filtered, sortBy), [filtered, sortBy])
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safeListPage = Math.min(listPage, totalPages)
  const pageStartIndex = (safeListPage - 1) * pageSize
  const pagedSorted = useMemo(
    () => sorted.slice(pageStartIndex, pageStartIndex + pageSize),
    [sorted, pageStartIndex, pageSize]
  )
  const zoneGroups = useMemo(() => groupCellsByZone(pagedSorted), [pagedSorted])

  const selectedLocation = useMemo(
    () => filtered.find((l) => l.locationCode === selectedCode) ?? locations.find((l) => l.locationCode === selectedCode) ?? null,
    [filtered, locations, selectedCode]
  )

  const zoneOptions = useMemo(() => extractZoneOptions(locations), [locations])

  const warehouseLabels = useMemo(() => {
    const map: Record<string, string> = { ...WAREHOUSE_LABELS }
    for (const wh of warehouses) {
      const code = wh.code?.trim()
      if (!code) continue
      const metaName =
        typeof wh.meta?.locationName === "string" ? wh.meta.locationName.trim() : ""
      map[code] = wh.name?.trim() || metaName || code
    }
    return map
  }, [warehouses])

  const workshopCodes = useMemo(
    () => warehouses.filter(isWorkshopDirectoryRow).map((wh) => wh.code.trim()).filter(Boolean),
    [warehouses]
  )

  const warehouseOptions = useMemo(() => {
    const map = new Map<string, { code: string; name: string; count: number; isWorkshop: boolean }>()
    for (const wh of warehouses) {
      if (wh.code?.trim()) {
        map.set(wh.code.trim(), {
          code: wh.code.trim(),
          name: wh.name?.trim() || wh.code,
          count: 0,
          isWorkshop: isWorkshopDirectoryRow(wh),
        })
      }
    }
    for (const loc of locations) {
      const code = loc.warehouseCode?.trim()
      if (!code) continue
      const cur = map.get(code) ?? {
        code,
        name: warehouseLabels[code] ?? code,
        count: 0,
        isWorkshop: workshopCodes.includes(code),
      }
      cur.count += 1
      map.set(code, cur)
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"))
  }, [locations, warehouses, warehouseLabels, workshopCodes])

  const warehouseFilterOptions = useMemo(
    () => warehouseOptions.filter((wh) => !wh.isWorkshop),
    [warehouseOptions]
  )
  const workshopFilterOptions = useMemo(
    () => warehouseOptions.filter((wh) => wh.isWorkshop),
    [warehouseOptions]
  )

  const createParentGroups = useMemo(() => {
    const directoryRows = warehouses
      .map((wh) => ({
        code: wh.code?.trim() ?? "",
        name: wh.name?.trim() ?? "",
        warehouseType: wh.warehouseType,
        meta: wh.meta,
      }))
      .filter((r) => r.code)
    if (directoryRows.length > 0) {
      return buildCreateParentSelectGroups(directoryRows, warehouseLabels)
    }
    const fromLocations = warehouseOptions.map((wh) => ({ code: wh.code, name: wh.name }))
    const fallbackRows =
      fromLocations.length > 0
        ? fromLocations
        : Object.entries(WAREHOUSE_LABELS).map(([code, name]) => ({ code, name }))
    return buildCreateParentSelectGroups(fallbackRows, warehouseLabels)
  }, [warehouses, warehouseOptions, warehouseLabels])

  /** Зоны из справочника (Настройки → Зоны). Хардкод — только если для склада зон ещё нет. */
  const zoneOptionsForCreate = useMemo(() => {
    const wh = createForm.warehouseCode.trim()
    const fromDir = directoryZones
      .filter((z) => z.warehouseCode === wh)
      .map((z) => ({
        warehouseCode: z.warehouseCode,
        zoneCode: z.zoneCode,
        zoneName: z.zoneName,
      }))
    const list =
      fromDir.length > 0
        ? fromDir
        : DEFAULT_ZONE_OPTIONS.filter((z) => z.warehouseCode === wh).map((z) => ({
            warehouseCode: z.warehouseCode,
            zoneCode: z.zoneCode,
            zoneName: z.zoneName,
          }))
    return [...list].sort((a, b) =>
      formatZoneSelectLabel(a.zoneCode, a.zoneName, a.warehouseCode).localeCompare(
        formatZoneSelectLabel(b.zoneCode, b.zoneName, b.warehouseCode),
        "ru"
      )
    )
  }, [directoryZones, createForm.warehouseCode])

  const counts = useMemo(() => {
    const byStatus = { free: 0, occupied: 0, reserved: 0, blocked: 0, noProfile: 0 }
    for (const loc of locations) {
      byStatus[cellStatusOf(loc)] += 1
      if (!cellHasProfile(loc)) byStatus.noProfile += 1
    }
    return byStatus
  }, [locations])

  const previewCode = useMemo(() => {
    return (
      createForm.locationCode.trim() ||
      resolveLocationCode(createForm.slotProfile) ||
      ""
    )
  }, [createForm])

  const csvDisabled = !hydrated || !hasFetched || loading || sorted.length === 0
  const showInitialSkeleton = !hasFetched || (loading && locations.length === 0)

  const commitListQuery = useCallback(
    (nextWarehouse: string, nextZone: string) => {
      const wh = nextWarehouse.trim()
      const zone = nextZone.trim()
      setWarehouseCode(wh)
      setZoneCode(zone)
      const href = cellsListHref({ warehouseCode: wh, zoneCode: zone })
      writtenHrefRef.current = href
      replaceWindowPath(href)
      // Next.js keeps stale search params when replacing the same pathname
      // with an empty query — hard-navigate so refresh cannot restore filters.
      if (href === "/cells") {
        window.location.replace("/cells")
        return
      }
      router.replace(href, { scroll: false })
    },
    [router]
  )

  function setWarehouseFilter(code: string | null) {
    commitListQuery(code || "", "")
  }

  const activeFilterCount = [
    statusFilter !== "all",
    Boolean(materialFilter),
    Boolean(processFilter),
    profileFilter !== "all",
    Boolean(warehouseCode),
    Boolean(zoneCode),
  ].filter(Boolean).length
  const hasActiveFilters = activeFilterCount > 0 || Boolean(searchQuery.trim())

  function setZoneFilter(nextWarehouse: string, nextZone: string | null) {
    if (nextZone) {
      commitListQuery(nextWarehouse, nextZone)
      return
    }
    commitListQuery(warehouseCode || nextWarehouse, "")
  }

  const isDesktopLayout = layoutMode !== "mobile" && layoutMode !== "tablet"
  const showTopology = topologyOpen && layoutMode !== "mobile"
  const showDetails = detailsOpen && layoutMode !== "mobile" && layoutMode !== "tablet"

  const selectLocation = useCallback((code: string) => {
    setSelectedCode(code)
    if (layoutMode === "tablet" || layoutMode === "mobile") {
      setMobilePreview(true)
      return
    }
    setDetailsOpen(true)
  }, [layoutMode])

  const openCellFull = useCallback((code: string) => {
    const from = listFromQuery ? `?from=${encodeURIComponent(listFromQuery)}` : ""
    router.push(`/cells/${encodeURIComponent(code)}${from}`)
  }, [listFromQuery, router])

  function changeViewMode(mode: "cards" | "compact") {
    setViewMode(mode)
    setCellsViewMode(mode)
  }

  function changePageSize(next: CellsPageSize) {
    setPageSize(next)
    setCellsPageSize(next)
    setListPage(1)
  }

  function changeSortBy(next: CellsSortBy) {
    setSortBy(next)
    setCellsSortBy(next)
  }

  function downloadCsv() {
    const csv = exportCellsCsv(sorted)
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `cells-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function renderLocationList(list: WmsLocationRow[]) {
    if (viewMode === "cards") {
      return (
        <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
          {list.map((loc) => (
            <CellsLocationCard
              key={loc.locationCode}
              location={loc}
              warehouseLabels={warehouseLabels}
              selected={selectedCode === loc.locationCode}
              onSelect={selectLocation}
              onOpen={openCellFull}
            />
          ))}
        </div>
      )
    }
    return (
      <div className="overflow-hidden rounded-md border border-border/80 bg-card">
        {list.map((loc) => {
          const st = cellStatusOf(loc)
          const meta = CELL_STATUS_META[st]
          const selected = selectedCode === loc.locationCode
          return (
            <button
              key={loc.locationCode}
              type="button"
              onClick={() => selectLocation(loc.locationCode)}
              className={cn(
                "flex w-full items-center gap-2.5 border-b border-l-[3px] border-border/60 px-2.5 py-1.5 text-left text-[13px] last:border-b-0 hover:bg-muted/50",
                meta.accent,
                selected && "bg-primary/[0.06]"
              )}
            >
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta.dot)} />
              <code className="w-[88px] shrink-0 truncate font-mono text-[12px] font-semibold">
                {loc.locationCode}
              </code>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {loc.slotTitle || loc.displayName || loc.zoneName || loc.zoneCode}
              </span>
              <span className="shrink-0 tabular-nums text-[12px]">{formatCellQty(loc.availableQty)}</span>
              <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground">{meta.label}</span>
            </button>
          )
        })}
      </div>
    )
  }

  function resetFilters() {
    setSearchQuery("")
    setStatusFilter("all")
    setMaterialFilter("")
    setProcessFilter("")
    setProfileFilter("all")
    setFiltersOpen(false)
    commitListQuery("", "")
  }

  async function submitCreateLocation() {
    if (!createForm.warehouseCode.trim() || !createForm.zoneCode.trim()) {
      setCreateError("Укажите склад и зону")
      return
    }
    const semanticCode = resolveLocationCode(
      createForm.slotProfile,
      createForm.locationCode
    )
    if (!semanticCode) {
      setCreateError(
        hasLineEquipment(createForm.slotProfile)
          ? "Укажите оборудование (аппликатор) или код ячейки вручную"
          : "Укажите код, оборудование или место на складе (полка)"
      )
      return
    }

    setCreateLoading(true)
    setCreateError(null)
    try {
      await createWmsLocation({
        warehouseCode: createForm.warehouseCode.trim(),
        zoneCode: createForm.zoneCode.trim(),
        locationCode: semanticCode,
        displayName: createForm.displayName.trim() || buildSlotTitle(createForm.slotProfile),
        locationAttrs: { slotProfile: createForm.slotProfile },
      })
      setCreateOpen(false)
      setCreateForm({
        warehouseCode: "OS",
        zoneCode: "RECV",
        locationCode: "",
        displayName: "",
        slotProfile: { ...EMPTY_SLOT_PROFILE },
      })
      await loadLocations(true)
      selectLocation(semanticCode)
      setCreatedBarcodeCode(semanticCode)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Не удалось создать ячейку")
    } finally {
      setCreateLoading(false)
    }
  }

  const secondaryFilterCount = [
    Boolean(materialFilter),
    Boolean(processFilter),
    profileFilter !== "all",
  ].filter(Boolean).length

  const warehouseSelectValue = warehouseFilterOptions.some((wh) => wh.code === warehouseCode)
    ? warehouseCode
    : ""
  const workshopSelectValue = workshopFilterOptions.some((wh) => wh.code === warehouseCode)
    ? warehouseCode
    : ""
  const zoneSelectOptions = zoneOptions.filter((z) => !warehouseCode || z.warehouseCode === warehouseCode)
  const pages = paginationItems(safeListPage, totalPages)

  function applyStatusFilter(key: "all" | "free" | "occupied" | "blocked" | "profile") {
    if (key === "profile") {
      setProfileFilter(profileFilter === "without" ? "all" : "without")
      setStatusFilter("all")
      return
    }
    if (key === "all") {
      setStatusFilter("all")
      setProfileFilter("all")
      return
    }
    setStatusFilter(key)
  }

  const kpiItems = [
    {
      key: "all" as const,
      label: "Всего",
      value: locations.length,
      active: statusFilter === "all" && profileFilter === "all",
      tone: "text-foreground",
    },
    {
      key: "free" as const,
      label: "Свободно",
      value: counts.free,
      active: statusFilter === "free",
      tone: "text-emerald-700 dark:text-emerald-400",
    },
    {
      key: "occupied" as const,
      label: "Занято",
      value: counts.occupied,
      active: statusFilter === "occupied",
      tone: "text-amber-800 dark:text-amber-300",
    },
    {
      key: "blocked" as const,
      label: "Блокировано",
      value: counts.blocked,
      active: statusFilter === "blocked",
      tone: "text-destructive",
    },
    {
      key: "profile" as const,
      label: "Без профиля",
      value: counts.noProfile,
      active: profileFilter === "without",
      tone: "text-muted-foreground",
    },
  ]

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] max-h-[calc(100dvh-7.5rem)] flex-col overflow-hidden">
      <header className="mb-2 shrink-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[21px] font-semibold leading-tight tracking-tight">Ячейки хранения</h1>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Управление адресным хранением, статусами и назначением ячеек
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button size="sm" className="h-8 rounded-md" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Ячейка
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-md"
              onClick={downloadCsv}
              disabled={csvDisabled}
              title="Скачать CSV"
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              CSV
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8 rounded-md" title="Ещё действия">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onSelect={() => setAiFillOpen(true)}>
                  <Sparkles className="mr-2 h-3.5 w-3.5" />
                  Настроить ИИ
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => router.push("/cells/rules")}>
                  <Scale className="mr-2 h-3.5 w-3.5" />
                  Правила
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={loading || refreshing || syncingPlan}
                  onSelect={() => {
                    void (async () => {
                      const syncError = await ensurePlanRows(true)
                      await loadLocations(true)
                      if (syncError) setError(syncError)
                    })()
                  }}
                >
                  <MapIcon className="mr-2 h-3.5 w-3.5" />
                  Ряды ГП
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setWaitingCreateOpen(true)}>
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Ожидание
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={loading || refreshing || syncingPlan}
                  onSelect={() => void loadLocations(true)}
                >
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Обновить
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="mt-3 flex overflow-x-auto rounded-md border border-border/80 bg-card">
          {kpiItems.map((item, index) => (
            <button
              key={item.key}
              type="button"
              onClick={() => applyStatusFilter(item.key)}
              className={cn(
                "flex min-w-[7.5rem] flex-1 items-baseline justify-between gap-3 px-3 py-2 text-left hover:bg-muted/40",
                index < kpiItems.length - 1 && "border-r border-border/80",
                item.active && "bg-muted/60"
              )}
            >
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {item.label}
              </span>
              <span className={cn("text-[15px] font-semibold tabular-nums leading-none", item.tone)}>
                {item.value}
              </span>
            </button>
          ))}
        </div>
      </header>

      <div className="mb-2 shrink-0 rounded-md border border-border/80 bg-card">
        <div className="flex items-center gap-1.5 overflow-x-auto px-2 py-1.5">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск по коду / зоне / назначению"
            className="h-8 rounded-md bg-background pl-8 text-[13px]"
          />
        </div>
        <select
          value={warehouseSelectValue}
          onChange={(e) => setWarehouseFilter(e.target.value || null)}
          className={cn(CONTROL, "max-w-[160px] shrink-0")}
          title="Склад"
        >
          <option value="">Склад</option>
          {warehouseFilterOptions.map((wh) => (
            <option key={wh.code} value={wh.code}>
              {wh.name}
              {wh.count > 0 ? ` (${wh.count})` : ""}
            </option>
          ))}
        </select>
        {workshopFilterOptions.length > 0 ? (
          <select
            value={workshopSelectValue}
            onChange={(e) => setWarehouseFilter(e.target.value || null)}
            className={cn(CONTROL, "max-w-[160px] shrink-0")}
            title="Цех"
          >
            <option value="">Цех</option>
            {workshopFilterOptions.map((wh) => (
              <option key={wh.code} value={wh.code}>
                {wh.name}
                {wh.count > 0 ? ` (${wh.count})` : ""}
              </option>
            ))}
          </select>
        ) : null}
        <select
          value={warehouseCode && zoneCode ? `${warehouseCode}::${zoneCode}` : ""}
          onChange={(e) => {
            const value = e.target.value
            if (!value) {
              setZoneFilter(warehouseCode, null)
              return
            }
            const [wh, zone] = value.split("::")
            if (wh && zone) setZoneFilter(wh, zone)
          }}
          className={cn(CONTROL, "max-w-[140px] shrink-0")}
          title="Зона"
        >
          <option value="">Зона</option>
          {zoneSelectOptions.map((z) => (
            <option key={`${z.warehouseCode}::${z.zoneCode}`} value={`${z.warehouseCode}::${z.zoneCode}`}>
              {z.zoneName || z.zoneCode} ({z.count})
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as CellsFilterState["status"])}
          className={cn(CONTROL, "max-w-[120px] shrink-0")}
          title="Статус"
        >
          <option value="all">Статус</option>
          <option value="free">Свободна</option>
          <option value="occupied">Занята</option>
          <option value="reserved">Резерв</option>
          <option value="blocked">Блок</option>
        </select>
        <Button
          variant={filtersOpen ? "secondary" : "outline"}
          size="sm"
          className="h-8 shrink-0 rounded-md"
          onClick={() => setFiltersOpen((v) => !v)}
        >
          <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
          Фильтры
          {secondaryFilterCount > 0 ? (
            <Badge className="ml-1.5 h-5 rounded px-1.5 text-[10px]">{secondaryFilterCount}</Badge>
          ) : null}
        </Button>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <select
            value={sortBy}
            onChange={(e) => changeSortBy(e.target.value as CellsSortBy)}
            className={CONTROL}
            title="Сортировка"
          >
            <option value="code">По коду</option>
            <option value="title">По названию</option>
            <option value="zone">По зоне</option>
            <option value="fill">По заполнению</option>
            <option value="available">По остатку</option>
          </select>
          <Button
            type="button"
            variant={groupByZone ? "secondary" : "outline"}
            size="sm"
            className="h-8 rounded-md"
            onClick={() => setGroupByZone((v) => !v)}
            title="Группировка по зонам"
          >
            <Layers className="mr-1 h-3.5 w-3.5" />
            По зонам
          </Button>
          <div className="flex rounded-md border border-border/80 p-0.5">
            <Button
              type="button"
              variant={viewMode === "cards" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7 rounded"
              onClick={() => changeViewMode("cards")}
              title="Карточки"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant={viewMode === "compact" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7 rounded"
              onClick={() => changeViewMode("compact")}
              title="Список"
            >
              <List className="h-3.5 w-3.5" />
            </Button>
          </div>
          {layoutMode !== "mobile" ? (
            <Button
              type="button"
              variant={topologyOpen ? "secondary" : "outline"}
              size="icon"
              className="h-8 w-8 rounded-md"
              onClick={() => setTopologyOpen((v) => !v)}
              title={topologyOpen ? "Скрыть топологию" : "Показать топологию"}
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {isDesktopLayout ? (
            <Button
              type="button"
              variant={detailsOpen ? "secondary" : "outline"}
              size="icon"
              className="h-8 w-8 rounded-md"
              onClick={() => setDetailsOpen((v) => !v)}
              title={detailsOpen ? "Скрыть подробности" : "Показать подробности"}
            >
              <PanelRight className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {hasActiveFilters ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-md text-[12px] text-muted-foreground"
              onClick={resetFilters}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Сбросить
            </Button>
          ) : null}
        </div>
        </div>
        {filtersOpen ? (
          <div className="grid gap-2 border-t border-border/80 px-2 py-2 sm:grid-cols-3">
            <label className="text-[12px] font-medium">
              Материал
              <select
                value={materialFilter}
                onChange={(e) => setMaterialFilter(e.target.value)}
                className={cn(CONTROL, "mt-1 w-full max-w-none")}
              >
                <option value="">Все</option>
                {SLOT_SELECT_OPTIONS.materialType.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px] font-medium">
              Процесс
              <select
                value={processFilter}
                onChange={(e) => setProcessFilter(e.target.value)}
                className={cn(CONTROL, "mt-1 w-full max-w-none")}
              >
                <option value="">Все</option>
                {SLOT_SELECT_OPTIONS.processType.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px] font-medium">
              Назначение / профиль
              <select
                value={profileFilter}
                onChange={(e) => setProfileFilter(e.target.value as CellsFilterState["profile"])}
                className={cn(CONTROL, "mt-1 w-full max-w-none")}
              >
                <option value="all">Все</option>
                <option value="with">С профилем</option>
                <option value="without">Без профиля</option>
              </select>
            </label>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mb-2 flex shrink-0 items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
          <p className="min-w-0">{error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 rounded-md"
            onClick={() => void loadLocations(true)}
          >
            Повторить
          </Button>
        </div>
      ) : null}

      {zoneOptions.length > 0 && layoutMode === "mobile" ? (
        <div className="mb-2 flex shrink-0 gap-1 overflow-x-auto pb-0.5">
          <button
            type="button"
            onClick={() => setZoneFilter(warehouseCode || zoneOptions[0]?.warehouseCode || "OS", null)}
            className={cn(
              "shrink-0 rounded-md border px-2 py-1 text-[12px]",
              !zoneCode ? "border-primary bg-primary/10" : "border-border/80"
            )}
          >
            Все зоны
          </button>
          {zoneOptions.map((z) => {
            const key = `${z.warehouseCode}::${z.zoneCode}`
            const active = activeZoneKey === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setZoneFilter(z.warehouseCode, active ? null : z.zoneCode)}
                className={cn(
                  "shrink-0 rounded-md border px-2 py-1 font-mono text-[12px]",
                  active ? "border-primary bg-primary/10" : "border-border/80"
                )}
              >
                {z.zoneCode}
                <span className="ml-1 text-muted-foreground">{z.count}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      <div
        className={cn(
          "grid min-h-0 min-w-0 flex-1 gap-2 overflow-hidden",
          showTopology && showDetails && "grid-cols-[minmax(220px,280px)_minmax(0,1fr)_minmax(300px,360px)]",
          showTopology && !showDetails && "grid-cols-[minmax(220px,280px)_minmax(0,1fr)]",
          !showTopology && showDetails && "grid-cols-[minmax(0,1fr)_minmax(300px,360px)]",
          !showTopology && !showDetails && "grid-cols-1"
        )}
      >
        {showTopology ? (
          <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
            <CellsTopologyPanel
              locations={locations}
              selectedCode={selectedCode}
              activeZoneKey={activeZoneKey}
              activeWarehouseCode={warehouseCode || null}
              warehouseLabels={warehouseLabels}
              workshopCodes={workshopCodes}
              onSelectZone={setZoneFilter}
              onSelectLocation={selectLocation}
              onSelectWarehouse={(code) => setWarehouseFilter(warehouseCode === code ? null : code)}
            />
          </div>
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border/80 bg-card">
          <div className="min-h-0 flex-1 overflow-auto p-2.5">
            {showInitialSkeleton ? (
              <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="h-[148px] animate-pulse rounded-md bg-muted/70" />
                ))}
              </div>
            ) : sorted.length === 0 ? (
              <div className="flex flex-col items-start justify-center px-2 py-10">
                <Filter className="mb-2 h-5 w-5 text-muted-foreground/50" />
                <p className="text-[14px] font-semibold">
                  {hasActiveFilters ? "Нет ячеек по фильтру" : "Нет ячеек"}
                </p>
                <p className="mt-1 max-w-md text-[13px] text-muted-foreground">
                  {hasActiveFilters
                    ? "Измените поиск или сбросьте фильтры — либо создайте новую ячейку."
                    : "В этой выборке ещё нет ячеек. Создайте первую, чтобы начать адресное хранение."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {hasActiveFilters ? (
                    <Button variant="outline" size="sm" className="h-8 rounded-md" onClick={resetFilters}>
                      Сбросить фильтры
                    </Button>
                  ) : null}
                  <Button size="sm" className="h-8 rounded-md" onClick={() => setCreateOpen(true)}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Добавить ячейку
                  </Button>
                </div>
              </div>
            ) : groupByZone ? (
              <div className="space-y-4">
                {zoneGroups.map((g) => (
                  <section key={g.zoneKey}>
                    <h3 className="mb-1.5 flex items-baseline gap-2 text-[12px] font-semibold text-muted-foreground">
                      <span className="font-mono text-foreground">{g.zoneCode}</span>
                      {g.zoneName ? <span>{g.zoneName}</span> : null}
                      <span className="font-normal tabular-nums">{g.locations.length}</span>
                    </h3>
                    {renderLocationList(g.locations)}
                  </section>
                ))}
              </div>
            ) : (
              renderLocationList(pagedSorted)
            )}
          </div>

          {!showInitialSkeleton ? (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border/80 px-2.5 py-1.5 text-[12px] text-muted-foreground">
              <span>
                <span className="tabular-nums text-foreground">{sorted.length}</span> ячеек
                {sorted.length !== locations.length ? (
                  <span> из {locations.length}</span>
                ) : null}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5">
                  <select
                    value={pageSize}
                    onChange={(e) => changePageSize(Number(e.target.value) as CellsPageSize)}
                    className={cn(CONTROL, "h-7")}
                  >
                    {CELLS_PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n} / page
                      </option>
                    ))}
                  </select>
                </label>
                {sorted.length > pageSize ? (
                  <div className="flex items-center gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-md"
                      disabled={safeListPage <= 1}
                      onClick={() => setListPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    {pages.map((item, idx) =>
                      item === "ellipsis" ? (
                        <span key={`e-${idx}`} className="px-1">
                          …
                        </span>
                      ) : (
                        <Button
                          key={item}
                          type="button"
                          variant={item === safeListPage ? "secondary" : "ghost"}
                          size="icon"
                          className="h-7 w-7 rounded-md text-[12px]"
                          onClick={() => setListPage(item)}
                        >
                          {item}
                        </Button>
                      )
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-md"
                      disabled={safeListPage >= totalPages}
                      onClick={() => setListPage((p) => Math.min(totalPages, p + 1))}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {showDetails ? (
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            <CellsPreviewPanel
              location={selectedLocation}
              listFromQuery={listFromQuery}
              warehouseLabels={warehouseLabels}
              onClose={() => setSelectedCode(null)}
              onRefreshList={() => void loadLocations(true)}
            />
          </div>
        ) : null}
      </div>

      <Sheet
        open={mobilePreview && layoutMode !== "desktop" && layoutMode !== null}
        onOpenChange={setMobilePreview}
      >
        {mobilePreview && layoutMode !== "desktop" && layoutMode !== null ? (
          <SheetContent
            side={layoutMode === "tablet" ? "right" : "bottom"}
            className={cn(
              "gap-0 p-0 [&>button]:hidden",
              layoutMode === "tablet"
                ? "flex h-full w-[min(100vw,380px)] flex-col sm:max-w-[380px]"
                : "flex h-[85vh] flex-col rounded-t-xl"
            )}
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Ячейка</SheetTitle>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <CellsPreviewPanel
                location={selectedLocation}
                listFromQuery={listFromQuery}
                warehouseLabels={warehouseLabels}
                onClose={() => {
                  setMobilePreview(false)
                  setSelectedCode(null)
                }}
                onRefreshList={() => void loadLocations(true)}
              />
            </div>
          </SheetContent>
        ) : null}
      </Sheet>

      <CellsAiFillDialog
        open={aiFillOpen}
        onOpenChange={setAiFillOpen}
        warehouseCode={warehouseCode || undefined}
        zoneCode={zoneCode || undefined}
        onApplied={() => void loadLocations(true)}
      />

      {/* Диалог создания */}
      <Dialog
        open={createOpen}
        onOpenChange={(v) => {
          if (createLoading) return
          setCreateOpen(v)
          if (!v) setCreateAdvancedOpen(false)
          if (v) {
            setCreateForm((p) => {
              const zonesForWh = directoryZones
                .filter((z) => z.warehouseCode === p.warehouseCode)
                .map((z) => ({ zoneCode: z.zoneCode }))
              const zones =
                zonesForWh.length > 0
                  ? zonesForWh
                  : DEFAULT_ZONE_OPTIONS.filter((z) => z.warehouseCode === p.warehouseCode)
              if (zones.some((z) => z.zoneCode === p.zoneCode)) return p
              const preferLine = isWorkshopWarehouseCode(p.warehouseCode, createParentGroups)
              const next =
                defaultZoneForCreate(p.warehouseCode, zones, preferLine) ?? zones[0]?.zoneCode
              return next ? { ...p, zoneCode: next } : p
            })
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Новая ячейка</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            После создания сразу откроется QR для печати — наклейте на ячейку и сканируйте в СканЧЗ.
          </p>
          <div className="grid gap-4">
            <CellsProfileTemplates
              disabled={createLoading}
              onPick={(profile, zoneHint) =>
                setCreateForm((p) => {
                  const hintOk =
                    Boolean(zoneHint) &&
                    zoneOptionsForCreate.some((z) => z.zoneCode === zoneHint)
                  return {
                    ...p,
                    zoneCode: hintOk && zoneHint ? zoneHint : p.zoneCode,
                    slotProfile: { ...EMPTY_SLOT_PROFILE, ...profile },
                  }
                })
              }
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="create-wh" className="text-sm font-medium">
                  {SLOT_FIELD_LABELS.warehouseCode}
                </label>
                <select
                  id="create-wh"
                  value={createForm.warehouseCode}
                  onChange={(e) => {
                    const warehouseCode = e.target.value
                    const preferLine = isWorkshopWarehouseCode(warehouseCode, createParentGroups)
                    setCreateForm((p) => {
                      const zonesForWh = directoryZones
                        .filter((z) => z.warehouseCode === warehouseCode)
                        .map((z) => ({
                          warehouseCode: z.warehouseCode,
                          zoneCode: z.zoneCode,
                          zoneName: z.zoneName,
                        }))
                      const zones =
                        zonesForWh.length > 0
                          ? zonesForWh
                          : DEFAULT_ZONE_OPTIONS.filter((z) => z.warehouseCode === warehouseCode).map(
                              (z) => ({
                                warehouseCode: z.warehouseCode,
                                zoneCode: z.zoneCode,
                                zoneName: z.zoneName,
                              })
                            )
                      const zoneStillOk = zones.some((z) => z.zoneCode === p.zoneCode)
                      const nextZone =
                        zoneStillOk && !preferLine
                          ? p.zoneCode
                          : defaultZoneForCreate(warehouseCode, zones, preferLine) ?? p.zoneCode
                      return {
                        ...p,
                        warehouseCode,
                        zoneCode: nextZone,
                      }
                    })
                  }}
                  disabled={createLoading}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  {createParentGroups.warehouses.length > 0 ? (
                    <optgroup label="Склады">
                      {createParentGroups.warehouses.map(({ code, label }) => (
                        <option key={`wh-${code}`} value={code}>
                          {label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {createParentGroups.workshops.length > 0 ? (
                    <optgroup label="Цехи и линии">
                      {createParentGroups.workshops.map(({ code, label }) => (
                        <option key={`ws-${code}`} value={code}>
                          {label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {SLOT_FIELD_HINTS.warehouseCode}
                </p>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="create-zone" className="text-sm font-medium">
                  {SLOT_FIELD_LABELS.zoneCode}
                </label>
                <select
                  id="create-zone"
                  value={`${createForm.warehouseCode}::${createForm.zoneCode}`}
                  onChange={(e) => {
                    const [warehouseCode, zoneCode] = e.target.value.split("::")
                    if (warehouseCode && zoneCode) {
                      setCreateForm((p) => ({ ...p, warehouseCode, zoneCode }))
                    }
                  }}
                  disabled={createLoading || zoneOptionsForCreate.length === 0}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  {zoneOptionsForCreate.map((z) => (
                    <option
                      key={`${z.warehouseCode}-${z.zoneCode}`}
                      value={`${z.warehouseCode}::${z.zoneCode}`}
                    >
                      {formatZoneSelectLabel(z.zoneCode, z.zoneName, z.warehouseCode)}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Только зоны из справочника (Настройки → Зоны). Нет нужной — сначала добавьте её там.
                </p>
              </div>
            </div>

            <StorageSlotProfileForm
              value={createForm.slotProfile}
              onChange={(slotProfile) => setCreateForm((p) => ({ ...p, slotProfile }))}
              disabled={createLoading}
              showPreview={false}
              compact
            />

            <div className="space-y-1.5">
              <label htmlFor="create-name" className="text-sm font-medium">
                {SLOT_FIELD_LABELS.displayName}
              </label>
              <Input
                id="create-name"
                value={createForm.displayName}
                onChange={(e) => setCreateForm((p) => ({ ...p, displayName: e.target.value }))}
                placeholder={buildSlotTitle(createForm.slotProfile)}
                disabled={createLoading}
                className="rounded-lg"
              />
            </div>

            <button
              type="button"
              className="text-left text-sm font-medium text-emerald-800 hover:underline"
              onClick={() => setCreateAdvancedOpen((v) => !v)}
            >
              {createAdvancedOpen ? "Скрыть" : "Подробные настройки"}
            </button>

            {createAdvancedOpen ? (
              <StorageSlotProfileForm
                value={createForm.slotProfile}
                onChange={(slotProfile) => setCreateForm((p) => ({ ...p, slotProfile }))}
                disabled={createLoading}
                advancedOnly
                showPreview
              />
            ) : null}

            {previewCode ? (
              <div className="rounded-xl border border-border/60 bg-muted/40 px-3 py-2.5">
                <p className="text-xs font-medium text-muted-foreground">Код для сканера</p>
                <p className="mt-1 break-all font-mono text-xs">{previewCode}</p>
              </div>
            ) : null}

            {createError ? (
              <p className="text-sm text-destructive">{createError}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createLoading}>
              Отмена
            </Button>
            <Button onClick={() => void submitCreateLocation()} disabled={createLoading}>
              {createLoading ? "Создание…" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createdBarcodeCode != null} onOpenChange={(open) => { if (!open) setCreatedBarcodeCode(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Этикетка ячейки</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Распечатайте QR и наклейте на ячейку. В СканЧЗ: проверка ЧЗ → автоматически шаг 2 → скан наклейки.
          </p>
          {createdBarcodeCode ? (
            <CellLocationBarcode
              locationCode={createdBarcodeCode}
              title={createdBarcodeCode}
            />
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatedBarcodeCode(null)}>
              Готово
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WaitingCellsCreateDialog
        open={waitingCreateOpen}
        onOpenChange={setWaitingCreateOpen}
        defaultWarehouseCode={createForm.warehouseCode}
        defaultZoneCode={createForm.zoneCode}
        onCreated={() => void loadLocations(true)}
      />
    </div>
  )
}

export default function CellsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
          Загрузка ячеек…
        </div>
      }
    >
      <CellsPageInner />
    </Suspense>
  )
}
