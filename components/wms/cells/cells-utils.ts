import type { WmsLocationRow } from "@/lib/wms-api"
import {
  cellFillPercent,
  compareSequentialCellCodes,
  hasMeaningfulSlotProfile,
  type CellOccupancyStatus,
} from "@/lib/storage-slot-ui"

/** Остаток на карточке: доступно + в цеху (A-1 после выдачи часто только in_production). */
export function cellOnHandQty(loc: Pick<WmsLocationRow, "availableQty" | "inProductionQty">): number {
  return Number(loc.availableQty || 0) + Number(loc.inProductionQty || 0)
}

export function cellStatusOf(location: WmsLocationRow): CellOccupancyStatus {
  if (location.locationStatus.toLowerCase().includes("block")) return "blocked"
  if (location.reservedQty > 0) return "reserved"
  if (cellOnHandQty(location) > 0 || location.skuCount > 0 || Number(location.codeCount || 0) > 0) {
    return "occupied"
  }
  return "free"
}

export function cellFreeUnits(loc: WmsLocationRow): number | null {
  const cap = loc.slotProfile?.capacityUnits
  if (cap == null || !Number.isFinite(cap)) return null
  return Math.max(0, cap - cellOnHandQty(loc))
}

export function cellFill(loc: WmsLocationRow): number | null {
  return cellFillPercent(cellOnHandQty(loc), loc.slotProfile?.capacityUnits ?? null)
}

export function cellHasProfile(loc: WmsLocationRow): boolean {
  return hasMeaningfulSlotProfile(loc.slotProfile)
}

export type CellsFilterState = {
  search: string
  status: CellOccupancyStatus | "all"
  warehouseCode: string
  zoneCode: string
  materialType: string
  processType: string
  profile: "all" | "with" | "without"
}

