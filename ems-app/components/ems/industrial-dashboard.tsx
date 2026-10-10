"use client"

import { useState } from "react"
import Link from "next/link"
import { Activity, AlertTriangle, Droplet, Factory, Gauge, Package, TrendingUp, Wallet, Zap } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { qs, useApi } from "@/lib/client/api"
import { dateRu, monthName, num, pct, qty, relative, rub } from "@/lib/client/format"
import { Delta, Empty, ErrorBox, Panel, Segmented, Skeleton, Stat } from "@/components/ui"
import { ChartFrame, ConsumptionChart, type Series } from "@/components/ems/charts"
import { PeriodPicker, usePeriod } from "@/components/ems/period"
import { PageHeader, useApp } from "@/components/ems/shell"
import { EventList } from "@/components/ems/events"

type IndData = {
  empty?: boolean
  site: { siteId: string; name: string; timezone: string; shifts: Array<{ name: string }> }
  period: { month: string; today: string }
  power: null | { kw: number | null; freshChannels: number; channels: number; at: string | null }
  peak: { todayKw: number | null; todayAt: string | null; monthKw: number | null; monthAt: string | null }
  electricity: { shiftName: string | null; shiftKwh: number; todayKwh: number; monthKwh: number; deviationPct: number | null }
  water: { coldTodayM3: number; coldMonthM3: number; hotTodayM3: number; hotMonthM3: number }
  costs: { forecast: number | null; actualToDate: number; previous: number | null; changePct: number | null; incomplete: boolean }
  specific: null | { unit: string; produced: number; kwhPer1000: number | null; energyKwh: number }
  shifts: Array<Record<string, number | string>>
  shiftNames: string[]
  breakdown: Array<{ nodeId: string; name: string; kind: string; electricityKwh: number; waterM3: number; meters: number }>
  meters: Array<{ meterId: string; name: string; state: string; lastAt: string | null }>
  events: Array<{ event_id: string; severity: string; title: string; message: string; status: string; opened_at: string; category: string; occurrences: number }>
  hasData: boolean
}

type SiteDetail = { nodes: Array<{ node_id: string; parent_id: string | null; name: string; kind: string }> }

