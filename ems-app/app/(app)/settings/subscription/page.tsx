"use client"

import { useState } from "react"
import { api, useApi } from "@/lib/client/api"
import { dateRu, dateTimeRu, rub } from "@/lib/client/format"
import { cn } from "@/lib/client/cn"
import { Badge, Button, ErrorBox, Notice, Panel, Skeleton, useToast } from "@/components/ui"
import { PageHeader, useApp } from "@/components/ems/shell"

type Plan = { plan_code: string; name: string; description: string; price_month: number | null; limits: Record<string, number | null>; features: string[] }
type Data = { subscription: { planCode: string; planName: string; status: string; trialEndsAt: string | null; currentPeriodEnd: string | null; limits: Record<string, number | null>; features: string[] }; usage: Record<string, number>; plans: Plan[]; history: Array<{ to_plan: string; to_status: string; reason: string; created_at: string; actor: string | null }>; warnings: Array<{ label: string; used: number; limit: number }>; limitLabels: Record<string, string> }

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "info" }> = { trial: { label: "пробный период", tone: "info" }, active: { label: "активна", tone: "success" }, past_due: { label: "ожидает оплаты", tone: "warning" }, expired: { label: "истекла", tone: "danger" }, cancelled: { label: "отменена", tone: "danger" } }
const FEATURE: Record<string, string> = { analytics_advanced: "Расширенная аналитика (тепловые карты, сравнения)", recommendations: "Рекомендации по данным", industrial: "Промышленная панель", production: "Удельное потребление по выпуску", api: "API для интеграций", sla: "SLA и выделенная поддержка" }

export default function SubscriptionPage() {
  const { can } = useApp()
  const toast = useToast()
  const q = useApi<Data>("/api/v1/subscription")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<{ message: string } | null>(null)
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />
  if (!q.data) return <Skeleton className="h-64" />
  const { subscription: s, usage, plans, history, warnings, limitLabels } = q.data
  return (
    <div className="space-y-4">
      <PageHeader title="Подписка SCADA EMS" subtitle="Оплата сервиса SCADA EMS. Не путать с коммунальными платежами." />
      <Panel title={s.planName} subtitle={s.status === "trial" && s.trialEndsAt ? `Пробный период до ${dateRu(s.trialEndsAt)}` : s.currentPeriodEnd ? `Оплачено до ${dateRu(s.currentPeriodEnd)}` : undefined} actions={<Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(s.limits).map(([k, v]) => {
            const used = usage[k]
            const ratio = v && used != null ? Math.min(1, used / v) : 0
            return (
              <div key={k} className="rounded-lg border border-border/70 p-2">
                <p className="text-[11px] text-muted-foreground">{limitLabels[k]}</p>
                <p className="ems-num text-sm font-semibold">{used != null ? `${used} из ${v ?? "∞"}` : v ?? "без ограничения"}</p>
                {used != null && v ? <div className="mt-1 h-1.5 rounded bg-muted"><div className={cn("h-full rounded", ratio >= 0.9 ? "bg-destructive" : ratio >= 0.8 ? "bg-amber-500" : "bg-primary")} style={{ width: `${ratio * 100}%` }} /></div> : null}
              </div>
            )
          })}
        </div>
        {warnings.length ? <Notice tone="warning" className="mt-3">Близко к лимиту: {warnings.map((w) => `${w.label} (${w.used} из ${w.limit})`).join(", ")}.</Notice> : null}
        <p className="mt-3 text-xs text-muted-foreground">При окончании подписки история измерений не удаляется: просмотр остаётся доступным, изменения приостанавливаются. Показания принимаются ещё 30 дней после окончания оплаченного периода.</p>
      </Panel>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((p) => (
          <Panel key={p.plan_code} title={p.name} subtitle={p.description} actions={p.plan_code === s.planCode ? <Badge tone="success">текущий</Badge> : null}>
            <p className="ems-num text-2xl font-semibold">{p.price_month == null ? "По договору" : `${rub(p.price_month)}/мес`}</p>
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              {Object.entries(p.limits).map(([k, v]) => <li key={k}>{limitLabels[k]}: {v ?? "без ограничения"}</li>)}
              {p.features.map((f) => <li key={f}>✓ {FEATURE[f] ?? f}</li>)}
            </ul>
            {can("subscription.manage") && p.plan_code !== s.planCode ? (
              <Button className="mt-3 w-full" variant="outline" loading={busy === p.plan_code} onClick={async () => {
                setBusy(p.plan_code); setError(null)
                try { const r = await api<{ message: string }>("/api/v1/subscription/request", { body: { planCode: p.plan_code } }); toast(r.message); q.reload() } catch (e) { setError(e as Error) } finally { setBusy(null) }
              }}>{p.price_month == null ? "Запросить предложение" : "Подключить"}</Button>
            ) : null}
          </Panel>
        ))}
      </div>
      <ErrorBox error={error} />
      <Notice>Онлайн-оплата не подключена: платёжный провайдер ещё не утверждён. Заявка на тариф передаётся администратору платформы, тариф активируется после оплаты по счёту. Оборудование оплачивается отдельно от подписки.</Notice>
      <Panel title="История" bodyClassName="p-0">
        <ul className="divide-y divide-border/60">
          {history.map((h, i) => (
            <li key={i} className="px-4 py-2 text-[13px]">
              {h.to_plan} · {STATUS[h.to_status]?.label ?? h.to_status} · {h.reason}
              <span className="block text-xs text-muted-foreground">{dateTimeRu(h.created_at)}{h.actor ? ` · ${h.actor}` : ""}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}
