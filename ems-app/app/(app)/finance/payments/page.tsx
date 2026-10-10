"use client"

import { useState } from "react"
import { ClipboardList, Pencil, Plus, Undo2, X } from "lucide-react"
import { api } from "@/lib/client/api"
import { BASIS_LABEL, dateRu, monthName, rub, SERVICE_LABEL } from "@/lib/client/format"
import { Button, ConfirmDialog, Empty, ErrorBox, Panel, Segmented, Skeleton, useToast } from "@/components/ui"
import { PageHeader, useApp } from "@/components/ems/shell"
import { ObligationStatusBadge } from "@/components/ems/obligation-status"
import { ObligationDialog, PayDialog, useObligations, type ObligationRow } from "@/components/ems/obligation-form"

type Filter = "open" | "due_soon" | "overdue" | "paid" | "all"

export default function PaymentsPage() {
  const { can } = useApp()
  const toast = useToast()
  const [filter, setFilter] = useState<Filter>("open")
  const q = useObligations({})
  const [edit, setEdit] = useState<ObligationRow | null | undefined>(undefined)
  const [pay, setPay] = useState<ObligationRow | null>(null)
  const [cancel, setCancel] = useState<{ o: ObligationRow; scope: "one" | "series" } | null>(null)
  const [undo, setUndo] = useState<ObligationRow | null>(null)
  const items = (q.data?.items ?? []).filter((o) => (filter === "all" ? true : filter === "open" ? o.status !== "paid" : o.status === filter))
  const count = (s: string) => (q.data?.items ?? []).filter((o) => o.status === s).length
  return (
    <div className="space-y-4">
      <PageHeader title="Платежи" subtitle="Коммунальные обязательства, сроки и история оплат. Подписка SCADA EMS сюда не входит." actions={can("finance.write") ? <Button onClick={() => setEdit(null)}><Plus /> Добавить платёж</Button> : null} />
      <Segmented
        value={filter}
        onChange={setFilter}
        size="default"
        options={[
          { value: "open", label: "К оплате" },
          { value: "due_soon", label: `Скоро срок${count("due_soon") ? ` · ${count("due_soon")}` : ""}` },
          { value: "overdue", label: `Просрочено${count("overdue") ? ` · ${count("overdue")}` : ""}` },
          { value: "paid", label: "Оплачено" },
          { value: "all", label: "Все" },
        ]}
      />
      <ErrorBox error={q.error} onRetry={q.reload} />
      <Panel bodyClassName="p-0">
        {!q.data ? (
          <Skeleton className="m-4 h-32" />
        ) : !items.length ? (
          <Empty icon={ClipboardList} title={filter === "paid" ? "Оплат пока нет" : "Нет платежей"} text="Добавьте коммунальные услуги со сроком оплаты — придёт напоминание, а следующий платёж серии создастся после отметки об оплате." />
        ) : (
          <div className="overflow-x-auto">
            <table className="ems-table">
              <thead>
                <tr>
                  <th>Услуга</th>
                  <th>Срок</th>
                  <th className="text-right">Сумма</th>
                  <th>Статус</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((o) => (
                  <tr key={o.obligationId}>
                    <td>
                      <p className="font-medium">{o.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {SERVICE_LABEL[o.service]}
                        {o.providerName ? ` · ${o.providerName}` : ""}
                        {o.accountNumber ? ` · л/с ${o.accountNumber}` : ""}
                        {o.recurrence.freq === "monthly" ? ` · ${o.recurrence.interval === 1 ? "ежемесячно" : `раз в ${o.recurrence.interval} мес.`}` : o.recurrence.freq === "yearly" ? " · ежегодно" : ""}
                      </p>
                    </td>
                    <td className="whitespace-nowrap text-[13px]">
                      {dateRu(o.dueDate)}
                      {o.readingsDueDate ? <span className="block text-xs text-muted-foreground">показания до {dateRu(o.readingsDueDate, { day: "2-digit", month: "2-digit" })}</span> : null}
                    </td>
                    <td className="ems-num text-right">
                      {o.status === "paid" ? rub(o.paidAmount, 2) : o.amount == null ? <span className="text-xs text-muted-foreground">{o.amountMode === "manual" ? "по квитанции" : "нет тарифа"}</span> : rub(o.amount, 2)}
                      {o.status !== "paid" && o.amountBasis && o.amount != null ? <span className="block text-[11px] text-muted-foreground">{BASIS_LABEL[o.amountBasis] ?? o.amountBasis}{o.amountPeriod ? `, ${monthName(o.amountPeriod).toLowerCase()}` : ""}</span> : null}
                    </td>
                    <td>
                      <ObligationStatusBadge status={o.status} daysLeft={q.data ? Math.round((Date.parse(o.dueDate) - Date.parse(q.data.today)) / 86400000) : undefined} />
                      {o.paidAt ? <span className="block text-[11px] text-muted-foreground">{dateRu(o.paidAt)}</span> : null}
                    </td>
                    <td className="text-right">
                      {can("finance.write") ? (
                        o.status === "paid" ? (
                          <Button variant="ghost" size="sm" onClick={() => setUndo(o)}>
                            <Undo2 /> Отменить отметку
                          </Button>
                        ) : (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" onClick={() => setPay(o)}>
                              Оплачено
                            </Button>
                            <Button variant="ghost" size="icon-sm" aria-label="Изменить" onClick={() => setEdit(o)}>
                              <Pencil />
                            </Button>
                            <Button variant="ghost" size="icon-sm" aria-label="Отменить платёж" onClick={() => setCancel({ o, scope: "one" })}>
                              <X />
                            </Button>
                          </div>
                        )
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <ObligationDialog open={edit !== undefined} initial={edit ?? null} onClose={() => setEdit(undefined)} onDone={() => { q.reload(); toast("Платёж сохранён") }} />
      <PayDialog obligation={pay} onClose={() => setPay(null)} onDone={() => { q.reload(); toast("Оплата отмечена") }} />
      <ConfirmDialog
        open={Boolean(cancel)}
        onClose={() => setCancel(null)}
        title="Отменить платёж?"
        text={
          <div className="space-y-2">
            <p>«{cancel?.o.title}» на {dateRu(cancel?.o.dueDate)} будет отменён, напоминаний не будет.</p>
            {cancel?.o.recurrence.freq !== "none" ? (
              <Segmented value={cancel?.scope ?? "one"} onChange={(s) => cancel && setCancel({ ...cancel, scope: s })} options={[{ value: "one", label: "Только этот" }, { value: "series", label: "И все следующие" }]} />
            ) : null}
          </div>
        }
        confirmLabel="Отменить платёж"
        onConfirm={async () => {
          await api(`/api/v1/obligations/${cancel!.o.obligationId}?scope=${cancel!.scope}`, { method: "DELETE" })
          q.reload()
        }}
      />
      <ConfirmDialog open={Boolean(undo)} onClose={() => setUndo(null)} title="Отменить отметку об оплате?" text="Платёж снова станет ожидающим. Созданный следующий платёж серии останется." confirmLabel="Отменить отметку" destructive={false} onConfirm={async () => { await api(`/api/v1/obligations/${undo!.obligationId}/unpay`, { body: {} }); q.reload() }} />
    </div>
  )
}
