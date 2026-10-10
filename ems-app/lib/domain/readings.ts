// Правила обработки показаний. Чистые функции без БД — их проверяют юнит-тесты.
//
// Принципы:
//  * пропуски не заполняются выдуманными значениями;
//  * потребление накопительного канала — разность корректных показаний;
//  * исходное значение регистра (raw) хранится всегда, нормализованное — raw·k + смещение;
//  * сомнительное показание помечается и попадает в журнал событий, а не исчезает молча.

export type Quality = "good" | "suspect" | "bad"

export type DeltaKind =
  | "baseline" // первое показание канала — точка отсчёта
  | "normal"
  | "rollover" // переполнение регистра
  | "reset" // сброс счётчика: потребление за интервал неизвестно
  | "coef_change" // смена коэффициента с граничным показанием
  | "coef_unbounded" // смена коэффициента без граничного показания: потребление неизвестно

export type QualityFlag =
  | "not_a_number"
  | "negative_value"
  | "negative_delta"
  | "rate_exceeded"
  | "clock_ahead"
  | "too_old"
  | "before_install"
  | "counter_reset"
  | "rollover"
  | "inconsistent_late"
  | "coef_boundary"
  | "coef_unbounded"
  | "manual_override"
  | "spike"

export type ChannelRules = {
  measureKind: "cumulative" | "instant"
  /** Модуль регистра в единицах raw (например 4294967296 для uint32). */
  rolloverAt: number | null
  /** Максимальный правдоподобный расход в нормализованных единицах за час. */
  maxRatePerHour: number | null
  installedAt?: number | null
}

export type StoredReading = {
  at: number
  raw: number
  value: number
  coef: number
  quality: Quality
  flags: string[]
  deltaKind: DeltaKind | null
}

export type Incoming = {
  at: number
  raw: number
  coef: number
  offset: number
  receivedAt: number
  flags?: QualityFlag[]
}

export type Evaluation = {
  value: number
  quality: Quality
  flags: QualityFlag[]
  delta: number | null
  deltaKind: DeltaKind | null
  prevAt: number | null
}

export const CLOCK_AHEAD_TOLERANCE_MS = 5 * 60_000
export const MAX_AGE_MS = 5 * 366 * 86_400_000

export function normalize(raw: number, coef: number, offset: number): number {
  return raw * coef + offset
}

/**
 * Проверка метки времени до записи. Время в будущем заменяется временем
 * приёма (часы устройства спешат), слишком старое — отклоняется.
 */
export function prepareTimestamp(input: { at: number; receivedAt: number }, rules: Pick<ChannelRules, "installedAt">): {
  at: number
  flags: QualityFlag[]
  reject: QualityFlag | null
} {
  const flags: QualityFlag[] = []
  let at = input.at
  if (!Number.isFinite(at)) return { at: input.receivedAt, flags, reject: "not_a_number" }
  if (at > input.receivedAt + CLOCK_AHEAD_TOLERANCE_MS) {
    flags.push("clock_ahead")
    at = input.receivedAt
  }
  if (at < input.receivedAt - MAX_AGE_MS) return { at, flags, reject: "too_old" }
  if (rules.installedAt != null && at < rules.installedAt - 60_000) return { at, flags, reject: "before_install" }
  return { at, flags, reject: null }
}

function closeTo(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
}

export function isUsable(r: Pick<StoredReading, "quality">): boolean {
  return r.quality !== "bad"
}

/**
 * Оценка нового показания относительно предыдущего корректного (prev) и,
 * при опоздавшем показании, следующего уже сохранённого (next).
 */
