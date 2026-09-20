/**
 * Демо API «склад по рядам»: агрегаты + постраничная выдача палет.
 * Данные генерируются процедурно (не храним 18k палет в памяти).
 * Заменить на GET /api/wms/fg/rows, .../rows/{id}/pallets и т.д.
 */

import type { FgMarkingTag } from "@/lib/wms/finished-goods-mock"
import { fgTagLabel, fmtFgDate, fmtFgQty } from "@/lib/wms/finished-goods-mock"

export type FgStorageRowSummary = {
  rowId: string
  rowCode: string
  label: string
  zone: string
  palletCount: number
  markingCodesCount: number
  bottles: number
  blocks: number
  nearestExpiryAt: string
  tags: FgMarkingTag[]
  nomenclatureSkus: number
  fillPercent: number
}

export type FgRowPalletSummary = {
  palletId: string
  palletCode: string
  serialNumber: string
  rowId: string
  position: number
  itemName: string
  itemCode: string
  blocks: number
  bottles: number
  markingCodesCount: number
  producedAt: string
  expiresAt: string
  tags: FgMarkingTag[]
}

export type FgPagedResult<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const ROW_COUNT = 100
const DEFAULT_PAGE_SIZE = 50

const NOMENCLATURE_POOL = [
  { itemCode: "FG-WATER-050", name: 'Вода «Crystal» 0,5 л' },
  { itemCode: "FG-LEMON-100", name: 'Лимонад «Fruity» 1,0 л' },
  { itemCode: "FG-COLA-033", name: 'Кола «Black» 0,33 л' },
  { itemCode: "FG-JUICE-095", name: 'Сок «Orange» 0,95 л' },
  { itemCode: "FG-TEA-050", name: 'Чай «Green» 0,5 л' },
  { itemCode: "FG-ENERGY-025", name: 'Энергетик «Boost» 0,25 л' },
] as const

function hashSeed(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h >>> 0)
}

function pickTags(seed: number): FgMarkingTag[] {
  const tags: FgMarkingTag[] = []
  if (seed % 17 === 0) tags.push("export")
  if (seed % 23 === 0) tags.push("expiry-risk")
  if (seed % 41 === 0) tags.push("quarantine")
  if (seed % 29 === 0) tags.push("promo")
  return tags
}

