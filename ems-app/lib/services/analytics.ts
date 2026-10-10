// Временные ряды для графиков. Разрешение выбирается по длине периода, чтобы
// не отдавать клиенту миллионы сырых точек. Пропуски остаются пропусками (null).

import type { Db } from "../server/db.ts"
import { badRequest } from "../server/errors.ts"
import { addDays, dayStartUtc, eachDay, floorHour, HOUR_MS, localDateKey, monthStartKey, addMonths } from "../domain/time.ts"
import type { Resource } from "../domain/units.ts"

export type Resolution = "raw" | "hour" | "day" | "month"

export type SeriesPoint = { t: string; v: number | null; allocated?: number; min?: number | null; max?: number | null }

export type Series = {
  key: string
  label: string
  unit: string
  kind: "consumption" | "instant"
  resolution: Resolution
  points: SeriesPoint[]
}

export function autoResolution(from: number, to: number): Resolution {
  const span = to - from
  if (span <= 2 * 86_400_000 + HOUR_MS) return "hour"
  if (span <= 120 * 86_400_000) return "day"
  return "month"
}

const MAX_POINTS = 5000

export type ChannelMeta = { channel_id: number; name: string; unit: string; measure_kind: "cumulative" | "instant"; meter_name: string; resource: Resource; quantity: string; tz: string }

export async function channelMeta(c: Db, orgId: string, ids: number[]): Promise<ChannelMeta[]> {
  const r = await c.query<ChannelMeta>(
    `SELECT ch.channel_id, ch.name, ch.unit, ch.measure_kind, m.name AS meter_name, m.resource, ch.quantity, s.timezone AS tz
       FROM ems_channels ch JOIN ems_meters m ON m.meter_id = ch.meter_id JOIN ems_sites s ON s.site_id = m.site_id
      WHERE ch.org_id = $1 AND ch.channel_id = ANY($2::bigint[])`,
    [orgId, ids],
  )
  return r.rows
}

/** Каналы учёта ресурса на объекте (или в поддереве узла). */
export async function billingChannels(c: Db, orgId: string, siteId: string, resource: Resource | Resource[], nodeId?: string | null, opts: { includeZones?: boolean } = {}): Promise<Array<{ channel_id: number; tariff_zone: string | null; meter_id: string; resource: Resource }>> {
  const resources = Array.isArray(resource) ? resource : [resource]
  const r = await c.query(
    `WITH RECURSIVE tree AS (
       SELECT node_id FROM ems_nodes WHERE node_id = $4::uuid AND org_id = $1
       UNION ALL SELECT n.node_id FROM ems_nodes n JOIN tree t ON n.parent_id = t.node_id)
     SELECT ch.channel_id, ch.tariff_zone, m.meter_id, m.resource
       FROM ems_channels ch JOIN ems_meters m ON m.meter_id = ch.meter_id
      WHERE ch.org_id = $1 AND m.site_id = $2 AND m.resource = ANY($3::text[]) AND ch.is_billing
        AND ch.measure_kind = 'cumulative' AND ch.archived_at IS NULL AND m.status <> 'draft'
        AND ($4::uuid IS NULL OR m.node_id IN (SELECT node_id FROM tree))`,
    [orgId, siteId, resources, nodeId ?? null],
  )
  return opts.includeZones === false ? r.rows.filter((x) => !x.tariff_zone) : r.rows
}

export async function powerChannels(c: Db, orgId: string, siteId: string, nodeId?: string | null): Promise<number[]> {
  const r = await c.query(
    `WITH RECURSIVE tree AS (
       SELECT node_id FROM ems_nodes WHERE node_id = $3::uuid AND org_id = $1
       UNION ALL SELECT n.node_id FROM ems_nodes n JOIN tree t ON n.parent_id = t.node_id)
     SELECT ch.channel_id FROM ems_channels ch JOIN ems_meters m ON m.meter_id = ch.meter_id
      WHERE ch.org_id = $1 AND m.site_id = $2 AND ch.quantity = 'power_active' AND ch.archived_at IS NULL AND m.status = 'active'
        AND ($3::uuid IS NULL OR m.node_id IN (SELECT node_id FROM tree))`,
    [orgId, siteId, nodeId ?? null],
  )
  return r.rows.map((x) => x.channel_id)
}