export function evaluateReading(
  rules: ChannelRules,
  prev: StoredReading | null,
  cur: Incoming,
  next: StoredReading | null = null,
): Evaluation {
  const flags: QualityFlag[] = [...(cur.flags ?? [])]
  const value = normalize(cur.raw, cur.coef, cur.offset)
  const base = { value, prevAt: null as number | null }

  if (!Number.isFinite(cur.raw) || !Number.isFinite(value)) {
    return { ...base, value: Number.isFinite(value) ? value : 0, quality: "bad", flags: [...flags, "not_a_number"], delta: null, deltaKind: null }
  }

  if (rules.measureKind === "instant") {
    return { ...base, quality: flags.includes("clock_ahead") ? "suspect" : "good", flags, delta: null, deltaKind: null }
  }

  if (cur.raw < 0) {
    return { ...base, quality: "bad", flags: [...flags, "negative_value"], delta: null, deltaKind: null }
  }

  let quality: Quality = flags.includes("clock_ahead") ? "suspect" : "good"

  if (!prev) {
    const late = checkAgainstNext(value, next)
    if (late) return { ...base, quality: "bad", flags: [...flags, late], delta: null, deltaKind: null }
    return { ...base, quality, flags, delta: null, deltaKind: "baseline" }
  }

  const prevAt = prev.at
  const hours = Math.max((cur.at - prev.at) / 3_600_000, 1 / 60)
  let delta: number | null
  let deltaKind: DeltaKind

  if (!closeTo(prev.coef, cur.coef)) {
    if (prev.flags.includes("coef_boundary")) {
      delta = (cur.raw - prev.raw) * cur.coef
      deltaKind = "coef_change"
      if (delta < 0) return { ...base, prevAt, quality: "bad", flags: [...flags, "negative_delta"], delta: null, deltaKind: null }
    } else {
      delta = null
      deltaKind = "coef_unbounded"
      flags.push("coef_unbounded")
      quality = "suspect"
    }
  } else {
    const d = value - prev.value
    if (d >= 0 || closeTo(value, prev.value)) {
      delta = Math.max(0, d)
      deltaKind = "normal"
    } else if (
      rules.rolloverAt != null &&
      rules.rolloverAt > 0 &&
      prev.raw >= rules.rolloverAt * 0.8 &&
      cur.raw <= rules.rolloverAt * 0.2
    ) {
      delta = (rules.rolloverAt - prev.raw + cur.raw) * cur.coef
      deltaKind = "rollover"
      flags.push("rollover")
    } else if (cur.raw <= Math.max(prev.raw * 0.05, 1e-9)) {
      delta = null
      deltaKind = "reset"
      flags.push("counter_reset")
    } else {
      return { ...base, prevAt, quality: "bad", flags: [...flags, "negative_delta"], delta: null, deltaKind: null }
    }
  }

  if (delta != null && rules.maxRatePerHour != null && rules.maxRatePerHour > 0 && delta / hours > rules.maxRatePerHour) {
    flags.push("rate_exceeded")
    quality = "suspect"
  }

  const late = checkAgainstNext(value, next)
  if (late) return { ...base, prevAt, quality: "bad", flags: [...flags, late], delta: null, deltaKind: null }

  return { ...base, prevAt, quality, flags, delta, deltaKind }
}

/** Опоздавшее показание не может быть больше следующего (если между ними не было сброса или переполнения). */
function checkAgainstNext(value: number, next: StoredReading | null): QualityFlag | null {
  if (!next || !isUsable(next)) return null
  if (next.deltaKind === "reset" || next.deltaKind === "rollover" || next.deltaKind === "coef_change" || next.deltaKind === "coef_unbounded") return null
  if (value > next.value && !closeTo(value, next.value)) return "inconsistent_late"
  return null
}

export const FLAG_LABELS: Record<QualityFlag, string> = {
  not_a_number: "Значение не является числом",
  negative_value: "Отрицательное показание накопительного счётчика",
  negative_delta: "Показание меньше предыдущего",
  rate_exceeded: "Расход выше правдоподобного для прибора",
  clock_ahead: "Часы устройства спешат — взято время приёма",
  too_old: "Показание старше пяти лет",
  before_install: "Показание раньше даты установки прибора",
  counter_reset: "Сброс счётчика: расход за интервал неизвестен",
  rollover: "Переполнение регистра учтено",
  inconsistent_late: "Опоздавшее показание больше следующего",
  coef_boundary: "Граничное показание при смене коэффициента",
  coef_unbounded: "Смена коэффициента без граничного показания",
  manual_override: "Исправлено вручную",
  spike: "Выброс: значение отклонено автоматически",
}