function isoDaysFromNow(days: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

function rowIndex(rowId: string): number {
  const n = Number.parseInt(rowId.replace(/\D/g, ""), 10)
  return Number.isFinite(n) && n >= 1 && n <= ROW_COUNT ? n : 1
}

function rowMeta(index: number) {
  const seed = hashSeed(`fg-row-${index}`)
  const palletCount = 175 + (seed % 11)
  const codesPerPallet = 1050 + (seed % 151)
  const markingCodesCount = palletCount * codesPerPallet
  const blocksPerPallet = 8 + (seed % 5)
  const bottlesPerBlock = 12 + (seed % 3)
  const blocks = palletCount * blocksPerPallet
  const bottles = blocks * bottlesPerBlock
  const expiryDays = 3 + (seed % 180)
  const skuCount = 2 + (seed % 4)
  const zone = index <= 40 ? "A" : index <= 70 ? "B" : "C"
  return {
    seed,
    palletCount,
    markingCodesCount,
    blocks,
    bottles,
    nearestExpiryAt: isoDaysFromNow(expiryDays),
    tags: pickTags(seed),
    nomenclatureSkus: skuCount,
    fillPercent: 55 + (seed % 46),
    zone,
  }
}

export function listFgStorageRows(options?: {
  query?: string
  tag?: FgMarkingTag | "all"
}): FgStorageRowSummary[] {
  const q = options?.query?.trim().toLowerCase() ?? ""
  const tag = options?.tag ?? "all"
  const rows: FgStorageRowSummary[] = []

  for (let i = 1; i <= ROW_COUNT; i++) {
    const rowId = `R${String(i).padStart(2, "0")}`
    const meta = rowMeta(i)
    const label = `Ряд ${String(i).padStart(2, "0")}`
    const row: FgStorageRowSummary = {
      rowId,
      rowCode: `FG-${meta.zone}-${String(i).padStart(2, "0")}`,
      label,
      zone: meta.zone,
      palletCount: meta.palletCount,
      markingCodesCount: meta.markingCodesCount,
      bottles: meta.bottles,
      blocks: meta.blocks,
      nearestExpiryAt: meta.nearestExpiryAt,
      tags: meta.tags,
      nomenclatureSkus: meta.nomenclatureSkus,
      fillPercent: meta.fillPercent,
    }
    if (tag !== "all" && !row.tags.includes(tag)) continue
    if (q) {
      const hay = `${row.label} ${row.rowCode} ${row.zone}`.toLowerCase()
      if (!hay.includes(q)) continue
    }
    rows.push(row)
  }
  return rows
}

export function getFgStorageRow(rowId: string): FgStorageRowSummary | null {
  return listFgStorageRows().find((r) => r.rowId === rowId) ?? null
}

function palletAt(rowId: string, index: number): FgRowPalletSummary {
  const ri = rowIndex(rowId)
  const meta = rowMeta(ri)
  const seed = hashSeed(`${rowId}-plt-${index}`)
  const nom = NOMENCLATURE_POOL[seed % NOMENCLATURE_POOL.length]
  const blocks = meta.blocks / meta.palletCount
  const bottles = Math.round(meta.bottles / meta.palletCount)
  const codes = Math.round(meta.markingCodesCount / meta.palletCount)
  const serial = `PLT${String(ri).padStart(2, "0")}${String(index + 1).padStart(4, "0")}`
  const expiryDays = 3 + (seed % 120)
  const prodDays = expiryDays - 365

  return {
    palletId: `${rowId}-${index}`,
    palletCode: `010460406000000021${serial}`,
    serialNumber: serial,
    rowId,
    position: index + 1,
    itemName: nom.name,
    itemCode: nom.itemCode,
    blocks: Math.round(blocks),
    bottles,
    markingCodesCount: codes,
    producedAt: isoDaysFromNow(prodDays),
    expiresAt: isoDaysFromNow(expiryDays),
    tags: pickTags(seed),
  }
}

export function listFgRowPallets(
  rowId: string,
  options?: { page?: number; pageSize?: number; query?: string }
): FgPagedResult<FgRowPalletSummary> {
  const row = getFgStorageRow(rowId)
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE
  const page = Math.max(1, options?.page ?? 1)
  const q = options?.query?.trim().toLowerCase() ?? ""

  if (!row) {
    return { items: [], total: 0, page, pageSize, totalPages: 0 }
  }

  let indices = Array.from({ length: row.palletCount }, (_, i) => i)
  if (q) {
    indices = indices.filter((i) => {
      const p = palletAt(rowId, i)
      return (
        p.serialNumber.toLowerCase().includes(q) ||
        p.palletCode.toLowerCase().includes(q) ||
        p.itemName.toLowerCase().includes(q)
      )
    })
  }

  const total = indices.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * pageSize
  const slice = indices.slice(start, start + pageSize)
  const items = slice.map((i) => palletAt(rowId, i))

  return { items, total, page: safePage, pageSize, totalPages }
}

export function findFgMarkingCode(query: string): {
  code: string
  kind: "pallet" | "block" | "bottle"
  rowId: string
  rowLabel: string
  palletSerial: string
  itemName: string
} | null {
  const q = query.trim().replace(/\s/g, "")
  if (q.length < 8) return null
  if (!/^[\dA-Za-z]+$/.test(q)) return null
  const seed = hashSeed(q)
  const rowNum = (seed % ROW_COUNT) + 1
  const rowId = `R${String(rowNum).padStart(2, "0")}`
  const palletIdx = seed % rowMeta(rowNum).palletCount
  const pallet = palletAt(rowId, palletIdx)
  const kind = q.length > 24 ? "bottle" : q.includes("BLK") ? "block" : "pallet"

  return {
    code: q.startsWith("01") ? q : pallet.palletCode,
    kind,
    rowId,
    rowLabel: `Ряд ${String(rowNum).padStart(2, "0")}`,
    palletSerial: pallet.serialNumber,
    itemName: pallet.itemName,
  }
}

export { fgTagLabel, fmtFgDate, fmtFgQty }
