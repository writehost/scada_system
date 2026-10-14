"use client"

import { Pencil, Plus, RefreshCw, Search } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useState } from "react"
import { api, fmtDate, fmtMoney, relTime, useApi, useDebounced } from "@/components/api"
import { CounterpartyFields, CounterpartyQuickCreate, type CounterpartyDraft } from "@/components/counterparty-form"
import { can, useMe } from "@/components/shell"
import { Badge, Button, cn, ErrorLine, Input, Modal, Spinner, STATUS_TONE, toast } from "@/components/ui"
import { docType, STATUS_LABEL } from "@/lib/edi/doc-types.ts"

type Row = { id: string; name: string; shortName: string | null; inn: string | null; kpp: string | null; status: string; roles: string[]; wmsSupplierCode: string | null; edoIds: unknown[]; documentCount: number; lastDocumentAt: string | null }
const CP_STATUS: Record<string, string> = { active: "Активный", prospect: "Потенциальный", paused: "Приостановлен", blocked: "Заблокирован" }
const ROLE: Record<string, string> = { supplier: "Поставщик", customer: "Покупатель", carrier: "Перевозчик", service: "Услуги" }

function Counterparties() {
  const me = useMe()
  const sp = useSearchParams()
  const router = useRouter()
  const selected = sp.get("id")
  const [q, setQ] = useState("")
  const dq = useDebounced(q, 200)
  const { data, reload } = useApi<{ rows: Row[]; total: number }>(`/api/edi/counterparties?q=${encodeURIComponent(dq)}&limit=200`, [dq])
  const [creating, setCreating] = useState(false)
  const [syncing, setSyncing] = useState(false)
  return (
    <div className="flex h-full min-h-0">
      <section className={cn("flex min-w-0 flex-col border-r border-border bg-card", selected ? "hidden w-[420px] lg:flex" : "flex-1 lg:max-w-[520px]")}>
        <div className="flex items-center gap-1.5 border-b border-border p-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted-foreground" />
            <Input className="pl-7" placeholder="Название или ИНН" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск контрагентов" />
          </div>
          {can(me, "edi.counterparty.write") && me.plan.features.integrations && (
            <Button
              size="sm"
              busy={syncing}
              title="Связать с поставщиками WMS по ИНН"
              icon={<RefreshCw className="size-3.5" />}
              onClick={async () => {
                setSyncing(true)
                try {
                  const r = await api<{ total: number; linked: number; created: number; skipped: number }>("/api/edi/counterparties/wms-sync", { method: "POST" })
                  toast(`WMS: поставщиков ${r.total}, связано ${r.linked}, создано ${r.created}${r.skipped ? `, без корректного ИНН ${r.skipped}` : ""}`)
                  reload()
                } catch (e) {
                  toast((e as Error).message, "error")
                } finally {
                  setSyncing(false)
                }
              }}
            >
              WMS
            </Button>
          )}
          {can(me, "edi.counterparty.write") && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>Новый</Button>}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {!data && <div className="grid h-24 place-items-center"><Spinner /></div>}
          {data?.rows.map((c) => (
            <button key={c.id} onClick={() => router.replace(`/counterparties?id=${c.id}`)} className={cn("block w-full border-b border-border px-3 py-2 text-left", selected === c.id ? "bg-row-active" : "hover:bg-row-hover")}>
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-medium">{c.shortName || c.name}</span>
                {c.status !== "active" && <Badge tone={c.status === "blocked" ? "danger" : "neutral"}>{CP_STATUS[c.status]}</Badge>}
                {c.wmsSupplierCode && <Badge title="Связан с поставщиком WMS">WMS</Badge>}
                <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{c.documentCount} док.</span>
              </div>
              <div className="text-[11px] text-muted-foreground">ИНН {c.inn ?? "—"}{c.kpp ? ` · КПП ${c.kpp}` : ""}{c.roles.length ? ` · ${c.roles.map((r) => ROLE[r]).join(", ")}` : ""}{c.lastDocumentAt ? ` · ${relTime(c.lastDocumentAt)}` : ""}</div>
            </button>
          ))}
          {data && !data.rows.length && <p className="p-6 text-center text-[13px] text-muted-foreground">{dq ? "Не найдено" : "Контрагентов пока нет. Создайте или подтяните поставщиков из WMS."}</p>}
        </div>
      </section>
      {selected && (
        <section className="min-w-0 flex-1 overflow-auto">
          <Card id={selected} onBack={() => router.replace("/counterparties")} onChanged={reload} />
        </section>
      )}
      {creating && <CounterpartyQuickCreate onClose={() => setCreating(false)} onCreated={(c) => { setCreating(false); reload(); router.replace(`/counterparties?id=${c.id}`) }} />}
    </div>
  )
}

