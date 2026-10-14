"use client"

import { AlertTriangle, CheckCircle2, FileUp, Info, Trash2, XCircle } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { api, fmtDate, fmtMoney, fmtQty, relTime, useApi } from "@/components/api"
import { CounterpartyQuickCreate } from "@/components/counterparty-form"
import { CounterpartyPicker, NomenclatureSearch, UserSelect } from "@/components/pickers"
import { useMe } from "@/components/shell"
import { Badge, Button, cn, ErrorLine, Field, IconButton, Input, Select, Spinner, toast } from "@/components/ui"
import { DOC_TYPES, docType } from "@/lib/edi/doc-types.ts"

type Party = { name: string; inn: string | null; kpp: string | null; address: string | null; bankName: string | null; bankBik: string | null; bankAccount: string | null; corrAccount: string | null }
type ImpLine = { lineNo: number; name: string; supplierCode: string | null; gtin: string | null; uomName: string | null; qty: number; price: number | null; vatRate: string | null; amountTotal: number | null; itemCode: string | null; itemName: string | null; matchSource: string | null; candidates: Array<{ itemCode: string; name: string }>; markingCodes: string[] }
type Imp = {
  importId: string
  status: string
  documentId: string | null
  fileId: string | null
  issues: Array<{ level: "error" | "warning" | "info"; code: string; message: string; line?: number }>
  parsed: {
    sourceKind: string
    fileName: string
    docType: string | null
    number: string | null
    date: string | null
    formatVersion: string | null
    function: string | null
    seller: Party | null
    buyer: Party | null
    counterparty: { id: string; name: string } | null
    basis: Array<{ name: string; number: string | null; date: string | null }>
    lines: ImpLine[]
    totals: { amountNet: number | null; vatAmount: number | null; amountTotal: number | null }
    related: Array<{ documentId: string; title: string; reason: string }>
    signatureFileIds: string[]
    previewText: string | null
    wmsAvailable: boolean
  }
}

const MATCH: Record<string, string> = { mapping: "сохранённое соответствие", gtin: "GTIN", alias_sku: "алиас WMS (код)", alias_name: "алиас WMS (название)", item_code: "код WMS" }
const ACCEPT = ".xml,.pdf,.docx,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.tif,.tiff,.zip,.sig,.p7s"

