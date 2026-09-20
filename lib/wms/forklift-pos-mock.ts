/**
 * Демо POS карщика: партия FIFO + план склада (уровни палет в ячейке).
 */

import type { FgStorageRowSummary } from "@/lib/wms/finished-goods-types"
import { listFgStorageRows } from "@/lib/wms/finished-goods-rows-mock"

export type ForkliftBatch = {
  batchId: string
  batchCode: string
  productName: string
  itemCode: string
  gtin: string
  lineName: string
  startedAt: string
  palletsTotal: number
  palletsPlaced: number
  fifoLabel: string
}

/** 0 — пусто, 1 — один палет, 2 — стопка из двух. */
export type SlotLevel = 0 | 1 | 2

export type ForkliftRowOption = FgStorageRowSummary & {
  capacityPallets: number
  freePalletSlots: number
  occupiedPallets: number
  stackCount: number
  recommended: boolean
  fifoRank: number | null
}

export type ForkliftPlacement = {
  placementId: string
  batchId: string
  rowId: string
  rowLabel: string
  position: number
  slotIndex: number
  slotLevel: SlotLevel
  palletSerial: string
  placedAt: string
}

export type ForkliftMapRow = ForkliftRowOption & {
  slotLevels: SlotLevel[]
  nextSlotIndex: number | null
}

export type ForkliftPlanStats = {
  free: number
  level1: number
  level2: number
}

export const FORKLIFT_MAP_SLOTS = 10

export const FORKLIFT_FLOOR_PLAN = {
  factoryLabel: "Цех №2",
  conveyorLabel: "Рольганг",
  orientationHint: "Нулевая отметка у Цеха №2 · Ряды вправо · Места снизу вверх",
  aisleLabel: "Проезд",
} as const

const session = {
  batch: {
    batchId: "BATCH-2026-06-09-001",
    batchCode: "П-240608-A",
    productName: 'Вода питьевая «Crystal» 0,5 л',
    itemCode: "FG-WATER-050",
    gtin: "04604060000001",
    lineName: "Линия 3 · SIPA",
    startedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    palletsTotal: 48,
    palletsPlaced: 12,
    fifoLabel: "Нажмите #ряд на плане — палета встанет в следующее свободное место",
  } satisfies ForkliftBatch,
  rowSlots: new Map<string, SlotLevel[]>(),
  placementCounter: 0,
}

function hashSeed(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h >>> 0)
}

function initialSlotLevels(rowId: string): SlotLevel[] {
  if (session.rowSlots.has(rowId)) return [...session.rowSlots.get(rowId)!]
  const seed = hashSeed(`fg-init-${rowId}`)
  const levels: SlotLevel[] = Array(FORKLIFT_MAP_SLOTS).fill(0)
  levels[0] = 2
  levels[1] = seed % 3 === 0 ? 2 : 1
  levels[2] = 1
  if (seed % 2 === 0) levels[3] = 1
  session.rowSlots.set(rowId, levels)
  return [...levels]
}

function getSlotLevels(rowId: string): SlotLevel[] {
  return session.rowSlots.get(rowId) ?? initialSlotLevels(rowId)
}

function countStats(levels: SlotLevel[]) {
  let free = 0
  let level1 = 0
  let level2 = 0
  for (const l of levels) {
    if (l === 0) free++
    else if (l === 1) level1++
    else level2++
  }
  return { free, level1, level2, occupied: level1 + level2, stacks: level2 }
}

function nextFreeSlotIndex(levels: SlotLevel[]): number {
  return levels.findIndex((l) => l === 0)
}

function enrichRow(row: FgStorageRowSummary, rank: number | null, recommended: boolean): ForkliftRowOption {
  const stats = countStats(getSlotLevels(row.rowId))
  return {
    ...row,
    occupiedPallets: stats.occupied,
    palletCount: stats.occupied,
    capacityPallets: FORKLIFT_MAP_SLOTS,
    freePalletSlots: stats.free,
    stackCount: stats.stacks,
    fillPercent: Math.round((stats.occupied / FORKLIFT_MAP_SLOTS) * 100),
    recommended,
    fifoRank: rank,
  }
}

export function getForkliftCurrentBatch(): ForkliftBatch {
  return { ...session.batch }
}

