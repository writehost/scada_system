"use client"

import { useCallback, useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  fetchDbHealthIndexes,
  fetchDbHealthQueries,
  fetchDbHealthHistory,
  fetchDbHealthRecommendations,
  fetchDbHealthSummary,
  fetchDbHealthTables,
  type HistoryPayload,
} from "@/lib/wms/db-health-client"
import type { HealthFinding, HealthQuery, HealthSummary } from "@/lib/wms/db-health"

type Tab = "overview" | "queries" | "tables" | "indexes" | "recommendations" | "history"

function Spark({ points, label }: { points: Array<{ ts: string; value: number | null }>; label: string }) {
  const vals = points.map((p) => (typeof p.value === "number" ? p.value : 0))
  if (vals.length < 2) {
    return (
      <div className="rounded-lg border p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <p className="mt-2 text-xs text-muted-foreground">Нужно ≥2 снимка. Нажмите «Снять снимок».</p>
      </div>
    )
  }
  const mn = Math.min(...vals)
  const mx = Math.max(...vals)
  const span = Math.max(mx - mn, 1e-9)
  const w = 320
  const h = 56
  const d = vals
    .map((v, i) => {
      const x = (i / (vals.length - 1)) * w
      const y = h - ((v - mn) / span) * (h - 8) - 4
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>{vals[vals.length - 1].toLocaleString()}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full" preserveAspectRatio="none">
        <polyline fill="none" stroke="currentColor" strokeWidth="2" points={d} className="text-primary" />
      </svg>
    </div>
  )
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function Sev({ value }: { value: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        value === "CRITICAL" && "bg-red-900/70 text-red-100",
        value === "HIGH" && "bg-amber-900/70 text-amber-100",
        value === "MEDIUM" && "bg-yellow-900/50 text-yellow-100",
        value === "LOW" && "bg-emerald-900/50 text-emerald-100",
        value === "INFO" && "bg-slate-800 text-slate-200"
      )}
    >
      {value}
    </span>
  )
}

function Bar({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  )
}

