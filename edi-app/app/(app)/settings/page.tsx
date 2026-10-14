"use client"

import { Trash2 } from "lucide-react"
import { useState } from "react"
import { api, fmtDateTime, useApi } from "@/components/api"
import { UserSelect } from "@/components/pickers"
import { useMe } from "@/components/shell"
import { Badge, Button, Field, IconButton, Input, Select, Spinner, toast } from "@/components/ui"

type Profile = { email: string | null; department: string | null; channels: Array<{ code: string; label: string; available: boolean }>; events: Array<{ code: string; label: string; channels: string[] }> }
type Delegation = { id: string; fromUserId: string; fromName: string; toUserId: string; toName: string; scope: string; startsAt: string; endsAt: string | null; reason: string | null; active: boolean }
const SCOPE: Record<string, string> = { all: "Все задачи", approval: "Согласования", signing: "Подписание" }

export default function SettingsPage() {
  const me = useMe()
  const { data: p, reload } = useApi<Profile>("/api/edi/profile")
  const { data: dl, reload: reloadDl } = useApi<{ delegations: Delegation[] }>("/api/edi/delegations")
  const [email, setEmail] = useState<string | null>(null)
  const [dept, setDept] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<Record<string, string[]> | null>(null)
  const [to, setTo] = useState("")
  const [scope, setScope] = useState("all")
  const [until, setUntil] = useState("")
  const [reason, setReason] = useState("")
  if (!p) return <div className="grid h-40 place-items-center"><Spinner /></div>
  const current = prefs ?? Object.fromEntries(p.events.map((e) => [e.code, e.channels]))
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 sm:p-4">
      <h1 className="text-lg font-bold">Профиль</h1>
      <section className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-3">
        <Field label="ФИО"><div className="flex h-8 items-center text-[13px]">{me.fio}</div></Field>
        <Field label="Email для уведомлений"><Input type="email" value={email ?? p.email ?? ""} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Подразделение"><Input value={dept ?? p.department ?? ""} onChange={(e) => setDept(e.target.value)} /></Field>
        <div className="text-xs text-muted-foreground sm:col-span-3">Роли: {me.roles.map((r) => r.name).join(", ")}. Учётная запись и пароль управляются в SCADA ID / WMS.</div>
      </section>

      <section className="rounded-xl border border-border bg-card p-3">
        <h2 className="mb-2 text-sm font-semibold">Уведомления</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[11px] text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Событие</th>
                {p.channels.map((c) => (
                  <th key={c.code} className="py-1 text-center font-medium">
                    {c.label}
                    {!c.available && <div className="font-normal">не подключено</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.events.map((e) => (
                <tr key={e.code} className="border-t border-border">
                  <td className="py-1.5">{e.label}</td>
                  {p.channels.map((c) => (
                    <td key={c.code} className="text-center">
                      <input
                        type="checkbox"
                        aria-label={`${e.label}: ${c.label}`}
                        disabled={c.code === "inapp" || !c.available}
                        checked={c.code === "inapp" || Boolean(current[e.code]?.includes(c.code))}
                        onChange={(ev) => setPrefs({ ...current, [e.code]: ev.target.checked ? [...(current[e.code] ?? []), c.code] : (current[e.code] ?? []).filter((x) => x !== c.code) })}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex justify-end">
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await api("/api/edi/profile", { method: "POST", json: { email: email ?? undefined, department: dept ?? undefined, notifications: prefs ?? undefined } })
                toast("Сохранено")
                setPrefs(null)
                reload()
              } catch (e) {
                toast((e as Error).message, "error")
              }
            }}
          >
            Сохранить
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-3">
        <h2 className="mb-1 text-sm font-semibold">Замещение (делегирование)</h2>
        <p className="mb-2 text-xs text-muted-foreground">Заместитель видит и выполняет ваши задачи; в истории фиксируется, кто и за кого принял решение.</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_150px_150px_1fr_auto]">
          <UserSelect value={to} onChange={setTo} placeholder="Заместитель" />
          <Select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Что передать">
            {Object.entries(SCOPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} aria-label="До" />
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина (отпуск…)" />
          <Button
            disabled={!to}
            onClick={async () => {
              try {
                await api("/api/edi/delegations", { method: "POST", json: { toUserId: to, scope, endsAt: until ? `${until}T23:59:59` : null, reason } })
                toast("Замещение назначено")
                setTo("")
                reloadDl()
              } catch (e) {
                toast((e as Error).message, "error")
              }
            }}
          >
            Назначить
          </Button>
        </div>
        <div className="mt-2">
          {dl?.delegations.map((d) => (
            <div key={d.id} className="flex items-center gap-2 border-b border-border py-1.5 text-xs last:border-0">
              <span>
                {d.fromName} → <b>{d.toName}</b> · {SCOPE[d.scope]} · с {fmtDateTime(d.startsAt)}
                {d.endsAt ? ` до ${fmtDateTime(d.endsAt)}` : " бессрочно"}
                {d.reason ? ` · ${d.reason}` : ""}
              </span>
              {d.active && <Badge tone="success">действует</Badge>}
              <IconButton label="Отменить" className="ml-auto" onClick={async () => { await api(`/api/edi/delegations?id=${d.id}`, { method: "DELETE" }); reloadDl() }}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-3 text-xs">
        <h2 className="mb-1 text-sm font-semibold">SCADA Mobile и интеграции</h2>
        <p className="text-muted-foreground">
          Отдельного мобильного приложения нет: интерфейс EDI адаптирован под телефон, а SCADA Mobile и внешние системы получают ленту задач через{" "}
          <code className="rounded bg-muted px-1">GET /api/edi/mobile/inbox</code> с персональным токеном WMS (<code className="rounded bg-muted px-1">Authorization: Bearer wmsu_…</code>). Уведомления SCADA приходят в колокольчик WMS при подключённой интеграции.
        </p>
      </section>
    </div>
  )
}
