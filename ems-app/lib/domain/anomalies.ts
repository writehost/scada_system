// Статистические детекторы для правил мониторинга и объяснимых рекомендаций.
// Каждый детектор возвращает числа, на которых основан вывод.

export type HourPoint = { ts: number; qty: number | null; allocated?: number; localHour: number }

/** Непрерывный расход: каждый из последних N часов с измеренными данными выше порога. */
export function continuousFlow(hours: HourPoint[], minPerHour: number, needHours: number): { triggered: boolean; hours: number; minObserved: number | null } {
  const sorted = [...hours].sort((a, b) => a.ts - b.ts)
  let streak = 0
  let minObserved: number | null = null
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const h = sorted[i]
    if (i < sorted.length - 1 && sorted[i + 1].ts - h.ts !== 3_600_000) break // разрыв в данных прерывает серию
    if (h.qty == null || (h.allocated ?? 0) > 0) break // распределённые данные не годятся для вывода о непрерывности
    if (h.qty < minPerHour) break
    streak += 1
    minObserved = minObserved == null ? h.qty : Math.min(minObserved, h.qty)
  }
  return { triggered: streak >= needHours, hours: streak, minObserved }
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Ночное потребление: средний расход в ночные часы последних суток против
 * медианы ночей базового периода.
 */
export function nightUsage(
  nights: Array<{ day: string; avgPerHour: number | null }>,
  opts: { thresholdPct: number; minAbsPerHour: number; baselineNights?: number },
): { triggered: boolean; last: number | null; baseline: number | null; increasePct: number | null } {
  const valid = nights.filter((n) => n.avgPerHour != null).sort((a, b) => (a.day < b.day ? -1 : 1))
  if (valid.length < 4) return { triggered: false, last: null, baseline: null, increasePct: null }
  const last = valid.at(-1)!.avgPerHour!
  const base = median(valid.slice(-(1 + (opts.baselineNights ?? 14)), -1).map((n) => n.avgPerHour!))
  if (base == null) return { triggered: false, last, baseline: null, increasePct: null }
  const increasePct = base > 0 ? ((last - base) / base) * 100 : null
  const triggered = last >= opts.minAbsPerHour && (base <= 0 ? last > opts.minAbsPerHour : increasePct! >= opts.thresholdPct)
  return { triggered, last, baseline: base, increasePct }
}

/** Рост потребления против сопоставимого периода (среднесуточное). */
export function growth(currentAvg: number | null, previousAvg: number | null, thresholdPct: number, minAbs = 0): { triggered: boolean; pct: number | null } {
  if (currentAvg == null || previousAvg == null || previousAvg <= 0) return { triggered: false, pct: null }
  const pct = ((currentAvg - previousAvg) / previousAvg) * 100
  return { triggered: pct >= thresholdPct && currentAvg >= minAbs, pct }
}

/** Устойчивое превышение: все значения окна выше порога. */
export function sustainedAbove(values: Array<number | null>, limit: number, minPoints: number): { triggered: boolean; max: number | null; points: number } {
  const v = values.filter((x): x is number => x != null)
  if (v.length < minPoints) return { triggered: false, max: v.length ? Math.max(...v) : null, points: v.length }
  return { triggered: v.every((x) => x > limit), max: Math.max(...v), points: v.length }
}

export type Recommendation = { code: string; severity: "info" | "warning"; title: string; text: string; evidence: Record<string, number | string> }

/** Рекомендации по фактическим данным электроэнергии и воды. */
export function recommend(input: {
  resource: "electricity" | "cold_water" | "hot_water"
  unit: string
  /** Средний расход в час ночью (00–05) за последние 7 ночей и 28 ночей до них. */
  night7: number | null
  night28: number | null
  /** Минимальный часовой расход за 7 суток (базовая нагрузка). */
  minHour7: number | null
  avgHour7: number | null
  measuredHours7: number
}): Recommendation[] {
  const out: Recommendation[] = []
  if (input.measuredHours7 < 24 * 3) return out // мало почасовых данных — молчим
  if (input.night7 != null && input.night28 != null && input.night28 > 0) {
    const pct = ((input.night7 - input.night28) / input.night28) * 100
    if (pct >= 25 && input.night7 > 0.05) {
      out.push({
        code: "night_growth",
        severity: "warning",
        title: input.resource === "electricity" ? "Ночной расход электроэнергии вырос" : "Ночной расход воды вырос",
        text:
          input.resource === "electricity"
            ? `Последние семь дней ночной расход электроэнергии выше среднего на ${Math.round(pct)}%. Проверьте постоянно работающие устройства.`
            : `Последние семь дней ночной расход воды выше обычного на ${Math.round(pct)}%. Проверьте сантехнику на подтекание.`,
        evidence: { night7: round(input.night7), night28: round(input.night28), pct: Math.round(pct), unit: input.unit },
      })
    }
  }
  if (input.resource === "electricity" && input.minHour7 != null && input.avgHour7 != null && input.avgHour7 > 0) {
    const share = input.minHour7 / input.avgHour7
    if (share >= 0.4 && input.minHour7 >= 0.1) {
      out.push({
        code: "base_load",
        severity: "info",
        title: "Высокая постоянная нагрузка",
        text: `Даже в самый тихий час недели потребление не опускалось ниже ${round(input.minHour7)} кВт·ч — это ${Math.round(share * 100)}% от среднего. Часть приборов работает круглосуточно.`,
        evidence: { minHour7: round(input.minHour7), avgHour7: round(input.avgHour7), share: Math.round(share * 100) },
      })
    }
  }
  if (input.resource !== "electricity" && input.minHour7 != null && input.minHour7 > 0.005) {
    out.push({
      code: "water_never_zero",
      severity: "warning",
      title: "Расход воды не опускается до нуля",
      text: `За неделю не было ни одного часа без расхода воды (минимум ${round(input.minHour7 * 1000)} л/ч). Так проявляется подтекание бачка или крана.`,
      evidence: { minLitersPerHour: round(input.minHour7 * 1000) },
    })
  }
  return out
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}
