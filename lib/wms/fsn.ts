/** FSN — скорость движения по складу. Не путать с S1–S5 и ABC. */

export const FSN_CLASSES = ["F", "S", "N"] as const
export type FsnClass = (typeof FSN_CLASSES)[number]

export const FSN_PERIODS = [30, 60, 90] as const
export type FsnPeriodDays = (typeof FSN_PERIODS)[number]

export const DEFAULT_FSN_DAYS: FsnPeriodDays = 90

export const FSN_META: Record<
  FsnClass,
  { title: string; short: string; slot: string; hint: string; className: string }
> = {
  F: {
    title: "Fast",
    short: "F · быстрый",
    slot: "ближе к отбору",
    hint: "Часто отгружают. Ставим ближе к воротам и отбору, чтобы кар меньше ездил.",
    className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  },
  S: {
    title: "Slow",
    short: "S · средний",
    slot: "середина склада",
    hint: "Двигается, но не каждый день. Средние ряды — не у ворот и не в дальнем тупике.",
    className: "border-amber-500/40 bg-amber-500/15 text-amber-900 dark:text-amber-200",
  },
  N: {
    title: "Non-moving",
    short: "N · редкий",
    slot: "дальше",
    hint: "Почти не двигался за период. Держим дальше, чтобы не занимать ближние ячейки.",
    className: "border-border/80 bg-muted/40 text-muted-foreground",
  },
}

export type FsnMovementStat = {
  itemCode: string
  moves: number
  qty: number
}

export type FsnItemClass = {
  itemCode: string
  fsn: FsnClass
  moves: number
  qty: number
  periodDays: number
  rank: number | null
}

export function normalizeFsnDays(raw: unknown): FsnPeriodDays {
  const n = Number(raw)
  if (n === 30 || n === 60 || n === 90) return n
  return DEFAULT_FSN_DAYS
}

export function fsnLabel(code: FsnClass | null | undefined): string {
  if (!code) return "—"
  return FSN_META[code]?.short ?? code
}

/**
 * F — верхние 20% по числу движений, S — следующие 50%, N — хвост и нули.
 * Ноль движений всегда N: товар не шёл через склад.
 */
export function classifyFsn(
  stats: FsnMovementStat[],
  itemCodes: string[],
  periodDays: number = DEFAULT_FSN_DAYS
): Map<string, FsnItemClass> {
  const byCode = new Map<string, FsnMovementStat>()
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
    .filter((row) => row.moves > 0)
    .sort((a, b) => b.moves - a.moves || b.qty - a.qty || a.itemCode.localeCompare(b.itemCode))

  const fCut = Math.max(1, Math.ceil(movers.length * 0.2))
  const sCut = Math.max(fCut, Math.ceil(movers.length * 0.7))
  const rankOf = new Map<string, number>()
  movers.forEach((row, i) => rankOf.set(row.itemCode, i + 1))

  const out = new Map<string, FsnItemClass>()
  for (const itemCode of unique) {
    const row = byCode.get(itemCode) ?? { itemCode, moves: 0, qty: 0 }
    const rank = rankOf.get(itemCode) ?? null
    let fsn: FsnClass = "N"
    if (row.moves > 0 && rank != null) {
      if (rank <= fCut) fsn = "F"
      else if (rank <= sCut) fsn = "S"
      else fsn = "N"
    }
    out.set(itemCode, {
      itemCode,
      fsn,
      moves: row.moves,
      qty: Number(row.qty.toFixed(3)),
      periodDays,
      rank,
    })
  }
  return out
}

/** A-1 ближе, чем C-40: буква зоны, затем номер ряда. */
export function planRowDistanceKey(planRowId: string | null | undefined): number {
  const raw = String(planRowId ?? "")
    .trim()
    .toUpperCase()
    .replace(/^FG-/, "")
  const m = raw.match(/^([A-ZА-ЯЁ]+)-(\d+)/)
  if (!m) return 99_999
  const zone = m[1]
  let zoneIdx = 0
  for (let i = 0; i < zone.length; i++) {
    const code = zone.charCodeAt(i)
    const n = code >= 65 && code <= 90 ? code - 64 : 20
    zoneIdx = zoneIdx * 26 + n
  }
  return zoneIdx * 1000 + Number(m[2])
}

/** 0 — самый ближний ряд набора, 1 — самый дальний. */
export function normalizeRowDistance(planRowId: string, allPlanRowIds: string[]): number {
  const keys = allPlanRowIds.map(planRowDistanceKey)
  const min = Math.min(...keys)
  const max = Math.max(...keys)
  const key = planRowDistanceKey(planRowId)
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0.5
  return (key - min) / (max - min)
}

/**
 * F тянем ближе, N — дальше, S — к середине.
 * closeness: 1 у ворот, 0 в дальнем ряду.
 */
export function fsnSlotScore(fsn: FsnClass, closeness: number, weight: number): { delta: number; reason: string } {
  const w = Number.isFinite(weight) ? weight : 0
  const c = Math.min(1, Math.max(0, closeness))
  if (fsn === "F") {
    const delta = Math.round(c * w)
    return { delta, reason: `FSN F — ближе к отбору (+${delta})` }
  }
  if (fsn === "N") {
    const delta = Math.round((1 - c) * w)
    return { delta, reason: `FSN N — дальше, ближние ячейки свободны (+${delta})` }
  }
  const mid = 1 - Math.abs(c - 0.5) * 2
  const delta = Math.round(mid * w * 0.5)
  return { delta, reason: `FSN S — средний ряд (+${delta})` }
}
