"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Area, Bar, Brush, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { ImageDown } from "lucide-react"
import { num, unit as unitLabel } from "@/lib/client/format"
import { Button } from "@/components/ui"

export type Point = { t: string; v: number | null; allocated?: number; min?: number | null; max?: number | null }
export type Series = { key: string; label: string; unit: string; kind: "consumption" | "instant"; resolution: "raw" | "hour" | "day" | "month"; points: Point[] }

const COLOR_VARS: Record<string, string> = { electricity: "--chart-1", cold_water: "--chart-2", hot_water: "--chart-4", heat: "--chart-3", gas: "--chart-5", power: "--chart-5" }

/** Цвета из токенов темы, вычисленные в конкретные значения (нужно для экспорта PNG). */
export function useColors(): (key: string, i: number) => string {
  const [vars, setVars] = useState<Record<string, string>>({})
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement)
    const out: Record<string, string> = {}
    for (const v of ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5", "--muted-foreground", "--border", "--foreground", "--card"]) out[v] = cs.getPropertyValue(v).trim()
    setVars(out)
  }, [])
  return (key: string, i: number) => {
    const base = key.replace(/^(cost:|ch:)/, "")
    const v = COLOR_VARS[base] ?? ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"][i % 5]
    // Салатовый токен бренда светлый — для столбцов на светлом фоне берём более тёмный оттенок.
    if (v === "--chart-1") return "oklch(0.68 0.16 118)"
    return vars[v] || "#888"
  }
}

export function formatTick(t: string, resolution: string, tz?: string): string {
  if (resolution === "hour" || resolution === "raw") {
    const d = new Date(t)
    return d.toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit", day: resolution === "raw" ? undefined : "2-digit", month: resolution === "raw" ? undefined : "2-digit", timeZone: tz })
  }
  if (resolution === "month") return new Date(`${t.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString("ru-RU", { month: "short", year: "2-digit", timeZone: "UTC" })
  return new Date(`${t}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "UTC" })
}

