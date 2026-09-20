import fs from "node:fs"
import path from "node:path"

export type HistoryTable = {
  schema: string
  name: string
  estimatedRows: number
  tableSize: number
  indexSize: number
  totalSize: number
  seqScan: number
  seqTupRead: number
  idxScan: number
  idxTupFetch: number
  nTupIns: number
  nTupUpd: number
  nTupDel: number
  nLiveTup: number
  nDeadTup: number
  lastVacuum: string | null
  lastAutovacuum: string | null
  lastAnalyze: string | null
  lastAutoanalyze: string | null
}

export type HistoryQuery = {
  queryid: string
  query: string
  calls: number
  totalExecTime: number
  meanExecTime: number
  rows: number
  sharedBlksHit: number
  sharedBlksRead: number
  tempBlksRead: number
  tempBlksWritten: number
}

export type HistorySnapshot = {
  timestamp: string
  databaseName: string
  databaseSize: number
  cacheHitRatio: number | null
  connections: number
  maxConnections: number
  longTransactions: number
  locks: number
  tables: HistoryTable[]
  indexes: Array<{ schema: string; table: string; name: string; sizeBytes: number; idxScan: number }>
  queries: HistoryQuery[]
}

export type GrowthWarning = {
  severity: "WARNING"
  kind: string
  objectName: string
  detail: string
}

function historyDir(): string {
  const env = (process.env.DB_HEALTH_HISTORY_DIR || "").trim()
  if (env) return env
  return path.join(process.cwd(), "data", "db-health")
}

export function saveHistorySnapshot(snap: HistorySnapshot): string {
  const dir = historyDir()
  fs.mkdirSync(dir, { recursive: true })
  const stamp = snap.timestamp.replace(/[:.]/g, "-")
  const file = path.join(dir, `snap-${stamp}-${snap.databaseName}.json`)
  fs.writeFileSync(file, JSON.stringify(snap), "utf8")
  prune(dir, 120)
  return file
}

function prune(dir: string, keep: number) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("snap-") && f.endsWith(".json"))
    .map((f) => path.join(dir, f))
    .sort()
  while (files.length > keep) {
    const old = files.shift()
    if (old) fs.unlinkSync(old)
  }
}

export function listHistorySnapshots(database?: string): HistorySnapshot[] {
  const dir = historyDir()
  if (!fs.existsSync(dir)) return []
  const out: HistorySnapshot[] = []
  for (const name of fs.readdirSync(dir).filter((f) => f.startsWith("snap-") && f.endsWith(".json")).sort()) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as HistorySnapshot
      if (database && raw.databaseName !== database) continue
      out.push(raw)
    } catch {
      /* skip broken */
    }
  }
  return out
}

function keyOf(t: HistoryTable) {
  return `${t.schema || "public"}.${t.name}`
}

export function growthWarnings(prev: HistorySnapshot | null, curr: HistorySnapshot): GrowthWarning[] {
  const warnings: GrowthWarning[] = []
  const oldMap = new Map((prev?.tables || []).map((t) => [keyOf(t), t]))
  for (const t of curr.tables) {
    const key = keyOf(t)
    if (t.tableSize > 0 && t.indexSize > t.tableSize && t.indexSize >= 1_000_000) {
      warnings.push({
        severity: "WARNING",
        kind: "index_gt_table",
        objectName: key,
        detail: `index size > table size (${t.indexSize} > ${t.tableSize})`,
      })
    }
    const live = t.nLiveTup
    const dead = t.nDeadTup
    const ratio = live + dead > 0 ? dead / (live + dead) : 0
    if (dead >= 10_000 || (live >= 1000 && ratio >= 0.2)) {
      warnings.push({
        severity: "WARNING",
        kind: "dead_tuples",
        objectName: key,
        detail: `dead=${dead} live=${live} ratio=${(ratio * 100).toFixed(1)}%`,
      })
    }
    const old = oldMap.get(key)
    if (!old) continue
    const rowPct = old.nLiveTup > 0 ? (t.nLiveTup - old.nLiveTup) / old.nLiveTup : 0
    const sizePct = old.tableSize > 0 ? (t.tableSize - old.tableSize) / old.tableSize : 0
    if (rowPct >= 0.3 || sizePct >= 0.3) {
      warnings.push({
        severity: "WARNING",
        kind: "table_growth_24h",
        objectName: key,
        detail: `table grew > 30% in 24h (rows ${old.nLiveTup}→${t.nLiveTup}, size ${old.tableSize}→${t.tableSize})`,
      })
    }
    if (old.seqTupRead > 1000 && t.seqTupRead > old.seqTupRead) {
      const seqX = t.seqTupRead / old.seqTupRead
      const rowX = old.nLiveTup > 0 ? t.nLiveTup / old.nLiveTup : 1
      if (seqX >= 3 && seqX > rowX * 2) {
        warnings.push({
          severity: "WARNING",
          kind: "seq_tup_read_vs_rows",
          objectName: key,
          detail: `seq_tup_read ×${seqX.toFixed(1)} vs rows ×${rowX.toFixed(2)}`,
        })
      }
    }
  }
  const oldQ = new Map((prev?.queries || []).map((q) => [q.queryid, q]))
  for (const q of curr.queries) {
    const o = oldQ.get(q.queryid)
    if (!o || o.meanExecTime < 5 || q.calls < 10) continue
    if (q.meanExecTime >= o.meanExecTime * 2) {
      warnings.push({
        severity: "WARNING",
        kind: "query_mean_2x",
        objectName: q.queryid,
        detail: `mean ${o.meanExecTime.toFixed(1)}→${q.meanExecTime.toFixed(1)} ms`,
      })
    }
  }
  return warnings
}