export function listForkliftRowsWithSpace(options?: {
  zone?: string | "all"
  onlyRecommended?: boolean
  mapRowsLimit?: number
}): ForkliftRowOption[] {
  const zoneFilter = options?.zone ?? "all"
  const rows = listFgStorageRows()
    .map((r) => enrichRow(r, null, false))
    .filter((r) => {
      if (r.freePalletSlots < 1) return false
      if (zoneFilter !== "all" && r.zone !== zoneFilter) return false
      return true
    })

  const scored = [...rows].sort((a, b) => {
    const score = (r: ForkliftRowOption) => r.freePalletSlots * 10 - r.fillPercent
    return score(b) - score(a)
  })

  const recommendedIds = new Set(scored.slice(0, 8).map((r) => r.rowId))
  let result = scored.map((r, i) =>
    enrichRow(
      listFgStorageRows().find((x) => x.rowId === r.rowId)!,
      recommendedIds.has(r.rowId) ? i + 1 : null,
      recommendedIds.has(r.rowId)
    )
  )

  if (options?.onlyRecommended) {
    result = result.filter((r) => r.recommended)
  }

  const limit = options?.mapRowsLimit ?? result.length
  return result.slice(0, limit)
}

function rowSortIndex(row: { rowId: string; label: string }): number {
  const fromId = row.rowId.replace(/\D/g, "")
  if (fromId) return parseInt(fromId, 10)
  const fromLabel = row.label.replace(/\D/g, "")
  return fromLabel ? parseInt(fromLabel, 10) : 0
}

export function rowDisplayNumber(row: { rowId: string; label: string }): string {
  const n = rowSortIndex(row)
  return n > 0 ? String(n) : row.label
}

export function getForkliftMapRows(options?: {
  zone?: string | "all"
  onlyRecommended?: boolean
  mapRowsLimit?: number
}): ForkliftMapRow[] {
  const sorted = [...listForkliftRowsWithSpace(options)].sort(
    (a, b) => rowSortIndex(a) - rowSortIndex(b)
  )
  return sorted.map((row) => {
    const slotLevels = getSlotLevels(row.rowId)
    const nextIdx = nextFreeSlotIndex(slotLevels)
    return {
      ...row,
      slotLevels,
      nextSlotIndex: nextIdx >= 0 ? nextIdx + 1 : null,
    }
  })
}

export function getForkliftPlanStats(rows: ForkliftMapRow[]): ForkliftPlanStats {
  let free = 0
  let level1 = 0
  let level2 = 0
  for (const row of rows) {
    const s = countStats(row.slotLevels)
    free += s.free
    level1 += s.level1
    level2 += s.level2
  }
  return { free, level1, level2 }
}

export function slotLevelLabel(level: SlotLevel): string {
  if (level === 0) return "Пусто"
  if (level === 1) return "1 палет"
  return "2 палета (стопка)"
}

/** Карщик выбрал ряд — палета в следующее свободное место (уровень 1). */
export function placePalletInRow(rowId: string, palletScan?: string): ForkliftPlacement {
  const base = listFgStorageRows().find((r) => r.rowId === rowId)
  if (!base) throw new Error("Ряд не найден")

  const levels = getSlotLevels(rowId)
  const idx = nextFreeSlotIndex(levels)
  if (idx < 0) throw new Error("Ряд заполнен — выберите другой")

  levels[idx] = 1
  session.rowSlots.set(rowId, levels)
  session.batch.palletsPlaced = Math.min(session.batch.palletsPlaced + 1, session.batch.palletsTotal)
  session.placementCounter += 1

  const serial =
    palletScan?.trim() ||
    `PLT${rowId.replace(/\D/g, "").padStart(2, "0")}${String(idx + 1).padStart(4, "0")}`

  return {
    placementId: `PLC-${Date.now()}-${session.placementCounter}`,
    batchId: session.batch.batchId,
    rowId,
    rowLabel: base.label,
    position: idx + 1,
    slotIndex: idx + 1,
    slotLevel: 1,
    palletSerial: serial,
    placedAt: new Date().toISOString(),
  }
}

export function fmtForkliftTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
}

export function fmtForkliftQty(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(n)
}

/** @deprecated use placePalletInRow */
export function confirmForkliftPlacement(rowId: string, palletScan?: string): ForkliftPlacement {
  return placePalletInRow(rowId, palletScan)
}
