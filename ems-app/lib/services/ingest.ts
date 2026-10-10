// Приём показаний из любых источников: ручной ввод, шлюз, HTTP push, импорт.
// Повторная доставка безопасна (ключ канал+время), опоздавшие показания
// встраиваются в историю с пересчётом соседних интервалов и агрегатов.

import type { Db } from "../server/db.ts"
import { evaluateReading, FLAG_LABELS, isUsable, prepareTimestamp, type ChannelRules, type Evaluation, type QualityFlag, type StoredReading } from "../domain/readings.ts"
import { allocateSpans, dayBucketFactory, hourBucket, type Span } from "../domain/allocate.ts"
import { floorHour, localDateKey } from "../domain/time.ts"
import { ensurePartitions, recomputeRange } from "./aggregate.ts"
import { raiseEvent } from "./events.ts"

export type ReadingSource = "manual" | "modbus_tcp" | "http_push" | "gateway" | "import" | "demo"

export type IngestItem = {
  channelId: number
  at: number
  raw: number
  source: ReadingSource
  enteredBy?: string | null
  note?: string | null
  flags?: QualityFlag[]
}

export type IngestStatus = "accepted" | "duplicate" | "conflict" | "rejected"

export type IngestResult = {
  channelId: number
  measuredAt: string
  status: IngestStatus
  quality?: "good" | "suspect" | "bad"
  flags?: string[]
  delta?: number | null
  reason?: string
}

export type ChannelCtx = {
  channelId: number
  orgId: string
  meterId: string
  siteId: string
  tz: string
  name: string
  meterName: string
  measureKind: "cumulative" | "instant"
  rules: ChannelRules
  removedAt: number | null
  meterStatus: string
  lastAt: number | null
  coefs: Array<{ from: number; multiplier: number; offset: number }>
}

const QUALITY_EVENT_FLAGS: Partial<Record<QualityFlag, "info" | "warning">> = {
  counter_reset: "warning",
  negative_delta: "warning",
  rate_exceeded: "warning",
  inconsistent_late: "info",
  coef_unbounded: "warning",
  spike: "info",
  clock_ahead: "info",
}

/** Флаги, которые задаются при приёме и сохраняются при повторной оценке. */
const STICKY_FLAGS: QualityFlag[] = ["clock_ahead", "coef_boundary", "manual_override"]

/**
 * `lock` блокирует строки каналов до конца транзакции (в порядке channel_id,
 * чтобы параллельные пакеты не взаимоблокировались): последнее время канала
 * и приращение агрегатов остаются согласованными при одновременной доставке.
 */
export async function loadChannels(c: Db, ids: number[], opts: { lock?: boolean } = {}): Promise<Map<number, ChannelCtx>> {
  const out = new Map<number, ChannelCtx>()
  if (!ids.length) return out
  const r = await c.query(
    `SELECT ch.channel_id, ch.org_id, ch.meter_id, m.site_id, s.timezone, ch.name, m.name AS meter_name,
            ch.measure_kind, ch.rollover_at, ch.max_rate_per_hour, ch.multiplier, ch.value_offset, ch.last_at,
            m.installed_at, m.removed_at, m.status AS meter_status, ch.archived_at
       FROM ems_channels ch
       JOIN ems_meters m ON m.meter_id = ch.meter_id
       JOIN ems_sites s ON s.site_id = m.site_id
      WHERE ch.channel_id = ANY($1::bigint[])
      ORDER BY ch.channel_id${opts.lock ? " FOR UPDATE OF ch" : ""}`,
    [ids],
  )
  const coefRows = await c.query<{ channel_id: number; effective_from: Date; multiplier: number; value_offset: number }>(
    `SELECT channel_id, effective_from, multiplier, value_offset FROM ems_channel_coefficients
      WHERE channel_id = ANY($1::bigint[]) ORDER BY channel_id, effective_from`,
    [ids],
  )
  for (const row of r.rows) {
    const coefs = coefRows.rows
      .filter((x) => x.channel_id === row.channel_id)
      .map((x) => ({ from: x.effective_from.getTime(), multiplier: x.multiplier, offset: x.value_offset }))
    if (!coefs.length) coefs.push({ from: 0, multiplier: row.multiplier, offset: row.value_offset })
    out.set(row.channel_id, {
      channelId: row.channel_id,
      orgId: row.org_id,
      meterId: row.meter_id,
      siteId: row.site_id,
      tz: row.timezone,
      name: row.name,
      meterName: row.meter_name,
      measureKind: row.measure_kind,
      rules: {
        measureKind: row.measure_kind,
        rolloverAt: row.rollover_at,
        maxRatePerHour: row.max_rate_per_hour,
        installedAt: row.installed_at ? new Date(row.installed_at).getTime() : null,
      },
      removedAt: row.removed_at ? new Date(row.removed_at).getTime() : null,
      meterStatus: row.archived_at ? "archived" : row.meter_status,
      lastAt: row.last_at ? new Date(row.last_at).getTime() : null,
      coefs,
    })
  }
  return out
}