export function filterCells(locations: WmsLocationRow[], f: CellsFilterState): WmsLocationRow[] {
  const q = f.search.trim().toLowerCase()
  return locations.filter((loc) => {
    if (f.warehouseCode && loc.warehouseCode !== f.warehouseCode) return false
    if (f.zoneCode && loc.zoneCode !== f.zoneCode) return false
    if (f.status !== "all" && cellStatusOf(loc) !== f.status) return false
    if (f.materialType && loc.slotProfile?.materialType !== f.materialType) return false
    if (f.processType && loc.slotProfile?.processType !== f.processType) return false
    if (f.profile === "with" && !cellHasProfile(loc)) return false
    if (f.profile === "without" && cellHasProfile(loc)) return false
    if (!q) return true
    const hay = [
      loc.locationCode,
      loc.displayName,
      loc.slotTitle,
      loc.zoneCode,
      loc.zoneName,
      loc.warehouseCode,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
    return hay.includes(q)
  })
}

export function extractZoneOptions(locations: WmsLocationRow[]) {
  const map = new Map<string, { zoneCode: string; zoneName?: string; warehouseCode: string; count: number }>()
  for (const loc of locations) {
    const key = `${loc.warehouseCode}::${loc.zoneCode}`
    const cur = map.get(key) ?? {
      zoneCode: loc.zoneCode,
      zoneName: loc.zoneName,
      warehouseCode: loc.warehouseCode,
      count: 0,
    }
    cur.count += 1
    map.set(key, cur)
  }
  return [...map.values()].sort((a, b) =>
    `${a.warehouseCode}/${a.zoneCode}`.localeCompare(`${b.warehouseCode}/${b.zoneCode}`, "ru")
  )
}

export type CellsSortBy = "code" | "fill" | "available" | "zone" | "title"

export function sortCells(locations: WmsLocationRow[], sortBy: CellsSortBy): WmsLocationRow[] {
  const list = [...locations]
  list.sort((a, b) => {
    switch (sortBy) {
      case "fill": {
        const fa = cellFill(a) ?? -1
        const fb = cellFill(b) ?? -1
        return fb - fa
      }
      case "available":
        return cellOnHandQty(b) - cellOnHandQty(a)
      case "zone":
        return `${a.zoneCode}/${a.locationCode}`.localeCompare(
          `${b.zoneCode}/${b.locationCode}`,
          "ru"
        )
      case "title": {
        const ta = (a.slotTitle || a.displayName || a.locationCode).toLowerCase()
        const tb = (b.slotTitle || b.displayName || b.locationCode).toLowerCase()
        return ta.localeCompare(tb, "ru")
      }
      default:
        return compareSequentialCellCodes(a.locationCode, b.locationCode)
    }
  })
  return list
}

export type CellsZoneGroup = {
  zoneKey: string
  zoneCode: string
  zoneName?: string
  warehouseCode: string
  locations: WmsLocationRow[]
}

export function groupCellsByZone(locations: WmsLocationRow[]): CellsZoneGroup[] {
  const map = new Map<string, CellsZoneGroup>()
  for (const loc of locations) {
    const key = `${loc.warehouseCode}::${loc.zoneCode}`
    if (!map.has(key)) {
      map.set(key, {
        zoneKey: key,
        zoneCode: loc.zoneCode,
        zoneName: loc.zoneName,
        warehouseCode: loc.warehouseCode,
        locations: [],
      })
    }
    map.get(key)!.locations.push(loc)
  }
  return [...map.values()].sort((a, b) =>
    `${a.warehouseCode}/${a.zoneCode}`.localeCompare(`${b.warehouseCode}/${b.zoneCode}`, "ru")
  )
}

export function exportCellsCsv(locations: WmsLocationRow[]): string {
  const header = [
    "locationCode",
    "displayName",
    "zoneCode",
    "warehouseCode",
    "material",
    "process",
    "availableQty",
    "status",
  ].join(";")
  const rows = locations.map((loc) => {
    const sp = loc.slotProfile
    const st = cellStatusOf(loc)
    return [
      loc.locationCode,
      (loc.slotTitle || loc.displayName || "").replace(/;/g, ","),
      loc.zoneCode,
      loc.warehouseCode,
      sp?.materialType ?? "",
      sp?.processType ?? "",
      String(Math.round(loc.availableQty)),
      st,
    ].join(";")
  })
  return [header, ...rows].join("\n")
}

export type CellOccupancyBucket = {
  total: number
  free: number
  occupied: number
  reserved: number
  blocked: number
}

const EMPTY_OCCUPANCY: CellOccupancyBucket = {
  total: 0,
  free: 0,
  occupied: 0,
  reserved: 0,
  blocked: 0,
}

function bumpOccupancy(bucket: CellOccupancyBucket, status: CellOccupancyStatus) {
  bucket.total += 1
  bucket[status] += 1
}

/** Индекс занятости по складу и зоне — только для отображения в дереве. */
export function buildOccupancyIndex(locations: WmsLocationRow[]) {
  const byWarehouse = new Map<string, CellOccupancyBucket>()
  const byZone = new Map<string, CellOccupancyBucket>()
  for (const loc of locations) {
    const status = cellStatusOf(loc)
    const wh = loc.warehouseCode?.trim()
    if (wh) {
      const cur = byWarehouse.get(wh) ?? { ...EMPTY_OCCUPANCY }
      bumpOccupancy(cur, status)
      byWarehouse.set(wh, cur)
    }
    if (wh && loc.zoneCode) {
      const key = `${wh}::${loc.zoneCode}`
      const cur = byZone.get(key) ?? { ...EMPTY_OCCUPANCY }
      bumpOccupancy(cur, status)
      byZone.set(key, cur)
    }
  }
  return { byWarehouse, byZone }
}

export function occupancyBusyFree(bucket: CellOccupancyBucket | undefined) {
  if (!bucket) return null
  return {
    total: bucket.total,
    busy: bucket.occupied + bucket.reserved,
    free: bucket.free,
    blocked: bucket.blocked,
  }
}

export const CELL_STATUS_META: Record<
  CellOccupancyStatus,
  { label: string; color: string; dot: string; bar: string; accent: string }
> = {
  free: {
    label: "Свободна",
    color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
    bar: "bg-emerald-500",
    accent: "border-l-emerald-500",
  },
  occupied: {
    label: "Занята",
    color: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
    dot: "bg-amber-500",
    bar: "bg-amber-500",
    accent: "border-l-amber-500",
  },
  reserved: {
    label: "Резерв",
    color: "bg-orange-500/10 text-orange-800 dark:text-orange-300",
    dot: "bg-orange-500",
    bar: "bg-orange-500",
    accent: "border-l-orange-400",
  },
  blocked: {
    label: "Блок",
    color: "bg-destructive/10 text-destructive",
    dot: "bg-destructive",
    bar: "bg-destructive",
    accent: "border-l-destructive",
  },
}

export type WarehouseSelectOption = { code: string; label: string }

export type WarehouseDirectoryLike = {
  code: string
  name: string
  warehouseType?: string
  meta?: Record<string, unknown>
}

export type CreateParentSelectGroups = {
  warehouses: WarehouseSelectOption[]
  workshops: WarehouseSelectOption[]
}

/** Цех / производственная площадка — отдельный тип размещения при создании ячейки. */
export function isWorkshopWarehouse(row: WarehouseDirectoryLike): boolean {
  if (row.warehouseType === "PRODUCTION") return true
  return Boolean(row.meta?.isProduction)
}

function normalizeWarehouseName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[-–—_/]+/g, " ")
    .replace(/\s+/g, " ")
}

