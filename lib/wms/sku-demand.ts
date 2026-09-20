/** ABC / XYZ / COI — спрос и ценность. Не путать с S1–S5 и с FSN. */

import {
  FSN_META,
  normalizeRowDistance,
  planRowDistanceKey,
  type FsnClass,
} from "@/lib/wms/fsn"
import type { StorageClassCode } from "@/lib/wms/physical-profile"

export const ABC_CLASSES = ["A", "B", "C"] as const
export type AbcClass = (typeof ABC_CLASSES)[number]

export const XYZ_CLASSES = ["X", "Y", "Z"] as const
export type XyzClass = (typeof XYZ_CLASSES)[number]

export type AbcXyzCell = `${AbcClass}${XyzClass}`

export const EURO_PALLET_M3 = Number((1.2 * 0.8 * 1.4).toFixed(4))

export const ABC_META: Record<
  AbcClass,
  { title: string; short: string; slot: string; hint: string; className: string }
> = {
  A: {
    title: "A",
    short: "A · ценный",
    slot: "ближе, строже контроль",
    hint: "Большая доля оборота. Держим ближе к отбору и считаем чаще.",
    className: "border-sky-500/40 bg-sky-500/15 text-sky-900 dark:text-sky-200",
  },
  B: {
    title: "B",
    short: "B · средний",
    slot: "середина",
    hint: "Средний оборот. Обычное место и обычный контроль.",
    className: "border-indigo-500/40 bg-indigo-500/15 text-indigo-900 dark:text-indigo-200",
  },
  C: {
    title: "C",
    short: "C · малоценный",
    slot: "дальше",
    hint: "Малая доля оборота. Можно убрать подальше, не занимать горячие ячейки.",
    className: "border-border/80 bg-muted/40 text-muted-foreground",
  },
}

export const XYZ_META: Record<
  XyzClass,
  { title: string; short: string; hint: string; className: string }
> = {
  X: {
    title: "X",
    short: "X · стабильный",
    hint: "Спрос предсказуем. Можно планировать и ставить в удобное постоянное место.",
    className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  },
  Y: {
    title: "Y",
    short: "Y · колеблется",
    hint: "Спрос скачет умеренно. Нужен запас и более гибкое место.",
    className: "border-amber-500/40 bg-amber-500/15 text-amber-900 dark:text-amber-200",
  },
  Z: {
    title: "Z",
    short: "Z · хаотичный",
    hint: "Спрос плохо прогнозируется или истории мало. Осторожнее с запасом и слоттингом.",
    className: "border-rose-500/40 bg-rose-500/15 text-rose-900 dark:text-rose-200",
  },
}

/** Куда тянуть SKU: 1 у отбора, 0 в дальнем ряду. */
export const ABCXYZ_TARGET_CLOSE: Record<AbcXyzCell, number> = {
  AX: 1,
  AY: 0.85,
  AZ: 0.75,
  BX: 0.6,
  BY: 0.5,
  BZ: 0.4,
  CX: 0.35,
  CY: 0.2,
  CZ: 0.05,
}

export const ABCXYZ_HINT: Record<AbcXyzCell, string> = {
  AX: "Важный и стабильный — прогнозировать и держать у отбора.",
  AY: "Важный, спрос колеблется — ближе, с запасом.",
  AZ: "Важный, спрос скачет — ближе и осторожнее управлять.",
  BX: "Средний и предсказуемый — обычное удобное место.",
  BY: "Средний оборот с колебаниями — середина склада.",
  BZ: "Средний и хаотичный — не занимать самые горячие ячейки.",
  CX: "Дешёвый, но ровный — можно чуть дальше, место постоянное.",
  CY: "Малоценный с колебаниями — дальняя зона.",
  CZ: "Малоценный и редкий — убрать подальше.",
}

export type MovementQtyStat = {
  itemCode: string
  moves: number
  qty: number
}

export type WeeklyMovementStat = {
  itemCode: string
  week: string
  moves: number
  qty: number
}

export type AbcItemClass = {
  itemCode: string
  abc: AbcClass
  qty: number
  share: number
  rank: number | null
}

export type XyzItemClass = {
  itemCode: string
  xyz: XyzClass
  cv: number | null
  weeksWithMoves: number
}

export type SkuDemandProfile = {
  itemCode: string
  periodDays: number
  moves: number
  qty: number
  fsn: FsnClass
  abc: AbcClass
  xyz: XyzClass
  abcxyz: AbcXyzCell
  cv: number | null
  weeksWithMoves: number
  coi: number | null
  occupiedM3: number | null
}

export type ReslotHint = {
  fromRow: string
  kind: "too_far" | "too_close"
  reason: string
  expectedCutPct: number | null
}

export function abcxyzCell(abc: AbcClass, xyz: XyzClass): AbcXyzCell {
  return `${abc}${xyz}`
}

export function formatSkuProfile(
  storageClass: StorageClassCode | string | null | undefined,
  abc: AbcClass | null | undefined,
  xyz: XyzClass | null | undefined,
  fsn: FsnClass | null | undefined
): string {
  const parts = [storageClass, abc && xyz ? `${abc}${xyz}` : null, fsn].filter(Boolean)
  return parts.length ? parts.join(" · ") : "—"
}

