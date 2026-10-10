"use client"

import { useState } from "react"
import { Mail, Plus, Trash2 } from "lucide-react"
import { api, useApi } from "@/lib/client/api"
import { dateTimeRu, relative } from "@/lib/client/format"
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, Empty, ErrorBox, Field, Input, Panel, Select, Skeleton, useToast } from "@/components/ui"
import { PageHeader, useApp } from "@/components/ems/shell"

type Recipient = { recipient_id: string; email: string; label: string | null; verified_at: string | null; verify_sent_at: string | null; enabled: boolean; paused_until: string | null; kinds: string[]; site_ids: string[] | null; send_hour: number }

export default function NotificationsPage() {
  const { can, sites } = useApp()
  const toast = useToast()
  const q = useApi<{ recipients: Recipient[]; kinds: Record<string, string> }>("/api/v1/recipients")
  const log = useApi<{ items: Array<{ notification_id: string; recipient: string; subject: string; reason: string; status: string; attempts: number; last_error: string | null; sent_at: string | null; created_at: string; link: string | null; next_attempt_at: string }> }>("/api/v1/notifications")
  const [add, setAdd] = useState(false)
  const [edit, setEdit] = useState<Recipient | null>(null)
  const [del, setDel] = useState<Recipient | null>(null)
  const manage = can("notifications.manage")
  const patch = async (r: Recipient, body: Record<string, unknown>) => {
    await api(`/api/v1/recipients/${r.recipient_id}`, { method: "PATCH", body })
    q.reload()
  }
  return (
    <div className="space-y-4">
      <PageHeader title="Уведомления" subtitle="Письма приходят только на подтверждённые адреса. Для каждого адреса — свои типы уведомлений, объекты и время." actions={manage ? <Button onClick={() => setAdd(true)}><Plus /> Адрес</Button> : null} />
      <ErrorBox error={q.error} onRetry={q.reload} />
      <Panel bodyClassName="p-0">
        {!q.data ? (
          <Skeleton className="m-4 h-24" />
        ) : !q.data.recipients.length ? (
          <Empty icon={Mail} title="Адресов нет" text="Добавьте email — придёт письмо для подтверждения." />
        ) : (
          <ul className="divide-y divide-border/60">
            {q.data.recipients.map((r) => {
              const paused = r.paused_until && new Date(r.paused_until) > new Date()
              return (
                <li key={r.recipient_id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {r.email} {r.label ? <span className="text-muted-foreground">· {r.label}</span> : null}{" "}
                      {r.verified_at ? <Badge tone="success">подтверждён</Badge> : <Badge tone="warning">ждёт подтверждения</Badge>} {!r.enabled ? <Badge>выключен</Badge> : null} {paused ? <Badge tone="info">пауза до {dateTimeRu(r.paused_until)}</Badge> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.kinds.map((k) => q.data!.kinds[k] ?? k).join(", ")} · {r.site_ids ? r.site_ids.map((id) => sites.find((s) => s.site_id === id)?.name ?? "—").join(", ") : "все объекты"} · напоминания в {r.send_hour}:00
                    </p>
                  </div>
                  {manage ? (
                    <div className="flex flex-wrap gap-1">
                      {!r.verified_at ? <Button variant="outline" size="sm" onClick={async () => { try { await api(`/api/v1/recipients/${r.recipient_id}/resend`, { body: {} }); toast("Письмо отправлено повторно") } catch (e) { toast((e as Error).message, "error") } }}>Отправить повторно</Button> : null}
                      <Button variant="outline" size="sm" onClick={() => setEdit(r)}>Настроить</Button>
                      {paused ? (
                        <Button variant="ghost" size="sm" onClick={() => patch(r, { pausedUntil: null })}>Снять паузу</Button>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => patch(r, { pausedUntil: new Date(Date.now() + 7 * 86400000).toISOString() })}>Пауза 7 дней</Button>
                      )}
                      <Button variant="ghost" size="icon-sm" aria-label="Удалить адрес" onClick={() => setDel(r)}><Trash2 /></Button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
      <Panel title="Журнал уведомлений" subtitle="Причина, получатель, время и статус доставки" bodyClassName="p-0">
        {!log.data ? (
          <Skeleton className="m-4 h-24" />
        ) : !log.data.items.length ? (
          <p className="p-4 text-[13px] text-muted-foreground">Уведомлений ещё не было.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="ems-table">
              <thead><tr><th>Письмо</th><th className="hidden md:table-cell">Получатель</th><th>Статус</th><th className="hidden sm:table-cell">Время</th></tr></thead>
              <tbody>
                {log.data.items.map((n) => (
                  <tr key={n.notification_id}>
                    <td><p className="font-medium">{n.subject}</p><p className="text-xs text-muted-foreground">{n.reason}{n.link ? <> · <a href={n.link} className="underline">объект</a></> : null}</p></td>
                    <td className="hidden text-[13px] md:table-cell">{n.recipient}</td>
                    <td>
                      <Badge tone={n.status === "sent" ? "success" : n.status === "failed" ? "danger" : n.status === "skipped" ? "neutral" : "info"}>{n.status === "sent" ? "доставлено" : n.status === "failed" ? `ошибка (${n.attempts})` : n.status === "skipped" ? "пропущено" : n.status === "sending" ? "отправка" : "в очереди"}</Badge>
                      {n.last_error ? <p className="mt-0.5 max-w-xs text-[11px] text-muted-foreground">{n.last_error}</p> : null}
                      {n.status === "queued" && new Date(n.next_attempt_at) > new Date() ? <p className="text-[11px] text-muted-foreground">отправка {dateTimeRu(n.next_attempt_at)}</p> : null}
                    </td>
                    <td className="hidden text-xs text-muted-foreground sm:table-cell">{n.sent_at ? dateTimeRu(n.sent_at) : relative(n.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {add ? <RecipientDialog kinds={q.data?.kinds ?? {}} onClose={() => setAdd(false)} onDone={() => { q.reload(); toast("Письмо для подтверждения отправлено") }} /> : null}
      {edit ? <RecipientDialog kinds={q.data?.kinds ?? {}} initial={edit} onClose={() => setEdit(null)} onDone={() => { q.reload(); toast("Сохранено") }} /> : null}
      <ConfirmDialog open={Boolean(del)} onClose={() => setDel(null)} title="Удалить адрес?" text={`Письма на ${del?.email} больше не будут отправляться.`} confirmLabel="Удалить" onConfirm={async () => { await api(`/api/v1/recipients/${del!.recipient_id}`, { method: "DELETE" }); q.reload() }} />
    </div>
  )
}

function RecipientDialog({ kinds, initial, onClose, onDone }: { kinds: Record<string, string>; initial?: Recipient; onClose: () => void; onDone: () => void }) {
  const { sites } = useApp()
  const [email, setEmail] = useState(initial?.email ?? "")
  const [label, setLabel] = useState(initial?.label ?? "")
  const [sel, setSel] = useState<string[]>(initial?.kinds ?? Object.keys(kinds))
  const [siteIds, setSiteIds] = useState<string[]>(initial?.site_ids ?? [])
  const [hour, setHour] = useState(String(initial?.send_hour ?? 9))
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string } | null>(null)
  return (
    <Dialog open onClose={onClose} title={initial ? `Настройки: ${initial.email}` : "Новый адрес"}
      footer={<><Button variant="outline" onClick={onClose}>Отмена</Button><Button loading={busy} disabled={!email || !sel.length} onClick={async () => {
        setBusy(true); setError(null)
        try {
          const body = { label: label || null, kinds: sel, siteIds: siteIds.length ? siteIds : null, sendHour: hour, enabled }
          if (initial) await api(`/api/v1/recipients/${initial.recipient_id}`, { method: "PATCH", body })
          else await api("/api/v1/recipients", { body: { ...body, email } })
          onDone(); onClose()
        } catch (e) { setError(e as Error) } finally { setBusy(false) }
      }}>Сохранить</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email"><Input type="email" value={email} disabled={Boolean(initial)} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Подпись"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Бухгалтерия" /></Field>
        <Field label="Какие уведомления" className="sm:col-span-2">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {Object.entries(kinds).map(([k, v]) => <Checkbox key={k} checked={sel.includes(k)} onChange={(c) => setSel(c ? [...sel, k] : sel.filter((x) => x !== k))} label={v} />)}
          </div>
        </Field>
        {sites.length > 1 ? (
          <Field label="Объекты" hint="Ничего не выбрано — все объекты" className="sm:col-span-2">
            <div className="flex flex-wrap gap-3">
              {sites.map((s) => <Checkbox key={s.site_id} checked={siteIds.includes(s.site_id)} onChange={(c) => setSiteIds(c ? [...siteIds, s.site_id] : siteIds.filter((x) => x !== s.site_id))} label={s.name} />)}
            </div>
          </Field>
        ) : null}
        <Field label="Час отправки напоминаний" hint="Аварии приходят сразу">
          <Select value={hour} onChange={(e) => setHour(e.target.value)}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
          </Select>
        </Field>
        {initial ? <div className="self-end"><Checkbox checked={enabled} onChange={setEnabled} label="Адрес включён" /></div> : null}
        <div className="sm:col-span-2"><ErrorBox error={error} /></div>
      </div>
    </Dialog>
  )
}
