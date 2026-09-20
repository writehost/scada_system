import type { PoolClient } from "pg"
import { saveHistorySnapshot, type HistorySnapshot } from "@/lib/wms/db-health-history"

export type HealthFinding = {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO"
  area: string
  title: string
  detail: string
  objectName?: string
  recommendation?: string
  impact?: string
  risk?: string
  difficulty?: string
  estimatedGain?: string
  sql?: string
}

export type HealthScore = {
  total: number
  query: number
  indexes: number
  vacuum: number
  locks: number
  storage: number
  cache: number
  connections: number
  bloat: number
}

export type HealthSummary = {
  readOnly: true
  timestamp: string
  databaseName: string
  databaseSizeBytes: number
  cacheHitRatio: number | null
  activeConnections: number
  maxConnections: number
  extensions: string[]
  score: HealthScore
  largestTables: Array<{
    name: string
    rows: number
    sizeBytes: number
    dead: number
    seqScan: number
    idxScan: number
  }>
  unusedIndexCandidates: number
  duplicateIndexes: number
  totalIndexes: number
  findings: HealthFinding[]
  topActions: HealthFinding[]
  notes: string[]
}

export type HealthQuery = {
  queryid: string
  query: string
  calls: number
  meanMs: number
  totalMs: number
  rows: number
  sharedHit: number
  sharedRead: number
  tempBlks: number
  tempBlksRead?: number
  issue: string
}

function penalty(severity: HealthFinding["severity"]): number {
  return { CRITICAL: 18, HIGH: 10, MEDIUM: 5, LOW: 2, INFO: 0 }[severity]
}

function scoreOf(findings: HealthFinding[], cacheHit: number | null, active: number, maxConn: number): HealthScore {
  const axes: Record<string, number> = {
    query: 100,
    indexes: 100,
    vacuum: 100,
    locks: 100,
    storage: 100,
    cache: 100,
    connections: 100,
    bloat: 100,
  }
  const map: Record<string, string> = {
    query: "query",
    index: "indexes",
    vacuum: "vacuum",
    locks: "locks",
    table: "storage",
    cache: "cache",
    connections: "connections",
    bloat: "bloat",
    orm: "query",
    config: "storage",
  }
  for (const f of findings) {
    const axis = map[f.area] || "storage"
    axes[axis] = Math.max(0, axes[axis] - penalty(f.severity))
  }
  if (cacheHit != null) {
    if (cacheHit < 0.9) axes.cache = Math.min(axes.cache, 40)
    else if (cacheHit < 0.97) axes.cache = Math.min(axes.cache, 70)
    else if (cacheHit < 0.99) axes.cache = Math.min(axes.cache, 88)
  }
  if (maxConn > 0 && active / maxConn > 0.8) axes.connections = Math.min(axes.connections, 50)
  const total = Math.round(
    axes.query * 0.22 +
      axes.indexes * 0.16 +
      axes.vacuum * 0.12 +
      axes.locks * 0.12 +
      axes.storage * 0.1 +
      axes.cache * 0.1 +
      axes.connections * 0.08 +
      axes.bloat * 0.1
  )
  return {
    total,
    query: axes.query,
    indexes: axes.indexes,
    vacuum: axes.vacuum,
    locks: axes.locks,
    storage: axes.storage,
    cache: axes.cache,
    connections: axes.connections,
    bloat: axes.bloat,
  }
}

function classifySql(sql: string, meanMs: number, calls: number, temp: number, sharedRead: number): string {
  const issues: string[] = []
  const q = sql.toLowerCase()
  if (/\boffset\b/.test(q)) issues.push("OFFSET pagination")
  if (/\bilike\b/.test(q)) issues.push("ILIKE")
  if (temp > 0) issues.push("temp files")
  if (sharedRead > 50_000 && meanMs > 20) issues.push("high shared read")
  if (meanMs > 100 && calls > 100) issues.push("slow frequent query")
  if (/count\s*\(\s*\*\s*\)/.test(q) && /wms_/.test(q)) issues.push("COUNT on WMS table")
  return issues.join("; ")
}

