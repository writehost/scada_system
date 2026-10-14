"use client"

import { useState } from "react"
import { cn } from "./ui"

/** Компактные графики без внешних библиотек: тонкие метки, наведение с подсказкой, легенда, табличный вид. */

type Point = { label: string; values: number[] }

export function LineChart({ points, series, height = 140 }: { points: Point[]; series: Array<{ name: string; color: string }>; height?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const w = 560
  const pad = { l: 28, r: 8, t: 8, b: 20 }
  const max = Math.max(1, ...points.flatMap((p) => p.values))
  const x = (i: number) => pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, points.length - 1)
  const y = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b)
  const ticks = [0, Math.round(max / 2), max]
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
        <button className="ml-auto underline-offset-2 hover:underline" onClick={() => setTable((t) => !t)}>
          {table ? "График" : "Таблица"}
        </button>
      </div>
      {table ? (
        <div className="max-h-40 overflow-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left font-medium">День</th>
                {series.map((s) => (
                  <th key={s.name} className="text-right font-medium">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.label}>
                  <td>{p.label}</td>
                  {p.values.map((v, i) => (
                    <td key={i} className="text-right tabular-nums">
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label={series.map((s) => s.name).join(", ")} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} />
                <text x={pad.l - 4} y={y(t) + 3} textAnchor="end" fontSize={9} fill="var(--muted-foreground)">
                  {t}
                </text>
              </g>
            ))}
            {points.map((p, i) =>
              i % Math.ceil(points.length / 6) === 0 ? (
                <text key={p.label} x={x(i)} y={height - 5} textAnchor="middle" fontSize={9} fill="var(--muted-foreground)">
                  {p.label}
                </text>
              ) : null
            )}
            {series.map((s, si) => (
              <polyline key={s.name} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={points.map((p, i) => `${x(i)},${y(p.values[si])}`).join(" ")} />
            ))}
            {hover != null && (
              <>
                <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="2 2" />
                {series.map((s, si) => (
                  <circle key={s.name} cx={x(hover)} cy={y(points[hover].values[si])} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
                ))}
              </>
            )}
            {points.map((p, i) => (
              <rect key={p.label} x={x(i) - (w - pad.l - pad.r) / points.length / 2} y={0} width={(w - pad.l - pad.r) / points.length} height={height} fill="transparent" onMouseEnter={() => setHover(i)} />
            ))}
          </svg>
          {hover != null && (
            <div className="pointer-events-none absolute top-0 rounded-lg border border-border bg-popover px-2 py-1 text-[11px] shadow" style={{ left: `${(x(hover) / w) * 100}%`, transform: hover > points.length / 2 ? "translateX(-105%)" : "translateX(5%)" }}>
              <div className="font-medium">{points[hover].label}</div>
              {series.map((s, si) => (
                <div key={s.name} className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: s.color }} />
                  {s.name}: <b className="tabular-nums">{points[hover].values[si]}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Горизонтальные столбцы одной серии с подписью значения справа. */
export function HBars({ rows, format = (v) => String(v), onClick }: { rows: Array<{ key: string; label: string; value: number; hint?: string }>; format?: (v: number) => string; onClick?: (key: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.key}>
          <button className={cn("group block w-full text-left", !onClick && "cursor-default")} onClick={() => onClick?.(r.key)} title={`${r.label}: ${format(r.value)}${r.hint ? ` · ${r.hint}` : ""}`}>
            <div className="flex justify-between gap-2 text-xs">
              <span className="truncate group-hover:underline">{r.label}</span>
              <span className="tabular-nums text-muted-foreground">{format(r.value)}</span>
            </div>
            <div className="mt-0.5 h-1.5 rounded-full bg-muted">
              <div className="h-1.5 rounded-full" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: "var(--viz-1)" }} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Вертикальные столбцы одной серии (например, завершённые по неделям). */
export function Bars({ rows, height = 90 }: { rows: Array<{ label: string; value: number }>; height?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="relative">
      <div className="flex items-end gap-[2px]" style={{ height }}>
        {rows.map((r, i) => (
          <div key={r.label} className="flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} title={`${r.label}: ${r.value}`}>
            <div className="w-full rounded-t" style={{ height: `${Math.max(2, (r.value / max) * 100)}%`, background: "var(--viz-1)", opacity: hover == null || hover === i ? 1 : 0.55 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{rows[0]?.label}</span>
        <span>{hover != null ? `${rows[hover].label}: ${rows[hover].value}` : `макс. ${max}`}</span>
        <span>{rows[rows.length - 1]?.label}</span>
      </div>
    </div>
  )
}