function fullLabel(t: string, resolution: string, tz?: string): string {
  if (resolution === "hour") {
    const d = new Date(t)
    const e = new Date(d.getTime() + 3600000)
    return `${d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: tz })}–${e.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: tz })}`
  }
  if (resolution === "raw") return new Date(t).toLocaleString("ru-RU", { timeZone: tz })
  if (resolution === "month") return new Date(`${t.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" })
  return new Date(`${t}T12:00:00Z`).toLocaleDateString("ru-RU", { weekday: "short", day: "2-digit", month: "long", timeZone: "UTC" })
}

/** Экспорт графика в PNG: SVG рендерится на canvas с белым фоном. */
export async function exportPng(container: HTMLElement | null, name: string) {
  const svg = container?.querySelector("svg.recharts-surface") as SVGSVGElement | null
  if (!svg) return
  const clone = svg.cloneNode(true) as SVGSVGElement
  const { width, height } = svg.getBoundingClientRect()
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  clone.setAttribute("width", String(width))
  clone.setAttribute("height", String(height))
  clone.setAttribute("style", "font-family: Inter, Segoe UI, Arial, sans-serif; font-size: 11px")
  const data = new XMLSerializer().serializeToString(clone)
  const img = new Image()
  const url = URL.createObjectURL(new Blob([data], { type: "image/svg+xml;charset=utf-8" }))
  await new Promise<void>((res, rej) => {
    img.onload = () => res()
    img.onerror = () => rej(new Error("svg render"))
    img.src = url
  })
  const scale = 2
  const canvas = document.createElement("canvas")
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(scale, scale)
  ctx.drawImage(img, 0, 0)
  URL.revokeObjectURL(url)
  const a = document.createElement("a")
  a.download = `${name}.png`
  a.href = canvas.toDataURL("image/png")
  a.click()
}

export function ChartFrame({ children, name, toolbar, height = 280 }: { children: (ref: React.RefObject<HTMLDivElement | null>) => ReactNode; name: string; toolbar?: ReactNode; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {toolbar}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => exportPng(ref.current, name)} aria-label="Сохранить график как PNG">
          <ImageDown /> PNG
        </Button>
      </div>
      <div ref={ref} style={{ height }} className="min-w-0">
        {children(ref)}
      </div>
    </div>
  )
}

type Row = Record<string, number | string | null>

/**
 * График потребления. Разные единицы (кВт·ч, м³, ₽) никогда не делят одну шкалу:
 * первая единица — левая ось, вторая — правая. Распределённая между редкими
 * показаниями часть закрашена штриховкой; пропуск данных — пустое место.
 */
export function ConsumptionChart({ series, tz, height = 280, name = "потребление", showBrush }: { series: Series[]; tz?: string; height?: number; name?: string; showBrush?: boolean }) {
  const color = useColors()
  const units = [...new Set(series.map((s) => s.unit))].slice(0, 2)
  const visible = series.filter((s) => units.includes(s.unit))
  const resolution = visible[0]?.resolution ?? "day"
  const rows = useMemo(() => {
    const times = [...new Set(visible.flatMap((s) => s.points.map((p) => p.t)))].sort()
    const map = visible.map((s) => new Map(s.points.map((p) => [p.t, p])))
    return times.map((t) => {
      const r: Row = { t }
      visible.forEach((s, i) => {
        const p = map[i].get(t)
        if (s.kind === "instant") {
          r[`${s.key}`] = p?.v ?? null
          r[`${s.key}__band`] = p?.min != null && p?.max != null ? ([p.min, p.max] as unknown as number) : null
        } else {
          const alloc = Math.min(p?.allocated ?? 0, p?.v ?? 0)
          r[`${s.key}__m`] = p?.v == null ? null : Math.max(0, p.v - alloc)
          r[`${s.key}__a`] = p?.v == null || !alloc ? null : alloc
          r[`${s.key}__v`] = p?.v ?? null
        }
      })
      return r
    })
  }, [visible])
  const anyAllocated = visible.some((s) => s.points.some((p) => (p.allocated ?? 0) > 0))
  if (!rows.length) return <div className="flex h-40 items-center justify-center text-[13px] text-muted-foreground">Нет данных за период</div>
  return (
    <div style={{ height }} className="min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: units.length > 1 ? 4 : 12, bottom: 0, left: 0 }}>
          <defs>
            {visible.map((s, i) => (
              <pattern key={s.key} id={`hatch-${s.key.replace(/[^a-z0-9]/gi, "")}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="5" height="5" fill={color(s.key, i)} fillOpacity={0.25} />
                <line x1="0" y1="0" x2="0" y2="5" stroke={color(s.key, i)} strokeWidth="2" />
              </pattern>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.88 0.02 90)" />
          <XAxis dataKey="t" tickFormatter={(t) => formatTick(t, resolution, tz)} tick={{ fontSize: 11 }} minTickGap={18} tickLine={false} axisLine={false} />
          {units.map((u, i) => (
            <YAxis key={u} yAxisId={u} orientation={i === 0 ? "left" : "right"} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => num(v, 1)} label={{ value: unitLabel(u), angle: -90, position: i === 0 ? "insideLeft" : "insideRight", fontSize: 11, offset: 12 }} />
          ))}
          <Tooltip
            cursor={{ fill: "oklch(0.92 0.02 90 / 0.5)" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const row = payload[0].payload as Row
              return (
                <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
                  <p className="mb-1 font-medium">{fullLabel(String(label), resolution, tz)}</p>
                  {visible.map((s, i) => {
                    const v = s.kind === "instant" ? row[s.key] : row[`${s.key}__v`]
                    const a = row[`${s.key}__a`]
                    return (
                      <p key={s.key} className="flex items-center gap-1.5">
                        <span className="size-2 rounded-sm" style={{ background: color(s.key, i) }} />
                        <span className="text-muted-foreground">{s.label}:</span>
                        <span className="ems-num font-medium">{v == null ? "нет данных" : `${num(Number(v), s.unit === "RUB" ? 0 : 3)} ${unitLabel(s.unit)}`}</span>
                        {a ? <span className="text-muted-foreground">(распределено {num(Number(a), 3)})</span> : null}
                      </p>
                    )
                  })}
                </div>
              )
            }}
          />
          {visible.length > 1 || anyAllocated ? (
            <Legend
              verticalAlign="top"
              height={24}
              iconSize={10}
              wrapperStyle={{ fontSize: 11 }}
              payload={[
                ...visible.map((s, i) => ({ value: s.label, type: "square" as const, color: color(s.key, i), id: s.key })),
                ...(anyAllocated ? [{ value: "распределено между показаниями", type: "square" as const, color: "#bbb", id: "alloc" }] : []),
              ]}
            />
          ) : null}
          {visible.map((s, i) =>
            s.kind === "instant" ? (
              [
                <Area key={`${s.key}b`} yAxisId={s.unit} dataKey={`${s.key}__band`} stroke="none" fill={color(s.key, i)} fillOpacity={0.15} isAnimationActive={false} connectNulls={false} />,
                <Line key={s.key} yAxisId={s.unit} dataKey={s.key} stroke={color(s.key, i)} strokeWidth={1.75} dot={false} isAnimationActive={false} connectNulls={false} />,
              ]
            ) : (
              [
                <Bar key={`${s.key}m`} yAxisId={s.unit} dataKey={`${s.key}__m`} stackId={s.key} fill={color(s.key, i)} radius={[0, 0, 0, 0]} isAnimationActive={false} maxBarSize={36} />,
                <Bar key={`${s.key}a`} yAxisId={s.unit} dataKey={`${s.key}__a`} stackId={s.key} fill={`url(#hatch-${s.key.replace(/[^a-z0-9]/gi, "")})`} radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={36} />,
              ]
            ),
          )}
          {showBrush ?? rows.length > 45 ? <Brush dataKey="t" height={22} travellerWidth={8} tickFormatter={(t) => formatTick(t, resolution, tz)} stroke="oklch(0.6 0.05 120)" /> : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Тепловая карта потребления: дни недели × часы (локальное время объекта). */
export function Heatmap({ cells, unit }: { cells: Array<{ weekday: number; hour: number; avg: number | null; samples: number }>; unit: string }) {
  const max = Math.max(0, ...cells.map((c) => c.avg ?? 0))
  const days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-[2px] text-[10px]" aria-label="Тепловая карта потребления по часам">
        <thead>
          <tr>
            <th className="w-8" />
            {Array.from({ length: 24 }, (_, h) => (
              <th key={h} className="font-normal text-muted-foreground">
                {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d, i) => (
            <tr key={d}>
              <th className="pr-1 text-right font-medium text-muted-foreground">{d}</th>
              {Array.from({ length: 24 }, (_, h) => {
                const c = cells.find((x) => x.weekday === i + 1 && x.hour === h)
                const v = c?.avg ?? null
                const k = v == null || max === 0 ? 0 : v / max
                return (
                  <td
                    key={h}
                    title={v == null ? `${d} ${h}:00 — нет данных` : `${d} ${String(h).padStart(2, "0")}:00 — в среднем ${num(v, 3)} ${unitLabel(unit)} (${c?.samples} ч)`}
                    className="h-6 rounded-[3px]"
                    style={{ background: v == null ? "repeating-linear-gradient(135deg, transparent 0 3px, oklch(0.85 0.01 90) 3px 4px)" : `oklch(${0.96 - k * 0.42} ${0.03 + k * 0.15} ${118 - k * 70})` }}
                  />
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>0</span>
        <span className="h-2 w-32 rounded" style={{ background: "linear-gradient(90deg, oklch(0.96 0.03 118), oklch(0.54 0.18 48))" }} />
        <span>
          {num(max, 3)} {unitLabel(unit)}/ч
        </span>
        <span className="ml-3 inline-block h-2 w-4 rounded ems-hatch" /> нет данных
      </div>
    </div>
  )
}

/** Мини-график для карточек (без осей). */
export function Sparkline({ points, color = "oklch(0.68 0.16 118)", height = 36 }: { points: Point[]; color?: string; height?: number }) {
  const data = points.map((p) => ({ t: p.t, v: p.v }))
  if (!data.some((d) => d.v != null)) return <div style={{ height }} />
  return (
    <div style={{ height }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Bar dataKey="v" fill={color} isAnimationActive={false} radius={[2, 2, 0, 0]} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
