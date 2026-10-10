"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Droplet, Gauge, Lightbulb, PencilLine, Thermometer, Wallet, Wifi, Zap } from "lucide-react"
import { qs, useApi } from "@/lib/client/api"
import { BASIS_LABEL, dateRu, monthName, num, qty, relative, rub, SERVICE_LABEL } from "@/lib/client/format"
import { cn } from "@/lib/client/cn"
import { Delta, Empty, ErrorBox, Notice, Panel, Segmented, Skeleton, Stat } from "@/components/ui"
import { ChartFrame, ConsumptionChart, type Series } from "@/components/ems/charts"
import { PeriodPicker, usePeriod } from "@/components/ems/period"
import { PageHeader, useApp } from "@/components/ems/shell"
import { ObligationStatusBadge } from "@/components/ems/obligation-status"
import { EventList } from "@/components/ems/events"

type HomeData = {
  empty?: boolean
  site: { siteId: string; name: string; kind: string; timezone: string }
  period: { month: string; monthEnd: string; today: string }
  totals: { actualToDate: number; forecast: number | null; previous: number | null; changePct: number | null; incomplete: boolean }
  resources: Array<{ resource: string; unit: string; monthQty: number; coveredDays: number; avgDaily: number | null; changePct: number | null; prevSamePeriod: number | null; readings: Array<{ name: string; value: number | null; at: string | null; zone: string | null }>; cost: null | { toDate: number | null; forecast: number | null; forecastQty: number | null; confidence: string; charged: number | null; hasTariff: boolean; warnings: string[] } }>
  otherServices: Array<{ accountId: string; service: string; title: string; providerName: string | null; amount: number | null; basis: string; nextObligation: null | { dueDate: string; status: string; daysLeft: number } }>
  obligations: Array<{ obligationId: string; title: string; service: string; amount: number | null; dueDate: string; status: string; daysLeft: number; amountMode: string }>
  meters: Array<{ meterId: string; name: string; resource: string; connection: string; lastAt: string | null; state: string }>
  events: Array<{ event_id: string; severity: string; title: string; message: string; status: string; opened_at: string; category: string; occurrences: number }>
  recommendations: Array<{ code: string; severity: string; title: string; text: string }>
}

const ICON: Record<string, typeof Zap> = { electricity: Zap, cold_water: Droplet, hot_water: Thermometer }
const LABEL: Record<string, string> = { electricity: "Электричество", cold_water: "Холодная вода", hot_water: "Горячая вода" }

