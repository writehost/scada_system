"use client"

import { ArrowLeft, Eye, EyeOff, FileText, LayoutTemplate, Plus, Trash2 } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { api, fmtMoney, useApi, useHotkeys } from "@/components/api"
import { CounterpartyPicker, NomenclatureSearch, UserSelect } from "@/components/pickers"
import { PrintView, type Org } from "@/components/print-view"
import { useMe } from "@/components/shell"
import { Badge, Button, cn, ErrorLine, Field, IconButton, Input, Select, Spinner, Textarea, toast } from "@/components/ui"
import { CATEGORY_LABEL, DIRECTION_LABEL, DOC_TYPES, docType, isEditableStatus, type DocTypeDef, type FieldDef } from "@/lib/edi/doc-types.ts"
import { computeLine, sumLines, VAT_RATES } from "@/lib/edi/money.ts"

type Template = {
  templateId: string
  code: string
  name: string
  docType: string
  version: number
  system: boolean
  schema: { defaults?: Record<string, unknown>; required?: string[]; body?: string; customFields?: Array<FieldDef & { required?: boolean }> }
  layout: { showLogo?: boolean; signatures?: string[]; header?: string; footer?: string; accent?: string }
  numbering: { prefix?: string; pattern?: string }
}

type LineDraft = { key: string; name: string; itemCode: string | null; supplierCode: string | null; uomName: string; qty: string; price: string; vatRate: string }
type Cp = { id: string; name: string; shortName?: string | null; inn: string | null; kpp?: string | null }

const newLine = (): LineDraft => ({ key: Math.random().toString(36).slice(2), name: "", itemCode: null, supplierCode: null, uomName: "шт", qty: "1", price: "", vatRate: "20%" })

function visible(f: FieldDef, fields: Record<string, unknown>) {
  if (!f.showIf) return true
  return fields[f.showIf.field] === f.showIf.equals || String(fields[f.showIf.field] ?? "") === String(f.showIf.equals)
}

function FieldInput({ f, value, onChange }: { f: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  if (f.type === "textarea") return <Textarea rows={f.key === "body" || f.key === "points" ? 6 : 3} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
  if (f.type === "select") {
    return (
      <Select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    )
  }
  if (f.type === "boolean") return <label className="flex h-8 items-center gap-2 text-[13px]"><input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} /> Да</label>
  if (f.type === "date") return <Input type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
  if (f.type === "number" || f.type === "money") return <Input inputMode="decimal" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
  if (f.type === "user") return <UserSelect value={String(value ?? "")} onChange={onChange} />
  return <Input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
}