export function topGrowing(
  prev: HistorySnapshot,
  curr: HistorySnapshot,
  field: "tableSize" | "nLiveTup" | "indexSize"
): Array<{ name: string; before: number; after: number; delta: number }> {
  if (field === "indexSize") {
    const old = new Map(prev.indexes.map((i) => [`${i.schema}.${i.table}.${i.name}`, i.sizeBytes]))
    return curr.indexes
      .map((i) => {
        const name = `${i.schema}.${i.table}.${i.name}`
        const before = old.get(name) ?? i.sizeBytes
        return { name, before, after: i.sizeBytes, delta: i.sizeBytes - before }
      })
      .filter((r) => r.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 10)
  }
  const old = new Map(prev.tables.map((t) => [keyOf(t), t]))
  return curr.tables
    .map((t) => {
      const o = old.get(keyOf(t))
      const before = o ? Number(o[field]) : Number(t[field])
      const after = Number(t[field])
      return { name: keyOf(t), before, after, delta: after - before }
    })
    .filter((r) => r.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 10)
}

function nearestSnapshot(snaps: HistorySnapshot[], day: string): HistorySnapshot | null {
  const target = Date.parse(day)
  if (!Number.isFinite(target) || snaps.length === 0) return null
  return snaps.reduce((best, snap) => {
    const dist = Math.abs(Date.parse(snap.timestamp) - target)
    const bestDist = best ? Math.abs(Date.parse(best.timestamp) - target) : Number.POSITIVE_INFINITY
    return dist < bestDist ? snap : best
  }, null as HistorySnapshot | null)
}

export function historyPayload(database?: string, from?: string, to?: string) {
  const snaps = listHistorySnapshots(database)
  let curr = snaps[snaps.length - 1] || null
  let prev = snaps.length >= 2 ? snaps[snaps.length - 2] : null
  if (from && to && snaps.length) {
    prev = nearestSnapshot(snaps, from)
    curr = nearestSnapshot(snaps, to)
  }
  const warnings = curr ? growthWarnings(prev, curr) : []
  return {
    count: snaps.length,
    compareFrom: prev?.timestamp || null,
    compareTo: curr?.timestamp || null,
    snapshots: snaps.map((s) => ({
      timestamp: s.timestamp,
      databaseName: s.databaseName,
      databaseSize: s.databaseSize,
      cacheHitRatio: s.cacheHitRatio,
      connections: s.connections,
      longTransactions: s.longTransactions,
      locks: s.locks,
    })),
    series: {
      databaseSize: snaps.map((s) => ({ ts: s.timestamp, value: s.databaseSize })),
      tableBytes: snaps.map((s) => ({
        ts: s.timestamp,
        value: s.tables.reduce((n, t) => n + t.tableSize, 0),
      })),
      cacheHit: snaps.map((s) => ({ ts: s.timestamp, value: s.cacheHitRatio })),
      connections: snaps.map((s) => ({ ts: s.timestamp, value: s.connections })),
      deadTuples: snaps.map((s) => ({
        ts: s.timestamp,
        value: s.tables.reduce((n, t) => n + t.nDeadTup, 0),
      })),
      seqScan: snaps.map((s) => ({
        ts: s.timestamp,
        value: s.tables.reduce((n, t) => n + t.seqScan, 0),
      })),
      rows: snaps.map((s) => ({
        ts: s.timestamp,
        value: s.tables.reduce((n, t) => n + t.nLiveTup, 0),
      })),
      indexBytes: snaps.map((s) => ({
        ts: s.timestamp,
        value: s.indexes.reduce((n, i) => n + i.sizeBytes, 0),
      })),
      queryMean: snaps.map((s) => {
        const qs = s.queries
        const mean = qs.length ? qs.reduce((n, q) => n + q.meanExecTime, 0) / qs.length : 0
        return { ts: s.timestamp, value: mean }
      }),
    },
    topGrowingTables: prev && curr ? topGrowing(prev, curr, "tableSize") : [],
    topGrowingRows: prev && curr ? topGrowing(prev, curr, "nLiveTup") : [],
    topGrowingIndexes: prev && curr ? topGrowing(prev, curr, "indexSize") : [],
    warnings,
  }
}
