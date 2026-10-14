"use client"

import { useState } from "react"
import { api } from "./api"
import { Button, ErrorLine, Field, Input, Modal, Select, Textarea } from "./ui"

export type CounterpartyDraft = {
  name: string
  shortName?: string
  inn?: string
  kpp?: string
  ogrn?: string
  addressLegal?: string
  addressActual?: string
  phone?: string
  email?: string
  contactPerson?: string
  bankName?: string
  bankBik?: string
  bankAccount?: string
  corrAccount?: string
  roles?: string[]
  status?: string
  note?: string
}

const ROLE_LABEL: Record<string, string> = { supplier: "Поставщик", customer: "Покупатель", carrier: "Перевозчик", service: "Исполнитель услуг" }

export function CounterpartyFields({ v, set, full }: { v: CounterpartyDraft; set: (p: Partial<CounterpartyDraft>) => void; full?: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-6">
      <Field label="Наименование" required className="sm:col-span-4"><Input value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder='ООО "Ромашка"' /></Field>
      <Field label="Краткое" className="sm:col-span-2"><Input value={v.shortName ?? ""} onChange={(e) => set({ shortName: e.target.value })} /></Field>
      <Field label="ИНН" className="sm:col-span-2"><Input inputMode="numeric" value={v.inn ?? ""} onChange={(e) => set({ inn: e.target.value.replace(/\D/g, "").slice(0, 12) })} /></Field>
      <Field label="КПП" className="sm:col-span-2"><Input value={v.kpp ?? ""} onChange={(e) => set({ kpp: e.target.value.toUpperCase().slice(0, 9) })} disabled={(v.inn ?? "").length === 12} /></Field>
      <Field label="ОГРН / ОГРНИП" className="sm:col-span-2"><Input inputMode="numeric" value={v.ogrn ?? ""} onChange={(e) => set({ ogrn: e.target.value.replace(/\D/g, "").slice(0, 15) })} /></Field>
      <Field label="Юридический адрес" className="sm:col-span-6"><Input value={v.addressLegal ?? ""} onChange={(e) => set({ addressLegal: e.target.value })} /></Field>
      {full && <Field label="Фактический адрес" className="sm:col-span-6"><Input value={v.addressActual ?? ""} onChange={(e) => set({ addressActual: e.target.value })} /></Field>}
      <Field label="Банк" className="sm:col-span-3"><Input value={v.bankName ?? ""} onChange={(e) => set({ bankName: e.target.value })} /></Field>
      <Field label="БИК" className="sm:col-span-3"><Input inputMode="numeric" value={v.bankBik ?? ""} onChange={(e) => set({ bankBik: e.target.value.replace(/\D/g, "").slice(0, 9) })} /></Field>
      <Field label="Расчётный счёт" className="sm:col-span-3"><Input inputMode="numeric" value={v.bankAccount ?? ""} onChange={(e) => set({ bankAccount: e.target.value.replace(/\D/g, "").slice(0, 20) })} /></Field>
      <Field label="Корр. счёт" className="sm:col-span-3"><Input inputMode="numeric" value={v.corrAccount ?? ""} onChange={(e) => set({ corrAccount: e.target.value.replace(/\D/g, "").slice(0, 20) })} /></Field>
      <Field label="Контактное лицо" className="sm:col-span-2"><Input value={v.contactPerson ?? ""} onChange={(e) => set({ contactPerson: e.target.value })} /></Field>
      <Field label="Телефон" className="sm:col-span-2"><Input value={v.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} /></Field>
      <Field label="Email" className="sm:col-span-2"><Input type="email" value={v.email ?? ""} onChange={(e) => set({ email: e.target.value })} /></Field>
      <div className="flex flex-wrap gap-3 sm:col-span-6">
        {Object.entries(ROLE_LABEL).map(([k, label]) => (
          <label key={k} className="flex items-center gap-1.5 text-[13px]">
            <input type="checkbox" checked={(v.roles ?? []).includes(k)} onChange={(e) => set({ roles: e.target.checked ? [...(v.roles ?? []), k] : (v.roles ?? []).filter((r) => r !== k) })} />
            {label}
          </label>
        ))}
      </div>
      {full && (
        <>
          <Field label="Статус сотрудничества" className="sm:col-span-2">
            <Select value={v.status ?? "active"} onChange={(e) => set({ status: e.target.value })}>
              <option value="active">Активный</option>
              <option value="prospect">Потенциальный</option>
              <option value="paused">Приостановлен</option>
              <option value="blocked">Заблокирован</option>
            </Select>
          </Field>
          <Field label="Примечание" className="sm:col-span-4"><Textarea rows={2} value={v.note ?? ""} onChange={(e) => set({ note: e.target.value })} /></Field>
        </>
      )}
    </div>
  )
}

/** Быстрое создание контрагента поверх формы документа: данные документа не теряются. */
export function CounterpartyQuickCreate({ initial, onClose, onCreated }: { initial?: Partial<CounterpartyDraft>; onClose: () => void; onCreated: (cp: { id: string; name: string; inn: string | null }) => void }) {
  const [v, setV] = useState<CounterpartyDraft>({ name: "", roles: [], ...initial })
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    setError("")
    try {
      const r = await api<{ counterparty: { id: string; name: string; inn: string | null } }>("/api/edi/counterparties", { method: "POST", json: v })
      onCreated(r.counterparty)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Новый контрагент" wide onClose={onClose} footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" busy={busy} disabled={!v.name.trim()} onClick={submit}>Создать</Button></>}>
      <CounterpartyFields v={v} set={(p) => setV({ ...v, ...p })} />
      <div className="mt-3"><ErrorLine error={error} /></div>
    </Modal>
  )
}