export default function DbHealthPage() {
  const [tab, setTab] = useState<Tab>("overview")
  const [summary, setSummary] = useState<HealthSummary | null>(null)
  const [queries, setQueries] = useState<HealthQuery[]>([])
  const [tables, setTables] = useState<HealthSummary["largestTables"]>([])
  const [indexes, setIndexes] = useState<
    Array<{
      name: string
      table: string
      sizeBytes: number
      scans: number
      unusedCandidate: boolean
      definition: string
    }>
  >([])
  const [recs, setRecs] = useState<HealthFinding[]>([])
  const [history, setHistory] = useState<HistoryPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [compareFrom, setCompareFrom] = useState("2026-09-01")
  const [compareTo, setCompareTo] = useState("2026-09-10")

  const loadHistory = useCallback(async (from?: string, to?: string) => {
    const h = await fetchDbHealthHistory(from, to)
    setHistory(h)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const results = await Promise.allSettled([
      fetchDbHealthSummary(),
      fetchDbHealthQueries(),
      fetchDbHealthTables(),
      fetchDbHealthIndexes(),
      fetchDbHealthRecommendations(),
      fetchDbHealthHistory(),
    ])
    const [s, q, t, i, r, h] = results
    if (s.status === "fulfilled") setSummary(s.value)
    if (q.status === "fulfilled") setQueries(q.value.queries)
    if (t.status === "fulfilled") setTables(t.value.tables)
    if (i.status === "fulfilled") setIndexes(i.value.indexes)
    if (r.status === "fulfilled") setRecs(r.value.recommendations)
    if (h.status === "fulfilled") setHistory(h.value)
    const firstFail = results.find((item) => item.status === "rejected")
    if (firstFail && firstFail.status === "rejected") {
      setError(firstFail.reason instanceof Error ? firstFail.reason.message : "Не удалось снять снимок")
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "queries", label: "Queries" },
    { id: "tables", label: "Tables" },
    { id: "indexes", label: "Indexes" },
    { id: "recommendations", label: "Recommendations" },
    { id: "history", label: "History" },
  ]

  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">DATABASE HEALTH</h1>
          <p className="text-sm text-muted-foreground">
            Только анализ. Индексы не создаются и не удаляются.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
          Снять снимок
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</div>
      ) : null}

      {summary ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Score" value={String(summary.score.total)} />
          <Kpi label="Size" value={fmtBytes(summary.databaseSizeBytes)} />
          <Kpi
            label="Cache hit"
            value={summary.cacheHitRatio == null ? "n/a" : `${(summary.cacheHitRatio * 100).toFixed(2)}%`}
          />
          <Kpi label="Connections" value={`${summary.activeConnections}/${summary.maxConnections}`} />
          <Kpi label="Indexes" value={String(summary.totalIndexes)} />
          <Kpi label="Unused candidates" value={String(summary.unusedIndexCandidates)} />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1 border-b">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "px-3 py-2 text-sm",
              tab === item.id ? "border-b-2 border-primary font-medium" : "text-muted-foreground"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "overview" && summary ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-lg border p-4">
            <h2 className="text-sm font-medium">Score</h2>
            <Bar label="Query" value={summary.score.query} />
            <Bar label="Indexes" value={summary.score.indexes} />
            <Bar label="Vacuum" value={summary.score.vacuum} />
            <Bar label="Locks" value={summary.score.locks} />
            <Bar label="Storage" value={summary.score.storage} />
            <Bar label="Cache" value={summary.score.cache} />
            <Bar label="Connections" value={summary.score.connections} />
            <Bar label="Bloat" value={summary.score.bloat} />
          </div>
          <div className="space-y-2 rounded-lg border p-4">
            <h2 className="text-sm font-medium">TOP 10 ACTIONS</h2>
            {summary.topActions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет приоритетных действий по этому снимку.</p>
            ) : (
              summary.topActions.map((f, i) => (
                <div key={`${f.title}-${i}`} className="border-b pb-2 last:border-0">
                  <div className="mb-1 flex items-center gap-2">
                    <Sev value={f.severity} />
                    <span className="text-sm font-medium">{i + 1}. {f.title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{f.recommendation || f.detail}</p>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      {tab === "queries" ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="p-2">ID</th>
                <th className="p-2">Calls</th>
                <th className="p-2">Mean</th>
                <th className="p-2">Read</th>
                <th className="p-2">Issue</th>
                <th className="p-2">SQL</th>
              </tr>
            </thead>
            <tbody>
              {queries.map((q) => (
                <tr key={q.queryid} className="border-t align-top">
                  <td className="p-2 font-mono">{q.queryid}</td>
                  <td className="p-2">{q.calls.toLocaleString()}</td>
                  <td className="p-2">{q.meanMs.toFixed(1)} ms</td>
                  <td className="p-2">{q.sharedRead.toLocaleString()}</td>
                  <td className="p-2">{q.issue || "—"}</td>
                  <td className="max-w-[420px] truncate p-2 font-mono">{q.query}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "tables" ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="p-2">Table</th>
                <th className="p-2">Rows</th>
                <th className="p-2">Size</th>
                <th className="p-2">Dead</th>
                <th className="p-2">Seq</th>
                <th className="p-2">Idx</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.name} className="border-t">
                  <td className="p-2 font-mono">{t.name}</td>
                  <td className="p-2">{t.rows.toLocaleString()}</td>
                  <td className="p-2">{fmtBytes(t.sizeBytes)}</td>
                  <td className="p-2">{t.dead.toLocaleString()}</td>
                  <td className="p-2">{t.seqScan.toLocaleString()}</td>
                  <td className="p-2">{t.idxScan.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "indexes" ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="p-2">Index</th>
                <th className="p-2">Table</th>
                <th className="p-2">Size</th>
                <th className="p-2">Scans</th>
                <th className="p-2">Unused</th>
              </tr>
            </thead>
            <tbody>
              {indexes.map((i) => (
                <tr key={i.name} className="border-t">
                  <td className="p-2 font-mono">{i.name}</td>
                  <td className="p-2">{i.table}</td>
                  <td className="p-2">{fmtBytes(i.sizeBytes)}</td>
                  <td className="p-2">{i.scans.toLocaleString()}</td>
                  <td className="p-2">{i.unusedCandidate ? "candidate" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "history" && history ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Снимков: {history.count}. Локальные JSON на сервере UI, не в production Postgres.
            {history.compareFrom && history.compareTo
              ? ` Сравнение: ${history.compareFrom} → ${history.compareTo}.`
              : ""}
          </p>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void loadHistory(compareFrom, compareTo)
            }}
          >
            <label className="text-xs text-muted-foreground">
              С
              <input
                type="date"
                value={compareFrom}
                onChange={(e) => setCompareFrom(e.target.value)}
                className="mt-1 block rounded border bg-background px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              По
              <input
                type="date"
                value={compareTo}
                onChange={(e) => setCompareTo(e.target.value)}
                className="mt-1 block rounded border bg-background px-2 py-1 text-sm"
              />
            </label>
            <Button type="submit" size="sm" variant="outline">
              Сравнить
            </Button>
          </form>
          {history.warnings.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-amber-700/40 p-3">
              <h2 className="text-sm font-medium">WARNING</h2>
              {history.warnings.map((w, i) => (
                <p key={`${w.kind}-${w.objectName}-${i}`} className="text-sm">
                  <span className="font-mono text-amber-200">{w.kind}</span> {w.objectName}: {w.detail}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Предупреждений роста нет. Нужны ≥2 снимка, чтобы ловить рост таблиц, seq scan и dead tuples.
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <Spark points={history.series.tableBytes} label="Рост таблиц" />
            <Spark points={history.series.indexBytes} label="Рост индексов" />
            <Spark points={history.series.rows} label="Рост строк" />
            <Spark points={history.series.seqScan} label="Seq scan trend" />
            <Spark points={history.series.deadTuples} label="Dead tuple trend" />
            <Spark points={history.series.queryMean} label="Query latency trend" />
            <Spark points={history.series.databaseSize} label="Database size" />
            <Spark points={history.series.cacheHit} label="Cache hit ratio" />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <GrowList title="TOP growing tables" rows={history.topGrowingTables} bytes />
            <GrowList title="TOP growing indexes" rows={history.topGrowingIndexes} bytes />
            <GrowList title="TOP growing rows" rows={history.topGrowingRows} />
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="p-2">Timestamp</th>
                  <th className="p-2">DB</th>
                  <th className="p-2">Size</th>
                  <th className="p-2">Cache</th>
                  <th className="p-2">Conn</th>
                  <th className="p-2">Long tx</th>
                  <th className="p-2">Locks</th>
                </tr>
              </thead>
              <tbody>
                {history.snapshots.length === 0 ? (
                  <tr>
                    <td className="p-2 text-muted-foreground" colSpan={7}>
                      Снимков ещё нет. Нажмите «Снять снимок».
                    </td>
                  </tr>
                ) : (
                  history.snapshots.map((s) => (
                    <tr key={s.timestamp} className="border-t">
                      <td className="p-2 font-mono">{s.timestamp}</td>
                      <td className="p-2">{s.databaseName}</td>
                      <td className="p-2">{fmtBytes(s.databaseSize)}</td>
                      <td className="p-2">
                        {s.cacheHitRatio == null ? "n/a" : `${(s.cacheHitRatio * 100).toFixed(3)}%`}
                      </td>
                      <td className="p-2">{s.connections}</td>
                      <td className="p-2">{s.longTransactions}</td>
                      <td className="p-2">{s.locks}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "recommendations" ? (
        <div className="space-y-3">
          {recs.map((f, i) => (
            <article key={`${f.title}-${i}`} className="rounded-lg border p-4">
              <div className="mb-2 flex items-center gap-2">
                <Sev value={f.severity} />
                <h3 className="text-sm font-medium">{f.title}</h3>
              </div>
              <p className="text-sm">{f.detail}</p>
              {f.recommendation ? <p className="mt-1 text-sm text-muted-foreground">{f.recommendation}</p> : null}
              <p className="mt-2 text-xs text-muted-foreground">
                Impact {f.impact || "—"} · Risk {f.risk || "—"} · {f.difficulty || "—"} · {f.estimatedGain || "n/a"}
              </p>
              {f.sql ? <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs">{f.sql}</pre> : null}
            </article>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function GrowList({
  title,
  rows,
  bytes,
}: {
  title: string
  rows: Array<{ name: string; before: number; after: number; delta: number }>
  bytes?: boolean
}) {
  const fmt = (n: number) => (bytes ? fmtBytes(n) : n.toLocaleString())
  return (
    <div className="rounded-lg border p-3">
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Пока нет прироста между снимками.</p>
      ) : (
        <ul className="space-y-1 text-xs">
          {rows.map((r) => (
            <li key={r.name} className="font-mono">
              {r.name} +{fmt(r.delta)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  )
}
