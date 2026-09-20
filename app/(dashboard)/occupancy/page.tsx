"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { BarChart3, Boxes, ChevronRight } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Button } from "@/components/ui/button"
import { getWarehouseOccupancy, type WmsWarehouseOccupancyResponse } from "@/lib/wms-api"

function pct(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0
}

function fillColor(p: number) {
  if (p >= 85) return "oklch(0.62 0.19 25)"
  if (p >= 60) return "oklch(0.72 0.15 70)"
  if (p >= 25) return "oklch(0.83 0.18 115)"
  return "oklch(0.72 0.08 145)"
}

function downloadTextFile(filename: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function toCsvValue(value: unknown) {
  const s = value == null ? "" : String(value)
  if (/[",\r\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`
  return s
}

function toCsv(rows: Array<Record<string, unknown>>) {
  const headers = Array.from(
    rows.reduce((acc, row) => {
      for (const k of Object.keys(row)) acc.add(k)
      return acc
    }, new Set<string>())
  )
  const lines = [headers.map(toCsvValue).join(",")]
  for (const row of rows) {
    lines.push(headers.map((h) => toCsvValue((row as Record<string, unknown>)[h])).join(","))
  }
  return lines.join("\r\n")
}

function OccupancyPageInner() {
  const router = useRouter()
  const search = useSearchParams()
  const [data, setData] = useState<WmsWarehouseOccupancyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const zoneCodeFilter = (search.get("zoneCode") || "").trim()

  useEffect(() => {
    let ignore = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const result = await getWarehouseOccupancy()
        if (!ignore) setData(result)
      } catch (e) {
        if (!ignore) setError(e instanceof Error ? e.message : "Не удалось загрузить заполненность")
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    load()
    return () => {
      ignore = true
    }
  }, [])

  const totals = data?.totals
  const totalCells = totals?.locationCount || 0
  const occupied = totals?.nonEmptyCount || 0
  const free = totals?.emptyCount || 0
  const overall = pct(occupied, totalCells)
  const zones = data?.zones || []
  const filteredZones = zoneCodeFilter ? zones.filter((z) => z.zoneCode === zoneCodeFilter) : zones

  const gaugeData = useMemo(
    () => [{ name: "fill", value: overall, fill: fillColor(overall) }],
    [overall]
  )

  const pieData = useMemo(
    () => [
      { name: "Занято", value: occupied, fill: "oklch(0.83 0.18 115)" },
      { name: "Свободно", value: free, fill: "oklch(0.90 0.02 90)" },
    ],
    [occupied, free]
  )

  const barData = useMemo(
    () =>
      [...filteredZones]
        .map((z) => {
          const p = pct(z.nonEmptyCount, z.locationCount)
          return {
            zone: z.zoneCode,
            warehouse: z.warehouseCode,
            pct: p,
            occupied: z.nonEmptyCount,
            free: Math.max(0, z.locationCount - z.nonEmptyCount),
            total: z.locationCount,
            qty: z.totalAvailableQty,
            fill: fillColor(p),
          }
        })
        .sort((a, b) => b.pct - a.pct || b.total - a.total),
    [filteredZones]
  )

  function exportReport() {
    if (!data) return
    const now = new Date()
    const stamp = now.toISOString().slice(0, 19).replaceAll(":", "-")
    const siteCode = data.siteCode || "DEFAULT"
    const rows = [
      {
        kind: "totals",
        siteCode,
        warehouseCode: "",
        zoneCode: "",
        locationCount: data.totals.locationCount,
        nonEmptyCount: data.totals.nonEmptyCount,
        emptyCount: data.totals.emptyCount,
        totalAvailableQty: data.totals.totalAvailableQty,
        declaredCapacityQtySum: data.totals.declaredCapacityQtySum,
        fillRatioDeclared: data.totals.fillRatioDeclared ?? "",
      },
      ...(data.zones || []).map((z) => ({
        kind: "zone",
        siteCode,
        warehouseCode: z.warehouseCode,
        zoneCode: z.zoneCode,
        locationCount: z.locationCount,
        nonEmptyCount: z.nonEmptyCount,
        emptyCount: z.emptyCount,
        totalAvailableQty: z.totalAvailableQty,
        declaredCapacityQtySum: z.declaredCapacityQtySum,
        fillRatioDeclared: z.fillRatioDeclared ?? "",
      })),
    ]
    downloadTextFile(`wms-occupancy-${siteCode}-${stamp}.csv`, toCsv(rows), "text/csv;charset=utf-8")
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Заполненность склада</h1>
          <p className="text-sm text-muted-foreground">Реальная сводка по ячейкам и зонам WMS</p>
        </div>
        <div className="flex items-center gap-2">
          {zoneCodeFilter ? (
            <Button
              variant="secondary"
              className="rounded-xl"
              onClick={() => router.push("/occupancy")}
              disabled={loading}
            >
              Зона: <span className="ml-1 font-mono">{zoneCodeFilter}</span> · сбросить
            </Button>
          ) : null}
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={exportReport}
            disabled={!data || loading}
          >
            <BarChart3 className="mr-2 h-4 w-4" />
            Отчёт
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mb-6 grid grid-cols-4 gap-4">
        <div className="rounded-2xl bg-primary p-5 text-primary-foreground">
          <div className="text-sm opacity-80">Общая заполненность</div>
          <div className="text-3xl font-bold">{overall}%</div>
          <div className="mt-2 text-sm opacity-80">
            {occupied} из {totalCells} ячеек
          </div>
        </div>
        <div className="rounded-2xl bg-card p-5 shadow-sm">
          <div className="text-sm text-muted-foreground">Занято</div>
          <div className="text-2xl font-bold">{occupied}</div>
        </div>
        <div className="rounded-2xl bg-card p-5 shadow-sm">
          <div className="text-sm text-muted-foreground">Свободно</div>
          <div className="text-2xl font-bold text-success">{free}</div>
        </div>
        <div className="rounded-2xl bg-card p-5 shadow-sm">
          <div className="text-sm text-muted-foreground">Остаток, шт.</div>
          <div className="text-2xl font-bold text-chart-3">{totals?.totalAvailableQty || 0}</div>
        </div>
      </div>

      {/* SCADA charts */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl bg-card p-5 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-foreground">Индикатор загрузки</div>
          <div className="relative h-[220px]">
            {!loading && totalCells > 0 ? (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <RadialBarChart
                    cx="50%"
                    cy="55%"
                    innerRadius="68%"
                    outerRadius="100%"
                    startAngle={210}
                    endAngle={-30}
                    data={gaugeData}
                  >
                    <RadialBar dataKey="value" background={{ fill: "oklch(0.92 0.02 90)" }} cornerRadius={8} />
                  </RadialBarChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-4">
                  <div className="text-4xl font-bold tabular-nums" style={{ color: fillColor(overall) }}>
                    {overall}%
                  </div>
                  <div className="text-xs text-muted-foreground">ячеек занято</div>
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {loading ? "Загрузка…" : "Нет данных"}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-card p-5 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-foreground">Занято / свободно</div>
          <div className="h-[220px]">
            {!loading && totalCells > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={58}
                    outerRadius={88}
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [`${value} яч.`, name]}
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid oklch(0.88 0.02 90)",
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {loading ? "Загрузка…" : "Нет данных"}
              </div>
            )}
          </div>
          <div className="mt-1 flex justify-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
              Занято {occupied}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-secondary" />
              Свободно {free}
            </span>
          </div>
        </div>

        <div className="rounded-2xl bg-card p-5 shadow-sm lg:col-span-1">
          <div className="mb-2 text-sm font-semibold text-foreground">Зоны по загрузке</div>
          <div className="h-[220px]">
            {!loading && barData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={barData.slice(0, 12)}
                  layout="vertical"
                  margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="oklch(0.90 0.02 90)" />
                  <XAxis
                    type="number"
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "oklch(0.5 0.02 145)", fontSize: 11 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="zone"
                    width={36}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "oklch(0.45 0.02 145)", fontSize: 12, fontWeight: 600 }}
                  />
                  <Tooltip
                    formatter={(value: number, _n, item) => {
                      const row = item?.payload as { occupied?: number; total?: number; qty?: number }
                      return [
                        `${value}% · ${row?.occupied ?? 0}/${row?.total ?? 0} яч. · ост. ${row?.qty ?? 0}`,
                        "Загрузка",
                      ]
                    }}
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid oklch(0.88 0.02 90)",
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="pct" radius={[0, 6, 6, 0]} maxBarSize={18}>
                    {barData.slice(0, 12).map((entry) => (
                      <Cell key={entry.zone} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {loading ? "Загрузка…" : "Нет зон"}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-2xl bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">Ячейки по зонам: занято / свободно</h3>
          <span className="text-xs text-muted-foreground">клик по столбцу — открыть ячейки</span>
        </div>
        <div className="h-[320px]">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Загрузка…</div>
          ) : barData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Зоны не найдены</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={barData}
                margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                onClick={(state) => {
                  const z = (state as { activePayload?: Array<{ payload?: { zone?: string; warehouse?: string } }> })
                    ?.activePayload?.[0]?.payload
                  if (!z?.zone || !z?.warehouse) return
                  router.push(
                    `/cells?warehouseCode=${encodeURIComponent(z.warehouse)}&zoneCode=${encodeURIComponent(z.zone)}`
                  )
                }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.90 0.02 90)" />
                <XAxis
                  dataKey="zone"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "oklch(0.45 0.02 145)", fontSize: 12, fontWeight: 600 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "oklch(0.5 0.02 145)", fontSize: 11 }}
                  allowDecimals={false}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [value, name === "occupied" ? "Занято" : "Свободно"]}
                  labelFormatter={(label) => `Зона ${label}`}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid oklch(0.88 0.02 90)",
                    fontSize: 12,
                  }}
                />
                <Legend
                  formatter={(value) => (value === "occupied" ? "Занято" : "Свободно")}
                  wrapperStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="occupied" stackId="cells" name="occupied" fill="oklch(0.83 0.18 115)" radius={[0, 0, 0, 0]} maxBarSize={42} cursor="pointer" />
                <Bar dataKey="free" stackId="cells" name="free" fill="oklch(0.90 0.02 90)" radius={[6, 6, 0, 0]} maxBarSize={42} cursor="pointer" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="rounded-2xl bg-card shadow-sm">
        <div className="border-b border-border p-5">
          <h3 className="font-semibold">Карточки зон</h3>
          <p className="text-xs text-muted-foreground">Нажмите карточку, чтобы открыть ячейки зоны</p>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3 xl:grid-cols-4">
          {loading ? (
            <div className="col-span-full p-6 text-sm text-muted-foreground">Загрузка...</div>
          ) : filteredZones.length === 0 ? (
            <div className="col-span-full p-6 text-sm text-muted-foreground">Зоны не найдены</div>
          ) : (
            filteredZones.map((zone) => {
              const occupancy = pct(zone.nonEmptyCount, zone.locationCount)
              const freeZ = Math.max(0, zone.locationCount - zone.nonEmptyCount)
              const mini = [{ name: "fill", value: occupancy, fill: fillColor(occupancy) }]
              return (
                <div
                  key={`${zone.warehouseCode}-${zone.zoneCode}`}
                  className={
                    "cursor-pointer rounded-xl border border-border/60 bg-background/60 p-3 transition hover:border-primary/40 hover:bg-secondary/40 " +
                    (zoneCodeFilter && zone.zoneCode === zoneCodeFilter ? "border-primary/50 bg-secondary/30" : "")
                  }
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    router.push(
                      `/cells?warehouseCode=${encodeURIComponent(zone.warehouseCode)}&zoneCode=${encodeURIComponent(zone.zoneCode)}`
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return
                    router.push(
                      `/cells?warehouseCode=${encodeURIComponent(zone.warehouseCode)}&zoneCode=${encodeURIComponent(zone.zoneCode)}`
                    )
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-lg font-bold tracking-tight">{zone.zoneCode}</div>
                      <div className="text-[11px] text-muted-foreground">{zone.warehouseCode}</div>
                    </div>
                    <div className="relative h-14 w-14 shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadialBarChart
                          cx="50%"
                          cy="50%"
                          innerRadius="62%"
                          outerRadius="100%"
                          startAngle={90}
                          endAngle={-270}
                          data={mini}
                        >
                          <RadialBar dataKey="value" background={{ fill: "oklch(0.92 0.02 90)" }} cornerRadius={6} />
                        </RadialBarChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] font-bold tabular-nums">
                        {occupancy}%
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
                    <div className="rounded-md bg-secondary/60 px-2 py-1">
                      <div className="text-muted-foreground">Занято</div>
                      <div className="font-semibold tabular-nums">{zone.nonEmptyCount}</div>
                    </div>
                    <div className="rounded-md bg-secondary/60 px-2 py-1">
                      <div className="text-muted-foreground">Свободно</div>
                      <div className="font-semibold tabular-nums">{freeZ}</div>
                    </div>
                    <div className="col-span-2 rounded-md bg-secondary/60 px-2 py-1">
                      <div className="text-muted-foreground">Остаток, шт.</div>
                      <div className="font-semibold tabular-nums">{zone.totalAvailableQty}</div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

export default function OccupancyPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-muted-foreground">Загрузка заполненности складов…</div>
      }
    >
      <OccupancyPageInner />
    </Suspense>
  )
}
