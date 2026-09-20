import type { FgPlanInventorySlot } from "@/lib/wms/fg-plan-inventory-storage"

export type FgPlanPostedMarker = {
  qty: number
  palletId?: string
  itemCode?: string
  at?: string
}

const DEFAULT_SHELF_LIFE_DAYS = 365

/** Буква линии в заводском номере партии: S = Sipa, дальше смена A/B/… */
const PLANT_LINE_BY_LETTER: Record<string, { code: string; name: string }> = {
  S: { code: "SIPA", name: "Sipa" },
  J: { code: "JR", name: "JR" },
  D: { code: "DEVIN", name: "Devin" },
}

export type PlantBatch = {
  raw: string
  lotCode: string
  dateIso: string | null
  dateLabel: string | null
  lineCode: string | null
  lineName: string | null
  shiftCode: string | null
}

function resolvePlantLine(letters: string): { code: string; name: string } | null {
  const u = letters.trim().toUpperCase()
  if (!u) return null
  if (PLANT_LINE_BY_LETTER[u]) return PLANT_LINE_BY_LETTER[u]
  if (u === "SIPA" || u === "SI") return PLANT_LINE_BY_LETTER.S
  if (u === "JR") return PLANT_LINE_BY_LETTER.J
  if (u === "DEVIN") return PLANT_LINE_BY_LETTER.D
  return { code: u, name: u }
}

function isoFromYmd(dd: string, mm: string, yyyy: string): string | null {
  const day = Number(dd)
  const month = Number(mm)
  const year = Number(yyyy)
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null
  const dt = new Date(Date.UTC(year, month - 1, day))
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function isoFromDmy(dd: string, mm: string, yy: string): string | null {
  const day = Number(dd)
  const month = Number(mm)
  const year = 2000 + Number(yy)
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const dt = new Date(Date.UTC(year, month - 1, day))
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/** Партия завода: 280826SA → 28.08.2026, линия Sipa, смена A. Буквы в конце допустимы. */
export function parsePlantBatch(raw: string | null | undefined): PlantBatch {
  const cleaned = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/g, "")
  const empty: PlantBatch = {
    raw: String(raw || "").trim(),
    lotCode: cleaned,
    dateIso: null,
    dateLabel: null,
    lineCode: null,
    lineName: null,
    shiftCode: null,
  }
  const yyyy = cleaned.match(/^(\d{2})(\d{2})(\d{4})([A-Z]*)$/)
  const yy = cleaned.match(/^(\d{2})(\d{2})(\d{2})([A-Z]*)$/)
  const m = yyyy || yy
  if (!m) return empty
  const dateIso = yyyy ? isoFromYmd(m[1], m[2], m[3]) : isoFromDmy(m[1], m[2], m[3])
  const tail = m[4] || ""
  let lineLetters = ""
  let shiftCode: string | null = null
  if (tail.length >= 2) {
    lineLetters = tail.slice(0, -1)
    shiftCode = tail.slice(-1)
  } else if (tail.length === 1) {
    if (PLANT_LINE_BY_LETTER[tail] || tail === "S" || tail === "J" || tail === "D") lineLetters = tail
    else shiftCode = tail
  }
  const line = resolvePlantLine(lineLetters)
  return {
    raw: String(raw || "").trim(),
    lotCode: cleaned,
    dateIso,
    dateLabel: dateIso ? `${m[1]}.${m[2]}.${dateIso.slice(0, 4)}` : null,
    lineCode: line?.code ?? null,
    lineName: line?.name ?? null,
    shiftCode,
  }
}

export function formatPlantBatch(raw: string | null | undefined): string {
  const parsed = parsePlantBatch(raw)
  if (!parsed.lotCode) return "без партии"
  const parts = [parsed.lotCode]
  if (parsed.lineName) parts.push(parsed.lineName)
  if (parsed.shiftCode) parts.push(`смена ${parsed.shiftCode}`)
  if (parsed.dateLabel) parts.push(parsed.dateLabel)
  return parts.join(" · ")
}

export function uniquePlantBatches(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const lot = parsePlantBatch(value).lotCode
    if (!lot || seen.has(lot)) continue
    seen.add(lot)
    out.push(lot)
  }
  return out
}

