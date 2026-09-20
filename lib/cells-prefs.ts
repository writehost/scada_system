const VIEW_KEY = "wms.cells.viewMode"
const SORT_KEY = "wms.cells.sortBy"
const PAGE_SIZE_KEY = "wms.cells.pageSize"

export const CELLS_PAGE_SIZE_OPTIONS = [25, 50, 100] as const
export type CellsPageSize = (typeof CELLS_PAGE_SIZE_OPTIONS)[number]

export type CellsSortBy = "code" | "fill" | "available" | "zone" | "title"

export function getCellsViewMode(): "cards" | "compact" {
  if (typeof window === "undefined") return "cards"
  const v = localStorage.getItem(VIEW_KEY)
  return v === "compact" ? "compact" : "cards"
}

export function setCellsViewMode(mode: "cards" | "compact") {
  localStorage.setItem(VIEW_KEY, mode)
}

export function getCellsSortBy(): CellsSortBy {
  if (typeof window === "undefined") return "code"
  const v = localStorage.getItem(SORT_KEY) as CellsSortBy | null
  if (v && ["code", "fill", "available", "zone", "title"].includes(v)) return v
  return "code"
}

export function setCellsSortBy(sort: CellsSortBy) {
  localStorage.setItem(SORT_KEY, sort)
}

export function getCellsPageSize(): CellsPageSize {
  if (typeof window === "undefined") return 25
  const raw = Number(localStorage.getItem(PAGE_SIZE_KEY))
  if (CELLS_PAGE_SIZE_OPTIONS.includes(raw as CellsPageSize)) return raw as CellsPageSize
  return 25
}

export function setCellsPageSize(size: CellsPageSize) {
  localStorage.setItem(PAGE_SIZE_KEY, String(size))
}
