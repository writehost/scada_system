"use client"

import { useState } from "react"
import { api, useApi } from "@/lib/client/api"
import { dateRu, dateTimeRu, relative, rub } from "@/lib/client/format"
import { Badge, Button, Dialog, ErrorBox, Field, Input, Panel, Select, Skeleton, Stat, useToast } from "@/components/ui"
import { PageHeader, useApp } from "@/components/ems/shell"

type Org = { org_id: string; name: string; kind: string; segment: string; is_demo: boolean; plan_code: string; status: string; effective_status: string; trial_ends_at: string | null; current_period_end: string | null; meters: number; users: number; readings_month: number; emails_month: number; requested_plan: string | null; created_at: string }
type Plan = { plan_code: string; segment: string; name: string; price_month: number | null; limits: Record<string, number | null>; is_public: boolean; is_trial: boolean }
type Data = { orgs: Org[]; plans: Plan[]; requests: Array<{ request_id: string; org_name: string; manufacturer: string; model: string; quantity: number; contact_name: string; contact_phone: string | null; contact_email: string | null; comment: string | null; status: string; created_at: string }>; metrics: Record<string, number>; workers: Array<{ job: string; last_ok_at: string | null; last_error: string | null; last_duration_ms: number | null; runs: number; failures: number; last_stats: Record<string, unknown> }> }