/**
 * ABC по доле оборота (qty): A до 80%, B до 95%, остальное и нули — C.
 */
export function classifyAbc(stats: MovementQtyStat[], itemCodes: string[]): Map<string, AbcItemClass> {
  const byCode = new Map<string, MovementQtyStat>()
  for (const row of stats) {
    const code = String(row.itemCode || "").trim()
    if (!code) continue
    const prev = byCode.get(code)
    const moves = Math.max(0, Number(row.moves) || 0)
    const qty = Math.max(0, Number(row.qty) || 0)
    if (!prev) byCode.set(code, { itemCode: code, moves, qty })
    else byCode.set(code, { itemCode: code, moves: prev.moves + moves, qty: prev.qty + qty })
  }

  const unique = [...new Set(itemCodes.map((c) => String(c || "").trim()).filter(Boolean))]
  const movers = unique
    .map((itemCode) => byCode.get(itemCode) ?? { itemCode, moves: 0, qty: 0 })
    .filter((row) => row.qty > 0 || row.moves > 0)
    .sort((a, b) => b.qty - a.qty || b.moves - a.moves || a.itemCode.localeCompare(b.itemCode))

  const totalQty = movers.reduce((s, row) => s + row.qty, 0)
  const rankOf = new Map<string, number>()
  const abcOf = new Map<string, AbcClass>()
  let cum = 0
  movers.forEach((row, i) => {
    rankOf.set(row.itemCode, i + 1)
    cum += row.qty
    const own = totalQty > 0 ? row.qty / totalQty : 0
    const share = totalQty > 0 ? cum / totalQty : 1
    let abc: AbcClass = "C"
    if (share <= 0.8 || i === 0 || own >= 0.2) abc = "A"
    else if (share <= 0.95 || own >= 0.05) abc = "B"
    abcOf.set(row.itemCode, abc)
  })

  const out = new Map<string, AbcItemClass>()
  const allQty = unique.reduce((s, code) => s + (byCode.get(code)?.qty ?? 0), 0)
  for (const itemCode of unique) {
    const row = byCode.get(itemCode) ?? { itemCode, moves: 0, qty: 0 }
    out.set(itemCode, {
      itemCode,
      abc: abcOf.get(itemCode) ?? "C",
      qty: Number(row.qty.toFixed(3)),
      share: allQty > 0 ? Number((row.qty / allQty).toFixed(4)) : 0,
      rank: rankOf.get(itemCode) ?? null,
    })
  }
  return out
}

export function coefficientOfVariation(values: number[]): number | null {
  if (values.length < 2) return null
  const mean = values.reduce((s, n) => s + n, 0) / values.length
  if (mean <= 0) return null
  const variance = values.reduce((s, n) => s + (n - mean) ** 2, 0) / values.length
  return Math.sqrt(variance) / mean
}

export function xyzFromCv(cv: number | null, weeksWithMoves: number): XyzClass {
  if (weeksWithMoves <= 0) return "Z"
  if (cv == null || weeksWithMoves < 2) return "Z"
  if (cv < 0.5) return "X"
  if (cv < 1) return "Y"
  return "Z"
}

export function classifyXyz(
  weekly: WeeklyMovementStat[],
  itemCodes: string[],
  periodDays: number
): Map<string, XyzItemClass> {
  const weekCount = Math.max(2, Math.ceil(periodDays / 7))
  const buckets = new Map<string, number[]>()
  const unique = [...new Set(itemCodes.map((c) => String(c || "").trim()).filter(Boolean))]
  for (const code of unique) buckets.set(code, Array.from({ length: weekCount }, () => 0))

  const weekKeys = [...new Set(weekly.map((row) => String(row.week || "").slice(0, 10)).filter(Boolean))].sort()

  if (weekKeys.length === 0) {
    const out = new Map<string, XyzItemClass>()
    for (const itemCode of unique) out.set(itemCode, { itemCode, xyz: "Z", cv: null, weeksWithMoves: 0 })
    return out
  }

  // Раскладываем по последним N неделям относительно самой свежей.
  const last = weekKeys[weekKeys.length - 1]
  const lastTime = Date.parse(last)
  for (const row of weekly) {
    const code = String(row.itemCode || "").trim()
    const series = buckets.get(code)
    if (!series) continue
    const t = Date.parse(String(row.week || "").slice(0, 10))
    if (!Number.isFinite(t) || !Number.isFinite(lastTime)) continue
    const offset = Math.round((lastTime - t) / 604_800_000)
    const idx = weekCount - 1 - offset
    if (idx < 0 || idx >= weekCount) continue
    series[idx] += Math.max(0, Number(row.qty) || 0)
  }

  const out = new Map<string, XyzItemClass>()
  for (const itemCode of unique) {
    const series = buckets.get(itemCode) ?? Array.from({ length: weekCount }, () => 0)
    const weeksWithMoves = series.filter((n) => n > 0).length
    const cv = coefficientOfVariation(series)
    out.set(itemCode, {
      itemCode,
      xyz: xyzFromCv(cv, weeksWithMoves),
      cv: cv == null ? null : Number(cv.toFixed(3)),
      weeksWithMoves,
    })
  }
  return out
}