function ImportPage() {
  const me = useMe()
  const sp = useSearchParams()
  const router = useRouter()
  const selected = sp.get("id")
  const { data: list, reload: reloadList } = useApi<{ imports: Array<{ importId: string; status: string; fileName: string; number: string | null; date: string | null; counterpartyName: string | null; issueCount: number; createdAt: string; documentId: string | null; detectedType: string | null }> }>("/api/edi/imports")
  const [uploading, setUploading] = useState(false)
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const upload = async (files: File[]) => {
    if (!files.length) return
    const fd = new FormData()
    files.forEach((f) => fd.append("file", f))
    setUploading(true)
    try {
      const r = await api<{ imports: Array<{ importId: string; status: string; issues: Array<{ message: string }> }> }>("/api/edi/imports", { method: "POST", body: fd })
      const real = r.imports.filter((i) => i.importId)
      toast(`Загружено документов: ${real.length}`)
      r.imports.filter((i) => !i.importId).forEach((i) => toast(i.issues[0]?.message ?? "Файл пропущен", "error"))
      await reloadList()
      if (real[0]) router.replace(`/import?id=${real[0].importId}`)
    } catch (e) {
      toast((e as Error).message, "error")
    } finally {
      setUploading(false)
    }
  }
  const pending = list?.imports.filter((i) => ["parsed", "needs_review"].includes(i.status)) ?? []
  const done = list?.imports.filter((i) => !["parsed", "needs_review"].includes(i.status)).slice(0, 15) ?? []

  return (
    <div className="flex h-full min-h-0">
      <aside className={cn("w-72 shrink-0 flex-col overflow-auto border-r border-border bg-card", selected ? "hidden lg:flex" : "flex w-full lg:w-72")}>
        <div
          className={cn("m-2 grid place-items-center rounded-xl border-2 border-dashed p-4 text-center transition", drag ? "border-ring bg-row-active" : "border-border")}
          onDragOver={(e) => (e.preventDefault(), setDrag(true))}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            void upload([...e.dataTransfer.files])
          }}
        >
          <FileUp className="mb-1 size-6 text-muted-foreground" />
          <p className="text-[13px] font-medium">Перетащите файлы сюда</p>
          <p className="mb-2 text-[11px] text-muted-foreground">XML (УПД, СЧФ), PDF, DOCX, XLSX, CSV, изображения, ZIP с подписями</p>
          <input ref={input} type="file" multiple hidden accept={ACCEPT} onChange={(e) => (void upload([...(e.target.files ?? [])]), (e.target.value = ""))} />
          <Button variant="primary" size="sm" busy={uploading} onClick={() => input.current?.click()}>Выбрать файлы</Button>
        </div>
        {pending.length > 0 && <div className="px-3 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Ждут проверки · {pending.length}</div>}
        {pending.map((i) => (
          <button key={i.importId} onClick={() => router.replace(`/import?id=${i.importId}`)} className={cn("mx-2 rounded-lg px-2 py-1.5 text-left", selected === i.importId ? "bg-row-active" : "hover:bg-muted")}>
            <div className="flex items-center gap-1.5">
              {i.status === "needs_review" ? <AlertTriangle className="size-3.5 shrink-0 text-destructive" /> : <CheckCircle2 className="size-3.5 shrink-0 text-[var(--success)]" />}
              <span className="truncate text-[13px] font-medium">{i.detectedType ? docType(i.detectedType)?.short : "Файл"} {i.number ? `№ ${i.number}` : i.fileName}</span>
            </div>
            <div className="truncate pl-5 text-[11px] text-muted-foreground">{i.counterpartyName ?? i.fileName} · {relTime(i.createdAt)}</div>
          </button>
        ))}
        {done.length > 0 && <div className="px-3 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Обработанные</div>}
        {done.map((i) => (
          <button key={i.importId} onClick={() => (i.documentId ? router.push(`/documents?id=${i.documentId}`) : undefined)} className="mx-2 rounded-lg px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted">
            {i.status === "confirmed" ? "✓" : "✕"} {i.number ? `№ ${i.number}` : i.fileName}
          </button>
        ))}
      </aside>
      <section className={cn("min-w-0 flex-1 overflow-auto", !selected && "hidden lg:block")}>
        {selected ? (
          <Review key={selected} id={selected} canReceipt={me.plan.features.integrations} onDone={() => reloadList()} onBack={() => router.replace("/import")} />
        ) : (
          <div className="grid h-full place-items-center p-6 text-center text-[13px] text-muted-foreground">
            <div className="max-w-sm space-y-2">
              <p>Загрузите УПД или другой документ поставщика.</p>
              <p className="text-xs">Структурированные файлы ФНС разбираются автоматически: контрагент по ИНН, строки, сопоставление с номенклатурой WMS. Документ создаётся только после вашей проверки; оригинал хранится без изменений.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function Review({ id, canReceipt, onDone, onBack }: { id: string; canReceipt: boolean; onDone: () => void; onBack: () => void }) {
  const router = useRouter()
  const { data: imp, setData, error, reload } = useApi<Imp>(`/api/edi/imports/${id}`, [id])
  const [busy, setBusy] = useState<string | null>(null)
  const [createCp, setCreateCp] = useState(false)
  const [saveMappings, setSaveMappings] = useState(true)
  const [receipt, setReceipt] = useState(true)
  const [responsible, setResponsible] = useState("")
  const [editLines, setEditLines] = useState<Set<number>>(new Set())
  const patch = useCallback(
    async (edits: Record<string, unknown>) => {
      setBusy("patch")
      try {
        setData(await api<Imp>(`/api/edi/imports/${id}`, { method: "PATCH", json: edits }))
      } catch (e) {
        toast((e as Error).message, "error")
      } finally {
        setBusy(null)
      }
    },
    [id, setData]
  )
  useEffect(() => {
    if (imp?.parsed.docType && !docType(imp.parsed.docType)?.wmsReceipt) setReceipt(false)
  }, [imp?.parsed.docType])

  if (error) return <div className="p-4"><ErrorLine error={error} /></div>
  if (!imp) return <div className="grid h-40 place-items-center"><Spinner /></div>
  const p = imp.parsed
  const type = p.docType ? docType(p.docType) : null
  const done = !["parsed", "needs_review"].includes(imp.status)
  const errors = imp.issues.filter((i) => i.level === "error" && i.code !== "ukd_unsupported")
  const unmatched = p.lines.filter((l) => !l.itemCode).length

  const confirm = async () => {
    setBusy("confirm")
    try {
      const r = await api<{ documentId: string; wmsReceipt: { inboundId?: string; error?: string } | null; mappings: Array<{ wmsAlias: string; error?: string }> }>(`/api/edi/imports/${id}`, {
        method: "POST",
        json: { saveMappings, createWmsReceipt: receipt && Boolean(type?.wmsReceipt), responsibleUserId: responsible || undefined },
      })
      if (r.wmsReceipt?.error) toast(`Документ создан, но заказ в WMS не создан: ${r.wmsReceipt.error}`, "error")
      else toast(r.wmsReceipt?.inboundId ? `Документ создан, заказ на приход ${r.wmsReceipt.inboundId} в WMS` : "Документ создан")
      onDone()
      router.push(`/documents?id=${r.documentId}`)
    } catch (e) {
      toast((e as Error).message, "error")
      reload()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" className="lg:hidden" onClick={onBack}>← Загрузки</Button>
        <h1 className="text-[15px] font-semibold">{p.fileName}</h1>
        {p.formatVersion && <Badge>ФНС {p.formatVersion}{p.function ? ` · ${p.function}` : ""}</Badge>}
        {p.signatureFileIds.length > 0 && <Badge tone="info">подпись: {p.signatureFileIds.length}</Badge>}
        {imp.fileId && <a className="text-xs text-muted-foreground underline" href={`/api/edi/files/${imp.fileId}`}>оригинал</a>}
        {!done && (
          <IconButton label="Отклонить загрузку" className="ml-auto" onClick={async () => { await api(`/api/edi/imports/${id}`, { method: "DELETE" }); toast("Загрузка отклонена"); onDone(); onBack() }}>
            <Trash2 className="size-4" />
          </IconButton>
        )}
      </div>

      {imp.issues.length > 0 && (
        <ul className="space-y-1">
          {imp.issues.map((i, k) => (
            <li key={k} className={cn("flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-xs", i.level === "error" ? "bg-[color-mix(in_oklch,var(--destructive)_10%,transparent)] text-destructive" : i.level === "warning" ? "bg-[color-mix(in_oklch,var(--warning)_14%,transparent)]" : "bg-muted text-muted-foreground")}>
              {i.level === "error" ? <XCircle className="mt-0.5 size-3.5 shrink-0" /> : i.level === "warning" ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> : <Info className="mt-0.5 size-3.5 shrink-0" />}
              {i.message}
            </li>
          ))}
        </ul>
      )}

      <section className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-4">
        <Field label="Тип документа" required>
          <Select value={p.docType ?? ""} disabled={done || p.sourceKind === "fns_upd"} onChange={(e) => void patch({ docType: e.target.value })}>
            <option value="">— выберите —</option>
            {DOC_TYPES.filter((t) => t.directions.includes("incoming")).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="Номер" required><Input defaultValue={p.number ?? ""} disabled={done} onBlur={(e) => e.target.value !== (p.number ?? "") && void patch({ number: e.target.value })} /></Field>
        <Field label="Дата" required><Input type="date" defaultValue={p.date ?? ""} disabled={done} onBlur={(e) => e.target.value !== (p.date ?? "") && void patch({ date: e.target.value })} /></Field>
        <Field label="Сумма"><div className="flex h-8 items-center text-[13px] font-semibold tabular-nums">{fmtMoney(p.totals.amountTotal)}</div></Field>
        <Field label={p.seller ? `Контрагент (продавец: ИНН ${p.seller.inn ?? "—"})` : "Контрагент"} required={type?.hasCounterparty} className="sm:col-span-3">
          <div className="flex gap-2">
            <div className="flex-1"><CounterpartyPicker value={p.counterparty ? { id: p.counterparty.id, name: p.counterparty.name, inn: p.seller?.inn ?? null } : null} onChange={(c) => void patch({ counterpartyId: c?.id ?? null })} allowCreate={false} /></div>
            {!p.counterparty && !done && <Button onClick={() => setCreateCp(true)}>Создать из документа</Button>}
          </div>
        </Field>
        <Field label="Ответственный"><UserSelect value={responsible} onChange={setResponsible} placeholder="я" /></Field>
        {p.basis.length > 0 && <div className="text-xs text-muted-foreground sm:col-span-4">Основание: {p.basis.map((b) => [b.name, b.number && `№ ${b.number}`, b.date && `от ${fmtDate(b.date)}`].filter(Boolean).join(" ")).join("; ")}</div>}
        {p.related.length > 0 && (
          <div className="text-xs sm:col-span-4">
            Найдены связанные: {p.related.map((r) => <a key={r.documentId} className="mr-2 underline" href={`/documents?id=${r.documentId}`} target="_blank" rel="noreferrer">{r.title} ({r.reason})</a>)}
          </div>
        )}
      </section>

      {p.lines.length > 0 && (
        <section className="rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <h2 className="text-[13px] font-semibold">Строки · {p.lines.length}</h2>
            {unmatched > 0 ? <Badge tone="warning">не сопоставлено: {unmatched}</Badge> : <Badge tone="success">все строки сопоставлены с WMS</Badge>}
            {!p.wmsAvailable && <Badge>WMS недоступна — только сохранённые соответствия</Badge>}
            {busy === "patch" && <Spinner className="size-3.5" />}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-xs">
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-medium">№</th>
                  <th className="px-2 py-1.5 font-medium">У поставщика</th>
                  <th className="px-2 py-1.5 text-right font-medium">Кол-во</th>
                  <th className="px-2 py-1.5 text-right font-medium">Сумма</th>
                  <th className="w-[40%] px-2 py-1.5 font-medium">Номенклатура WMS</th>
                </tr>
              </thead>
              <tbody>
                {p.lines.map((l) => (
                  <tr key={l.lineNo} className={cn("border-t border-border align-top", !l.itemCode && "bg-[color-mix(in_oklch,var(--warning)_7%,transparent)]")}>
                    <td className="px-2 py-1.5 text-muted-foreground">{l.lineNo}</td>
                    <td className="px-2 py-1.5">
                      <div className="text-[13px]">{l.name}</div>
                      <div className="text-[11px] text-muted-foreground">{[l.supplierCode && `код ${l.supplierCode}`, l.gtin && `GTIN ${l.gtin}`, l.markingCodes.length ? `КИЗ ${l.markingCodes.length}` : ""].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtQty(l.qty)} {l.uomName}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtMoney(l.amountTotal)}</td>
                    <td className="px-2 py-1.5">
                      {l.itemCode && !editLines.has(l.lineNo) ? (
                        <div className="flex items-start gap-1.5">
                          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[var(--success)]" />
                          <div className="min-w-0 flex-1">
                            <div><span className="font-mono">{l.itemCode}</span> {l.itemName}</div>
                            <div className="text-[11px] text-muted-foreground">{l.matchSource ? MATCH[l.matchSource] ?? l.matchSource : "выбрано вручную — будет сохранено"}</div>
                          </div>
                          {!done && <button className="text-[11px] text-muted-foreground underline" onClick={() => setEditLines((s) => new Set(s).add(l.lineNo))}>изменить</button>}
                        </div>
                      ) : done ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="space-y-1">
                          {l.candidates?.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {l.candidates.map((c) => (
                                <button key={c.itemCode} className="rounded-md border border-border px-1.5 py-0.5 text-left text-[11px] hover:border-ring" onClick={() => void patch({ lines: [{ lineNo: l.lineNo, itemCode: c.itemCode, itemName: c.name }] })}>
                                  {c.name} <span className="font-mono text-muted-foreground">{c.itemCode}</span>
                                </button>
                              ))}
                            </div>
                          )}
                          <NomenclatureSearch
                            autoFocus={editLines.has(l.lineNo)}
                            placeholder="Найти в WMS…"
                            onPick={(it) => {
                              setEditLines((s) => {
                                const n = new Set(s)
                                n.delete(l.lineNo)
                                return n
                              })
                              void patch({ lines: [{ lineNo: l.lineNo, itemCode: it.itemCode, itemName: it.name }] })
                            }}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {p.previewText && (
        <section className="rounded-xl border border-border bg-card p-3">
          <h2 className="mb-1 text-[13px] font-semibold">Текст документа</h2>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{p.previewText}</pre>
        </section>
      )}

      {!done && (
        <section className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-lg">
          <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={saveMappings} onChange={(e) => setSaveMappings(e.target.checked)} /> Запомнить сопоставления для следующих документов</label>
          {type?.wmsReceipt && canReceipt && (
            <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={receipt} disabled={unmatched > 0} onChange={(e) => setReceipt(e.target.checked)} /> Создать заказ на приход в WMS {unmatched > 0 && <span className="text-xs text-muted-foreground">(сопоставьте все строки)</span>}</label>
          )}
          <Button variant="primary" className="ml-auto" busy={busy === "confirm"} disabled={errors.length > 0 || !p.docType || (type?.hasCounterparty && !p.counterparty)} onClick={confirm}>
            Принять документ
          </Button>
        </section>
      )}
      {createCp && p.seller && (
        <CounterpartyQuickCreate
          initial={{ name: p.seller.name, inn: p.seller.inn ?? "", kpp: p.seller.kpp ?? "", addressLegal: p.seller.address ?? "", bankName: p.seller.bankName ?? "", bankBik: p.seller.bankBik ?? "", bankAccount: p.seller.bankAccount ?? "", corrAccount: p.seller.corrAccount ?? "", roles: ["supplier"] }}
          onClose={() => setCreateCp(false)}
          onCreated={(c) => (setCreateCp(false), void patch({ counterpartyId: c.id }))}
        />
      )}
    </div>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div className="grid h-40 place-items-center"><Spinner /></div>}>
      <ImportPage />
    </Suspense>
  )
}