async function tryQuery<T extends Record<string, unknown>>(
  client: PoolClient,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  try {
    const r = await client.query(sql, params)
    return r.rows as T[]
  } catch {
    return []
  }
}

export async function collectDbHealth(client: PoolClient): Promise<{
  summary: HealthSummary
  queries: HealthQuery[]
  tables: HealthSummary["largestTables"]
  indexes: Array<{
    name: string
    table: string
    sizeBytes: number
    scans: number
    unusedCandidate: boolean
    definition: string
  }>
  recommendations: HealthFinding[]
}> {
  await client.query("BEGIN")
  await client.query("SET LOCAL default_transaction_read_only = on")
  await client.query("SET LOCAL statement_timeout = 15000")
  await client.query("SET LOCAL lock_timeout = 2000")
  try {
    return await collectDbHealthTx(client)
  } finally {
    await client.query("ROLLBACK").catch(() => undefined)
  }
}

async function collectDbHealthTx(client: PoolClient): Promise<{
  summary: HealthSummary
  queries: HealthQuery[]
  tables: HealthSummary["largestTables"]
  indexes: Array<{
    name: string
    table: string
    sizeBytes: number
    scans: number
    unusedCandidate: boolean
    definition: string
  }>
  recommendations: HealthFinding[]
}> {

  const notes: string[] = []
  const findings: HealthFinding[] = []

  const ident = await client.query<{ db: string; bytes: string }>(
    "SELECT current_database() AS db, pg_database_size(current_database())::text AS bytes"
  )
  const databaseName = ident.rows[0]?.db || ""
  const databaseSizeBytes = Number(ident.rows[0]?.bytes || 0)

  const ext = await client.query<{ extname: string }>("SELECT extname FROM pg_extension")
  const extensions = ext.rows.map((r) => r.extname)
  if (!extensions.includes("pg_stat_statements")) {
    notes.push("pg_stat_statements is not installed — query ranking is empty.")
    findings.push({
      severity: "HIGH",
      area: "config",
      title: "pg_stat_statements missing",
      detail: "Cannot rank live SQL. CREATE EXTENSION is review-only.",
      recommendation: "Install pg_stat_statements in shared_preload_libraries, then CREATE EXTENSION.",
      sql: "-- REVIEW REQUIRED\n-- CREATE EXTENSION IF NOT EXISTS pg_stat_statements;",
    })
  }

  const cache = await client.query<{ heap: number | null }>(`
    SELECT CASE WHEN blks_hit + blks_read = 0 THEN NULL
                ELSE blks_hit::float / (blks_hit + blks_read) END AS heap
    FROM pg_stat_database WHERE datname = current_database()
  `)
  const cacheHitRatio = cache.rows[0]?.heap ?? null

  const conn = await client.query<{ active: string; max: string }>(`
    SELECT
      (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::text AS active,
      (SELECT setting FROM pg_settings WHERE name = 'max_connections') AS max
  `)
  const activeConnections = Number(conn.rows[0]?.active || 0)
  const maxConnections = Number(conn.rows[0]?.max || 0)

  const tableRows = await client.query<{
    schema: string
    name: string
    n_live_tup: string
    size_bytes: string
    index_bytes: string
    n_dead_tup: string
    seq_scan: string
    seq_tup_read: string
    idx_scan: string
    idx_tup_fetch: string
    n_tup_ins: string
    n_tup_upd: string
    n_tup_del: string
    last_vacuum: Date | string | null
    last_autovacuum: Date | string | null
    last_analyze: Date | string | null
    last_autoanalyze: Date | string | null
  }>(`
    SELECT
      n.nspname AS schema,
      c.relname AS name,
      COALESCE(s.n_live_tup, 0)::bigint AS n_live_tup,
      pg_table_size(c.oid)::bigint AS size_bytes,
      pg_indexes_size(c.oid)::bigint AS index_bytes,
      COALESCE(s.n_dead_tup, 0)::bigint AS n_dead_tup,
      COALESCE(s.seq_scan, 0)::bigint AS seq_scan,
      COALESCE(s.seq_tup_read, 0)::bigint AS seq_tup_read,
      COALESCE(s.idx_scan, 0)::bigint AS idx_scan,
      COALESCE(s.idx_tup_fetch, 0)::bigint AS idx_tup_fetch,
      COALESCE(s.n_tup_ins, 0)::bigint AS n_tup_ins,
      COALESCE(s.n_tup_upd, 0)::bigint AS n_tup_upd,
      COALESCE(s.n_tup_del, 0)::bigint AS n_tup_del,
      s.last_vacuum, s.last_autovacuum, s.last_analyze, s.last_autoanalyze
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY pg_table_size(c.oid) DESC
    LIMIT 200
  `)

  const ts = (v: Date | string | null) => (v == null ? null : typeof v === "string" ? v : v.toISOString())

  const historyTables = tableRows.rows.map((r) => ({
    schema: r.schema,
    name: r.name,
    estimatedRows: Number(r.n_live_tup),
    tableSize: Number(r.size_bytes),
    indexSize: Number(r.index_bytes),
    totalSize: Number(r.size_bytes) + Number(r.index_bytes),
    seqScan: Number(r.seq_scan),
    seqTupRead: Number(r.seq_tup_read),
    idxScan: Number(r.idx_scan),
    idxTupFetch: Number(r.idx_tup_fetch),
    nTupIns: Number(r.n_tup_ins),
    nTupUpd: Number(r.n_tup_upd),
    nTupDel: Number(r.n_tup_del),
    nLiveTup: Number(r.n_live_tup),
    nDeadTup: Number(r.n_dead_tup),
    lastVacuum: ts(r.last_vacuum),
    lastAutovacuum: ts(r.last_autovacuum),
    lastAnalyze: ts(r.last_analyze),
    lastAutoanalyze: ts(r.last_autoanalyze),
  }))

  const tables = historyTables.map((t) => ({
    name: t.name,
    rows: t.nLiveTup,
    sizeBytes: t.tableSize,
    dead: t.nDeadTup,
    seqScan: t.seqScan,
    idxScan: t.idxScan,
  }))

  for (const t of tables) {
    const live = t.rows
    const dead = t.dead
    const ratio = live + dead > 0 ? dead / (live + dead) : 0
    if (ratio >= 0.3 && live > 1_000_000) {
      findings.push({
        severity: "HIGH",
        area: "bloat",
        title: `Dead-tuple pressure on ${t.name}`,
        detail: `Estimated dead ratio ${(ratio * 100).toFixed(1)}% (not pgstattuple).`,
        objectName: t.name,
        recommendation: "Tune per-table autovacuum. Do not VACUUM FULL.",
      })
    }
    if (live >= 100_000 && t.seqScan > t.idxScan * 2 && t.seqScan > 100) {
      findings.push({
        severity: live >= 1_000_000 ? "HIGH" : "MEDIUM",
        area: "table",
        title: `Sequential scans dominate on ${t.name}`,
        detail: `seq_scan=${t.seqScan} vs idx_scan=${t.idxScan} at ~${live} rows.`,
        objectName: t.name,
        recommendation: "Map to pg_stat_statements, then HypoPG. Do not index every WHERE column.",
      })
    }
  }

  const idxRows = await client.query<{
    schema: string
    name: string
    table: string
    size_bytes: string
    idx_scan: string
    defn: string
    indisprimary: boolean
  }>(`
    SELECT
      n.nspname AS schema,
      i.relname AS name,
      t.relname AS table,
      pg_relation_size(ix.indexrelid)::bigint AS size_bytes,
      COALESCE(si.idx_scan, 0)::bigint AS idx_scan,
      pg_get_indexdef(ix.indexrelid) AS defn,
      ix.indisprimary
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    LEFT JOIN pg_stat_user_indexes si ON si.indexrelid = ix.indexrelid
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY pg_relation_size(ix.indexrelid) DESC
  `)

  const indexes = idxRows.rows.map((r) => ({
    schema: r.schema,
    name: r.name,
    table: r.table,
    sizeBytes: Number(r.size_bytes),
    scans: Number(r.idx_scan),
    unusedCandidate: Number(r.idx_scan) === 0 && !r.indisprimary,
    definition: r.defn,
  }))

  const unusedIndexCandidates = indexes.filter((i) => i.unusedCandidate).length
  const defnKey = new Map<string, string[]>()
  for (const i of indexes) {
    const key = `${i.table}::${i.definition.replace(/^CREATE (UNIQUE )?INDEX \S+ ON /, "")}`
    const list = defnKey.get(key) || []
    list.push(i.name)
    defnKey.set(key, list)
  }
  let duplicateIndexes = 0
  for (const list of defnKey.values()) {
    if (list.length > 1) duplicateIndexes += list.length - 1
  }

  if (unusedIndexCandidates > 0) {
    findings.push({
      severity: unusedIndexCandidates > 8 ? "HIGH" : "MEDIUM",
      area: "index",
      title: `${unusedIndexCandidates} unused index candidate(s)`,
      detail: "idx_scan=0. Candidate for removal — not a drop order. Stats reset / new / monthly jobs.",
      recommendation: "Do not DROP after one snapshot.",
    })
  }

  let queryRows = await tryQuery<{
    queryid: string
    query: string
    calls: string
    mean_ms: number
    total_ms: number
    rows: string
    shared_blks_hit: string
    shared_blks_read: string
    temp_blks_read: string
    temp_blks_written: string
  }>(
    client,
    `SELECT queryid::text AS queryid, query, calls::bigint AS calls,
            mean_exec_time AS mean_ms, total_exec_time AS total_ms, rows::bigint AS rows,
            shared_blks_hit::bigint AS shared_blks_hit, shared_blks_read::bigint AS shared_blks_read,
            temp_blks_read::bigint AS temp_blks_read, temp_blks_written::bigint AS temp_blks_written
     FROM pg_stat_statements
     WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
       AND query NOT ILIKE '%pg_stat_statements%'
     ORDER BY total_exec_time DESC
     LIMIT 40`
  )
  if (queryRows.length === 0) {
    queryRows = await tryQuery(
      client,
      `SELECT queryid::text AS queryid, query, calls::bigint AS calls,
              mean_time AS mean_ms, total_time AS total_ms, rows::bigint AS rows,
              shared_blks_hit::bigint AS shared_blks_hit, shared_blks_read::bigint AS shared_blks_read,
              COALESCE(temp_blks_read, 0)::bigint AS temp_blks_read,
              temp_blks_written::bigint AS temp_blks_written
       FROM pg_stat_statements
       ORDER BY total_time DESC
       LIMIT 40`
    )
  }

  const queries: HealthQuery[] = queryRows.map((r) => {
    const meanMs = Number(r.mean_ms || 0)
    const calls = Number(r.calls || 0)
    const temp = Number(r.temp_blks_written || 0)
    const sharedRead = Number(r.shared_blks_read || 0)
    const issue = classifySql(String(r.query || ""), meanMs, calls, temp, sharedRead)
    if (issue && meanMs > 50) {
      findings.push({
        severity: meanMs > 200 && calls > 10_000 ? "CRITICAL" : "HIGH",
        area: "query",
        title: `Query ${r.queryid}: ${issue}`,
        detail: String(r.query || "").slice(0, 400),
        objectName: String(r.queryid),
        recommendation: "Inspect EXPLAIN (BUFFERS). Use HypoPG before any CREATE INDEX CONCURRENTLY.",
        estimatedGain: `${calls.toLocaleString()} calls @ ${meanMs.toFixed(1)} ms`,
      })
    }
    return {
      queryid: String(r.queryid),
      query: String(r.query || ""),
      calls,
      meanMs,
      totalMs: Number(r.total_ms || 0),
      rows: Number(r.rows || 0),
      sharedHit: Number(r.shared_blks_hit || 0),
      sharedRead,
      tempBlks: temp,
      tempBlksRead: Number(r.temp_blks_read || 0),
      issue,
    }
  })

  const activity = await tryQuery<{ long_tx: string; waiting_locks: string }>(
    client,
    `SELECT
       (SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid != pg_backend_pid()
          AND xact_start IS NOT NULL
          AND now() - xact_start > interval '30 seconds')::text AS long_tx,
       (SELECT count(*) FROM pg_locks l
        JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE a.datname = current_database() AND NOT l.granted)::text AS waiting_locks`
  )
  const longTransactions = Number(activity[0]?.long_tx || 0)
  const blocked = Number(activity[0]?.waiting_locks || 0)
  if (blocked > 0) {
    findings.push({
      severity: blocked >= 3 ? "CRITICAL" : "HIGH",
      area: "locks",
      title: `${blocked} blocked session(s)`,
      detail: "Live lock waiters. Investigate the blocker first.",
      recommendation: "Find the oldest xact holding the lock. Do not kill randomly.",
    })
  }

  const scale = await tryQuery<{ setting: string }>(
    client,
    `SELECT setting FROM pg_settings WHERE name = 'autovacuum_vacuum_scale_factor'`
  )
  const scaleVal = Number(scale[0]?.setting || 0.2)
  if (scaleVal >= 0.1 && tables.some((t) => t.rows >= 1_000_000)) {
    findings.push({
      severity: "MEDIUM",
      area: "vacuum",
      title: `Global autovacuum scale ${scaleVal} is late for million-row tables`,
      detail: "Per-table storage parameters, not a global hammer.",
      recommendation: "ALTER TABLE … SET (autovacuum_vacuum_scale_factor = 0.02) — review only.",
      sql: "-- REVIEW REQUIRED\n-- ALTER TABLE <hot> SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 5000);",
    })
  }

  if (cacheHitRatio != null && cacheHitRatio < 0.97) {
    findings.push({
      severity: cacheHitRatio < 0.9 ? "HIGH" : "MEDIUM",
      area: "cache",
      title: `Cache hit ratio ${(cacheHitRatio * 100).toFixed(2)}%`,
      detail: `Database size ${Math.round(databaseSizeBytes / 1024 ** 3)} GB.`,
      recommendation: "Do not raise shared_buffers without DB-host RAM.",
    })
  }

  const score = scoreOf(findings, cacheHitRatio, activeConnections, maxConnections)
  const topActions = findings
    .filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH" || f.severity === "MEDIUM")
    .slice(0, 10)

  const summary: HealthSummary = {
    readOnly: true,
    timestamp: new Date().toISOString(),
    databaseName,
    databaseSizeBytes,
    cacheHitRatio,
    activeConnections,
    maxConnections,
    extensions,
    score,
    largestTables: tables,
    unusedIndexCandidates,
    duplicateIndexes,
    totalIndexes: indexes.length,
    findings,
    topActions,
    notes,
  }

  const history: HistorySnapshot = {
    timestamp: summary.timestamp,
    databaseName,
    databaseSize: databaseSizeBytes,
    cacheHitRatio,
    connections: activeConnections,
    maxConnections,
    longTransactions,
    locks: blocked,
    tables: historyTables,
    indexes: indexes.map((i) => ({
      schema: i.schema || "public",
      table: i.table,
      name: i.name,
      sizeBytes: i.sizeBytes,
      idxScan: i.scans,
    })),
    queries: queries.map((q) => ({
      queryid: q.queryid,
      query: q.query.slice(0, 2000),
      calls: q.calls,
      totalExecTime: q.totalMs,
      meanExecTime: q.meanMs,
      rows: q.rows,
      sharedBlksHit: q.sharedHit,
      sharedBlksRead: q.sharedRead,
      tempBlksRead: q.tempBlksRead || 0,
      tempBlksWritten: q.tempBlks,
    })),
  }
  try {
    saveHistorySnapshot(history)
  } catch {
    /* local disk only — never fail the health read */
  }

  return { summary, queries, tables, indexes, recommendations: topActions }
}