export function coefAt(ch: ChannelCtx, at: number): { coef: number; offset: number } {
  let pick = ch.coefs[0]
  for (const k of ch.coefs) if (k.from <= at) pick = k
  return { coef: pick.multiplier, offset: pick.offset }
}

type Row = StoredReading & { receivedAt: number; delta: number | null; prevAt: number | null; source: string }

function toRow(r: Record<string, unknown>): Row {
  return {
    at: (r.measured_at as Date).getTime(),
    raw: r.raw_value as number,
    value: r.value as number,
    coef: r.coef as number,
    quality: r.quality as Row["quality"],
    flags: (r.flags as string[]) ?? [],
    deltaKind: (r.delta_kind as Row["deltaKind"]) ?? null,
    receivedAt: (r.received_at as Date).getTime(),
    delta: (r.delta as number | null) ?? null,
    prevAt: r.prev_at ? (r.prev_at as Date).getTime() : null,
    source: r.source as string,
  }
}

const COLS = "measured_at, received_at, raw_value, value, coef, quality, flags, delta_kind, delta, prev_at, source"

async function usableBefore(c: Db, channelId: number, at: number): Promise<Row | null> {
  const r = await c.query(`SELECT ${COLS} FROM ems_readings WHERE channel_id = $1 AND measured_at < $2 AND quality <> 'bad' ORDER BY measured_at DESC LIMIT 1`, [channelId, new Date(at)])
  return r.rows[0] ? toRow(r.rows[0]) : null
}

async function usableAfter(c: Db, channelId: number, at: number): Promise<Row | null> {
  const r = await c.query(`SELECT ${COLS} FROM ems_readings WHERE channel_id = $1 AND measured_at > $2 AND quality <> 'bad' ORDER BY measured_at ASC LIMIT 1`, [channelId, new Date(at)])
  return r.rows[0] ? toRow(r.rows[0]) : null
}

async function readingAt(c: Db, channelId: number, at: number): Promise<Row | null> {
  const r = await c.query(`SELECT ${COLS} FROM ems_readings WHERE channel_id = $1 AND measured_at = $2`, [channelId, new Date(at)])
  return r.rows[0] ? toRow(r.rows[0]) : null
}

