"use client"

import { useState } from "react"
import { Download } from "lucide-react"
import { qs, useApi } from "@/lib/client/api"
import { Checkbox, ErrorBox, Panel, Segmented, Skeleton } from "@/components/ui"
import { ChartFrame, ConsumptionChart, Heatmap, type Series } from "@/components/ems/charts"
import { PeriodPicker, usePeriod } from "@/components/ems/period"
import { NeedSite, PageHeader, useApp } from "@/components/ems/shell"

export default function AnalyticsPage() {
  return <NeedSite>{(siteId, site) => <Analytics siteId={siteId} tz={site.timezone} />}</NeedSite>
}

const RES = [
  { id: "electricity", label: "Электричество" },
  { id: "cold_water", label: "ХВС" },
  { id: "hot_water", label: "ГВС" },
  { id: "heat", label: "Тепло" },
  { id: "gas", label: "Газ" },
]

function Analytics({ siteId, tz }: { siteId: string; tz: string }) {
  const { industrial, hasFeature } = useApp()
  const p = usePeriod("month")
  const [metric, setMetric] = useState<"consumption" | "cost" | "power">("consumption")
  const [res, setRes] = useState<string[]>(["electricity"])
  const [nodeId, setNodeId] = useState("")
  const [heatRes, setHeatRes] = useState("electricity")
  const nodes = useApi<{ nodes: Array<{ node_id: string; name: string }> }>(industrial ? `/api/v1/sites/${siteId}` : null)
  const resolution = metric === "cost" && p.period.resolution === "hour" ? "day" : p.period.resolution
  const params = { siteId, nodeId: nodeId || null, from: p.period.from, to: p.period.to, resolution, metric: metric === "consumption" ? null : metric, resources: metric === "power" ? null : res.join(",") }
  const q = useApi<{ series: Series[]; notes: string[]; resolution: string }>(res.length || metric === "power" ? `/api/v1/series${qs(params)}` : null)
  const heat = useApi<{ cells: Array<{ weekday: number; hour: number; avg: number | null; samples: number }>; unit: string; allocatedShare: number }>(hasFeature("analytics_advanced") ? `/api/v1/series/heatmap${qs({ siteId, resource: heatRes, nodeId: nodeId || null })}` : null)
  const units = new Set((q.data?.series ?? []).map((s) => s.unit))
  return (
    <div className="space-y-4">
      <PageHeader title="Потребление" subtitle="Масштабирование, выбор периода и серий, экспорт CSV и PNG. Длинные периоды показываются по суткам и месяцам — без миллионов сырых точек." />
      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented value={metric} onChange={setMetric} options={[{ value: "consumption", label: "Расход" }, { value: "cost", label: "Стоимость, ₽" }, { value: "power", label: "Мощность, кВт" }]} />
          {metric !== "power" ? (
            <div className="flex flex-wrap gap-3">
              {RES.map((r) => (
                <Checkbox key={r.id} checked={res.includes(r.id)} onChange={(v) => setRes(v ? [...res, r.id] : res.filter((x) => x !== r.id))} label={r.label} />
              ))}
            </div>
          ) : null}
          {nodes.data?.nodes.length ? (
            <select aria-label="Участок" className="ems-input h-8 w-auto text-[13px]" value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
              <option value="">Вся площадка</option>
              {nodes.data.nodes.map((n) => (
                <option key={n.node_id} value={n.node_id}>
                  {n.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        {units.size > 2 ? <p className="mt-2 text-xs text-amber-700">Выбрано больше двух единиц измерения — показаны первые две (у каждой своя ось).</p> : null}
        <div className="mt-3">
          <ChartFrame
            name="scada-ems-анализ"
            height={340}
            toolbar={
              <>
                <PeriodPicker state={p} />
                <a className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-muted" href={`/api/v1/export${qs(params)}`}>
                  <Download className="size-4" /> CSV
                </a>
              </>
            }
          >
            {() => (q.loading && !q.data ? <Skeleton className="h-full" /> : q.error ? <ErrorBox error={q.error} onRetry={q.reload} /> : <ConsumptionChart series={q.data?.series ?? []} tz={tz} height={340} />)}
          </ChartFrame>
          {q.data?.notes?.length ? <p className="mt-2 text-xs text-muted-foreground">{q.data.notes.join(". ")}</p> : null}
          <p className="mt-2 text-xs text-muted-foreground">Штриховка — расход, распределённый пропорционально времени между редкими показаниями (итог точный, раскладка по часам — оценка). Пустые места — нет данных: пропуски не заполняются.</p>
        </div>
      </Panel>
      <Panel title="Тепловая карта" subtitle="Средний часовой расход по дням недели, 4 недели" actions={<Segmented value={heatRes} onChange={setHeatRes} options={RES.slice(0, 3).map((r) => ({ value: r.id, label: r.label }))} />}>
        {!hasFeature("analytics_advanced") ? (
          <p className="text-[13px] text-muted-foreground">Доступно в тарифе с расширенной аналитикой.</p>
        ) : !heat.data ? (
          <Skeleton className="h-48" />
        ) : (
          <Heatmap cells={heat.data.cells} unit={heat.data.unit} />
        )}
      </Panel>
    </div>
  )
}
