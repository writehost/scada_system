"use client"

import { useState } from "react"
import { Bell, Plus, Trash2 } from "lucide-react"
import { api, qs, useApi } from "@/lib/client/api"
import { relative } from "@/lib/client/format"
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, Empty, ErrorBox, Field, Input, Panel, Select, Skeleton, useToast } from "@/components/ui"
import { NeedSite, PageHeader, useApp } from "@/components/ems/shell"

type Rule = { rule_id: string; kind: string; name: string; params: Record<string, number | string>; severity: string; enabled: boolean; notify: boolean; repeat_minutes: number | null; window_from: number | null; window_to: number | null; site_name: string; meter_name: string | null; open_events: number; last_evaluated_at: string | null }

const FIELDS: Record<string, Array<{ key: string; label: string; def: string; resource?: boolean }>> = {
  telemetry_lost: [{ key: "minutes", label: "Нет данных дольше, мин", def: "120" }],
  power_over: [{ key: "limitKw", label: "Предел мощности, кВт", def: "100" }, { key: "minutes", label: "Средняя за, мин", def: "10" }],
  flow_over: [{ key: "resource", label: "Ресурс", def: "cold_water", resource: true }, { key: "limitPerHour", label: "Предел, м³/ч", def: "1" }],
  continuous_flow: [{ key: "resource", label: "Ресурс", def: "cold_water", resource: true }, { key: "minPerHour", label: "Порог, м³/ч", def: "0.005" }, { key: "hours", label: "Часов подряд", def: "6" }],
  night_usage: [{ key: "resource", label: "Ресурс", def: "electricity", resource: true }, { key: "thresholdPct", label: "Выше обычного на, %", def: "50" }, { key: "minAbsPerHour", label: "Не меньше, ед./ч", def: "0.1" }, { key: "fromHour", label: "Ночь с, ч", def: "0" }, { key: "toHour", label: "Ночь до, ч", def: "5" }],
  consumption_growth: [{ key: "resource", label: "Ресурс", def: "cold_water", resource: true }, { key: "thresholdPct", label: "Рост на, %", def: "35" }, { key: "minDays", label: "Минимум дней данных", def: "5" }],
  budget_over: [{ key: "budget", label: "Бюджет в месяц, ₽", def: "5000" }],
  monthly_limit: [{ key: "resource", label: "Ресурс", def: "electricity", resource: true }, { key: "limit", label: "Лимит в месяц", def: "300" }],
}

export default function RulesPage() {
  return <NeedSite>{(siteId) => <Rules siteId={siteId} />}</NeedSite>
}