export function HomeDashboard() {
  const { siteId, can } = useApp()
  const q = useApi<HomeData>(siteId ? `/api/v1/dashboard/home${qs({ siteId })}` : null)
  const d = q.data
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />
  if (!d || q.loading) return <HomeSkeleton />
  if (d.empty) return null

  const nearest = d.obligations[0]
  const problems = d.meters.filter((m) => m.state === "stale" || m.state === "attention" || m.state === "no_data")
  const openAlerts = d.events.filter((e) => e.status === "open" && e.category !== "data_quality")

  return (
    <div className="space-y-4">
      <PageHeader
        title={d.site.name}
        subtitle={`${monthName(d.period.month)} · данные по ${dateRu(d.period.today, { day: "numeric", month: "long" })}`}
        actions={
          can("readings.write") ? (
            <Link href="/readings" className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground sm:hidden">
              <PencilLine className="size-4" /> Внести показания
            </Link>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={Wallet}
          label="Прогноз за месяц"
          value={d.totals.forecast == null ? "—" : rub(d.totals.forecast)}
          sub={
            <span className="flex flex-wrap items-center gap-1">
              <Delta value={d.totals.changePct} /> к {monthName(addMonth(d.period.month, -1)).toLowerCase()}
              {d.totals.incomplete ? <span className="text-amber-700">· не по всем услугам есть тариф</span> : null}
            </span>
          }
        />
        <Stat icon={CheckCircle2} label="Начислено по показаниям" value={rub(d.totals.actualToDate)} sub={`с 1 по ${Number(d.period.today.slice(8))} число`} />
        <Stat
          icon={CalendarClock}
          label="Ближайший платёж"
          tone={nearest?.status === "overdue" ? "danger" : nearest?.status === "due_soon" ? "warning" : "neutral"}
          value={nearest ? (nearest.amount == null ? nearest.title : rub(nearest.amount)) : "Нет"}
          sub={nearest ? <span>{nearest.title} · {dateRu(nearest.dueDate, { day: "numeric", month: "long" })} · <ObligationStatusBadge status={nearest.status} daysLeft={nearest.daysLeft} /></span> : <Link href="/finance/payments" className="underline">Добавить платёж</Link>}
        />
        <Stat
          icon={problems.length ? AlertTriangle : Gauge}
          label="Счётчики"
          tone={problems.length ? "warning" : "neutral"}
          value={d.meters.length ? `${d.meters.length - problems.length} из ${d.meters.length} в порядке` : "Нет приборов"}
          sub={problems.length ? problems.map((m) => m.name).slice(0, 2).join(", ") : d.meters.length ? "без замечаний" : <Link href="/meters/new" className="underline">Добавить счётчик</Link>}
        />
      </div>

      {openAlerts.length ? (
        <Notice tone="warning">
          <span className="font-medium">{openAlerts[0].title}.</span> {openAlerts[0].message}{" "}
          <Link href="/monitoring/events" className="underline">
            Все события ({openAlerts.length})
          </Link>
        </Notice>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {d.resources.length === 0 ? (
          <Panel className="md:col-span-2 xl:col-span-3">
            <Empty icon={Gauge} title="Счётчики ещё не добавлены" text="Добавьте счётчик электричества или воды и вносите показания раз в месяц — SCADA EMS посчитает расход, стоимость и напомнит об оплате." action={<Link href="/meters/new" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Добавить счётчик</Link>} />
          </Panel>
        ) : (
          d.resources.map((r) => <ResourceCard key={r.resource} r={r} />)
        )}
        {d.otherServices.map((s) => (
          <div key={s.accountId} className="ems-panel flex flex-col gap-1 p-3">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Wifi className="size-3.5" />
              </span>
              <span className="ems-label flex-1">{s.title}</span>
              {s.nextObligation ? <ObligationStatusBadge status={s.nextObligation.status} daysLeft={s.nextObligation.daysLeft} /> : null}
            </div>
            <p className="ems-num text-lg font-semibold">{rub(s.amount)}</p>
            <p className="text-xs text-muted-foreground">
              {s.providerName ?? SERVICE_LABEL[s.service]} · {BASIS_LABEL[s.basis] ?? s.basis}
              {s.nextObligation ? ` · оплатить до ${dateRu(s.nextObligation.dueDate, { day: "numeric", month: "long" })}` : ""}
            </p>
          </div>
        ))}
      </div>

      {d.resources.length ? <HomeChart siteId={d.site.siteId} tz={d.site.timezone} resources={d.resources.map((r) => r.resource)} /> : null}

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Ближайшие платежи" actions={<Link href="/finance/payments" className="text-xs text-muted-foreground hover:text-foreground">Все платежи →</Link>} bodyClassName="p-0">
          {d.obligations.length ? (
            <ul className="divide-y divide-border/60">
              {d.obligations.map((o) => (
                <li key={o.obligationId} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{o.title}</p>
                    <p className="text-xs text-muted-foreground">до {dateRu(o.dueDate, { day: "numeric", month: "long" })}</p>
                  </div>
                  <div className="text-right">
                    <p className="ems-num text-[13px] font-semibold">{o.amount == null ? "—" : rub(o.amount)}</p>
                    <ObligationStatusBadge status={o.status} daysLeft={o.daysLeft} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={CalendarClock} title="Платежей нет" text="Добавьте коммунальные платежи — придёт напоминание до срока." />
          )}
        </Panel>
        <Panel title="События" actions={<Link href="/monitoring/events" className="text-xs text-muted-foreground hover:text-foreground">Журнал →</Link>} bodyClassName="p-0">
          <EventList events={d.events.slice(0, 6)} compact />
        </Panel>
        <Panel title="Рекомендации" subtitle="Только по фактическим измерениям">
          {d.recommendations.length ? (
            <ul className="space-y-3">
              {d.recommendations.map((r) => (
                <li key={r.code} className="flex gap-2 text-[13px]">
                  <Lightbulb className={cn("mt-0.5 size-4 shrink-0", r.severity === "warning" ? "text-amber-600" : "text-muted-foreground")} />
                  <div>
                    <p className="font-medium">{r.title}</p>
                    <p className="text-muted-foreground">{r.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">Рекомендации появятся, когда накопится не меньше трёх суток почасовых данных с автоматических счётчиков. По ручным показаниям раз в месяц выводов о ночном расходе мы не делаем.</p>
          )}
        </Panel>
      </div>
    </div>
  )
}

function addMonth(key: string, n: number) {
  const [y, m] = key.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`
}

function ResourceCard({ r }: { r: HomeData["resources"][number] }) {
  const Icon = ICON[r.resource] ?? Gauge
  const latest = r.readings.filter((x) => x.at).sort((a, b) => (a.at! < b.at! ? 1 : -1))[0]
  return (
    <Link href={`/resources/${r.resource}`} className="ems-panel group flex flex-col gap-2 p-3 transition-colors hover:border-primary/50">
      <div className="flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-lg bg-primary/15 text-[oklch(0.45_0.12_120)]">
          <Icon className="size-3.5" />
        </span>
        <span className="ems-label flex-1">{LABEL[r.resource]}</span>
        <ArrowRight className="size-3.5 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[11px] text-muted-foreground">Расход за месяц</p>
          <p className="ems-num text-lg font-semibold">{qty(r.monthQty, r.unit)}</p>
          <p className="text-xs">
            <Delta value={r.changePct} /> <span className="text-muted-foreground">к тем же дням</span>
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Стоимость</p>
          {r.cost?.hasTariff ? (
            <>
              <p className="ems-num text-lg font-semibold">{rub(r.cost.charged ?? r.cost.toDate)}</p>
              <p className="text-xs text-muted-foreground">прогноз {rub(r.cost.forecast)}</p>
            </>
          ) : (
            <p className="mt-1 text-xs text-amber-700">Тариф не указан</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-t border-border/60 pt-2 text-xs text-muted-foreground">
        {r.readings.map((x) => (
          <span key={x.name} className="ems-num">
            {x.zone ? `${x.zone}: ` : "Показание: "}
            <span className="font-medium text-foreground">{num(x.value, r.unit === "m3" ? 3 : 1)}</span>
          </span>
        ))}
        {r.resource !== "electricity" && r.avgDaily != null ? <span>в сутки ≈ {qty(r.avgDaily, r.unit)}</span> : null}
        <span className="ml-auto">{latest ? relative(latest.at) : "нет показаний"}</span>
      </div>
      {r.cost?.warnings?.length ? <p className="text-xs text-amber-700">{r.cost.warnings[0]}</p> : null}
    </Link>
  )
}

function HomeChart({ siteId, tz, resources }: { siteId: string; tz: string; resources: string[] }) {
  const p = usePeriod("month")
  const water = resources.filter((r) => r !== "electricity")
  const [mode, setMode] = useState<"kwh" | "m3" | "rub">(resources.includes("electricity") ? "kwh" : "m3")
  const params = mode === "kwh" ? { resources: "electricity" } : mode === "m3" ? { resources: water.join(",") } : { resources: resources.join(","), metric: "cost" }
  const q = useApi<{ series: Series[]; notes: string[] }>(`/api/v1/series${qs({ siteId, from: p.period.from, to: p.period.to, resolution: mode === "rub" && p.period.resolution === "hour" ? "day" : p.period.resolution, ...params })}`)
  return (
    <Panel title="Потребление" subtitle={`${p.period.label}. Единицы не смешиваются: переключите кВт·ч, м³ или ₽.`}>
      <ChartFrame
        name="scada-ems-потребление"
        toolbar={
          <>
            <PeriodPicker state={p} />
            <Segmented
              ariaLabel="Единицы"
              value={mode}
              onChange={setMode}
              options={[
                { value: "kwh", label: "кВт·ч", disabled: !resources.includes("electricity") },
                { value: "m3", label: "м³", disabled: !water.length },
                { value: "rub", label: "₽" },
              ]}
            />
          </>
        }
      >
        {() => (q.loading && !q.data ? <Skeleton className="h-full w-full" /> : q.error ? <ErrorBox error={q.error} onRetry={q.reload} /> : <ConsumptionChart series={q.data?.series ?? []} tz={tz} />)}
      </ChartFrame>
      {q.data?.notes?.length ? <p className="mt-2 text-xs text-muted-foreground">{q.data.notes.join(". ")}</p> : null}
    </Panel>
  )
}

function HomeSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-56" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-2xl" />
    </div>
  )
}

