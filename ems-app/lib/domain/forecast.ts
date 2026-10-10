// Прогноз потребления до конца расчётного периода. Простая статистика по
// фактическим данным, без выдуманных значений: прогноз всегда помечен как прогноз.

import { addDays, diffDays } from "./time.ts"

export type DayPoint = { day: string; qty: number | null; allocated?: number }

export type Forecast = {
  actualQty: number
  forecastQty: number | null
  avgDaily: number | null
  coveredDays: number
  dataUntil: string | null
  remainingDays: number
  confidence: "high" | "medium" | "low" | "none"
  basis: "recent_average" | "previous_period" | "none"
}

/**
 * days — суточные значения периода [periodStart..periodEnd] до сегодняшнего дня
 * (null — данных нет). history — предыдущие сутки для оценки среднего, если
 * в текущем периоде данных мало.
 */
export function forecastPeriod(input: {
  periodStart: string
  periodEnd: string
  today: string
  days: DayPoint[]
  history?: DayPoint[]
  previousPeriodTotal?: number | null
  window?: number
}): Forecast {
  const window = input.window ?? 14
  const inPeriod = input.days.filter((d) => d.day >= input.periodStart && d.day <= input.periodEnd && d.day <= input.today)
  const covered = inPeriod.filter((d) => d.qty != null)
  const actualQty = covered.reduce((s, d) => s + (d.qty ?? 0), 0)
  const dataUntil = covered.length ? covered.map((d) => d.day).sort().at(-1)! : null
  const totalDays = diffDays(input.periodStart, input.periodEnd) + 1

  // Текущие сутки ещё не закончились: в среднее не входят, их остаток прогнозируется.
  const todayPartial = dataUntil === input.today
  const todayQty = todayPartial ? covered.find((d) => d.day === input.today)?.qty ?? 0 : 0
  const pool = [...(input.history ?? []), ...inPeriod]
    .filter((d) => d.qty != null && !(todayPartial && d.day === input.today))
    .sort((a, b) => (a.day < b.day ? -1 : 1))
  const recent = pool.slice(-window)

  if (recent.length === 0) {
    if (input.previousPeriodTotal != null && input.previousPeriodTotal > 0) {
      return { actualQty, forecastQty: Math.max(actualQty, input.previousPeriodTotal), avgDaily: input.previousPeriodTotal / totalDays, coveredDays: covered.length, dataUntil, remainingDays: totalDays, confidence: "low", basis: "previous_period" }
    }
    return { actualQty, forecastQty: null, avgDaily: null, coveredDays: covered.length, dataUntil, remainingDays: totalDays, confidence: "none", basis: "none" }
  }

  const avgDaily = recent.reduce((s, d) => s + (d.qty ?? 0), 0) / recent.length
  const from = todayPartial ? input.today : dataUntil ? addDays(dataUntil, 1) : input.periodStart
  const remainingDays = from > input.periodEnd ? 0 : diffDays(from, input.periodEnd) + 1
  const allocShare = recent.reduce((s, d) => s + (d.allocated ?? 0), 0) / Math.max(1e-9, recent.reduce((s, d) => s + (d.qty ?? 0), 0))
  const confidence: Forecast["confidence"] = recent.length >= 7 && allocShare < 0.5 ? "high" : recent.length >= 3 ? "medium" : "low"
  return {
    actualQty,
    forecastQty: Math.max(actualQty, actualQty - todayQty + avgDaily * remainingDays),
    avgDaily,
    coveredDays: covered.length,
    dataUntil,
    remainingDays,
    confidence,
    basis: "recent_average",
  }
}

export function percentChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || previous <= 0) return null
  return ((current - previous) / previous) * 100
}