function Rules({ siteId }: { siteId: string }) {
  const { can, industrial } = useApp()
  const toast = useToast()
  const q = useApi<{ rules: Rule[]; kinds: Record<string, string> }>(`/api/v1/rules${qs({ siteId })}`)
  const [open, setOpen] = useState(false)
  const [del, setDel] = useState<Rule | null>(null)
  const kinds = q.data?.kinds ?? {}
  return (
    <div className="space-y-4">
      <PageHeader title="Правила оповещений" subtitle="Условия, по которым открываются события и уходят уведомления. Повторы подавляются." actions={can("rules.write") ? <Button onClick={() => setOpen(true)}><Plus /> Правило</Button> : null} />
      <ErrorBox error={q.error} onRetry={q.reload} />
      <Panel bodyClassName="p-0">
        {!q.data ? (
          <Skeleton className="m-4 h-32" />
        ) : !q.data.rules.length ? (
          <Empty icon={Bell} title="Правил нет" text={industrial ? "Добавьте контроль мощности, ночного потребления и потери связи." : "Например: рост расхода воды на 35% или непрерывный расход 6 часов подряд."} />
        ) : (
          <ul className="divide-y divide-border/60">
            {q.data.rules.map((r) => (
              <li key={r.rule_id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {r.name} {!r.enabled ? <Badge>выключено</Badge> : null} {r.open_events ? <Badge tone="danger">открыто событий: {r.open_events}</Badge> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {kinds[r.kind]} · {Object.entries(r.params).map(([k, v]) => `${FIELDS[r.kind]?.find((f) => f.key === k)?.label ?? k}: ${v}`).join(", ")}
                    {r.meter_name ? ` · ${r.meter_name}` : ""}
                    {r.repeat_minutes ? ` · повтор каждые ${r.repeat_minutes} мин` : ""}
                    {r.window_from != null ? ` · окно ${r.window_from}–${r.window_to} ч` : ""}
                    {r.last_evaluated_at ? ` · проверено ${relative(r.last_evaluated_at)}` : ""}
                  </p>
                </div>
                <Badge tone={r.severity === "critical" ? "danger" : r.severity === "warning" ? "warning" : "neutral"}>{r.severity === "critical" ? "авария" : r.severity === "warning" ? "предупреждение" : "информация"}</Badge>
                {can("rules.write") ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        await api(`/api/v1/rules/${r.rule_id}`, { method: "PATCH", body: { enabled: !r.enabled } })
                        q.reload()
                      }}
                    >
                      {r.enabled ? "Выключить" : "Включить"}
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Удалить правило" onClick={() => setDel(r)}>
                      <Trash2 />
                    </Button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {open ? <RuleDialog siteId={siteId} kinds={kinds} onClose={() => setOpen(false)} onDone={() => { q.reload(); toast("Правило создано") }} /> : null}
      <ConfirmDialog open={Boolean(del)} onClose={() => setDel(null)} title="Удалить правило?" text="Открытые по нему события останутся в журнале." confirmLabel="Удалить" onConfirm={async () => { await api(`/api/v1/rules/${del!.rule_id}`, { method: "DELETE" }); q.reload() }} />
    </div>
  )
}

function RuleDialog({ siteId, kinds, onClose, onDone }: { siteId: string; kinds: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState("continuous_flow")
  const [params, setParams] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.continuous_flow.map((f) => [f.key, f.def])))
  const [severity, setSeverity] = useState("warning")
  const [notify, setNotify] = useState(true)
  const [repeat, setRepeat] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string } | null>(null)
  return (
    <Dialog
      open
      onClose={onClose}
      title="Новое правило"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true); setError(null)
            try {
              await api("/api/v1/rules", { body: { kind, siteId, params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, FIELDS[kind].find((f) => f.key === k)?.resource ? v : v.replace(",", ".")])), severity, notify, repeatMinutes: repeat || null } })
              onDone(); onClose()
            } catch (e) { setError(e as Error) } finally { setBusy(false) }
          }}>Создать</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Условие" className="sm:col-span-2">
          <Select value={kind} onChange={(e) => { setKind(e.target.value); setParams(Object.fromEntries(FIELDS[e.target.value].map((f) => [f.key, f.def]))) }}>
            {Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        {FIELDS[kind].map((f) => (
          <Field key={f.key} label={f.label}>
            {f.resource ? (
              <Select value={params[f.key]} onChange={(e) => setParams({ ...params, [f.key]: e.target.value })}>
                {(kind === "flow_over" || kind === "continuous_flow" ? ["cold_water", "hot_water"] : ["electricity", "cold_water", "hot_water", "gas", "heat"]).map((r) => <option key={r} value={r}>{({ electricity: "Электроэнергия", cold_water: "Холодная вода", hot_water: "Горячая вода", gas: "Газ", heat: "Тепло" } as Record<string, string>)[r]}</option>)}
              </Select>
            ) : (
              <Input inputMode="decimal" value={params[f.key] ?? ""} onChange={(e) => setParams({ ...params, [f.key]: e.target.value })} />
            )}
          </Field>
        ))}
        <Field label="Важность">
          <Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="info">Информация</option>
            <option value="warning">Предупреждение</option>
            <option value="critical">Авария</option>
          </Select>
        </Field>
        <Field label="Повторять письмо, мин" hint="Пусто — одно письмо до закрытия события">
          <Input inputMode="numeric" value={repeat} onChange={(e) => setRepeat(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <div className="sm:col-span-2"><Checkbox checked={notify} onChange={setNotify} label="Отправлять уведомления" hint="Иначе событие видно только в приложении" /></div>
        <div className="sm:col-span-2"><ErrorBox error={error} /></div>
      </div>
    </Dialog>
  )
}