const WAREHOUSE_ALIAS_BUCKETS: Record<string, string> = {
  OS: "materials",
  MAT: "materials",
  "СКЛАД-МАТЕРИАЛОВ": "materials",
  FG: "finished",
  "СКЛАД-ГОТОВОЙ-ПРОДУКЦИИ": "finished",
}

function warehouseBucketKey(code: string, name: string, isWorkshop = false): string {
  const trimmed = code.trim()
  if (isWorkshop) return `workshop:${trimmed}`
  if (WAREHOUSE_ALIAS_BUCKETS[trimmed]) return WAREHOUSE_ALIAS_BUCKETS[trimmed]
  const norm = normalizeWarehouseName(name || trimmed)
  if (norm.includes("склад материалов") || (norm.includes("склад") && norm.includes("материал"))) {
    return "materials"
  }
  if (norm.includes("готовой продукции")) return "finished"
  return `wh:${normalizeWarehouseName(trimmed)}`
}

function resolveWarehouseDisplayName(
  code: string,
  name: string,
  fallbackLabels?: Record<string, string>
): string {
  const fromFallback = fallbackLabels?.[code]?.trim()
  if (fromFallback) return fromFallback
  const trimmed = name?.trim()
  if (trimmed && normalizeWarehouseName(trimmed) !== normalizeWarehouseName(code)) return trimmed
  return trimmed || code
}

/** Короткие коды предпочтительнее длинных дублей вроде «СКЛАД-МАТЕРИАЛОВ». */
function warehouseCodePriority(code: string): number {
  const c = code.trim()
  if (c === "OS") return 0
  if (c === "MAT") return 1
  if (c === "FG") return 2
  if (/^[A-Z0-9]{2,6}$/i.test(c)) return 3
  return 10
}

/** Один склад — одна строка в select (без дублей «Склад материалов» / «СКЛАД-МАТЕРИАЛОВ»). */
export function dedupeWarehouseOptionsForSelect(
  rows: Array<{ code: string; name: string }>,
  fallbackLabels?: Record<string, string>,
  options?: { isWorkshop?: boolean }
): WarehouseSelectOption[] {
  const isWorkshop = options?.isWorkshop ?? false
  const map = new Map<string, WarehouseSelectOption & { priority: number }>()
  for (const row of rows) {
    const code = row.code?.trim()
    if (!code) continue
    const display = resolveWarehouseDisplayName(code, row.name ?? "", fallbackLabels)
    const bucket = warehouseBucketKey(code, display, isWorkshop)
    const priority = warehouseCodePriority(code)
    const candidate = { code, label: display, priority }
    const prev = map.get(bucket)
    if (!prev || candidate.priority < prev.priority) {
      map.set(bucket, candidate)
    }
  }
  return [...map.values()]
    .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label, "ru"))
    .map(({ code, label }) => ({ code, label: `${label} · ${code}` }))
}

/** Склады и цехи отдельными группами для формы создания ячейки. */
export function buildCreateParentSelectGroups(
  rows: WarehouseDirectoryLike[],
  fallbackLabels?: Record<string, string>
): CreateParentSelectGroups {
  const warehouses: Array<{ code: string; name: string }> = []
  const workshops: Array<{ code: string; name: string }> = []
  for (const row of rows) {
    const code = row.code?.trim()
    if (!code) continue
    const entry = { code, name: row.name?.trim() || code }
    if (isWorkshopWarehouse(row)) workshops.push(entry)
    else warehouses.push(entry)
  }
  const dedupedWarehouses = dedupeWarehouseOptionsForSelect(warehouses, fallbackLabels)
  const dedupedWorkshops = dedupeWarehouseOptionsForSelect(workshops, fallbackLabels, { isWorkshop: true })
  if (dedupedWorkshops.length === 0) {
    for (const wh of dedupedWarehouses) {
      if (wh.code === "OS") {
        dedupedWorkshops.push({
          code: wh.code,
          label: "Линия / цех (участок LINE) · OS",
        })
        break
      }
    }
  }
  return { warehouses: dedupedWarehouses, workshops: dedupedWorkshops }
}

export function isWorkshopWarehouseCode(
  code: string,
  groups: CreateParentSelectGroups
): boolean {
  return groups.workshops.some((w) => w.code === code)
}

export function defaultZoneForCreate(
  warehouseCode: string,
  zones: Array<{ zoneCode: string }>,
  preferLine: boolean
): string | undefined {
  if (zones.length === 0) return undefined
  if (preferLine) {
    const line = zones.find((z) => z.zoneCode === "LINE")
    if (line) return line.zoneCode
  }
  return zones[0]?.zoneCode
}