export function computeCoi(occupiedM3: number | null | undefined, moves: number): number | null {
  const vol = Number(occupiedM3)
  const m = Number(moves)
  if (!Number.isFinite(vol) || vol <= 0 || !Number.isFinite(m) || m <= 0) return null
  return Number((vol / m).toFixed(6))
}

export function abcxyzSlotScore(
  abc: AbcClass,
  xyz: XyzClass,
  closeness: number,
  weight: number
): { delta: number; reason: string } {
  const w = Number.isFinite(weight) ? weight : 0
  const c = Math.min(1, Math.max(0, closeness))
  const cell = abcxyzCell(abc, xyz)
  const target = ABCXYZ_TARGET_CLOSE[cell]
  const fit = 1 - Math.abs(c - target)
  const delta = Math.round(fit * w)
  return { delta, reason: `${cell} — ${ABCXYZ_HINT[cell]} (+${delta})` }
}

export function coiSlotScore(
  coi: number | null | undefined,
  medianCoi: number | null | undefined,
  closeness: number,
  weight: number
): { delta: number; reason: string } {
  const w = Number.isFinite(weight) ? weight : 0
  const value = Number(coi)
  const mid = Number(medianCoi)
  if (!w || !Number.isFinite(value) || value <= 0 || !Number.isFinite(mid) || mid <= 0) {
    return { delta: 0, reason: "" }
  }
  const c = Math.min(1, Math.max(0, closeness))
  const logRatio = Math.log(value / mid)
  const wantClose = Math.min(1, Math.max(0, 0.5 - logRatio * 0.35))
  const fit = 1 - Math.abs(c - wantClose)
  const delta = Math.round(fit * w)
  const tip = value < mid ? "маленький COI — ближе к отбору" : "большой COI — дальше"
  return { delta, reason: `COI ${value} · ${tip} (+${delta})` }
}

export function medianPositive(values: number[]): number | null {
  const xs = values.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  if (xs.length === 0) return null
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[mid] : Number(((xs[mid - 1] + xs[mid]) / 2).toFixed(6))
}

/** Типичный склад ГП: A-1 ближе, C-140 дальше. */
export function rowClosenessHeuristic(planRowId: string): number {
  const key = planRowDistanceKey(planRowId)
  const min = planRowDistanceKey("A-1")
  const max = planRowDistanceKey("C-140")
  if (max <= min) return 0.5
  const t = (key - min) / (max - min)
  return 1 - Math.min(1, Math.max(0, t))
}

export function suggestReslot(input: {
  fsn?: FsnClass | null
  abc?: AbcClass | null
  currentPlanRowIds: string[]
  allPlanRowIds?: string[]
}): ReslotHint | null {
  const rows = input.currentPlanRowIds.map((id) => String(id || "").trim()).filter(Boolean)
  if (rows.length === 0) return null
  const scored = rows.map((id) => ({
    id,
    close: input.allPlanRowIds?.length
      ? 1 - normalizeRowDistance(id, input.allPlanRowIds)
      : rowClosenessHeuristic(id),
  }))
  scored.sort((a, b) => b.close - a.close)
  const best = scored[0]
  const hot = input.fsn === "F" || input.abc === "A"
  const cold = input.fsn === "N" && (input.abc === "C" || !input.abc)
  if (hot && best.close < 0.4) {
    const expectedCutPct = Math.round((1 - best.close) * 40)
    return {
      fromRow: best.id,
      kind: "too_far",
      reason: `${input.fsn === "F" ? "FSN F" : "ABC A"} лежит в ${best.id} — слишком далеко от отбора. Имеет смысл переставить ближе.`,
      expectedCutPct,
    }
  }
  if (cold && best.close > 0.7) {
    return {
      fromRow: best.id,
      kind: "too_close",
      reason: `FSN N занимает ближний ряд ${best.id}. Лучше освободить его под быстрый товар.`,
      expectedCutPct: Math.round((best.close - 0.5) * 30),
    }
  }
  return null
}

export function skuProfileHint(profile: {
  storageClass?: string | null
  abc?: AbcClass | null
  xyz?: XyzClass | null
  fsn?: FsnClass | null
  moves?: number
  days?: number
  coi?: number | null
}): string {
  const bits: string[] = []
  if (profile.storageClass) bits.push(`Класс ${profile.storageClass}`)
  if (profile.abc) bits.push(ABC_META[profile.abc].hint)
  if (profile.xyz) bits.push(XYZ_META[profile.xyz].hint)
  if (profile.fsn) bits.push(FSN_META[profile.fsn].hint)
  if (profile.abc && profile.xyz) bits.push(ABCXYZ_HINT[abcxyzCell(profile.abc, profile.xyz)])
  if (profile.moves != null) bits.push(`${profile.moves} движ. за ${profile.days ?? 90} дн.`)
  if (profile.coi != null) bits.push(`COI ${profile.coi}`)
  return bits.join(" ")
}
