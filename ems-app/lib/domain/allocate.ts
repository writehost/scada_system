// Распределение потребления интервала между показаниями по корзинам (часам, суткам).
// Если интервал целиком в одной корзине — потребление относится к ней как измеренное.
// Если интервал длиннее (ручной ввод раз в месяц, обрыв связи) — известный итог
// делится пропорционально времени и помечается как распределённый (allocated).
// Новых значений сверх фактической разности показаний не появляется.

import { addDays, dayStartUtc, floorHour, HOUR_MS, localDateKey } from "./time.ts"

export type Span = { start: number; end: number; delta: number | null }

export type BucketDef<K> = { key: K; start: number; end: number }

export type BucketSum = { delta: number; allocated: number }

export function hourBucket(ts: number): BucketDef<number> {
  const start = floorHour(ts)
  return { key: start, start, end: start + HOUR_MS }
}

export function dayBucketFactory(tz: string): (ts: number) => BucketDef<string> {
  return (ts: number) => {
    const key = localDateKey(ts, tz)
    const start = dayStartUtc(key, tz)
    return { key, start, end: dayStartUtc(addDays(key, 1), tz) }
  }
}

/**
 * Интервал (start, end]: потребление учтено показанием в момент end,
 * поэтому корзина определяется по end - 1 мс.
 */
export function allocateSpans<K>(
  spans: Span[],
  bucketOf: (ts: number) => BucketDef<K>,
  limit?: { from: number; to: number },
): Map<K, BucketSum> {
  const out = new Map<K, BucketSum>()
  const add = (key: K, delta: number, allocated: number) => {
    const cur = out.get(key)
    if (cur) {
      cur.delta += delta
      cur.allocated += allocated
    } else out.set(key, { delta, allocated })
  }
  for (const s of spans) {
    if (s.delta == null || !(s.end > s.start)) continue
    const first = bucketOf(s.start)
    const last = bucketOf(s.end - 1)
    if (first.key === last.key) {
      if (!limit || (first.start >= limit.from && first.start < limit.to)) add(first.key, s.delta, 0)
      continue
    }
    const total = s.end - s.start
    let b = first
    let guard = 0
    while (b.start < s.end && guard++ < 200_000) {
      const from = Math.max(b.start, s.start)
      const to = Math.min(b.end, s.end)
      if (to > from && (!limit || (b.start >= limit.from && b.start < limit.to))) {
        const part = (s.delta * (to - from)) / total
        add(b.key, part, part)
      }
      b = bucketOf(b.end)
    }
  }
  return out
}
