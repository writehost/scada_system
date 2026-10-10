// Ограничение частоты запросов (скользящее окно в памяти процесса).
// При нескольких экземплярах приложения лимит действует на экземпляр —
// для общего лимита ставится ограничение на уровне nginx (docs/EMS.md).

const buckets = new Map<string, number[]>()
let lastSweep = Date.now()

export function rateLimit(key: string, limit: number, windowMs = 60_000): { ok: boolean; retryAfterSec: number } {
  const now = Date.now()
  if (now - lastSweep > 5 * 60_000) {
    for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1] > windowMs) buckets.delete(k)
    lastSweep = now
  }
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs)
  if (arr.length >= limit) {
    buckets.set(key, arr)
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - arr[0])) / 1000)) }
  }
  arr.push(now)
  buckets.set(key, arr)
  return { ok: true, retryAfterSec: 0 }
}
