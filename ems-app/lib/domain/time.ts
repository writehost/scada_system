// Календарь в часовом поясе объекта без сторонних библиотек.
// Даты-ключи — строки YYYY-MM-DD, чтобы не зависеть от пояса процесса.

const fmtCache = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    })
    fmtCache.set(tz, f)
  }
  return f
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz)
    return true
  } catch {
    return false
  }
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number }

export function localParts(at: Date | number, tz: string): LocalParts {
  const parts = formatter(tz).formatToParts(typeof at === "number" ? new Date(at) : at)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0"
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAYS[get("weekday")] ?? 1,
  }
}

/** Смещение пояса в минутах для момента at (UTC+3 → 180). */
export function tzOffsetMinutes(at: number, tz: string): number {
  const p = localParts(at, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60000)
}

/** UTC-момент локального времени (y-m-d h:00) в поясе tz. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, tz: string, minute = 0): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const off1 = tzOffsetMinutes(guess - 0, tz)
  let ts = guess - off1 * 60000
  const off2 = tzOffsetMinutes(ts, tz)
  if (off2 !== off1) ts = guess - off2 * 60000
  return ts
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

export function parseDateKey(key: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) throw new Error(`bad date key ${key}`)
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const { year, month, day } = parseDateKey(value)
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

export function localDateKey(at: Date | number, tz: string): string {
  const p = localParts(at, tz)
  return dateKey(p.year, p.month, p.day)
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function addDays(key: string, n: number): string {
  const { year, month, day } = parseDateKey(key)
  const d = new Date(Date.UTC(year, month - 1, day + n))
  return dateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

export function addMonths(key: string, n: number, preferredDay?: number): string {
  const { year, month, day } = parseDateKey(key)
  const total = year * 12 + (month - 1) + n
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  const want = preferredDay ?? day
  return dateKey(y, m, Math.min(want, daysInMonth(y, m)))
}

export function diffDays(a: string, b: string): number {
  const pa = parseDateKey(a)
  const pb = parseDateKey(b)
  return Math.round((Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86400000)
}

export function monthStartKey(key: string): string {
  const { year, month } = parseDateKey(key)
  return dateKey(year, month, 1)
}

export function monthEndKey(key: string): string {
  const { year, month } = parseDateKey(key)
  return dateKey(year, month, daysInMonth(year, month))
}

export function weekdayOfKey(key: string): number {
  const { year, month, day } = parseDateKey(key)
  const wd = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return wd === 0 ? 7 : wd
}

/** UTC-начало локальных суток. */
export function dayStartUtc(key: string, tz: string): number {
  const { year, month, day } = parseDateKey(key)
  return zonedTimeToUtc(year, month, day, 0, tz)
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k)
  return out
}

export const HOUR_MS = 3600_000
export const DAY_MS = 86_400_000

export function floorHour(ts: number): number {
  return Math.floor(ts / HOUR_MS) * HOUR_MS
}

/** "07:30" → минуты от полуночи. */
export function parseClock(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) throw new Error(`bad time ${value}`)
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 24 || min > 59 || (h === 24 && min > 0)) throw new Error(`bad time ${value}`)
  return h * 60 + min
}

/** Попадает ли минута суток в интервал [from, to) с переходом через полночь. */
export function inClockRange(minuteOfDay: number, from: number, to: number): boolean {
  if (from === to) return true
  return from < to ? minuteOfDay >= from && minuteOfDay < to : minuteOfDay >= from || minuteOfDay < to
}
