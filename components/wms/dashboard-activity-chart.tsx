"use client"

import { useMemo, useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { fmtDayLabel, plural, type DashboardOpsDay } from "@/lib/wms/dashboard-data"

type Mode = "operations" | "scans"

const SERIES = [
  { key: "receiving", label: "Приёмка", className: "bg-chart-1" },
  { key: "movement", label: "Перемещение", className: "bg-chart-2" },
  { key: "issue", label: "Выдача", className: "bg-chart-3" },
  { key: "production", label: "Производство", className: "bg-chart-5" },
  { key: "other", label: "Прочее", className: "bg-muted-foreground/40" },
] as const

export function DashboardActivityChart({
  series,
  days,
  onDaysChange,
  loading,
  className,
}: {
  series: DashboardOpsDay[]
  days: number
  onDaysChange: (days: number) => void
  loading?: boolean
  className?: string
}) {
  const [mode, setMode] = useState<Mode>("operations")

  const view = useMemo(() => {
    const rows = series.map((d) => ({
      ...d,
      total: d.receiving + d.movement + d.issue + d.production + d.other,
    }))
    const maxOps = Math.max(1, ...rows.map((r) => r.total))
    const maxScans = Math.max(1, ...rows.map((r) => r.scans))
    const totals = rows.reduce(
      (acc, r) => ({
        receiving: acc.receiving + r.receiving,
        movement: acc.movement + r.movement,
        issue: acc.issue + r.issue,
        production: acc.production + r.production,
        other: acc.other + r.other,
        operations: acc.operations + r.total,
        scans: acc.scans + r.scans,
      }),
      { receiving: 0, movement: 0, issue: 0, production: 0, other: 0, operations: 0, scans: 0 }
    )
    const activeDays = rows.filter((r) => (mode === "scans" ? r.scans > 0 : r.total > 0)).length
    return { rows, maxOps, maxScans, totals, activeDays }
  }, [series, mode])

  const empty = mode === "scans" ? view.totals.scans === 0 : view.totals.operations === 0

  return (
    <section className={cn("wms-panel", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <h2 className="wms-panel-title">Активность склада</h2>
          <p className="wms-panel-subtitle">
            {mode === "operations"
              ? `${view.totals.operations} ${plural(view.totals.operations, "операция", "операции", "операций")} за период`
              : `${view.totals.scans.toLocaleString("ru-RU")} ${plural(view.totals.scans, "скан", "скана", "сканов")} за период`}
            {view.activeDays > 0
              ? ` · работа шла ${view.activeDays} ${plural(view.activeDays, "день", "дня", "дней")}`
              : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex rounded-lg border border-border/70 p-0.5">
            {(
              [
                { id: "operations" as Mode, label: "Операции" },
                { id: "scans" as Mode, label: "Сканы" },
              ]
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                  mode === m.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-border/70 p-0.5">
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onDaysChange(d)}
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-medium tabular-nums transition-colors",
                  days === d ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {d} дн
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-4">
        {loading && series.length === 0 ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : (
          <>
            <div className="relative flex h-28 items-end gap-[3px] border-b border-border/60 pl-8">
              <span className="pointer-events-none absolute left-0 top-0 text-[10px] tabular-nums text-muted-foreground/70">
                {mode === "scans" ? view.maxScans.toLocaleString("ru-RU") : view.maxOps}
              </span>
              {view.rows.map((row) => {
                const value = mode === "scans" ? row.scans : row.total
                const max = mode === "scans" ? view.maxScans : view.maxOps
                const heightPct = value > 0 ? Math.max(6, Math.round((value / max) * 100)) : 0
                return (
                  <Tooltip key={row.day}>
                    <TooltipTrigger asChild>
                      <div className="group flex h-full min-w-0 flex-1 cursor-default flex-col justify-end">
                        <div className="relative flex h-full w-full items-end justify-center">
                          {value === 0 ? (
                            <div className="h-[3px] w-full rounded-full bg-border/70" />
                          ) : mode === "scans" ? (
                            <div
                              className="w-full rounded-t-[3px] bg-chart-2 transition-opacity group-hover:opacity-80"
                              style={{ height: `${heightPct}%` }}
                            />
                          ) : (
                            <div
                              className="flex w-full flex-col-reverse overflow-hidden rounded-t-[3px] transition-opacity group-hover:opacity-80"
                              style={{ height: `${heightPct}%` }}
                            >
                              {SERIES.map((s) => {
                                const part = row[s.key]
                                if (part <= 0) return null
                                return (
                                  <div
                                    key={s.key}
                                    className={s.className}
                                    style={{ height: `${(part / row.total) * 100}%` }}
                                  />
                                )
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      <p className="font-medium">{fmtDayLabel(row.day)}</p>
                      {mode === "scans" ? (
                        <p>{row.scans.toLocaleString("ru-RU")} сканов</p>
                      ) : row.total === 0 ? (
                        <p>Операций не было</p>
                      ) : (
                        <ul className="mt-0.5 space-y-0.5">
                          {SERIES.filter((s) => row[s.key] > 0).map((s) => (
                            <li key={s.key}>
                              {s.label}: {row[s.key]}
                            </li>
                          ))}
                        </ul>
                      )}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>

            <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{view.rows.length > 0 ? fmtDayLabel(view.rows[0].day) : ""}</span>
              {empty ? <span>За период данных нет</span> : null}
              <span>{view.rows.length > 0 ? fmtDayLabel(view.rows[view.rows.length - 1].day) : ""}</span>
            </div>

            {mode === "operations" ? (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border/60 pt-3">
                {SERIES.map((s) => (
                  <span key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className={cn("h-2 w-2 rounded-sm", s.className)} />
                    {s.label}
                    <span className="font-semibold tabular-nums text-foreground">
                      {view.totals[s.key]}
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                Сканы марок с ТСД и рабочих мест — по ним видно реальную нагрузку смены, даже когда
                документов за день немного.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  )
}