/** Сумма потребления по нескольким каналам по часам. */
export async function hourlySum(c: Db, channelIds: number[], from: number, to: number): Promise<Map<number, { qty: number; allocated: number }>> {
  const out = new Map<number, { qty: number; allocated: number }>()
  if (!channelIds.length) return out
  const r = await c.query<{ bucket: Date; qty: number; allocated: number }>(
    `SELECT bucket, sum(delta) AS qty, sum(allocated) AS allocated FROM ems_agg_hourly
      WHERE channel_id = ANY($1::bigint[]) AND bucket >= $2 AND bucket < $3 AND delta IS NOT NULL GROUP BY bucket`,
    [channelIds, new Date(from), new Date(to)],
  )
  for (const row of r.rows) out.set(row.bucket.getTime(), { qty: row.qty, allocated: row.allocated })
  return out
}

export async function dailySum(c: Db, channelIds: number[], fromDay: string, toDay: string): Promise<Map<string, { qty: number; allocated: number }>> {
  const out = new Map<string, { qty: number; allocated: number }>()
  if (!channelIds.length) return out
  const r = await c.query<{ day: string; qty: number; allocated: number }>(
    `SELECT day, sum(delta) AS qty, sum(allocated) AS allocated FROM ems_agg_daily
      WHERE channel_id = ANY($1::bigint[]) AND day >= $2::date AND day <= $3::date AND delta IS NOT NULL GROUP BY day`,
    [channelIds, fromDay, toDay],
  )
  for (const row of r.rows) out.set(row.day, { qty: row.qty, allocated: row.allocated })
  return out
}

function bucketsHour(from: number, to: number): number[] {
  const out: number[] = []
  for (let t = floorHour(from); t < to && out.length < MAX_POINTS; t += HOUR_MS) out.push(t)
  return out
}

function monthsBetween(fromDay: string, toDay: string): string[] {
  const out: string[] = []
  for (let m = monthStartKey(fromDay); m <= toDay && out.length < 240; m = addMonths(m, 1, 1)) out.push(m)
  return out
}

/**
 * Ряд потребления (сумма каналов) с заданным разрешением.
 * Для часа — UTC-корзины, для суток и месяца — календарь часового пояса объекта.
 */
export async function consumptionSeries(c: Db, channelIds: number[], tz: string, from: number, to: number, resolution: Resolution): Promise<SeriesPoint[]> {
  if (resolution === "raw") throw badRequest("Сырые показания запрашиваются по одному каналу")
  if (resolution === "hour") {
    const sums = await hourlySum(c, channelIds, floorHour(from), to)
    return bucketsHour(from, to).map((t) => {
      const s = sums.get(t)
      return { t: new Date(t).toISOString(), v: s ? s.qty : null, allocated: s?.allocated ?? 0 }
    })
  }
  const fromDay = localDateKey(from, tz)
  const toDay = localDateKey(to - 1, tz)
  const sums = await dailySum(c, channelIds, resolution === "month" ? monthStartKey(fromDay) : fromDay, toDay)
  if (resolution === "day") {
    const days = eachDay(fromDay, toDay).slice(0, MAX_POINTS)
    return days.map((d) => {
      const s = sums.get(d)
      return { t: d, v: s ? s.qty : null, allocated: s?.allocated ?? 0 }
    })
  }
  return monthsBetween(fromDay, toDay).map((m) => {
    let qty = 0
    let alloc = 0
    let any = false
    for (const [d, s] of sums) {
      if (d.startsWith(m.slice(0, 7))) {
        qty += s.qty
        alloc += s.allocated
        any = true
      }
    }
    return { t: m, v: any ? qty : null, allocated: alloc }
  })
}

/** Ряд мгновенной величины (мощность): среднее, минимум, максимум за корзину. */
export async function instantSeries(c: Db, channelIds: number[], tz: string, from: number, to: number, resolution: Resolution): Promise<SeriesPoint[]> {
  if (!channelIds.length) return []
  if (resolution === "raw") {
    if (channelIds.length !== 1) throw badRequest("Сырые значения — по одному каналу")
    const r = await c.query<{ measured_at: Date; value: number }>(
      `SELECT measured_at, value FROM ems_readings WHERE channel_id = $1 AND measured_at >= $2 AND measured_at < $3 AND quality <> 'bad' ORDER BY measured_at LIMIT ${MAX_POINTS}`,
      [channelIds[0], new Date(from), new Date(to)],
    )
    return r.rows.map((x) => ({ t: x.measured_at.toISOString(), v: x.value }))
  }
  if (resolution === "hour") {
    // Сумма средних мощностей каналов за час — средняя мощность группы.
    const r = await c.query<{ bucket: Date; avg: number; mx: number; mn: number }>(
      `SELECT bucket, sum(v_avg) AS avg, sum(v_max) AS mx, sum(v_min) AS mn FROM ems_agg_hourly
        WHERE channel_id = ANY($1::bigint[]) AND bucket >= $2 AND bucket < $3 GROUP BY bucket`,
      [channelIds, new Date(floorHour(from)), new Date(to)],
    )
    const m = new Map(r.rows.map((x) => [x.bucket.getTime(), x]))
    return bucketsHour(from, to).map((t) => {
      const x = m.get(t)
      return { t: new Date(t).toISOString(), v: x ? x.avg : null, min: x?.mn ?? null, max: x?.mx ?? null }
    })
  }
  const fromDay = localDateKey(from, tz)
  const toDay = localDateKey(to - 1, tz)
  const r = await c.query<{ day: string; avg: number; mx: number; mn: number }>(
    `SELECT day, sum(v_avg) AS avg, sum(v_max) AS mx, sum(v_min) AS mn FROM ems_agg_daily
      WHERE channel_id = ANY($1::bigint[]) AND day >= $2::date AND day <= $3::date GROUP BY day`,
    [channelIds, fromDay, toDay],
  )
  const m = new Map(r.rows.map((x) => [x.day, x]))
  return eachDay(fromDay, toDay).map((d) => {
    const x = m.get(d)
    return { t: d, v: x ? x.avg : null, min: x?.mn ?? null, max: x?.mx ?? null }
  })
}

