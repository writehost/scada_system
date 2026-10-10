"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { api, qs, useApi } from "@/lib/client/api"
import { SERVICE_LABEL } from "@/lib/client/format"
import { Button, Checkbox, Dialog, ErrorBox, Field, Input, Select, Textarea } from "@/components/ui"
import { useApp } from "@/components/ems/shell"

export type ObligationRow = {
  obligationId: string
  siteId: string | null
  siteName: string | null
  accountId: string | null
  title: string
  service: string
  providerName: string | null
  accountNumber: string | null
  amountMode: string
  amount: number | null
  amountBasis: string | null
  amountPeriod: string | null
  fixedAmount: number | null
  dueDate: string
  readingsDueDate: string | null
  recurrence: { freq: string; interval?: number; day?: number; month?: number }
  remindDays: number
  readingsRemindDays: number
  recipientIds: string[]
  note: string | null
  status: string
  paidAt: string | null
  paidAmount: number | null
}

export function ObligationDialog({ open, onClose, onDone, initial }: { open: boolean; onClose: () => void; onDone: () => void; initial?: ObligationRow | null }) {
  const { siteId, sites } = useApp()
  const accounts = useApi<{ accounts: Array<{ account_id: string; service: string; title: string; provider_name: string | null; account_number: string | null; site_id: string }> }>(open ? "/api/v1/accounts" : null)
  const recipients = useApi<{ recipients: Array<{ recipient_id: string; email: string; verified_at: string | null }> }>(open ? "/api/v1/recipients" : null)
  const blank = () => ({
    title: "",
    service: "electricity",
    siteId: siteId ?? "",
    accountId: "",
    providerName: "",
    accountNumber: "",
    amountMode: "fixed",
    amount: "",
    dueDate: "",
    readingsDueDate: "",
    freq: "monthly",
    interval: "1",
    day: "10",
    month: "1",
    remindDays: "3",
    readingsRemindDays: "2",
    recipientIds: [] as string[],
    note: "",
  })
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string } | null>(null)
  useEffect(() => {
    if (!open) return
    setError(null)
    if (initial) {
      setF({
        title: initial.title,
        service: initial.service,
        siteId: initial.siteId ?? "",
        accountId: initial.accountId ?? "",
        providerName: initial.providerName ?? "",
        accountNumber: initial.accountNumber ?? "",
        amountMode: initial.amountMode,
        amount: initial.fixedAmount != null ? String(initial.fixedAmount) : "",
        dueDate: initial.dueDate,
        readingsDueDate: initial.readingsDueDate ?? "",
        freq: initial.recurrence.freq,
        interval: String(initial.recurrence.interval ?? 1),
        day: String(initial.recurrence.day ?? Number(initial.dueDate.slice(8))),
        month: String(initial.recurrence.month ?? 1),
        remindDays: String(initial.remindDays),
        readingsRemindDays: String(initial.readingsRemindDays),
        recipientIds: initial.recipientIds,
        note: initial.note ?? "",
      })
    } else setF(blank())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const accs = (accounts.data?.accounts ?? []).filter((a) => a.service === f.service && (!f.siteId || a.site_id === f.siteId))
  const recurrence = f.freq === "monthly" ? { freq: "monthly", interval: Number(f.interval), day: Number(f.day) } : f.freq === "yearly" ? { freq: "yearly", month: Number(f.month), day: Number(f.day) } : { freq: "none" }

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const body = {
        title: f.title,
        service: f.service,
        siteId: f.siteId || null,
        accountId: f.accountId || null,
        providerName: f.providerName || null,
        accountNumber: f.accountNumber || null,
        amountMode: f.amountMode,
        amount: f.amountMode === "calculated" ? null : f.amount === "" ? null : f.amount,
        dueDate: f.dueDate,
        readingsDueDate: f.readingsDueDate || null,
        recurrence,
        remindDays: f.remindDays,
        readingsRemindDays: f.readingsRemindDays,
        recipientIds: f.recipientIds,
        note: f.note || null,
      }
      if (initial) await api(`/api/v1/obligations/${initial.obligationId}`, { method: "PATCH", body })
      else await api("/api/v1/obligations", { body })
      onDone()
      onClose()
    } catch (e) {
      setError(e as Error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={initial ? "Изменить платёж" : "Новый платёж"}
      description="Коммунальное обязательство: срок оплаты, срок передачи показаний и напоминания."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={busy} disabled={!f.title.trim() || !f.dueDate} onClick={save}>
            Сохранить
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Название услуги" required>
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Электричество" />
        </Field>
        <Field label="Вид услуги">
          <Select value={f.service} onChange={(e) => setF({ ...f, service: e.target.value, accountId: "" })} disabled={Boolean(initial)}>
            {Object.entries(SERVICE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        {sites.length > 1 && !initial ? (
          <Field label="Объект">
            <Select value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value, accountId: "" })}>
              {sites.map((s) => (
                <option key={s.site_id} value={s.site_id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {!initial ? (
          <Field label="Лицевой счёт SCADA EMS" hint="Нужен для расчёта суммы по показаниям">
            <Select
              value={f.accountId}
              onChange={(e) => {
                const a = accs.find((x) => x.account_id === e.target.value)
                setF({ ...f, accountId: e.target.value, providerName: a?.provider_name ?? f.providerName, accountNumber: a?.account_number ?? f.accountNumber })
              }}
            >
              <option value="">— без привязки —</option>
              {accs.map((a) => (
                <option key={a.account_id} value={a.account_id}>
                  {a.title}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Поставщик">
          <Input value={f.providerName} onChange={(e) => setF({ ...f, providerName: e.target.value })} />
        </Field>
        <Field label="Номер лицевого счёта">
          <Input value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value })} />
        </Field>
        <Field label="Сумма платежа">
          <Select value={f.amountMode} onChange={(e) => setF({ ...f, amountMode: e.target.value })}>
            <option value="fixed">Фиксированная</option>
            <option value="calculated" disabled={!f.accountId && !initial?.accountId}>
              Рассчитывать по показаниям и тарифу
            </option>
            <option value="manual">Введу из квитанции</option>
          </Select>
        </Field>
        {f.amountMode !== "calculated" ? (
          <Field label="Сумма, ₽" hint={f.amountMode === "manual" ? "Можно оставить пустой до получения квитанции" : undefined}>
            <Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
        ) : (
          <p className="self-end text-xs text-muted-foreground">Сумма = стоимость за месяц перед сроком оплаты: по квитанции, если внесена, иначе расчёт или прогноз.</p>
        )}
        <Field label="Оплатить до" required>
          <Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value, day: e.target.value ? String(Number(e.target.value.slice(8))) : f.day })} />
        </Field>
        <Field label="Передать показания до" hint="Отдельное напоминание">
          <Input type="date" value={f.readingsDueDate} max={f.dueDate || undefined} onChange={(e) => setF({ ...f, readingsDueDate: e.target.value })} />
        </Field>
        <Field label="Повторение">
          <Select value={f.freq} onChange={(e) => setF({ ...f, freq: e.target.value })}>
            <option value="monthly">Ежемесячно / раз в N месяцев</option>
            <option value="yearly">Ежегодно</option>
            <option value="none">Однократно</option>
          </Select>
        </Field>
        {f.freq === "monthly" ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Каждые, мес.">
              <Input inputMode="numeric" value={f.interval} onChange={(e) => setF({ ...f, interval: e.target.value.replace(/\D/g, "") })} />
            </Field>
            <Field label="Число месяца">
              <Input inputMode="numeric" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value.replace(/\D/g, "") })} />
            </Field>
          </div>
        ) : f.freq === "yearly" ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Месяц">
              <Input inputMode="numeric" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value.replace(/\D/g, "") })} />
            </Field>
            <Field label="Число">
              <Input inputMode="numeric" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value.replace(/\D/g, "") })} />
            </Field>
          </div>
        ) : (
          <div />
        )}
        <Field label="Напомнить об оплате за, дней">
          <Input inputMode="numeric" value={f.remindDays} onChange={(e) => setF({ ...f, remindDays: e.target.value.replace(/\D/g, "") })} />
        </Field>
        <Field label="Напомнить о показаниях за, дней">
          <Input inputMode="numeric" value={f.readingsRemindDays} onChange={(e) => setF({ ...f, readingsRemindDays: e.target.value.replace(/\D/g, "") })} />
        </Field>
        <Field label="Кому напоминать" className="sm:col-span-2" hint={<>Пусто — всем подписанным на «Сроки оплаты». <Link href="/settings/notifications" className="underline">Адреса для уведомлений</Link></>}>
          <div className="flex flex-wrap gap-3">
            {(recipients.data?.recipients ?? []).map((r) => (
              <Checkbox
                key={r.recipient_id}
                checked={f.recipientIds.includes(r.recipient_id)}
                onChange={(v) => setF({ ...f, recipientIds: v ? [...f.recipientIds, r.recipient_id] : f.recipientIds.filter((x) => x !== r.recipient_id) })}
                label={r.email}
                hint={r.verified_at ? undefined : "не подтверждён"}
              />
            ))}
          </div>
        </Field>
        <Field label="Примечание" className="sm:col-span-2">
          <Textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <ErrorBox error={error} />
        </div>
      </div>
    </Dialog>
  )
}

