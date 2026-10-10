"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, Wallet } from "lucide-react"
import { qs, useApi } from "@/lib/client/api"
import { monthName, num, rub, unit } from "@/lib/client/format"
import { Badge, Button, Delta, Empty, ErrorBox, Panel, Skeleton, Stat } from "@/components/ui"
import { NeedSite, PageHeader } from "@/components/ems/shell"

type Line = { label: string; qty: number | null; unit: string | null; price: number | null; amount: number; fixed: boolean; estimated: boolean }
type Svc = { accountId: string; service: string; serviceLabel: string; title: string; providerName: string | null; unit: string | null; hasTariff: boolean; qty: number; calcMethod: string; actualToDate: { amount: number | null; result: { lines: Line[]; warnings: string[] } }; forecast: { qty: number | null; amount: number | null; confidence: string }; charged: { amount: number; note: string | null } | null; previous: { amount: number | null; basis: string }; changePct: number | null; budget: number | null }
type Costs = { month: string; today: string; services: Svc[]; totals: { actualToDate: number; forecast: number | null; previous: number | null; changePct: number | null; incomplete: boolean } }

const CONF: Record<string, string> = { high: "надёжный", medium: "приблизительный", low: "грубый", none: "нет данных" }

export default function CostsPage() {
  return <NeedSite>{(siteId) => <Costs siteId={siteId} />}</NeedSite>
}

function shift(month: string, n: number) {
  const [y, m] = month.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`
}

function Costs({ siteId }: { siteId: string }) {
  const [month, setMonth] = useState<string | null>(null)
  const q = useApi<Costs>(`/api/v1/costs${qs({ siteId, month })}`)
  const d = q.data
  const current = d ? d.month === `${d.today.slice(0, 8)}01` : true
  const total = d?.services.reduce((s, x) => s + (x.charged?.amount ?? x.forecast.amount ?? 0), 0) ?? 0
  return (
    <div className="space-y-4">
      <PageHeader
        title="Сводка расходов"
        subtitle="Каждая сумма подписана источником: по квитанции, расчёт по показаниям или прогноз"
        actions={
          d ? (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-sm" aria-label="Предыдущий месяц" onClick={() => setMonth(shift(d.month, -1))}>
                <ChevronLeft />
              </Button>
              <span className="min-w-36 text-center text-sm font-medium">{monthName(d.month)}</span>
              <Button variant="outline" size="icon-sm" aria-label="Следующий месяц" disabled={current} onClick={() => setMonth(shift(d.month, 1))}>
                <ChevronRight />
              </Button>
            </div>
          ) : null
        }
      />
      <ErrorBox error={q.error} onRetry={q.reload} />
      {!d ? (
        <Skeleton className="h-64" />
      ) : !d.services.length ? (
        <Panel>
          <Empty icon={Wallet} title="Нет услуг" text="Добавьте услуги и тарифы, чтобы видеть стоимость." action={<Link href="/tariffs" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">К тарифам</Link>} />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={current ? "Прогноз за месяц" : "Итого за месяц"} value={rub(d.totals.forecast)} sub={d.totals.incomplete ? "не по всем услугам есть тариф" : current ? "по фактическому темпу потребления" : "по показаниям и квитанциям"} />
            <Stat label="Начислено к текущему дню" value={rub(d.totals.actualToDate)} sub="расчёт по показаниям и квитанциям" />
            <Stat label="Прошлый месяц" value={rub(d.totals.previous)} sub={<span>изменение <Delta value={d.totals.changePct} /></span>} />
            <Stat label="Услуг" value={String(d.services.length)} sub={`${d.services.filter((s) => s.hasTariff || s.calcMethod === "manual").length} с тарифом`} />
          </div>
          <Panel title="Доля услуг" subtitle="По сумме за месяц (квитанция или прогноз)">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
              {d.services.map((s, i) => {
                const v = s.charged?.amount ?? s.forecast.amount ?? 0
                return v > 0 ? <div key={s.accountId} title={`${s.title}: ${rub(v)}`} style={{ width: `${(v / Math.max(total, 1)) * 100}%`, background: ["oklch(0.68 0.16 118)", "oklch(0.55 0.12 250)", "oklch(0.6 0.2 25)", "oklch(0.7 0.15 55)", "oklch(0.6 0.15 320)", "oklch(0.5 0.05 145)", "oklch(0.75 0.1 200)", "oklch(0.4 0.03 90)"][i % 8] }} /> : null
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {d.services.map((s, i) => {
                const v = s.charged?.amount ?? s.forecast.amount ?? 0
                return (
                  <span key={s.accountId} className="flex items-center gap-1.5">
                    <span className="size-2 rounded-sm" style={{ background: ["oklch(0.68 0.16 118)", "oklch(0.55 0.12 250)", "oklch(0.6 0.2 25)", "oklch(0.7 0.15 55)", "oklch(0.6 0.15 320)", "oklch(0.5 0.05 145)", "oklch(0.75 0.1 200)", "oklch(0.4 0.03 90)"][i % 8] }} />
                    {s.title} — {total > 0 ? Math.round((v / total) * 100) : 0}%
                  </span>
                )
              })}
            </div>
          </Panel>
          <div className="grid gap-3 lg:grid-cols-2">
            {d.services.map((s) => (
              <Panel
                key={s.accountId}
                title={s.title}
                subtitle={s.providerName ?? s.serviceLabel}
                actions={s.charged ? <Badge tone="success">по квитанции</Badge> : !s.hasTariff && s.calcMethod !== "manual" ? <Badge tone="warning">нет тарифа</Badge> : null}
              >
                <div className="grid grid-cols-3 gap-2 text-[13px]">
                  <div>
                    <p className="text-[11px] text-muted-foreground">{s.unit ? "Расход" : "Сумма"}</p>
                    <p className="ems-num font-semibold">{s.unit ? `${num(s.qty, 3)} ${unit(s.unit)}` : rub(s.charged?.amount ?? s.actualToDate.amount)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">{s.charged ? "Начислено (квитанция)" : "Расчёт к дате"}</p>
                    <p className="ems-num font-semibold">{rub(s.charged?.amount ?? s.actualToDate.amount, 2)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Прогноз</p>
                    <p className="ems-num font-semibold">{rub(s.forecast.amount, 2)}</p>
                    <p className="text-[11px] text-muted-foreground">{CONF[s.forecast.confidence]}</p>
                  </div>
                </div>
                {s.actualToDate.result.lines.length ? (
                  <table className="mt-3 w-full text-xs">
                    <tbody>
                      {s.actualToDate.result.lines.map((l, i) => (
                        <tr key={i} className="border-t border-border/50">
                          <td className="py-1 pr-2">
                            {l.label}
                            {l.estimated ? <span className="text-amber-700"> · распределено</span> : null}
                          </td>
                          <td className="ems-num py-1 text-right text-muted-foreground">{l.qty != null ? `${num(l.qty, 3)} ${unit(l.unit)} × ${num(l.price, 4)} ₽` : "в месяц"}</td>
                          <td className="ems-num py-1 pl-2 text-right">{rub(l.amount, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
                {s.actualToDate.result.warnings.map((w) => (
                  <p key={w} className="mt-2 text-xs text-amber-700">
                    {w}
                  </p>
                ))}
                <p className="mt-2 text-xs text-muted-foreground">
                  Прошлый месяц: {rub(s.previous.amount, 2)} ({s.previous.basis === "actual" ? "по квитанции" : "расчёт"}) · изменение <Delta value={s.changePct} />
                  {s.budget ? ` · бюджет ${rub(s.budget)}` : ""}
                </p>
              </Panel>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
