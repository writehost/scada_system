// Пересчёт часовых и суточных агрегатов для изменённого диапазона канала.
// Агрегаты всегда выводятся из сохранённых показаний, поэтому их можно
// пересчитать в любой момент без потери информации.

import type { Db } from "../server/db.ts"
import { allocateSpans, dayBucketFactory, hourBucket, type Span } from "../domain/allocate.ts"
import { addDays, dayStartUtc, floorHour, HOUR_MS, localDateKey } from "../domain/time.ts"

const partitionCache = new Set<string>()

export async function ensurePartitions(c: Db, table: "ems_readings" | "ems_agg_hourly", fromMs: number, toMs: number): Promise<void> {
  const d = new Date(fromMs)
  let y = d.getUTCFullYear()
  let m = d.getUTCMonth()
  const end = new Date(toMs)
  let guard = 0
  while ((y < end.getUTCFullYear() || (y === end.getUTCFullYear() && m <= end.getUTCMonth())) && guard++ < 240) {
    const key = `${table}:${y}-${m}`
    if (!partitionCache.has(key)) {
      await c.query("SELECT ems_ensure_month_partition($1, $2::date)", [table, `${y}-${String(m + 1).padStart(2, "0")}-01`])
      partitionCache.add(key)
    }
    m += 1
    if (m > 11) {
      m = 0
      y += 1
    }
  }
}

export function resetPartitionCache(): void {
  partitionCache.clear()
}

export type AggChannel = { channelId: number; orgId: string; tz: string; measureKind: "cumulative" | "instant" }

async function loadSpans(c: Db, channelId: number, from: number, to: number): Promise<Span[]> {
  const r = await c.query<{ prev_at: Date; measured_at: Date; delta: number }>(
    `SELECT prev_at, measured_at, delta FROM ems_readings
      WHERE channel_id = $1 AND quality <> 'bad' AND delta IS NOT NULL AND prev_at IS NOT NULL
        AND measured_at > $2 AND prev_at < $3`,
    [channelId, new Date(from), new Date(to)],
  )
  return r.rows.map((row) => ({ start: row.prev_at.getTime(), end: row.measured_at.getTime(), delta: row.delta }))
}

async function recomputeCumulative(c: Db, ch: AggChannel, from: number, to: number): Promise<void> {
  const hFrom = floorHour(from)
  const hTo = floorHour(Math.max(to - 1, from)) + HOUR_MS
  const spans = await loadSpans(c, ch.channelId, hFrom, hTo)
  const hourly = allocateSpans(spans, hourBucket, { from: hFrom, to: hTo })
  await ensurePartitions(c, "ems_agg_hourly", hFrom, hTo - 1)
  await c.query("DELETE FROM ems_agg_hourly WHERE channel_id = $1 AND bucket >= $2 AND bucket < $3", [ch.channelId, new Date(hFrom), new Date(hTo)])
  if (hourly.size) {
    const keys = [...hourly.keys()]
    await c.query(
      `INSERT INTO ems_agg_hourly (channel_id, bucket, org_id, delta, allocated, n)
       SELECT $1, b, $2, d, a, 0 FROM unnest($3::timestamptz[], $4::float8[], $5::float8[]) AS t(b, d, a)`,
      [ch.channelId, ch.orgId, keys.map((k) => new Date(k)), keys.map((k) => hourly.get(k)!.delta), keys.map((k) => hourly.get(k)!.allocated)],
    )
  }

  const firstDay = localDateKey(from, ch.tz)
  const lastDay = localDateKey(Math.max(to - 1, from), ch.tz)
  const dFrom = dayStartUtc(firstDay, ch.tz)
  const dTo = dayStartUtc(addDays(lastDay, 1), ch.tz)
  const daySpans = dFrom === hFrom && dTo === hTo ? spans : await loadSpans(c, ch.channelId, dFrom, dTo)
  const daily = allocateSpans(daySpans, dayBucketFactory(ch.tz), { from: dFrom, to: dTo })
  await c.query("DELETE FROM ems_agg_daily WHERE channel_id = $1 AND day >= $2::date AND day <= $3::date", [ch.channelId, firstDay, lastDay])
  if (daily.size) {
    const keys = [...daily.keys()]
    await c.query(
      `INSERT INTO ems_agg_daily (channel_id, day, org_id, delta, allocated, n)
       SELECT $1, d, $2, v, a, 0 FROM unnest($3::date[], $4::float8[], $5::float8[]) AS t(d, v, a)`,
      [ch.channelId, ch.orgId, keys, keys.map((k) => daily.get(k)!.delta), keys.map((k) => daily.get(k)!.allocated)],
    )
  }
}

async function recomputeInstant(c: Db, ch: AggChannel, from: number, to: number): Promise<void> {
  const hFrom = floorHour(from)
  const hTo = floorHour(to) + HOUR_MS
  await ensurePartitions(c, "ems_agg_hourly", hFrom, hTo - 1)
  await c.query("DELETE FROM ems_agg_hourly WHERE channel_id = $1 AND bucket >= $2 AND bucket < $3", [ch.channelId, new Date(hFrom), new Date(hTo)])
  await c.query(
    `INSERT INTO ems_agg_hourly (channel_id, bucket, org_id, n, v_avg, v_min, v_max)
     SELECT channel_id, date_trunc('hour', measured_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', org_id,
            count(*), avg(value), min(value), max(value)
       FROM ems_readings
      WHERE channel_id = $1 AND quality <> 'bad' AND measured_at >= $2 AND measured_at < $3
      GROUP BY 1, 2, 3`,
    [ch.channelId, new Date(hFrom), new Date(hTo)],
  )
  const firstDay = localDateKey(from, ch.tz)
  const lastDay = localDateKey(to, ch.tz)
  await c.query("DELETE FROM ems_agg_daily WHERE channel_id = $1 AND day >= $2::date AND day <= $3::date", [ch.channelId, firstDay, lastDay])
  await c.query(
    `INSERT INTO ems_agg_daily (channel_id, day, org_id, n, v_avg, v_min, v_max)
     SELECT channel_id, (measured_at AT TIME ZONE $4)::date, org_id, count(*), avg(value), min(value), max(value)
       FROM ems_readings
      WHERE channel_id = $1 AND quality <> 'bad' AND measured_at >= $2 AND measured_at < $3
      GROUP BY 1, 2, 3`,
    [ch.channelId, new Date(dayStartUtc(firstDay, ch.tz)), new Date(dayStartUtc(addDays(lastDay, 1), ch.tz)), ch.tz],
  )
}

export async function recomputeRange(c: Db, ch: AggChannel, from: number, to: number): Promise<void> {
  if (ch.measureKind === "cumulative") await recomputeCumulative(c, ch, from, to)
  else await recomputeInstant(c, ch, from, to)
}