function Card({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const me = useMe()
  const { data, reload } = useApi<any>(`/api/edi/counterparties/${id}`, [id])
  const [edit, setEdit] = useState<CounterpartyDraft | null>(null)
  const [err, setErr] = useState("")
  if (!data) return <div className="grid h-40 place-items-center"><Spinner /></div>
  const c = data.counterparty
  const s = data.stats
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 sm:p-4">
      <Button size="sm" variant="ghost" className="lg:hidden" onClick={onBack}>← Список</Button>
      <header className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold">{c.name}</h1>
          <div className="text-xs text-muted-foreground">ИНН {c.inn ?? "—"}{c.kpp ? ` · КПП ${c.kpp}` : ""}{c.ogrn ? ` · ОГРН ${c.ogrn}` : ""}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge tone={c.status === "active" ? "success" : c.status === "blocked" ? "danger" : "neutral"}>{CP_STATUS[c.status]}</Badge>
            {c.roles.map((r: string) => <Badge key={r}>{ROLE[r]}</Badge>)}
            {c.wmsSupplierCode && <Badge title="Явное сопоставление со справочником поставщиков WMS">Поставщик WMS {c.wmsSupplierCode}</Badge>}
            {data.itemMappings > 0 && <Badge tone="info">сопоставлений номенклатуры: {data.itemMappings}</Badge>}
          </div>
        </div>
        <div className="flex gap-1.5">
          <Link href={`/documents?counterpartyId=${id}`}><Button size="sm">Все документы</Button></Link>
          {can(me, "edi.doc.create") && <Link href="/documents/new"><Button size="sm" variant="primary">Новый документ</Button></Link>}
          {can(me, "edi.counterparty.write") && <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEdit({ ...c, shortName: c.shortName ?? "", roles: c.roles })}>Изменить</Button>}
        </div>
      </header>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          ["Документов", s.total],
          ["Входящих", s.incoming],
          ["Исходящих", s.outgoing],
          ["Закуплено", fmtMoney(s.purchased)],
          ["Продано", fmtMoney(s.sold)],
        ].map(([l, v]) => (
          <div key={l as string} className="rounded-xl border border-border bg-card px-3 py-2">
            <div className="text-[11px] text-muted-foreground">{l}</div>
            <div className="text-[15px] font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <section className="grid gap-x-6 gap-y-1 rounded-xl border border-border bg-card p-3 text-[13px] sm:grid-cols-2">
        {[
          ["Юридический адрес", c.addressLegal],
          ["Фактический адрес", c.addressActual],
          ["Банк", c.bankName && `${c.bankName}, БИК ${c.bankBik ?? "—"}`],
          ["Расчётный счёт", c.bankAccount],
          ["Корр. счёт", c.corrAccount],
          ["Контакт", [c.contactPerson, c.phone, c.email].filter(Boolean).join(" · ")],
          ["Идентификаторы ЭДО", (c.edoIds ?? []).map((e: { provider: string; boxId: string }) => `${e.provider}: ${e.boxId}`).join(", ")],
          ["Примечание", c.note],
        ]
          .filter(([, v]) => v)
          .map(([l, v]) => (
            <div key={l as string}>
              <span className="text-[11px] text-muted-foreground">{l}: </span>
              {v}
            </div>
          ))}
      </section>
      {data.tasks.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-semibold">Незавершённые задачи · {data.tasks.length}</h2>
          {data.tasks.map((t: any) => (
            <Link key={t.taskId} href={`/documents?id=${t.documentId}`} className="flex justify-between border-b border-border py-1.5 text-xs hover:underline">
              <span>{t.title} — {t.stepName} ({t.assignee})</span>
              <span className="text-muted-foreground">{t.dueAt ? `срок ${fmtDate(t.dueAt)}` : ""}</span>
            </Link>
          ))}
        </section>
      )}
      {data.contracts.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-semibold">Договоры</h2>
          {data.contracts.map((d: any) => (
            <Link key={d.documentId} href={`/documents?id=${d.documentId}`} className="flex justify-between border-b border-border py-1.5 text-xs hover:underline">
              <span>№ {d.number ?? "—"} от {fmtDate(d.docDate)}{d.validTo ? ` · до ${fmtDate(d.validTo)}` : ""}</span>
              <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
            </Link>
          ))}
        </section>
      )}
      <section>
        <h2 className="mb-1 text-sm font-semibold">Документы</h2>
        {data.documents.length === 0 && <p className="text-xs text-muted-foreground">Документов нет.</p>}
        {data.documents.map((d: any) => (
          <Link key={d.documentId} href={`/documents?id=${d.documentId}`} className="flex items-center gap-2 border-b border-border py-1.5 text-xs hover:bg-row-hover">
            <span className="w-24 shrink-0 text-muted-foreground">{docType(d.docType)?.short}</span>
            <span className="min-w-0 flex-1 truncate">№ {d.number ?? "—"} от {fmtDate(d.docDate)}</span>
            <span className="tabular-nums">{d.amountTotal != null ? fmtMoney(d.amountTotal) : ""}</span>
            <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
          </Link>
        ))}
      </section>
      {edit && (
        <Modal
          title="Реквизиты контрагента"
          wide
          onClose={() => setEdit(null)}
          footer={
            <>
              <Button onClick={() => setEdit(null)}>Отмена</Button>
              <Button
                variant="primary"
                onClick={async () => {
                  try {
                    await api(`/api/edi/counterparties/${id}`, { method: "PATCH", json: edit })
                    toast("Сохранено")
                    setEdit(null)
                    reload()
                    onChanged()
                  } catch (e) {
                    setErr((e as Error).message)
                  }
                }}
              >
                Сохранить
              </Button>
            </>
          }
        >
          <CounterpartyFields v={edit} set={(p) => setEdit({ ...edit, ...p })} full />
          <div className="mt-2"><ErrorLine error={err} /></div>
        </Modal>
      )}
    </div>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div className="grid h-40 place-items-center"><Spinner /></div>}>
      <Counterparties />
    </Suspense>
  )
}