function Constructor() {
  const me = useMe()
  const sp = useSearchParams()
  const router = useRouter()
  const editId = sp.get("edit")
  const { data: lib } = useApi<{ templates: Template[]; types: DocTypeDef[]; org: Org | null }>("/api/edi/templates")
  const { data: existing } = useApi<any>(editId ? `/api/edi/documents/${editId}` : null, [editId])

  const [template, setTemplate] = useState<Template | null>(null)
  const [typeCode, setTypeCode] = useState<string>(sp.get("type") ?? "")
  const [direction, setDirection] = useState<string>("")
  const [number, setNumber] = useState("")
  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10))
  const [cp, setCp] = useState<Cp | null>(null)
  const [fields, setFields] = useState<Record<string, unknown>>({})
  const [lines, setLines] = useState<LineDraft[]>([newLine()])
  const [responsible, setResponsible] = useState("")
  const [department, setDepartment] = useState(me.department ?? "")
  const [confidential, setConfidential] = useState(false)
  const [dueDate, setDueDate] = useState("")
  const [basis, setBasis] = useState("")
  const [reason, setReason] = useState("")
  const [preview, setPreview] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const type = typeCode ? docType(typeCode) : null

  useEffect(() => {
    if (!existing) return
    const d = existing.document
    setTypeCode(d.docType)
    setDirection(d.direction)
    setNumber(d.number ?? "")
    setDocDate(d.docDate ?? "")
    setCp(existing.counterparty)
    setFields(d.fields ?? {})
    setResponsible("")
    setDepartment(d.department ?? "")
    setConfidential(d.confidential)
    setDueDate(d.dueDate ?? "")
    setBasis(d.basis ?? "")
    setLines(
      existing.lines.length
        ? existing.lines.map((l: any) => ({ key: String(l.lineNo), name: l.name, itemCode: l.itemCode, supplierCode: l.supplierCode, uomName: l.uomName ?? "шт", qty: String(l.qty), price: l.price != null ? String(l.price) : "", vatRate: l.vatRate ?? "без НДС" }))
        : [newLine()]
    )
  }, [existing])

  const pickTemplate = (t: Template | null, code?: string) => {
    setTemplate(t)
    const tc = t?.docType ?? code ?? ""
    setTypeCode(tc)
    const def = docType(tc)
    setDirection(def?.directions.includes("outgoing") ? "outgoing" : def?.directions[0] ?? "internal")
    setFields({ ...(t?.schema.defaults ?? {}) })
  }

  const computed = useMemo(() => lines.filter((l) => l.name.trim()).map((l) => ({ ...l, ...computeLine({ qty: l.qty, price: l.price, vatRate: l.vatRate }) })), [lines])
  const totals = sumLines(computed)
  const required = new Set([...(type?.fields.filter((f) => f.required).map((f) => f.key) ?? []), ...(template?.schema.required ?? [])])
  const missing = [...required].filter((k) => fields[k] == null || fields[k] === "")
  const allFields: FieldDef[] = [...(type?.fields ?? []), ...(template?.schema.customFields ?? [])]

  const payload = () => ({
    docType: typeCode,
    direction,
    number: number.trim() || null,
    docDate,
    counterpartyId: cp?.id ?? null,
    fields,
    lines: type?.hasLines
      ? computed.map((l) => ({ name: l.name, itemCode: l.itemCode, supplierCode: l.supplierCode, uomName: l.uomName, qty: l.qty, price: l.price, vatRate: l.vatRate }))
      : undefined,
    responsibleUserId: responsible || undefined,
    department: department || null,
    confidential,
    dueDate: dueDate || null,
    basis: basis || null,
    templateId: template?.templateId,
  })

  const save = useCallback(
    async (then?: "workflow" | "print") => {
      if (!type) return
      setBusy(then ?? "save")
      setError(null)
      try {
        let id = editId
        if (editId) {
          const { docType: _t, direction: _d, templateId: _tpl, responsibleUserId, ...patch } = payload()
          await api(`/api/edi/documents/${editId}`, { method: "PATCH", json: { ...patch, ...(responsibleUserId ? { responsibleUserId } : {}), reason: reason || undefined } })
        } else {
          const r = await api<{ document: { documentId: string } }>("/api/edi/documents", { method: "POST", json: payload() })
          id = r.document.documentId
        }
        if (then === "workflow") {
          await api(`/api/edi/documents/${id}/action`, { method: "POST", json: { action: "start_workflow" } })
          toast("Документ отправлен на согласование")
        } else toast("Сохранено")
        if (then === "print") window.open(`/documents/${id}/print`, "_blank")
        router.push(`/documents?id=${id}`)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [type, editId, typeCode, direction, number, docDate, cp, fields, computed, responsible, department, confidential, dueDate, basis, template, reason]
  )
  useHotkeys({ "mod+s": () => void save(), "mod+Enter": () => void save("workflow") }, Boolean(type))

  if (!lib || (editId && !existing)) return <div className="grid h-40 place-items-center"><Spinner /></div>
  const editingLocked = existing && !isEditableStatus(existing.document.status)
  if (editingLocked) {
    return <div className="p-6"><ErrorLine error="Документ в этом статусе не редактируется. Верните его на доработку или создайте корректировочный документ." /></div>
  }

  if (!type) {
    return (
      <div className="mx-auto max-w-5xl space-y-5 p-3 sm:p-5">
        <h1 className="text-lg font-bold">Новый документ</h1>
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><LayoutTemplate className="size-4" /> Шаблоны</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {lib.templates.map((t) => (
              <button key={t.templateId} className="rounded-xl border border-border bg-card p-3 text-left hover:border-ring" onClick={() => pickTemplate(t)}>
                <div className="text-[13px] font-semibold">{t.name}</div>
                <div className="text-xs text-muted-foreground">{docType(t.docType)?.name} · v{t.version}{t.system ? "" : " · свой"}</div>
              </button>
            ))}
          </div>
        </section>
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><FileText className="size-4" /> С нуля по типу</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(CATEGORY_LABEL).map(([cat, label]) => (
              <div key={cat}>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
                <div className="flex flex-wrap gap-1">
                  {DOC_TYPES.filter((t) => t.category === cat).map((t) => (
                    <button key={t.code} className="h-7 rounded-lg border border-border bg-card px-2 text-xs hover:border-ring" onClick={() => pickTemplate(null, t.code)}>{t.name}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    )
  }

  const setLine = (key: string, p: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))
  const previewDoc = { docType: typeCode, direction, number: number || null, docDate, title: "", currency: "RUB", amountNet: totals.amountNet, amountVat: totals.amountVat, amountTotal: type.hasLines ? totals.amountTotal : (fields.totalOverride as number) ?? null, fields: { ...fields, templateBody: template?.schema.body }, basis }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
        <IconButton label="Назад" onClick={() => (editId ? router.push(`/documents?id=${editId}`) : (setTypeCode(""), setTemplate(null)))}><ArrowLeft className="size-4" /></IconButton>
        <div className="min-w-0">
          <div className="text-sm font-semibold">{editId ? "Редактирование" : "Новый"}: {template?.name ?? type.name}</div>
          <div className="text-[11px] text-muted-foreground">{editId ? `версия ${existing.document.currentVersion}${existing.document.status !== "draft" ? " → будет создана новая версия" : ""}` : "черновик сохраняется по Ctrl+S"}</div>
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" icon={preview ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} onClick={() => setPreview((p) => !p)} className="hidden lg:inline-flex">Предпросмотр</Button>
          <Button size="sm" busy={busy === "print"} onClick={() => void save("print")}>Сохранить и печать/PDF</Button>
          <Button size="sm" busy={busy === "save"} onClick={() => void save()}>Сохранить</Button>
          {me.plan.features.workflows && <Button size="sm" variant="primary" busy={busy === "workflow"} disabled={missing.length > 0} title={missing.length ? "Заполните обязательные поля" : "Ctrl+Enter"} onClick={() => void save("workflow")}>Сохранить и на согласование</Button>}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto p-3 sm:p-4">
          <div className="mx-auto max-w-3xl space-y-4">
            <ErrorLine error={error} />
            <section className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-4">
              {type.directions.length > 1 && (
                <Field label="Направление">
                  <Select value={direction} onChange={(e) => setDirection(e.target.value)} disabled={Boolean(editId)}>
                    {type.directions.map((d) => <option key={d} value={d}>{DIRECTION_LABEL[d]}</option>)}
                  </Select>
                </Field>
              )}
              <Field label="Номер" hint={!editId && direction !== "incoming" ? "пусто — присвоится по нумерации" : undefined}>
                <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder={direction === "incoming" ? "номер контрагента" : "авто"} />
              </Field>
              <Field label="Дата" required><Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></Field>
              <Field label="Срок исполнения"><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
              {type.hasCounterparty && (
                <Field label="Контрагент" required={direction !== "internal"} className="sm:col-span-4">
                  <CounterpartyPicker value={cp} onChange={setCp} />
                </Field>
              )}
              <Field label="Ответственный" className="sm:col-span-2"><UserSelect value={responsible} onChange={setResponsible} placeholder={editId ? "без изменений" : "я"} /></Field>
              <Field label="Подразделение"><Input value={department} onChange={(e) => setDepartment(e.target.value)} /></Field>
              <label className="flex items-end gap-2 pb-2 text-[13px]"><input type="checkbox" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} /> Конфиденциально</label>
            </section>

            {allFields.length > 0 && (
              <section className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-2">
                {allFields.filter((f) => visible(f, fields)).map((f) => (
                  <Field key={f.key} label={f.label} required={required.has(f.key)} hint={f.hint} className={f.type === "textarea" ? "sm:col-span-2" : undefined} error={error && required.has(f.key) && missing.includes(f.key) ? "Обязательное поле" : null}>
                    <FieldInput f={f} value={fields[f.key]} onChange={(v) => setFields((x) => ({ ...x, [f.key]: v }))} />
                  </Field>
                ))}
                {!type.fields.some((f) => f.key === "basis") && type.hasCounterparty && (
                  <Field label="Основание" className="sm:col-span-2"><Input value={basis} onChange={(e) => setBasis(e.target.value)} /></Field>
                )}
                {type.hasAmount && !type.hasLines && (
                  <Field label="Сумма"><Input inputMode="decimal" value={String(fields.totalOverride ?? "")} onChange={(e) => setFields((x) => ({ ...x, totalOverride: e.target.value }))} /></Field>
                )}
              </section>
            )}

            {type.hasLines && (
              <section className="rounded-xl border border-border bg-card">
                <div className="flex items-center gap-2 border-b border-border p-2">
                  <h3 className="text-[13px] font-semibold">Табличная часть</h3>
                  <div className="ml-auto w-full max-w-sm">
                    <NomenclatureSearch
                      onPick={(it) =>
                        setLines((ls) => {
                          const blank = ls.find((l) => !l.name.trim())
                          const row = { ...(blank ?? newLine()), name: it.name, itemCode: it.itemCode, supplierCode: it.sku, uomName: it.uomCode === "pcs" || !it.uomCode ? "шт" : it.uomCode }
                          return blank ? ls.map((l) => (l.key === blank.key ? row : l)) : [...ls, row]
                        })
                      }
                    />
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-[13px]">
                    <thead className="text-left text-[11px] text-muted-foreground">
                      <tr>
                        <th className="w-6 px-2 py-1 font-medium">№</th>
                        <th className="px-1 py-1 font-medium">Наименование</th>
                        <th className="w-20 px-1 py-1 font-medium">Кол-во</th>
                        <th className="w-16 px-1 py-1 font-medium">Ед.</th>
                        <th className="w-24 px-1 py-1 font-medium">Цена</th>
                        <th className="w-24 px-1 py-1 font-medium">НДС</th>
                        <th className="w-28 px-1 py-1 text-right font-medium">Сумма</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => {
                        const c = computeLine({ qty: l.qty, price: l.price, vatRate: l.vatRate })
                        return (
                          <tr key={l.key} className="border-t border-border">
                            <td className="px-2 text-muted-foreground">{i + 1}</td>
                            <td className="px-1 py-1">
                              <Input value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value, itemCode: e.target.value === l.name ? l.itemCode : l.itemCode })} placeholder="Наименование" />
                              {l.itemCode && <Badge className="mt-0.5" title="Номенклатура WMS">{l.itemCode}</Badge>}
                            </td>
                            <td className="px-1"><Input inputMode="decimal" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} /></td>
                            <td className="px-1"><Input value={l.uomName} onChange={(e) => setLine(l.key, { uomName: e.target.value })} /></td>
                            <td className="px-1">
                              <Input
                                inputMode="decimal"
                                value={l.price}
                                onChange={(e) => setLine(l.key, { price: e.target.value })}
                                onKeyDown={(e) => e.key === "Enter" && i === lines.length - 1 && (e.preventDefault(), setLines((ls) => [...ls, newLine()]))}
                              />
                            </td>
                            <td className="px-1">
                              <Select value={l.vatRate} onChange={(e) => setLine(l.key, { vatRate: e.target.value })}>
                                {VAT_RATES.map((v) => <option key={v} value={v}>{v}</option>)}
                              </Select>
                            </td>
                            <td className="px-1 text-right tabular-nums">{c.amountTotal != null ? fmtMoney(c.amountTotal) : "—"}</td>
                            <td><IconButton label="Удалить строку" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [newLine()]))}><Trash2 className="size-3.5" /></IconButton></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between border-t border-border p-2">
                  <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setLines((ls) => [...ls, newLine()])}>Строка</Button>
                  <div className="text-right text-[13px]">
                    <span className="text-muted-foreground">Без НДС {fmtMoney(totals.amountNet)} · НДС {fmtMoney(totals.amountVat)} · </span>
                    <b>Итого {fmtMoney(totals.amountTotal)}</b>
                  </div>
                </div>
              </section>
            )}

            {editId && existing.document.status !== "draft" && (
              <Field label="Причина изменения (новая версия)" required><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            )}
            {missing.length > 0 && <p className="text-xs text-muted-foreground">Для согласования заполните: {missing.map((k) => allFields.find((f) => f.key === k)?.label ?? k).join(", ")}</p>}
          </div>
        </div>
        {preview && (
          <aside className="hidden w-[46%] max-w-[820px] shrink-0 overflow-auto border-l border-border bg-muted p-4 lg:block">
            <div className="origin-top scale-[0.85]">
              <PrintView doc={previewDoc} cp={cp ? { name: cp.name, inn: cp.inn, kpp: cp.kpp ?? null } : null} lines={computed.map((l, i) => ({ lineNo: i + 1, name: l.name, uomName: l.uomName, qty: l.qty, price: l.price, vatRate: l.vatRate, vatAmount: l.vatAmount, amountTotal: l.amountTotal }))} org={lib.org} layout={template?.layout} />
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}

export default function NewDocumentPage() {
  return (
    <Suspense fallback={<div className="grid h-40 place-items-center"><Spinner /></div>}>
      <Constructor />
    </Suspense>
  )
}
