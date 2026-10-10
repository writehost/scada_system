"use client"

import { use, useState } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Gauge, PencilLine, Plus, SquareStack } from "lucide-react"
import { qs, useApi } from "@/lib/client/api"
import { dateRu, num, qty, relative, rub, SERVICE_LABEL, unit } from "@/lib/client/format"
import { Badge, Delta, Empty, ErrorBox, Panel, Segmented, Skeleton, Stat } from "@/components/ui"
import { ChartFrame, ConsumptionChart, Heatmap, type Series } from "@/components/ems/charts"
import { PeriodPicker, usePeriod } from "@/components/ems/period"
import { NeedSite, PageHeader, useApp } from "@/components/ems/shell"
import { ObligationStatusBadge } from "@/components/ems/obligation-status"
import { useObligations } from "@/components/ems/obligation-form"

const TITLE: Record<string, string> = { electricity: "Электричество", cold_water: "Холодная вода", hot_water: "Горячая вода", other: "Прочие услуги" }
const UNIT: Record<string, string> = { electricity: "kWh", cold_water: "m3", hot_water: "m3" }

export default function ResourcePage({ params }: { params: Promise<{ resource: string }> }) {
  const { resource } = use(params)
  if (!(resource in TITLE)) notFound()
  return <NeedSite>{(siteId, site) => (resource === "other" ? <OtherServices siteId={siteId} /> : <Resource siteId={siteId} tz={site.timezone} resource={resource} />)}</NeedSite>
}

type Costs = { services: Array<{ service: string; title: string; hasTariff: boolean; qty: number; actualToDate: { amount: number | null; result: { warnings: string[] } }; forecast: { qty: number | null; amount: number | null }; charged: { amount: number } | null; previous: { amount: number | null }; changePct: number | null }> }