/** Последние сырые показания канала (для журнала и проверки прибора). */
export async function rawReadings(c: Db, channelId: number, from: number, to: number, limit = 500) {
  const r = await c.query(
    `SELECT measured_at, received_at, raw_value, value, delta, delta_kind, quality, flags, source, note
       FROM ems_readings WHERE channel_id = $1 AND measured_at >= $2 AND measured_at < $3
      ORDER BY measured_at DESC LIMIT $4`,
    [channelId, new Date(from), new Date(to), Math.min(limit, 5000)],
  )
  return r.rows.map((x) => ({
    measuredAt: x.measured_at.toISOString(),
    receivedAt: x.received_at.toISOString(),
    raw: x.raw_value,
    value: x.value,
    delta: x.delta,
    deltaKind: x.delta_kind,
    quality: x.quality,
    flags: x.flags,
    source: x.source,
    note: x.note,
  }))
}

/** Тепловая карта: потребление по дням недели и часам (локальное время), среднее за период. */
export async function heatmap(c: Db, channelIds: number[], tz: string, from: number, to: number): Promise<{ cells: Array<{ weekday: number; hour: number; avg: number | null; samples: number }>; allocatedShare: number }> {
  if (!channelIds.length) return { cells: [], allocatedShare: 0 }
  const r = await c.query<{ wd: number; hr: number; avg: number; n: number; alloc: number; total: number }>(
    `WITH h AS (
       SELECT bucket, sum(delta) AS qty, sum(allocated) AS alloc FROM ems_agg_hourly
        WHERE channel_id = ANY($1::bigint[]) AND bucket >= $2 AND bucket < $3 AND delta IS NOT NULL GROUP BY bucket)
     SELECT extract(isodow FROM bucket AT TIME ZONE $4)::int AS wd, extract(hour FROM bucket AT TIME ZONE $4)::int AS hr,
            avg(qty) AS avg, count(*)::int AS n, sum(alloc) AS alloc, sum(qty) AS total
       FROM h GROUP BY 1, 2`,
    [channelIds, new Date(from), new Date(to), tz],
  )
  const m = new Map(r.rows.map((x) => [`${x.wd}:${x.hr}`, x]))
  const cells: Array<{ weekday: number; hour: number; avg: number | null; samples: number }> = []
  let alloc = 0
  let total = 0
  for (let wd = 1; wd <= 7; wd += 1) {
    for (let hr = 0; hr < 24; hr += 1) {
      const x = m.get(`${wd}:${hr}`)
      cells.push({ weekday: wd, hour: hr, avg: x ? x.avg : null, samples: x?.n ?? 0 })
      if (x) {
        alloc += x.alloc
        total += x.total
      }
    }
  }
  return { cells, allocatedShare: total > 0 ? alloc / total : 0 }
}

export function dayRangeUtc(fromDay: string, toDay: string, tz: string): { from: number; to: number } {
  return { from: dayStartUtc(fromDay, tz), to: dayStartUtc(addDays(toDay, 1), tz) }
}

export function toCsv(rows: Array<Record<string, unknown>>, columns: Array<{ key: string; title: string }>): string {
  const esc = (v: unknown) => {
    if (v == null) return ""
    const s = typeof v === "number" ? String(v).replace(".", ",") : String(v)
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return "﻿" + [columns.map((c) => esc(c.title)).join(";"), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(";"))].join("\r\n")
}