export function IndustrialDashboard() {
  const { siteId } = useApp()
  const [nodeId, setNodeId] = useState<string>("")
  const detail = useApi<SiteDetail>(siteId ? `/api/v1/sites/${siteId}` : null)
  const q = useApi<IndData>(siteId ? `/api/v1/dashboard/industrial${qs({ siteId, nodeId })}` : null)
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />
  const d = q.data
  const nodes = detail.data?.nodes ?? []
  const path = buildPaths(nodes)

  return (
    <div className="space-y-4">
      <PageHeader
        title={d?.site.name ?? "Площадка"}
        subtitle={d ? `${monthName(d.period.month)} · обновлено ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : " "}
        actions={
          nodes.length ? (
            <select aria-label="Участок" value={nodeId} onChange={(e) => setNodeId(e.target.value)} className="ems-input h-8 w-auto max-w-[70vw] text-[13px]">
              <option value="">Вся площадка</option>
              {path.map((n) => (
                <option key={n.node_id} value={n.node_id}>
                  {" ".repeat(n.depth)}
                  {n.name}
                </option>
              ))}
            </select>
          ) : null
        }
      />
      {!d || q.loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      ) : !d.hasData ? (
        <Panel>
          <Empty icon={Factory} title="Нет приборов на площадке" text="Подключите шлюз SCADA EMS Gateway и приборы учёта — здесь появится мощность, расход по сменам и удельное потребление." action={<Link href="/onboarding?mode=industrial" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Настроить площадку</Link>} />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat icon={Activity} label="Активная мощность" value={d.power?.kw != null ? qty(d.power.kw, "kW") : "—"} sub={d.power ? (d.power.freshChannels < d.power.channels ? `${d.power.freshChannels} из ${d.power.channels} каналов на связи` : `обновлено ${relative(d.power.at)}`) : "нет каналов мощности"} tone={d.power && d.power.freshChannels < d.power.channels ? "warning" : "neutral"} />
            <Stat icon={TrendingUp} label="Пик за сутки" value={qty(d.peak.todayKw, "kW")} sub={d.peak.monthKw != null ? `за месяц ${qty(d.peak.monthKw, "kW")} · ср. за час` : "по часовым данным"} />
            <Stat icon={Zap} label={d.electricity.shiftName ? `Смена «${d.electricity.shiftName}»` : "Смена"} value={qty(d.electricity.shiftKwh, "kWh", 0)} sub={`сутки ${qty(d.electricity.todayKwh, "kWh", 0)}`} />
            <Stat icon={Gauge} label="Электроэнергия за месяц" value={qty(d.electricity.monthKwh, "kWh", 0)} sub={<span>отклонение суток <Delta value={d.electricity.deviationPct} /></span>} tone={d.electricity.deviationPct != null && d.electricity.deviationPct > 20 ? "warning" : "neutral"} />
            <Stat icon={Droplet} label="Вода за месяц" value={qty(d.water.coldMonthM3 + d.water.hotMonthM3, "m3", 1)} sub={`ХВС ${num(d.water.coldMonthM3, 1)} · ГВС ${num(d.water.hotMonthM3, 1)} · сегодня ${num(d.water.coldTodayM3 + d.water.hotTodayM3, 1)} м³`} />
            <Stat icon={Wallet} label="Стоимость ресурсов" value={rub(d.costs.forecast)} sub={<span>прогноз месяца · <Delta value={d.costs.changePct} /></span>} />
          </div>

          <div className="grid gap-3 xl:grid-cols-3">
            <IndustrialChart siteId={d.site.siteId} nodeId={nodeId} tz={d.site.timezone} />
            <Panel title="Удельное потребление" subtitle="По данным о выпуске из MES/APS/WMS (API)">
              {d.specific ? (
                <div className="space-y-2">
                  <p className="ems-num text-3xl font-semibold">{d.specific.kwhPer1000 != null ? num(d.specific.kwhPer1000, 1) : "—"}</p>
                  <p className="text-[13px] text-muted-foreground">кВт·ч на 1000 {d.specific.unit}</p>
                  <p className="text-xs text-muted-foreground">
                    Выпуск с начала месяца: {num(d.specific.produced, 0)} {d.specific.unit}, электроэнергия за те же интервалы: {qty(d.specific.energyKwh, "kWh", 0)}.
                  </p>
                </div>
              ) : (
                <Empty icon={Package} title="Нет данных о выпуске" text="Передайте объём выпуска по линиям через API (раздел «Интеграции»), чтобы сравнивать эффективность линий." />
              )}
            </Panel>
          </div>

          <div className="grid gap-3 xl:grid-cols-3">
            <Panel title="Сравнение смен" subtitle="Электроэнергия, кВт·ч, последние 7 суток" className="xl:col-span-2">
              {d.shifts.length ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.shifts} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.88 0.02 90)" />
                      <XAxis dataKey="day" tickFormatter={(t) => dateRu(String(t), { day: "2-digit", month: "2-digit" })} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => num(v, 0)} />
                      <Tooltip formatter={(v: number) => qty(v, "kWh", 0)} labelFormatter={(t) => dateRu(String(t), { weekday: "short", day: "numeric", month: "long" })} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {d.shiftNames.map((n, i) => (
                        <Bar key={n} dataKey={n} fill={["oklch(0.68 0.16 118)", "oklch(0.55 0.12 250)", "oklch(0.7 0.15 55)", "oklch(0.6 0.15 320)"][i % 4]} isAnimationActive={false} maxBarSize={28} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-[13px] text-muted-foreground">Нет почасовых данных за неделю.</p>
              )}
            </Panel>
            <Panel title="События и отклонения" actions={<Link href="/monitoring/events" className="text-xs text-muted-foreground hover:text-foreground">Журнал →</Link>} bodyClassName="p-0">
              <EventList events={d.events.slice(0, 6)} compact />
            </Panel>
          </div>

          <div className="grid gap-3 xl:grid-cols-3">
            <Panel title="По участкам" subtitle="С начала месяца" className="xl:col-span-2" bodyClassName="p-0">
              {d.breakdown.length ? (
                <div className="overflow-x-auto">
                  <table className="ems-table">
                    <thead>
                      <tr>
                        <th>Участок</th>
                        <th className="text-right">Электроэнергия</th>
                        <th className="text-right">Доля</th>
                        <th className="text-right">Вода</th>
                        <th className="text-right">Приборы</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.breakdown.map((b) => {
                        const total = d.breakdown.reduce((s, x) => s + x.electricityKwh, 0)
                        return (
                          <tr key={b.nodeId} className="cursor-pointer hover:bg-muted/40" onClick={() => setNodeId(b.nodeId)}>
                            <td className="font-medium">{b.name}</td>
                            <td className="ems-num text-right">{qty(b.electricityKwh, "kWh", 0)}</td>
                            <td className="ems-num text-right text-muted-foreground">{total > 0 ? pct((b.electricityKwh / total) * 100).replace("+", "") : "—"}</td>
                            <td className="ems-num text-right">{qty(b.waterM3, "m3", 1)}</td>
                            <td className="ems-num text-right">{b.meters}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="p-4 text-[13px] text-muted-foreground">Структура площадки не задана. Добавьте цеха и линии в разделе «Объекты».</p>
              )}
            </Panel>
            <Panel title="Состояние приборов" actions={<Link href="/monitoring/health" className="text-xs text-muted-foreground hover:text-foreground">Подробно →</Link>} bodyClassName="p-0">
              <ul className="divide-y divide-border/60">
                {d.meters.slice(0, 8).map((m) => (
                  <li key={m.meterId} className="flex items-center gap-2 px-4 py-2 text-[13px]">
                    <span className={`size-2 shrink-0 rounded-full ${m.state === "ok" ? "bg-emerald-500" : m.state === "attention" ? "bg-amber-500" : "bg-destructive"}`} />
                    <Link href={`/meters/${m.meterId}`} className="min-w-0 flex-1 truncate hover:underline">
                      {m.name}
                    </Link>
                    <span className="text-xs text-muted-foreground">{relative(m.lastAt)}</span>
                  </li>
                ))}
              </ul>
              {d.meters.some((m) => m.state !== "ok") ? (
                <p className="flex items-center gap-1.5 border-t border-border/60 px-4 py-2 text-xs text-amber-700">
                  <AlertTriangle className="size-3.5" /> Есть приборы без свежих данных
                </p>
              ) : null}
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}

function buildPaths(nodes: SiteDetail["nodes"]) {
  const out: Array<SiteDetail["nodes"][number] & { depth: number }> = []
  const walk = (parent: string | null, depth: number) => {
    for (const n of nodes.filter((x) => x.parent_id === parent)) {
      out.push({ ...n, depth })
      walk(n.node_id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

function IndustrialChart({ siteId, nodeId, tz }: { siteId: string; nodeId: string; tz: string }) {
  const p = usePeriod("day")
  const [metric, setMetric] = useState<"energy" | "power" | "water">("energy")
  const params = metric === "energy" ? { resources: "electricity" } : metric === "water" ? { resources: "cold_water,hot_water" } : { metric: "power" }
  const q = useApi<{ series: Series[]; notes: string[] }>(`/api/v1/series${qs({ siteId, nodeId, from: p.period.from, to: p.period.to, resolution: p.period.resolution, ...params })}`)
  return (
    <Panel title="Нагрузка" subtitle={p.period.label} className="xl:col-span-2">
      <ChartFrame
        name="scada-ems-нагрузка"
        toolbar={
          <>
            <PeriodPicker state={p} />
            <Segmented ariaLabel="Показатель" value={metric} onChange={setMetric} options={[{ value: "energy", label: "кВт·ч" }, { value: "power", label: "кВт" }, { value: "water", label: "м³" }]} />
          </>
        }
      >
        {() => (q.loading && !q.data ? <Skeleton className="h-full w-full" /> : <ConsumptionChart series={q.data?.series ?? []} tz={tz} />)}
      </ChartFrame>
      {q.data?.notes?.length ? <p className="mt-2 text-xs text-muted-foreground">{q.data.notes.join(". ")}</p> : null}
    </Panel>
  )
}