export function PayDialog({ obligation, onClose, onDone }: { obligation: ObligationRow | null; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState("")
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string } | null>(null)
  useEffect(() => {
    if (obligation) {
      setAmount(obligation.amount != null ? String(obligation.amount) : "")
      setError(null)
    }
  }, [obligation])
  if (!obligation) return null
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Отметить оплату: ${obligation.title}`}
      description="Отметка ставится вами вручную: SCADA EMS не считает платёж оплаченным без подтверждения."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            loading={busy}
            disabled={amount === ""}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await api(`/api/v1/obligations/${obligation.obligationId}/pay`, { body: { amount: amount.replace(",", "."), paidOn, note: note || null } })
                onDone()
                onClose()
              } catch (e) {
                setError(e as Error)
              } finally {
                setBusy(false)
              }
            }}
          >
            Оплачено
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Сумма оплаты, ₽">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label="Дата оплаты">
          <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
        <Field label="Примечание" className="sm:col-span-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Сбербанк Онлайн" />
        </Field>
        {obligation.recurrence.freq !== "none" ? <p className="text-xs text-muted-foreground sm:col-span-2">Следующий платёж серии будет создан автоматически.</p> : null}
        <div className="sm:col-span-2">
          <ErrorBox error={error} />
        </div>
      </div>
    </Dialog>
  )
}

export function useObligations(params: Record<string, string | null>) {
  return useApi<{ today: string; items: ObligationRow[] }>(`/api/v1/obligations${qs(params)}`)
}
