"use client"

import { useState } from "react"
import { Plus, Receipt, Trash2 } from "lucide-react"
import { api, qs, useApi } from "@/lib/client/api"
import { dateRu, monthName, rub, SERVICE_LABEL } from "@/lib/client/format"
import { Badge, Button, ConfirmDialog, Dialog, Empty, ErrorBox, Field, Input, Panel, Select, Skeleton, useToast } from "@/components/ui"
import { NeedSite, PageHeader, useApp } from "@/components/ems/shell"
import { TariffForm, type TariffDraft } from "@/components/ems/tariff-form"
import { describeTariff } from "@/lib/client/tariffs"

type Tariff = { tariffId: string; name: string; validFrom: string; validTo: string | null; config: Record<string, any> }
type Account = { account_id: string; service: string; title: string; provider_name: string | null; account_number: string | null; calc_method: string; budget_month: number | null; tariffs: Tariff[] }

export default function TariffsPage() {
  return <NeedSite>{(siteId) => <Tariffs siteId={siteId} />}</NeedSite>
}

function Tariffs({ siteId }: { siteId: string }) {
  const { can, industrial } = useApp()
  const toast = useToast()
  const q = useApi<{ accounts: Account[] }>(`/api/v1/accounts${qs({ siteId })}`)
  const charges = useApi<{ charges: Array<{ charge_id: string; title: string; period: string; amount: number; note: string | null }> }>(`/api/v1/charges${qs({ siteId })}`)
  const [newAcc, setNewAcc] = useState(false)
  const [tariffFor, setTariffFor] = useState<Account | null>(null)
  const [chargeFor, setChargeFor] = useState<Account | null>(null)
  const [del, setDel] = useState<Tariff | null>(null)
  return (
    <div className="space-y-4">
      <PageHeader title="Тарифы и лицевые счета" subtitle="Цены задаёте вы — из квитанции или договора. История тарифов сохраняется." actions={can("tariffs.write") ? <Button onClick={() => setNewAcc(true)}><Plus /> Услуга</Button> : null} />
      <ErrorBox error={q.error} onRetry={q.reload} />
      {!q.data ? (
        <Skeleton className="h-48" />
      ) : !q.data.accounts.length ? (
        <Panel>
          <Empty icon={Receipt} title="Нет услуг" text="Добавьте услугу (электричество, вода, интернет…), её поставщика и тариф — тогда SCADA EMS посчитает стоимость." />
        </Panel>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {q.data.accounts.map((a) => (
            <Panel
              key={a.account_id}
              title={a.title}
              subtitle={`${SERVICE_LABEL[a.service]}${a.provider_name ? ` · ${a.provider_name}` : ""}${a.account_number ? ` · л/с ${a.account_number}` : ""}`}
              actions={
                <>
                  <Badge>{a.calc_method === "meter" ? "по счётчику" : a.calc_method === "fixed" ? "фиксированно" : "вручную"}</Badge>
                  {can("tariffs.write") ? (
                    <Button size="sm" variant="outline" onClick={() => setTariffFor(a)}>
                      <Plus /> Тариф
                    </Button>
                  ) : null}
                  {can("finance.write") ? (
                    <Button size="sm" variant="ghost" onClick={() => setChargeFor(a)}>
                      Начисление
                    </Button>
                  ) : null}
                </>
              }
              bodyClassName="p-0"
            >
              {a.tariffs.length ? (
                <ul className="divide-y divide-border/60">
                  {[...a.tariffs].reverse().map((t) => (
                    <li key={t.tariffId} className="flex items-start gap-2 px-4 py-2.5 text-[13px]">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {t.name} {t.validTo == null ? <Badge tone="success">действует</Badge> : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          с {dateRu(t.validFrom)}
                          {t.validTo ? ` по ${dateRu(t.validTo)}` : ""} · {describeTariff(t.config)}
                        </p>
                      </div>
                      {can("tariffs.write") ? (
                        <Button variant="ghost" size="icon-sm" aria-label="Удалить тариф" onClick={() => setDel(t)}>
                          <Trash2 />
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-3 text-[13px] text-amber-700">Тариф не указан — стоимость не рассчитывается.</p>
              )}
            </Panel>
          ))}
        </div>
      )}
      {charges.data?.charges.length ? (
        <Panel title="Фактические начисления" subtitle="Суммы из квитанций заменяют расчёт за месяц" bodyClassName="p-0">
          <table className="ems-table">
            <tbody>
              {charges.data.charges.map((c) => (
                <tr key={c.charge_id}>
                  <td>{c.title}</td>
                  <td>{monthName(c.period)}</td>
                  <td className="ems-num text-right">{rub(c.amount, 2)}</td>
                  <td className="hidden text-xs text-muted-foreground sm:table-cell">{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ) : null}
      <AccountDialog open={newAcc} onClose={() => setNewAcc(false)} siteId={siteId} onDone={q.reload} />
      {tariffFor ? <TariffDialog account={tariffFor} industrial={industrial} onClose={() => setTariffFor(null)} onDone={() => { q.reload(); toast("Тариф сохранён") }} /> : null}
      {chargeFor ? <ChargeDialog account={chargeFor} onClose={() => setChargeFor(null)} onDone={() => { charges.reload(); toast("Начисление сохранено") }} /> : null}
      <ConfirmDialog open={Boolean(del)} onClose={() => setDel(null)} title="Удалить тариф?" text={`«${del?.name}» больше не будет участвовать в расчётах за свой период. Прошлые рассчитанные суммы изменятся.`} confirmLabel="Удалить" onConfirm={async () => { await api(`/api/v1/tariffs/${del!.tariffId}`, { method: "DELETE" }); q.reload() }} />
    </div>
  )
}

function AccountDialog({ open, onClose, siteId, onDone }: { open: boolean; onClose: () => void; siteId: string; onDone: () => void }) {
  const [f, setF] = useState({ service: "electricity", calcMethod: "meter", providerName: "", accountNumber: "", title: "", budgetMonth: "" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string } | null>(null)
  const meterable = ["electricity", "cold_water", "hot_water", "wastewater", "gas", "heating"].includes(f.service)
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Новая услуга"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true); setError(null)
            try { await api("/api/v1/accounts", { body: { ...f, siteId, calcMethod: meterable ? f.calcMethod : f.calcMethod === "meter" ? "fixed" : f.calcMethod, title: f.title || null, budgetMonth: f.budgetMonth || null } }); onDone(); onClose() } catch (e) { setError(e as Error) } finally { setBusy(false) }
          }}>Добавить</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Услуга">
          <Select value={f.service} onChange={(e) => setF({ ...f, service: e.target.value, calcMethod: ["internet", "other"].includes(e.target.value) ? "fixed" : "meter" })}>
            {Object.entries(SERVICE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Как считать сумму">
          <Select value={f.calcMethod} onChange={(e) => setF({ ...f, calcMethod: e.target.value })}>
            {meterable ? <option value="meter">По показаниям и тарифу</option> : null}
            <option value="fixed">Фиксированная сумма</option>
            <option value="manual">Ввод вручную из квитанции</option>
          </Select>
        </Field>
        <Field label="Поставщик"><Input value={f.providerName} onChange={(e) => setF({ ...f, providerName: e.target.value })} /></Field>
        <Field label="Лицевой счёт"><Input value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value })} /></Field>
        <Field label="Название" hint="По умолчанию — название услуги"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Бюджет в месяц, ₽" hint="Для предупреждения о превышении"><Input inputMode="decimal" value={f.budgetMonth} onChange={(e) => setF({ ...f, budgetMonth: e.target.value })} /></Field>
        <div className="sm:col-span-2"><ErrorBox error={error} /></div>
      </div>
    </Dialog>
  )
}

function TariffDialog({ account, industrial, onClose, onDone }: { account: Account; industrial: boolean; onClose: () => void; onDone: () => void }) {
  const [draft, setDraft] = useState<TariffDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string } | null>(null)
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`Тариф: ${account.title}`}
      description="Действующий бессрочный тариф автоматически закроется накануне даты начала нового."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button loading={busy} disabled={!draft} onClick={async () => {
            setBusy(true); setError(null)
            try { await api("/api/v1/tariffs", { body: { ...draft, accountId: account.account_id } }); onDone(); onClose() } catch (e) { setError(e as Error) } finally { setBusy(false) }
          }}>Сохранить тариф</Button>
        </>
      }
    >
      <TariffForm service={account.service} industrial={industrial} onChange={setDraft} />
      <div className="mt-3"><ErrorBox error={error} /></div>
    </Dialog>
  )
}

function ChargeDialog({ account, onClose, onDone }: { account: Account; onClose: () => void; onDone: () => void }) {
  const prev = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)
  const [f, setF] = useState({ period: `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-01`, amount: "", note: "по квитанции" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string } | null>(null)
  return (
    <Dialog open onClose={onClose} title={`Начисление: ${account.title}`} description="Сумма из квитанции поставщика. Она заменит расчёт по показаниям за этот месяц."
      footer={<><Button variant="outline" onClick={onClose}>Отмена</Button><Button loading={busy} disabled={!f.amount} onClick={async () => { setBusy(true); setError(null); try { await api("/api/v1/charges", { body: { ...f, accountId: account.account_id } }); onDone(); onClose() } catch (e) { setError(e as Error) } finally { setBusy(false) } }}>Сохранить</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Месяц"><Input type="month" value={f.period.slice(0, 7)} onChange={(e) => setF({ ...f, period: `${e.target.value}-01` })} /></Field>
        <Field label="Сумма, ₽"><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Примечание" className="sm:col-span-2"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <div className="sm:col-span-2"><ErrorBox error={error} /></div>
      </div>
    </Dialog>
  )
}