export default function AdminPage() {
  const { me } = useApp()
  const toast = useToast()
  const q = useApi<Data>(me.user.isPlatformAdmin ? "/api/admin/overview" : null)
  const [org, setOrg] = useState<Org | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  if (!me.user.isPlatformAdmin) return <p className="text-sm">Раздел доступен администраторам платформы (SCADA ID: super admin).</p>
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />
  if (!q.data) return <Skeleton className="h-64" />
  const m = q.data.metrics
  return (
    <div className="space-y-4">
      <PageHeader title="Администрирование платформы" subtitle="Организации, подписки, тарифы SCADA EMS, заявки на оборудование, состояние системы" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Активные приборы" value={String(m.meters_active)} />
        <Stat label="Показаний за месяц" value={Number(m.readings_month).toLocaleString("ru-RU")} />
        <Stat label="Размер БД" value={`${Math.round(Number(m.db_bytes) / 1048576)} МБ`} sub={`телеметрия ${Math.round(Number(m.readings_bytes) / 1048576)} МБ`} />
        <Stat label="Очередь писем" value={String(m.mail_queue)} sub={`ошибок: ${m.mail_failed}`} tone={m.mail_failed ? "warning" : "neutral"} />
        <Stat label="Шлюзы" value={`${m.gateways_online} на связи`} sub={`${m.gateways_offline} без связи`} tone={m.gateways_offline ? "warning" : "neutral"} />
      </div>
      <Panel title="Фоновые задачи" bodyClassName="p-0">
        <table className="ems-table">
          <tbody>
            {q.data.workers.map((w) => (
              <tr key={w.job}>
                <td className="font-medium">{w.job}</td>
                <td>{w.last_error ? <Badge tone="danger">{w.last_error}</Badge> : <Badge tone="success">ok {relative(w.last_ok_at)}</Badge>}</td>
                <td className="ems-num text-right text-xs">{w.last_duration_ms} мс · запусков {w.runs} · сбоев {w.failures}</td>
                <td className="hidden max-w-xs truncate font-mono text-[11px] text-muted-foreground md:table-cell">{JSON.stringify(w.last_stats)}</td>
              </tr>
            ))}
            {!q.data.workers.length ? <tr><td className="text-[13px] text-amber-700">Фоновый обработчик ещё не запускался (scripts/worker.ts).</td></tr> : null}
          </tbody>
        </table>
      </Panel>
      <Panel title="Организации" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="ems-table">
            <thead><tr><th>Организация</th><th>Тариф</th><th>Статус</th><th className="text-right">Приборы</th><th className="text-right">Показаний/мес</th><th className="text-right">Писем/мес</th><th /></tr></thead>
            <tbody>
              {q.data.orgs.map((o) => (
                <tr key={o.org_id}>
                  <td><p className="font-medium">{o.name} {o.is_demo ? <Badge tone="warning">демо</Badge> : null}</p><p className="text-xs text-muted-foreground">{o.segment} · {o.kind} · {o.users} польз. · с {dateRu(o.created_at)}</p></td>
                  <td className="text-[13px]">{o.plan_code}{o.requested_plan && o.requested_plan !== o.plan_code ? <Badge tone="info">заявка: {o.requested_plan}</Badge> : null}</td>
                  <td><Badge tone={o.effective_status === "active" || o.effective_status === "trial" ? "success" : "danger"}>{o.effective_status}</Badge><p className="text-[11px] text-muted-foreground">{o.current_period_end ? `до ${dateRu(o.current_period_end)}` : o.trial_ends_at ? `проба до ${dateRu(o.trial_ends_at)}` : ""}</p></td>
                  <td className="ems-num text-right">{o.meters}</td>
                  <td className="ems-num text-right">{Number(o.readings_month).toLocaleString("ru-RU")}</td>
                  <td className="ems-num text-right">{o.emails_month}</td>
                  <td className="text-right"><Button size="sm" variant="outline" onClick={() => setOrg(o)}>Подписка</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Тарифы SCADA EMS" subtitle="Цены и лимиты хранятся в базе и меняются здесь" bodyClassName="p-0">
        <table className="ems-table">
          <tbody>
            {q.data.plans.map((p) => (
              <tr key={p.plan_code}>
                <td><p className="font-medium">{p.name}</p><p className="font-mono text-[11px] text-muted-foreground">{p.plan_code}{p.is_trial ? " · пробный" : ""}{!p.is_public ? " · скрыт" : ""}</p></td>
                <td className="ems-num">{p.price_month == null ? "по договору" : rub(p.price_month)}</td>
                <td className="hidden text-xs text-muted-foreground md:table-cell">{Object.entries(p.limits).map(([k, v]) => `${k}: ${v ?? "∞"}`).join(", ")}</td>
                <td className="text-right"><Button size="sm" variant="outline" onClick={() => setPlan(p)}>Изменить</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Заявки на оборудование" bodyClassName="p-0">
        <ul className="divide-y divide-border/60">
          {q.data.requests.map((r) => (
            <li key={r.request_id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-[13px]">
              <span className="min-w-0 flex-1">{r.org_name}: {r.manufacturer} {r.model} × {r.quantity}<span className="block text-xs text-muted-foreground">{r.contact_name} {r.contact_phone ?? ""} {r.contact_email ?? ""} · {dateTimeRu(r.created_at)}{r.comment ? ` · ${r.comment}` : ""}</span></span>
              <select aria-label="Статус заявки" className="ems-input h-8 w-auto text-xs" value={r.status} onChange={async (e) => { await api(`/api/admin/device-requests/${r.request_id}`, { method: "PATCH", body: { status: e.target.value } }); q.reload() }}>
                <option value="new">новая</option><option value="processing">в работе</option><option value="closed">закрыта</option>
              </select>
            </li>
          ))}
          {!q.data.requests.length ? <li className="px-4 py-3 text-[13px] text-muted-foreground">Заявок нет.</li> : null}
        </ul>
      </Panel>
      {org ? <OrgSubDialog org={org} plans={q.data.plans} onClose={() => setOrg(null)} onDone={() => { q.reload(); toast("Подписка изменена") }} /> : null}
      {plan ? <PlanDialog plan={plan} onClose={() => setPlan(null)} onDone={() => { q.reload(); toast("Тариф сохранён") }} /> : null}
    </div>
  )
}

function OrgSubDialog({ org, plans, onClose, onDone }: { org: Org; plans: Plan[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ planCode: org.requested_plan ?? org.plan_code, status: "active", periodEnd: new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 10), note: "оплата по счёту" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string } | null>(null)
  return (
    <Dialog open onClose={onClose} title={`Подписка: ${org.name}`} footer={<><Button variant="outline" onClick={onClose}>Отмена</Button><Button loading={busy} onClick={async () => { setBusy(true); setError(null); try { await api(`/api/admin/orgs/${org.org_id}/subscription`, { method: "PATCH", body: { ...f, periodEnd: f.periodEnd ? `${f.periodEnd}T23:59:59Z` : null } }); onDone(); onClose() } catch (e) { setError(e as Error) } finally { setBusy(false) } }}>Сохранить</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Тариф"><Select value={f.planCode} onChange={(e) => setF({ ...f, planCode: e.target.value })}>{plans.filter((p) => p.segment === org.segment).map((p) => <option key={p.plan_code} value={p.plan_code}>{p.name}</option>)}</Select></Field>
        <Field label="Статус"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{["trial", "active", "past_due", "expired", "cancelled"].map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <Field label="Оплачено до"><Input type="date" value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} /></Field>
        <Field label="Основание"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <div className="sm:col-span-2"><ErrorBox error={error} /></div>
      </div>
    </Dialog>
  )
}

function PlanDialog({ plan, onClose, onDone }: { plan: Plan; onClose: () => void; onDone: () => void }) {
  const [price, setPrice] = useState(plan.price_month == null ? "" : String(plan.price_month))
  const [limits, setLimits] = useState<Record<string, string>>(Object.fromEntries(Object.entries(plan.limits).map(([k, v]) => [k, v == null ? "" : String(v)])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string } | null>(null)
  return (
    <Dialog open onClose={onClose} title={plan.name} description="Пустое значение — без ограничения / цена по договору." footer={<><Button variant="outline" onClick={onClose}>Отмена</Button><Button loading={busy} onClick={async () => { setBusy(true); setError(null); try { await api(`/api/admin/plans/${plan.plan_code}`, { method: "PATCH", body: { priceMonth: price === "" ? null : price, limits } }); onDone(); onClose() } catch (e) { setError(e as Error) } finally { setBusy(false) } }}>Сохранить</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Цена в месяц, ₽" className="sm:col-span-2"><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        {Object.keys(limits).map((k) => <Field key={k} label={k}><Input inputMode="numeric" value={limits[k]} onChange={(e) => setLimits({ ...limits, [k]: e.target.value })} /></Field>)}
        <div className="sm:col-span-2"><ErrorBox error={error} /></div>
      </div>
    </Dialog>
  )
}