function Resource({ siteId, tz, resource }: { siteId: string; tz: string; resource: string }) {
  const { hasFeature, can } = useApp()
  const p = usePeriod("month")
  const [metric, setMetric] = useState<"consumption" | "cost">("consumption")
  const series = useApi<{ series: Series[]; notes: string[] }>(`/api/v1/series${qs({ siteId, resources: resource, metric: metric === "cost" ? "cost" : null, from: p.period.from, to: p.period.to, resolution: metric === "cost" && p.period.resolution === "hour" ? "day" : p.period.resolution })}`)
  const meters = useApi<{ meters: Array<{ meter_id: string; name: string; resource: string; connection: string; channels: Array<{ channelId: number; name: string; unit: string; lastValue: number | null; lastAt: string | null; decimals: number; measureKind: string }> }> }>(`/api/v1/meters${qs({ siteId })}`)
  const costs = useApi<Costs>(`/api/v1/costs${qs({ siteId })}`)
  const advanced = hasFeature("analytics_advanced")
  const heat = useApi<{ cells: Array<{ weekday: number; hour: number; avg: number | null; samples: number }>; allocatedShare: number; unit: string }>(advanced ? `/api/v1/series/heatmap${qs({ siteId, resource })}` : null)
  const own = (meters.data?.meters ?? []).filter((m) => m.resource === resource)
  const svc = costs.data?.services.find((s) => s.service === resource)
  const u = UNIT[resource]
  return (
    <div className="space-y-4">
      <PageHeader
        title={TITLE[resource]}
        subtitle="Расход, стоимость и приборы"
        actions={
          can("readings.write") && own.some((m) => m.connection === "manual") ? (
            <Link href="/readings" className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
              <PencilLine className="size-4" /> Внести показания
            </Link>
          ) : null
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Расход за месяц" loading={!costs.data} value={qty(svc?.qty ?? null, u)} sub={svc?.forecast.qty != null ? `прогноз ${qty(svc.forecast.qty, u)}` : "—"} />
        <Stat label="Стоимость к дате" loading={!costs.data} value={svc?.hasTariff ? rub(svc.charged?.amount ?? svc.actualToDate.amount, 2) : "—"} sub={svc?.hasTariff ? (svc.charged ? "по квитанции" : "расчёт по показаниям") : <Link href="/tariffs" className="underline">Указать тариф</Link>} />
        <Stat label="Прогноз стоимости" loading={!costs.data} value={rub(svc?.forecast.amount ?? null)} sub={<span>к прошлому месяцу <Delta value={svc?.changePct ?? null} /></span>} />
        <Stat label="Прошлый месяц" loading={!costs.data} value={rub(svc?.previous.amount ?? null)} />
      </div>
      <Panel title="Потребление" subtitle={p.period.label}>
        <ChartFrame
          name={`scada-ems-${resource}`}
          toolbar={
            <>
              <PeriodPicker state={p} />
              <Segmented value={metric} onChange={setMetric} options={[{ value: "consumption", label: unit(u) }, { value: "cost", label: "₽" }]} />
              <a className="text-xs text-muted-foreground underline" href={`/api/v1/export${qs({ siteId, resources: resource, metric: metric === "cost" ? "cost" : null, from: p.period.from, to: p.period.to, resolution: p.period.resolution === "hour" && metric === "cost" ? "day" : p.period.resolution })}`}>
                CSV
              </a>
            </>
          }
        >
          {() => (series.loading && !series.data ? <Skeleton className="h-full" /> : series.error ? <ErrorBox error={series.error} /> : <ConsumptionChart series={series.data?.series ?? []} tz={tz} />)}
        </ChartFrame>
        {series.data?.notes?.length ? <p className="mt-2 text-xs text-muted-foreground">{series.data.notes.join(". ")}</p> : null}
      </Panel>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Приборы" actions={can("devices.write") ? <Link href="/meters/new" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><Plus className="size-3.5" /> Добавить</Link> : null} bodyClassName="p-0">
          {own.length ? (
            <ul className="divide-y divide-border/60">
              {own.map((m) => (
                <li key={m.meter_id} className="px-4 py-2.5 text-[13px]">
                  <Link href={`/meters/${m.meter_id}`} className="font-medium hover:underline">
                    {m.name}
                  </Link>
                  {m.channels.map((c) => (
                    <p key={c.channelId} className="ems-num text-xs text-muted-foreground">
                      {c.name}: <span className="text-foreground">{c.lastValue == null ? "—" : `${num(c.lastValue, c.decimals)} ${unit(c.unit)}`}</span> · {relative(c.lastAt)}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={Gauge} title="Нет приборов" text="Добавьте счётчик, чтобы считать расход." />
          )}
        </Panel>
        <Panel title="Профиль по часам" subtitle={advanced ? "Средний расход по дням недели и часам за 4 недели" : "Доступно в тарифе с расширенной аналитикой"}>
          {!advanced ? (
            <p className="text-[13px] text-muted-foreground">
              Тепловая карта показывает, в какие часы расходуется ресурс. <Link href="/settings/subscription" className="underline">Тарифы SCADA EMS</Link>
            </p>
          ) : !heat.data ? (
            <Skeleton className="h-40" />
          ) : heat.data.cells.every((c) => c.avg == null) ? (
            <p className="text-[13px] text-muted-foreground">Нужны почасовые данные с автоматического прибора. По ручным показаниям раз в месяц профиль по часам не строится.</p>
          ) : (
            <>
              <Heatmap cells={heat.data.cells} unit={heat.data.unit} />
              {heat.data.allocatedShare > 0.2 ? <p className="mt-2 text-xs text-amber-700">{Math.round(heat.data.allocatedShare * 100)}% расхода распределено между редкими показаниями — профиль приблизительный.</p> : null}
            </>
          )}
        </Panel>
      </div>
      {svc?.actualToDate.result.warnings.length ? <p className="text-xs text-amber-700">{svc.actualToDate.result.warnings.join(" ")}</p> : null}
    </div>
  )
}

function OtherServices({ siteId }: { siteId: string }) {
  const accounts = useApi<{ accounts: Array<{ account_id: string; service: string; title: string; provider_name: string | null; account_number: string | null; calc_method: string; tariffs: Array<{ config: { kind: string; amount?: number } ; validTo: string | null }> }> }>(`/api/v1/accounts${qs({ siteId })}`)
  const ob = useObligations({ siteId })
  const list = (accounts.data?.accounts ?? []).filter((a) => !["electricity", "cold_water", "hot_water"].includes(a.service))
  return (
    <div className="space-y-4">
      <PageHeader title="Прочие услуги" subtitle="Интернет, водоотведение, отопление, газ и другие регулярные платежи" actions={<Link href="/tariffs" className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium">Управление услугами</Link>} />
      <ErrorBox error={accounts.error} onRetry={accounts.reload} />
      {!accounts.data ? (
        <Skeleton className="h-40" />
      ) : !list.length ? (
        <Panel>
          <Empty icon={SquareStack} title="Нет прочих услуг" text="Добавьте интернет, домофон, вывоз мусора или другие регулярные услуги — с напоминаниями об оплате." />
        </Panel>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((a) => {
            const t = a.tariffs.find((x) => x.validTo == null)
            const next = (ob.data?.items ?? []).filter((o) => o.accountId === a.account_id && o.status !== "paid")[0]
            return (
              <Panel key={a.account_id} title={a.title} subtitle={`${SERVICE_LABEL[a.service]}${a.provider_name ? ` · ${a.provider_name}` : ""}`}>
                <p className="ems-num text-xl font-semibold">{t?.config.kind === "fixed" ? rub(t.config.amount ?? null) : a.calc_method === "manual" ? "по квитанции" : "по тарифу"}</p>
                <p className="text-xs text-muted-foreground">{a.account_number ? `л/с ${a.account_number}` : "лицевой счёт не указан"}</p>
                {next ? (
                  <p className="mt-2 flex items-center gap-2 text-[13px]">
                    Оплатить до {dateRu(next.dueDate, { day: "numeric", month: "long" })} <ObligationStatusBadge status={next.status} />
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    <Badge>нет платежа</Badge> <Link href="/finance/payments" className="underline">добавить</Link>
                  </p>
                )}
              </Panel>
            )
          })}
        </div>
      )}
    </div>
  )
}
