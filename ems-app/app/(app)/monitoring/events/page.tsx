"use client"

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import { api, qs, useApi } from "@/lib/client/api"
import { dateTimeRu } from "@/lib/client/format"
import { Badge, Button, ErrorBox, Field, Input, Panel, Segmented, Skeleton, useToast } from "@/components/ui"
import { PageHeader, useApp } from "@/components/ems/shell"
import { CATEGORY_LABEL, EventList, SeverityIcon, type EventRow } from "@/components/ems/events"

type Ev = EventRow & { details: Record<string, unknown>; acknowledged_at: string | null; acknowledged_by: string | null; ack_note: string | null; resolved_at: string | null; notified_at: string | null; deliveries: Array<{ recipient: string; status: string; sent_at: string | null; last_error: string | null }> }

function EventsInner() {
  const { can } = useApp()
  const toast = useToast()
  const initial = useSearchParams().get("event")
  const [status, setStatus] = useState<string>("open")
  const [category, setCategory] = useState<string>("")
  const q = useApi<{ events: Ev[] }>(`/api/v1/events${qs({ status: status === "all" ? null : status, category: category || null })}`)
  const [selected, setSelected] = useState<string | null>(initial)
  const [note, setNote] = useState("")
  const ev = q.data?.events.find((e) => e.event_id === selected) ?? null
  const act = async (action: "ack" | "resolve") => {
    await api(`/api/v1/events/${ev!.event_id}/${action}`, { body: { note: note || null } })
    setNote("")
    toast(action === "ack" ? "Событие подтверждено" : "Событие закрыто")
    q.reload()
  }
  return (
    <div className="space-y-4">
      <PageHeader title="События" subtitle="Аварии, перерасход, потеря связи и качество данных. Повторы одного события объединяются." />
      <div className="flex flex-wrap gap-2">
        <Segmented value={status} onChange={setStatus} options={[{ value: "open", label: "Открытые" }, { value: "acknowledged", label: "Подтверждённые" }, { value: "resolved", label: "Закрытые" }, { value: "all", label: "Все" }]} />
        <select aria-label="Категория" className="ems-input h-8 w-auto text-[13px]" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Все категории</option>
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <ErrorBox error={q.error} onRetry={q.reload} />
      <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
        <Panel bodyClassName="p-0">{!q.data ? <Skeleton className="m-4 h-40" /> : <EventList events={q.data.events} onSelect={(e) => setSelected(e.event_id)} selected={selected} />}</Panel>
        <Panel title="Подробности" className="lg:sticky lg:top-20 lg:self-start">
          {!ev ? (
            <p className="text-[13px] text-muted-foreground">Выберите событие.</p>
          ) : (
            <div className="space-y-3 text-[13px]">
              <div className="flex items-start gap-2">
                <SeverityIcon severity={ev.severity} status={ev.status} />
                <div>
                  <p className="font-semibold">{ev.title}</p>
                  <p className="text-muted-foreground">{ev.message}</p>
                </div>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Категория</dt>
                <dd>{CATEGORY_LABEL[ev.category]}</dd>
                <dt className="text-muted-foreground">Важность</dt>
                <dd><Badge tone={ev.severity === "critical" ? "danger" : ev.severity === "warning" ? "warning" : "neutral"}>{ev.severity === "critical" ? "авария" : ev.severity === "warning" ? "предупреждение" : "информация"}</Badge></dd>
                <dt className="text-muted-foreground">Открыто</dt>
                <dd>{dateTimeRu(ev.opened_at)}</dd>
                <dt className="text-muted-foreground">Последний раз</dt>
                <dd>{dateTimeRu(ev.last_seen_at)} · повторов {ev.occurrences}</dd>
                {ev.acknowledged_at ? (
                  <>
                    <dt className="text-muted-foreground">Подтвердил</dt>
                    <dd>{ev.acknowledged_by ?? "—"}, {dateTimeRu(ev.acknowledged_at)}{ev.ack_note ? ` — ${ev.ack_note}` : ""}</dd>
                  </>
                ) : null}
                {ev.resolved_at ? (
                  <>
                    <dt className="text-muted-foreground">Закрыто</dt>
                    <dd>{dateTimeRu(ev.resolved_at)}{typeof ev.details.resolution === "string" ? ` — ${ev.details.resolution}` : ""}</dd>
                  </>
                ) : null}
              </dl>
              {ev.deliveries.length ? (
                <div>
                  <p className="mb-1 text-xs font-medium">Уведомления</p>
                  {ev.deliveries.map((d, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      {d.recipient}: {d.status === "sent" ? `доставлено ${dateTimeRu(d.sent_at)}` : d.status === "failed" ? `ошибка — ${d.last_error}` : d.status === "skipped" ? `пропущено — ${d.last_error}` : "в очереди"}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{ev.category === "data_quality" ? "События качества данных показываются только в приложении." : "Писем по событию не было (нет подписанных адресов или уведомления отключены в правиле)."}</p>
              )}
              {can("events.ack") && ev.status !== "resolved" ? (
                <div className="space-y-2 border-t border-border/60 pt-3">
                  <Field label="Комментарий">
                    <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Проверили, кран закрыт" />
                  </Field>
                  <div className="flex gap-2">
                    {ev.status === "open" ? (
                      <Button size="sm" variant="outline" onClick={() => act("ack")}>
                        Подтвердить
                      </Button>
                    ) : null}
                    <Button size="sm" onClick={() => act("resolve")}>
                      Закрыть
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Подтверждённое событие не присылает повторных писем. Если условие сохранится после закрытия — откроется новое событие.</p>
                </div>
              ) : null}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

export default function EventsPage() {
  return (
    <Suspense fallback={null}>
      <EventsInner />
    </Suspense>
  )
}