export function plantLinesFromBatches(values: Array<string | null | undefined>): {
  code: string | null
  name: string | null
} {
  const codes = new Set<string>()
  const names = new Set<string>()
  for (const value of values) {
    const parsed = parsePlantBatch(value)
    if (parsed.lineCode) codes.add(parsed.lineCode)
    if (parsed.lineName) names.add(parsed.lineName)
  }
  return {
    code: [...codes][0] ?? null,
    name: [...names].join(", ") || null,
  }
}

export function slotBottleQty(slot: Pick<FgPlanInventorySlot, "quantity">): number {
  const n = Number(slot.quantity)
  if (Number.isFinite(n) && n > 0) return Math.round(n)
  return 1
}

export function slotProductionDateIso(raw: string | null | undefined): string | null {
  const value = String(raw || "").trim()
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

export function slotLotCode(slot: Pick<FgPlanInventorySlot, "address" | "batch" | "productionDate" | "gtin">): string {
  const parsed = parsePlantBatch(slot.batch)
  if (parsed.lotCode) return parsed.lotCode.slice(0, 48)
  const day = String(slot.productionDate || "").trim().slice(0, 10).replace(/-/g, "")
  const gtin = String(slot.gtin || "").replace(/\D/g, "").slice(-8)
  if (day && gtin) return `PLAN-${gtin}-${day}`
  if (day) return `PLAN-${day}`
  const address = String(slot.address || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .slice(0, 40)
  return `PLAN-${address || "SLOT"}`
}

/** Дата выпуска: сначала DDMMYY из партии, иначе поле плана. */
export function slotEffectiveProductionDateIso(
  slot: Pick<FgPlanInventorySlot, "batch" | "productionDate">
): string | null {
  const parsed = parsePlantBatch(slot.batch)
  if (parsed.dateIso) return `${parsed.dateIso}T00:00:00.000Z`
  return slotProductionDateIso(slot.productionDate)
}

export function slotExpiryIso(
  productionIso: string | null,
  shelfLifeDays: number | null | undefined
): string | null {
  if (!productionIso) return null
  const days = Number(shelfLifeDays)
  const life = Number.isFinite(days) && days > 0 ? days : DEFAULT_SHELF_LIFE_DAYS
  const d = new Date(productionIso)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + life)
  return d.toISOString()
}

/** Сколько ещё нужно провести, чтобы слот плана совпал с уже оприходованным. */
export function slotPostDelta(
  slot: Pick<FgPlanInventorySlot, "quantity" | "palletId" | "stockPostedQty">,
  posted?: FgPlanPostedMarker | null
): number {
  const qty = slotBottleQty(slot)
  const palletId = String(slot.palletId || "").trim()
  const fromJson = Number(slot.stockPostedQty)
  const jsonPosted = Number.isFinite(fromJson) && fromJson > 0 ? fromJson : 0
  if (!posted) return Math.max(0, qty - jsonPosted)
  const samePallet = !palletId || !posted.palletId || posted.palletId === palletId
  if (!samePallet) return qty
  const already = Math.max(jsonPosted, Number(posted.qty) || 0)
  return Math.max(0, qty - already)
}

/** Колонка «Бутылки» на складе ГП: коды ЧЗ или оприходованный остаток, что больше. */
export function warehouseBottleQty(markingBottles: number, stockBottles: number): number {
  const marking = Number(markingBottles)
  const stock = Number(stockBottles)
  return Math.max(Number.isFinite(marking) ? marking : 0, Number.isFinite(stock) ? stock : 0)
}

export function summarizePlanStock(
  slots: FgPlanInventorySlot[],
  postedByAddress: Record<string, FgPlanPostedMarker>
): {
  occupiedSlots: number
  pendingSlots: number
  postedSlots: number
  pendingPallets: number
  pendingBottles: number
} {
  let occupiedSlots = 0
  let pendingSlots = 0
  let postedSlots = 0
  let pendingPallets = 0
  let pendingBottles = 0
  for (const slot of slots) {
    if (slot.status !== "occupied") continue
    occupiedSlots += 1
    const gtinDigits = String(slot.gtin || "").replace(/\D/g, "")
    if (gtinDigits.length < 13) {
      postedSlots += 1
      continue
    }
    const delta = slotPostDelta(slot, postedByAddress[slot.address])
    if (delta > 0) {
      pendingSlots += 1
      pendingPallets += 1
      pendingBottles += delta
    } else {
      postedSlots += 1
    }
  }
  return { occupiedSlots, pendingSlots, postedSlots, pendingPallets, pendingBottles }
}