async function insertReading(c: Db, ch: ChannelCtx, item: IngestItem, at: number, receivedAt: number, coef: number, ev: Evaluation): Promise<void> {
  await c.query(
    `INSERT INTO ems_readings (org_id, channel_id, measured_at, received_at, raw_value, value, coef, delta, prev_at, delta_kind, quality, flags, source, entered_by, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      ch.orgId, ch.channelId, new Date(at), new Date(receivedAt), item.raw, ev.value, coef, ev.delta,
      ev.prevAt == null ? null : new Date(ev.prevAt), ev.deltaKind, ev.quality, ev.flags, item.source, item.enteredBy ?? null, item.note ?? null,
    ],
  )
}

async function updateEvaluation(c: Db, channelId: number, at: number, ev: Evaluation): Promise<void> {
  await c.query(
    `UPDATE ems_readings SET value = $3, delta = $4, prev_at = $5, delta_kind = $6, quality = $7, flags = $8
      WHERE channel_id = $1 AND measured_at = $2`,
    [channelId, new Date(at), ev.value, ev.delta, ev.prevAt == null ? null : new Date(ev.prevAt), ev.deltaKind, ev.quality, ev.flags],
  )
}

function asStored(at: number, raw: number, coef: number, ev: Evaluation): Row {
  return { at, raw, coef, value: ev.value, quality: ev.quality, flags: ev.flags, deltaKind: ev.deltaKind, receivedAt: at, delta: ev.delta, prevAt: ev.prevAt, source: "" }
}

function sticky(flags: string[]): QualityFlag[] {
  return flags.filter((f): f is QualityFlag => (STICKY_FLAGS as string[]).includes(f))
}

/**
 * Повторная оценка показаний после момента `afterAt` до первого, чья оценка не изменилась.
 * Возвращает время последнего изменённого показания.
 */
export async function reevaluateAfter(c: Db, ch: ChannelCtx, afterAt: number, limit = 1000): Promise<number | null> {
  const rows = await c.query(`SELECT ${COLS} FROM ems_readings WHERE channel_id = $1 AND measured_at > $2 ORDER BY measured_at ASC LIMIT $3`, [ch.channelId, new Date(afterAt), limit])
  let prev: Row | null = await usableBefore(c, ch.channelId, afterAt + 1)
  let changedUntil: number | null = null
  for (const raw of rows.rows) {
    const r = toRow(raw)
    const flags = sticky(r.flags)
    if (flags.includes("manual_override") && r.quality === "bad") continue
    const { offset } = coefAt(ch, r.at)
    let ev = evaluateReading(ch.rules, prev, { at: r.at, raw: r.raw, coef: r.coef, offset, receivedAt: r.receivedAt, flags }, null)
    if (flags.includes("manual_override") && ev.quality !== "bad") ev = { ...ev, quality: "good" }
    const same =
      ev.quality === r.quality &&
      ev.deltaKind === r.deltaKind &&
      (ev.prevAt ?? null) === (r.prevAt ?? null) &&
      Math.abs((ev.delta ?? -1) - (r.delta ?? -1)) < 1e-9 &&
      ev.flags.length === r.flags.length
    if (same) break
    await updateEvaluation(c, ch.channelId, r.at, ev)
    changedUntil = r.at
    if (isUsable(ev)) prev = asStored(r.at, r.raw, r.coef, ev)
  }
  return changedUntil
}

export async function logCorrection(
  c: Db,
  ch: Pick<ChannelCtx, "orgId" | "channelId">,
  at: number,
  action: "create" | "reject" | "restore" | "edit",
  change: { oldValue?: number | null; newValue?: number | null; oldQuality?: string | null; newQuality?: string | null; reason?: string | null; actorId?: string | null },
): Promise<void> {
  await c.query(
    `INSERT INTO ems_reading_corrections (org_id, channel_id, measured_at, action, old_value, new_value, old_quality, new_quality, reason, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [ch.orgId, ch.channelId, new Date(at), action, change.oldValue ?? null, change.newValue ?? null, change.oldQuality ?? null, change.newQuality ?? null, change.reason ?? null, change.actorId ?? null],
  )
}

type ChannelOutcome = { accepted: number; raisedFlags: Map<QualityFlag, { at: number; value: number }> }

/** Проверки, общие для обоих путей: время, активность прибора, число. */
function precheck(ch: ChannelCtx, item: IngestItem, receivedAt: number): { at: number; flags: QualityFlag[] } | IngestResult {
  const prepared = prepareTimestamp({ at: item.at, receivedAt }, ch.rules)
  const at = Math.round(prepared.at)
  if (prepared.reject) return { channelId: ch.channelId, measuredAt: safeIso(item.at), status: "rejected", reason: prepared.reject }
  if ((ch.meterStatus === "archived" || ch.meterStatus === "replaced") && (ch.removedAt == null || at > ch.removedAt)) {
    return { channelId: ch.channelId, measuredAt: new Date(at).toISOString(), status: "rejected", reason: "meter_not_active" }
  }
  if (!Number.isFinite(item.raw)) return { channelId: ch.channelId, measuredAt: new Date(at).toISOString(), status: "rejected", reason: "not_a_number" }
  return { at, flags: [...(item.flags ?? []), ...prepared.flags] }
}

/**
 * Основная точка приёма. Вызывается в транзакции организации (withOrg).
 * Каналы чужой организации не видны из-за RLS и получают статус rejected.
 *
 * Типовой поток (новые показания после последнего сохранённого) идёт быстрым
 * путём: оценка в памяти, массовая вставка и приращение агрегатов —
 * фиксированное число запросов на пакет. Опоздавшие и повторные показания,
 * ручной ввод и автоматическое отклонение выбросов идут полным путём с
 * повторной оценкой соседних показаний и пересчётом агрегатов.
 */
export async function ingestReadings(c: Db, orgId: string, items: IngestItem[], opts: { receivedAt?: number } = {}): Promise<IngestResult[]> {
  const receivedAt = opts.receivedAt ?? Date.now()
  const channels = await loadChannels(c, [...new Set(items.map((i) => i.channelId))], { lock: true })
  const results: IngestResult[] = new Array(items.length)
  const byChannel = new Map<number, number[]>()
  items.forEach((it, idx) => {
    const ch = channels.get(it.channelId)
    if (!ch || ch.orgId !== orgId) {
      results[idx] = { channelId: it.channelId, measuredAt: safeIso(it.at), status: "rejected", reason: "unknown_channel" }
      return
    }
    const list = byChannel.get(it.channelId) ?? []
    list.push(idx)
    byChannel.set(it.channelId, list)
  })

  // Кандидаты быстрого пути: все показания канала новее последнего сохранённого.
  const fastCandidates: number[] = []
  for (const [channelId, idxs] of byChannel) {
    const ch = channels.get(channelId)!
    idxs.sort((a, b) => items[a].at - items[b].at)
    let maxAt = ch.lastAt ?? Number.NEGATIVE_INFINITY
    let ok = true
    for (const idx of idxs) {
      const item = items[idx]
      if (item.source === "manual") ok = false
      const pre = precheck(ch, item, receivedAt)
      if ("status" in pre) continue
      if (!(pre.at > maxAt)) ok = false
      maxAt = pre.at
    }
    if (ok) fastCandidates.push(channelId)
  }

  let accepted = 0
  const outcomes: Array<[ChannelCtx, ChannelOutcome]> = []
  const slow = new Set(byChannel.keys())
  if (fastCandidates.length) {
    const fast = await ingestFast(c, orgId, fastCandidates.map((id) => channels.get(id)!), byChannel, items, receivedAt, results)
    for (const [channelId, outcome] of fast) {
      slow.delete(channelId)
      accepted += outcome.accepted
      outcomes.push([channels.get(channelId)!, outcome])
    }
  }
  for (const channelId of slow) {
    const ch = channels.get(channelId)!
    const outcome = await ingestChannelFull(c, orgId, ch, byChannel.get(channelId)!, items, receivedAt, results)
    accepted += outcome.accepted
    outcomes.push([ch, outcome])
  }

  for (const [ch, outcome] of outcomes) {
    for (const [flag, info] of outcome.raisedFlags) {
      await raiseEvent(c, {
        orgId,
        kind: `reading_${flag}`,
        category: "data_quality",
        severity: QUALITY_EVENT_FLAGS[flag] ?? "info",
        title: `${ch.meterName}: ${FLAG_LABELS[flag]}`,
        message: `${ch.name}: ${FLAG_LABELS[flag].toLowerCase()} (показание ${round(info.value)} на ${new Date(info.at).toISOString()}).`,
        dedupKey: `quality:${ch.channelId}:${flag}`,
        siteId: ch.siteId,
        meterId: ch.meterId,
        channelId: ch.channelId,
        details: { flag, at: new Date(info.at).toISOString(), value: info.value },
      })
    }
  }

  if (accepted > 0) {
    await c.query(
      `INSERT INTO ems_usage_counters (org_id, month, readings_ingested) VALUES ($1, date_trunc('month', now())::date, $2)
       ON CONFLICT (org_id, month) DO UPDATE SET readings_ingested = ems_usage_counters.readings_ingested + EXCLUDED.readings_ingested`,
      [orgId, accepted],
    )
  }
  return results
}

type Planned = { idx: number; item: IngestItem; at: number; coef: number; ev: Evaluation }

/**
 * Быстрый путь. Оценка выполняется в памяти до любых записей; канал, где
 * сработало бы автоматическое отклонение выброса, возвращается на полный путь.
 */
async function ingestFast(
  c: Db,
  orgId: string,
  chans: ChannelCtx[],
  byChannel: Map<number, number[]>,
  items: IngestItem[],
  receivedAt: number,
  results: IngestResult[],
): Promise<Map<number, ChannelOutcome>> {
  const out = new Map<number, ChannelOutcome>()
  const lastRows = await c.query(
    `SELECT ids.id AS channel_id, r.measured_at, r.received_at, r.raw_value, r.value, r.coef, r.quality, r.flags, r.delta_kind, r.delta, r.prev_at, r.source
       FROM unnest($1::bigint[]) AS ids(id)
       CROSS JOIN LATERAL (
         SELECT ${COLS} FROM ems_readings
          WHERE channel_id = ids.id AND quality <> 'bad'
          ORDER BY measured_at DESC LIMIT 1
       ) r`,
    [chans.map((ch) => ch.channelId)],
  )
  const lastUsable = new Map<number, Row>(lastRows.rows.map((r) => [r.channel_id as number, toRow(r)]))

  const plans = new Map<number, { ch: ChannelCtx; planned: Planned[]; rejected: Array<[number, IngestResult]> }>()
  for (const ch of chans) {
    let prev: Row | null = lastUsable.get(ch.channelId) ?? null
    const planned: Planned[] = []
    const rejected: Array<[number, IngestResult]> = []
    let fallback = false
    for (const idx of byChannel.get(ch.channelId)!) {
      const item = items[idx]
      const pre = precheck(ch, item, receivedAt)
      if ("status" in pre) {
        rejected.push([idx, pre])
        continue
      }
      const { coef, offset } = coefAt(ch, pre.at)
      const ev = evaluateReading(ch.rules, prev, { at: pre.at, raw: item.raw, coef, offset, receivedAt, flags: pre.flags }, null)
      const droppedAfterSpike = (ev.quality === "bad" && ev.flags.includes("negative_delta")) || ev.deltaKind === "reset"
      if (droppedAfterSpike && prev && prev.quality === "suspect" && prev.flags.includes("rate_exceeded")) {
        fallback = true
        break
      }
      planned.push({ idx, item, at: pre.at, coef, ev })
      if (isUsable(ev)) prev = asStored(pre.at, item.raw, coef, ev)
    }
    if (!fallback) plans.set(ch.channelId, { ch, planned, rejected })
  }
  if (!plans.size) return out

  const all = [...plans.values()].flatMap((p) => p.planned)
  if (all.length) {
    let minAt = Number.POSITIVE_INFINITY
    let maxAt = Number.NEGATIVE_INFINITY
    for (const p of all) {
      minAt = Math.min(minAt, p.at)
      maxAt = Math.max(maxAt, p.at)
    }
    await ensurePartitions(c, "ems_readings", minAt, maxAt)
    await c.query(
      `INSERT INTO ems_readings (org_id, channel_id, measured_at, received_at, raw_value, value, coef, delta, prev_at, delta_kind, quality, flags, source, entered_by, note)
       SELECT $1, ch, at, $2, raw, v, k, d, pa, dk, q, CASE WHEN f = '' THEN '{}'::text[] ELSE string_to_array(f, ',') END, src, eb, nt
         FROM unnest($3::bigint[], $4::timestamptz[], $5::float8[], $6::float8[], $7::float8[], $8::float8[], $9::timestamptz[],
                     $10::text[], $11::text[], $12::text[], $13::text[], $14::uuid[], $15::text[])
              AS t(ch, at, raw, v, k, d, pa, dk, q, f, src, eb, nt)`,
      [
        orgId,
        new Date(receivedAt),
        all.map((p) => p.item.channelId),
        all.map((p) => new Date(p.at)),
        all.map((p) => p.item.raw),
        all.map((p) => p.ev.value),
        all.map((p) => p.coef),
        all.map((p) => p.ev.delta),
        all.map((p) => (p.ev.prevAt == null ? null : new Date(p.ev.prevAt))),
        all.map((p) => p.ev.deltaKind),
        all.map((p) => p.ev.quality),
        all.map((p) => p.ev.flags.join(",")),
        all.map((p) => p.item.source),
        all.map((p) => p.item.enteredBy ?? null),
        all.map((p) => p.item.note ?? null),
      ],
    )
    await addAggregates(c, orgId, [...plans.values()])
  }

  const upd = { ids: [] as number[], lastAt: [] as Date[], lastValue: [] as Array<number | null> }
  for (const { ch, planned, rejected } of plans.values()) {
    const raisedFlags = new Map<QualityFlag, { at: number; value: number }>()
    for (const [idx, r] of rejected) results[idx] = r
    let lastValue: number | null = null
    for (const p of planned) {
      results[p.idx] = { channelId: ch.channelId, measuredAt: new Date(p.at).toISOString(), status: "accepted", quality: p.ev.quality, flags: p.ev.flags, delta: p.ev.delta }
      for (const f of p.ev.flags) if (QUALITY_EVENT_FLAGS[f]) raisedFlags.set(f, { at: p.at, value: p.ev.value })
      if (isUsable(p.ev)) lastValue = p.ev.value
    }
    if (planned.length) {
      upd.ids.push(ch.channelId)
      upd.lastAt.push(new Date(planned[planned.length - 1].at))
      upd.lastValue.push(lastValue)
    }
    out.set(ch.channelId, { accepted: planned.length, raisedFlags })
  }
  if (upd.ids.length) {
    await c.query(
      `UPDATE ems_channels ch SET last_at = GREATEST(ch.last_at, u.last_at), last_received_at = $4, last_value = COALESCE(u.last_value, ch.last_value)
         FROM unnest($1::bigint[], $2::timestamptz[], $3::float8[]) AS u(id, last_at, last_value)
        WHERE ch.channel_id = u.id`,
      [upd.ids, upd.lastAt, upd.lastValue, new Date(receivedAt)],
    )
  }
  return out
}

/**
 * Приращение часовых и суточных агрегатов новыми интервалами. Интервалы
 * дописываемых показаний не пересекаются с уже учтёнными, поэтому сумма
 * совпадает с полным пересчётом (это проверяется тестом).
 */
async function addAggregates(c: Db, orgId: string, plans: Array<{ ch: ChannelCtx; planned: Planned[] }>): Promise<void> {
  const hourly = { ch: [] as number[], key: [] as Date[], delta: [] as Array<number | null>, alloc: [] as number[], n: [] as number[], avg: [] as Array<number | null>, min: [] as Array<number | null>, max: [] as Array<number | null> }
  const daily = { ch: [] as number[], key: [] as string[], delta: [] as Array<number | null>, alloc: [] as number[], n: [] as number[], avg: [] as Array<number | null>, min: [] as Array<number | null>, max: [] as Array<number | null> }
  let minBucket = Number.POSITIVE_INFINITY
  let maxBucket = Number.NEGATIVE_INFINITY
  for (const { ch, planned } of plans) {
    const usable = planned.filter((p) => isUsable(p.ev))
    if (!usable.length) continue
    if (ch.measureKind === "cumulative") {
      const spans: Span[] = []
      for (const p of usable) if (p.ev.delta != null && p.ev.prevAt != null) spans.push({ start: p.ev.prevAt, end: p.at, delta: p.ev.delta })
      for (const [k, v] of allocateSpans(spans, hourBucket)) {
        hourly.ch.push(ch.channelId), hourly.key.push(new Date(k)), hourly.delta.push(v.delta), hourly.alloc.push(v.allocated)
        hourly.n.push(0), hourly.avg.push(null), hourly.min.push(null), hourly.max.push(null)
        minBucket = Math.min(minBucket, k)
        maxBucket = Math.max(maxBucket, k)
      }
      for (const [k, v] of allocateSpans(spans, dayBucketFactory(ch.tz))) {
        daily.ch.push(ch.channelId), daily.key.push(k), daily.delta.push(v.delta), daily.alloc.push(v.allocated)
        daily.n.push(0), daily.avg.push(null), daily.min.push(null), daily.max.push(null)
      }
    } else {
      const group = <K>(keyOf: (at: number) => K) => {
        const m = new Map<K, { n: number; sum: number; min: number; max: number }>()
        for (const p of usable) {
          const k = keyOf(p.at)
          const g = m.get(k)
          if (g) {
            g.n += 1
            g.sum += p.ev.value
            g.min = Math.min(g.min, p.ev.value)
            g.max = Math.max(g.max, p.ev.value)
          } else m.set(k, { n: 1, sum: p.ev.value, min: p.ev.value, max: p.ev.value })
        }
        return m
      }
      for (const [k, g] of group(floorHour)) {
        hourly.ch.push(ch.channelId), hourly.key.push(new Date(k)), hourly.delta.push(null), hourly.alloc.push(0)
        hourly.n.push(g.n), hourly.avg.push(g.sum / g.n), hourly.min.push(g.min), hourly.max.push(g.max)
        minBucket = Math.min(minBucket, k)
        maxBucket = Math.max(maxBucket, k)
      }
      for (const [k, g] of group((at) => localDateKey(at, ch.tz))) {
        daily.ch.push(ch.channelId), daily.key.push(k), daily.delta.push(null), daily.alloc.push(0)
        daily.n.push(g.n), daily.avg.push(g.sum / g.n), daily.min.push(g.min), daily.max.push(g.max)
      }
    }
  }
  const merge = (table: string, keyCol: string) => `
    ON CONFLICT (channel_id, ${keyCol}) DO UPDATE SET
      delta = CASE WHEN EXCLUDED.delta IS NULL THEN ${table}.delta ELSE COALESCE(${table}.delta, 0) + EXCLUDED.delta END,
      allocated = ${table}.allocated + EXCLUDED.allocated,
      v_avg = CASE WHEN EXCLUDED.n = 0 THEN ${table}.v_avg
                   ELSE (COALESCE(${table}.v_avg, 0) * ${table}.n + EXCLUDED.v_avg * EXCLUDED.n) / (${table}.n + EXCLUDED.n) END,
      n = ${table}.n + EXCLUDED.n,
      v_min = LEAST(${table}.v_min, EXCLUDED.v_min),
      v_max = GREATEST(${table}.v_max, EXCLUDED.v_max)`
  if (hourly.ch.length) {
    await ensurePartitions(c, "ems_agg_hourly", minBucket, maxBucket)
    await c.query(
      `INSERT INTO ems_agg_hourly (channel_id, bucket, org_id, delta, allocated, n, v_avg, v_min, v_max)
       SELECT ch, b, $1, d, a, n, av, mn, mx
         FROM unnest($2::bigint[], $3::timestamptz[], $4::float8[], $5::float8[], $6::int[], $7::float8[], $8::float8[], $9::float8[]) AS t(ch, b, d, a, n, av, mn, mx)
       ${merge("ems_agg_hourly", "bucket")}`,
      [orgId, hourly.ch, hourly.key, hourly.delta, hourly.alloc, hourly.n, hourly.avg, hourly.min, hourly.max],
    )
  }
  if (daily.ch.length) {
    await c.query(
      `INSERT INTO ems_agg_daily (channel_id, day, org_id, delta, allocated, n, v_avg, v_min, v_max)
       SELECT ch, dd, $1, d, a, n, av, mn, mx
         FROM unnest($2::bigint[], $3::date[], $4::float8[], $5::float8[], $6::int[], $7::float8[], $8::float8[], $9::float8[]) AS t(ch, dd, d, a, n, av, mn, mx)
       ${merge("ems_agg_daily", "day")}`,
      [orgId, daily.ch, daily.key, daily.delta, daily.alloc, daily.n, daily.avg, daily.min, daily.max],
    )
  }
}

/** Полный путь для одного канала: опоздавшие показания, повторы, ручной ввод, выбросы. */
async function ingestChannelFull(
  c: Db,
  orgId: string,
  ch: ChannelCtx,
  idxs: number[],
  items: IngestItem[],
  receivedAt: number,
  results: IngestResult[],
): Promise<ChannelOutcome> {
  const channelId = ch.channelId
  let accepted = 0
  let lastUsable: Row | null | undefined
  let maxAt = ch.lastAt
  let rangeFrom = Number.POSITIVE_INFINITY
  let rangeTo = Number.NEGATIVE_INFINITY
  const raisedFlags = new Map<QualityFlag, { at: number; value: number }>()

  for (const idx of idxs) {
    const item = items[idx]
    const pre = precheck(ch, item, receivedAt)
    if ("status" in pre) {
      results[idx] = pre
      continue
    }
    const at = pre.at
    await ensurePartitions(c, "ems_readings", at, at)
    const { coef, offset } = coefAt(ch, at)
    const flags = pre.flags
    const appending = maxAt == null || at > maxAt
    let prev: Row | null
    let next: Row | null = null

    if (appending) {
      if (lastUsable === undefined) lastUsable = await usableBefore(c, channelId, at)
      prev = lastUsable
    } else {
      const existing = await readingAt(c, channelId, at)
      if (existing) {
        const same = Math.abs(existing.raw - item.raw) <= 1e-9 * Math.max(1, Math.abs(item.raw))
        if (!same) {
          await c.query(
            `INSERT INTO ems_reading_conflicts (org_id, channel_id, measured_at, existing_value, incoming_value, source) VALUES ($1, $2, $3, $4, $5, $6)`,
            [orgId, channelId, new Date(at), existing.raw, item.raw, item.source],
          )
        }
        results[idx] = { channelId, measuredAt: new Date(at).toISOString(), status: same ? "duplicate" : "conflict", quality: existing.quality, reason: same ? undefined : "different_value_for_same_time" }
        continue
      }
      prev = await usableBefore(c, channelId, at)
      next = await usableAfter(c, channelId, at)
    }

    let ev = evaluateReading(ch.rules, prev, { at, raw: item.raw, coef, offset, receivedAt, flags }, next)

    // Выброс: предыдущее значение было неправдоподобно большим, а текущее
    // согласуется с показанием до него — отклоняем выброс автоматически.
    const droppedAfterSpike = (ev.quality === "bad" && ev.flags.includes("negative_delta")) || ev.deltaKind === "reset"
    if (droppedAfterSpike && prev && prev.quality === "suspect" && prev.flags.includes("rate_exceeded")) {
      const before = await usableBefore(c, channelId, prev.at)
      const retry = evaluateReading(ch.rules, before, { at, raw: item.raw, coef, offset, receivedAt, flags }, next)
      if (isUsable(retry) && retry.deltaKind !== "reset") {
        await c.query(
          `UPDATE ems_readings SET quality = 'bad', delta = NULL, delta_kind = NULL, flags = array_append(flags, 'spike') WHERE channel_id = $1 AND measured_at = $2`,
          [channelId, new Date(prev.at)],
        )
        await logCorrection(c, ch, prev.at, "reject", { oldValue: prev.value, oldQuality: prev.quality, newQuality: "bad", reason: "auto: выброс, следующее показание вернулось к прежнему уровню" })
        raisedFlags.set("spike", { at: prev.at, value: prev.value })
        rangeFrom = Math.min(rangeFrom, prev.prevAt ?? prev.at)
        ev = retry
      }
    }

    await insertReading(c, ch, item, at, receivedAt, coef, ev)
    if (item.source === "manual") {
      await logCorrection(c, ch, at, "create", { newValue: ev.value, newQuality: ev.quality, reason: item.note ?? null, actorId: item.enteredBy ?? null })
    }
    accepted += 1
    results[idx] = { channelId, measuredAt: new Date(at).toISOString(), status: "accepted", quality: ev.quality, flags: ev.flags, delta: ev.delta }
    for (const f of ev.flags) if (QUALITY_EVENT_FLAGS[f]) raisedFlags.set(f, { at, value: ev.value })

    rangeFrom = Math.min(rangeFrom, ev.prevAt ?? at, at)
    rangeTo = Math.max(rangeTo, at)
    if (appending) {
      maxAt = at
      if (isUsable(ev)) lastUsable = asStored(at, item.raw, coef, ev)
    } else {
      const changedUntil = await reevaluateAfter(c, ch, at)
      if (changedUntil != null) rangeTo = Math.max(rangeTo, changedUntil)
      lastUsable = undefined
    }
  }

  if (rangeTo >= rangeFrom) {
    await recomputeRange(c, { channelId, orgId, tz: ch.tz, measureKind: ch.measureKind }, rangeFrom, rangeTo + 1)
    await c.query(
      `UPDATE ems_channels ch SET last_at = GREATEST(ch.last_at, $2), last_received_at = $3,
              last_value = COALESCE((SELECT value FROM ems_readings r WHERE r.channel_id = ch.channel_id AND r.quality <> 'bad' ORDER BY measured_at DESC LIMIT 1), ch.last_value)
        WHERE channel_id = $1`,
      [channelId, new Date(maxAt ?? rangeTo), new Date(receivedAt)],
    )
  }
  return { accepted, raisedFlags }
}

function safeIso(at: number): string {
  return Number.isFinite(at) ? new Date(at).toISOString() : "invalid"
}

function round(v: number): string {
  return (Math.round(v * 1000) / 1000).toLocaleString("ru-RU")
}

/** Ручная корректировка: отклонить, подтвердить сомнительное, исправить значение. */
export async function correctReading(
  c: Db,
  orgId: string,
  channelId: number,
  at: number,
  action: "reject" | "confirm" | "edit",
  opts: { newRaw?: number; reason: string; actorId: string },
): Promise<{ quality: string; value: number }> {
  const ch = (await loadChannels(c, [channelId])).get(channelId)
  if (!ch || ch.orgId !== orgId) throw new Error("not_found")
  const existing = await readingAt(c, channelId, at)
  if (!existing) throw new Error("not_found")
  let quality = existing.quality
  let value = existing.value
  if (action === "reject") {
    await c.query(
      `UPDATE ems_readings SET quality = 'bad', delta = NULL, delta_kind = NULL, flags = array_append(array_remove(flags, 'manual_override'), 'manual_override') WHERE channel_id = $1 AND measured_at = $2`,
      [channelId, new Date(at)],
    )
    quality = "bad"
    await logCorrection(c, ch, at, "reject", { oldValue: existing.value, oldQuality: existing.quality, newQuality: "bad", reason: opts.reason, actorId: opts.actorId })
  } else {
    const raw = action === "edit" ? opts.newRaw! : existing.raw
    const prev = await usableBefore(c, channelId, at)
    const next = await usableAfter(c, channelId, at)
    const { offset } = coefAt(ch, at)
    let ev = evaluateReading(ch.rules, prev, { at, raw, coef: existing.coef, offset, receivedAt: existing.receivedAt, flags: [...sticky(existing.flags), "manual_override"] }, next)
    if (action === "confirm" && ev.quality === "suspect") ev = { ...ev, quality: "good" }
    await c.query(`UPDATE ems_readings SET raw_value = $3 WHERE channel_id = $1 AND measured_at = $2`, [channelId, new Date(at), raw])
    await updateEvaluation(c, channelId, at, ev)
    quality = ev.quality
    value = ev.value
    await logCorrection(c, ch, at, action === "edit" ? "edit" : "restore", { oldValue: existing.value, newValue: ev.value, oldQuality: existing.quality, newQuality: ev.quality, reason: opts.reason, actorId: opts.actorId })
  }
  const changedUntil = await reevaluateAfter(c, ch, at)
  const from = Math.min(existing.prevAt ?? at, at)
  await recomputeRange(c, { channelId, orgId, tz: ch.tz, measureKind: ch.measureKind }, from, Math.max(at, changedUntil ?? at) + 1)
  return { quality, value }
}
