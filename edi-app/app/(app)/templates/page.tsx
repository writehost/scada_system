"use client"

import { Plus, Trash2 } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { api, useApi } from "@/components/api"
import { PrintView, type Org } from "@/components/print-view"
import { can, useMe } from "@/components/shell"
import { Badge, Button, cn, ErrorLine, Field, IconButton, Input, Select, Spinner, Textarea, toast } from "@/components/ui"
import { DOC_TYPES, docType, type FieldDef } from "@/lib/edi/doc-types.ts"
import { EDI_ROLES } from "@/lib/edi/permissions.ts"

type Custom = { key: string; label: string; type: FieldDef["type"]; required?: boolean; options?: FieldDef["options"]; showIf?: { field: string; equals: string | boolean } }
type Template = {
  templateId: string
  code: string
  name: string
  docType: string
  version: number
  system: boolean
  allowedRoles: string[]
  schema: { defaults?: Record<string, unknown>; required?: string[]; body?: string; customFields?: Custom[] }
  layout: { showLogo?: boolean; signatures?: string[]; header?: string; footer?: string; accent?: string }
  numbering: { prefix?: string; pattern?: string; reset?: string }
}

const SAMPLE_LINES = [
  { lineNo: 1, name: "Пример позиции 1", uomName: "шт", qty: 10, price: 100, vatRate: "20%", vatAmount: 200, amountTotal: 1200 },
  { lineNo: 2, name: "Пример позиции 2", uomName: "кг", qty: 2.5, price: 400, vatRate: "20%", vatAmount: 200, amountTotal: 1200 },
]

export default function TemplatesPage() {
  const me = useMe()
  const { data, reload } = useApi<{ templates: Template[]; org: Org | null }>("/api/edi/templates")
  const [edit, setEdit] = useState<Template | null>(null)
  const admin = can(me, "edi.template.admin") && me.plan.features.templatesCustom
  if (!data) return <div className="grid h-40 place-items-center"><Spinner /></div>
  if (edit) return <Editor t={edit} org={data.org} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), reload())} />
  return (
    <div className="mx-auto max-w-5xl space-y-3 p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <h1 className="mr-auto text-lg font-bold">Шаблоны документов</h1>
        {admin && (
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit({ templateId: "", code: "", name: "", docType: "memo", version: 0, system: false, allowedRoles: [], schema: { defaults: {}, required: [], customFields: [] }, layout: { showLogo: true, signatures: ["Руководитель"] }, numbering: { prefix: "", pattern: "{prefix}{seq}", reset: "year" } })}>
            Новый шаблон
          </Button>
        )}
      </div>
      {!data.org?.inn && can(me, "edi.admin") && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs">Реквизиты вашей организации для печатных форм не заполнены — <Link className="underline" href="/admin?tab=org">заполнить</Link>.</p>
      )}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.templates.map((t) => (
          <div key={t.templateId} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-semibold">{t.name}</span>
              <Badge>v{t.version}</Badge>
              {t.system && <Badge tone="info">системный</Badge>}
            </div>
            <div className="text-xs text-muted-foreground">{docType(t.docType)?.name} · номер {t.numbering.pattern?.replace("{prefix}", t.numbering.prefix ?? "") ?? "{seq}"}</div>
            <div className="mt-2 flex gap-1.5">
              {can(me, "edi.doc.create") && <Link href={`/documents/new`}><Button size="sm">Создать документ</Button></Link>}
              {admin && <Button size="sm" variant="ghost" onClick={() => setEdit(structuredClone(t))}>{t.system ? "Сделать свой на основе" : "Изменить"}</Button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Editor({ t, org, onClose, onSaved }: { t: Template; org: Org | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Template>(t.system ? { ...t, code: `${t.code}_own`, name: `${t.name} (свой)` } : t)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const type = docType(v.docType)
  const set = (p: Partial<Template>) => setV((x) => ({ ...x, ...p }))
  const setSchema = (p: Partial<Template["schema"]>) => setV((x) => ({ ...x, schema: { ...x.schema, ...p } }))
  const setLayout = (p: Partial<Template["layout"]>) => setV((x) => ({ ...x, layout: { ...x.layout, ...p } }))
  const customs = v.schema.customFields ?? []
  const allFields = [...(type?.fields ?? []), ...customs]
  const numberPreview = useMemo(() => (v.numbering.pattern || "{prefix}{seq}").replace("{prefix}", v.numbering.prefix ?? "").replace("{year}", String(new Date().getFullYear())).replace(/\{seq(?::(\d+))?\}/, (_m, w) => (w ? "1".padStart(Number(w), "0") : "1")), [v.numbering])

  const save = async () => {
    setBusy(true)
    setError("")
    try {
      const r = await api<{ version: number }>("/api/edi/templates", { method: "POST", json: { code: v.code, name: v.name, docType: v.docType, schema: v.schema, layout: v.layout, numbering: v.numbering, allowedRoles: v.allowedRoles } })
      toast(`Шаблон сохранён, версия ${r.version}`)
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 space-y-3 overflow-auto p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <h1 className="mr-auto text-[15px] font-semibold">Конструктор шаблона</h1>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" busy={busy} disabled={!v.code.trim() || !v.name.trim()} onClick={save}>Сохранить версию</Button>
        </div>
        <ErrorLine error={error} />
        <section className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-3">
          <Field label="Название" required><Input value={v.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Код" hint={v.version ? `сохранится как v${v.version + 1}` : "латиница"}><Input value={v.code} disabled={Boolean(v.version && !t.system)} onChange={(e) => set({ code: e.target.value })} /></Field>
          <Field label="Тип документа">
            <Select value={v.docType} onChange={(e) => set({ docType: e.target.value })}>
              {DOC_TYPES.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
            </Select>
          </Field>
        </section>

        <section className="rounded-xl border border-border bg-card p-3">
          <h2 className="mb-2 text-[13px] font-semibold">Поля: значения по умолчанию и обязательность</h2>
          <table className="w-full text-xs">
            <tbody>
              {allFields.map((f) => (
                <tr key={f.key} className="border-b border-border last:border-0">
                  <td className="py-1 pr-2">{f.label}{f.key.startsWith("custom") && <Badge className="ml-1">своё</Badge>}</td>
                  <td className="w-56 py-1 pr-2">
                    {f.type === "select" ? (
                      <Select value={String(v.schema.defaults?.[f.key] ?? "")} onChange={(e) => setSchema({ defaults: { ...v.schema.defaults, [f.key]: e.target.value } })}>
                        <option value="">—</option>
                        {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Select>
                    ) : f.type === "boolean" ? (
                      <input type="checkbox" checked={Boolean(v.schema.defaults?.[f.key])} onChange={(e) => setSchema({ defaults: { ...v.schema.defaults, [f.key]: e.target.checked } })} />
                    ) : f.type === "date" ? (
                      <span className="text-muted-foreground">дата при создании</span>
                    ) : (
                      <Input className="h-7" value={String(v.schema.defaults?.[f.key] ?? "")} onChange={(e) => setSchema({ defaults: { ...v.schema.defaults, [f.key]: e.target.value } })} />
                    )}
                  </td>
                  <td className="w-28 py-1">
                    <label className="flex items-center gap-1">
                      <input type="checkbox" disabled={type?.fields.some((x) => x.key === f.key && x.required)} checked={Boolean(type?.fields.find((x) => x.key === f.key)?.required) || (v.schema.required ?? []).includes(f.key)} onChange={(e) => setSchema({ required: e.target.checked ? [...(v.schema.required ?? []), f.key] : (v.schema.required ?? []).filter((x) => x !== f.key) })} />
                      обязательно
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="space-y-2 rounded-xl border border-border bg-card p-3">
          <div className="flex items-center">
            <h2 className="mr-auto text-[13px] font-semibold">Собственные поля</h2>
            <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setSchema({ customFields: [...customs, { key: `custom${customs.length + 1}`, label: "Новое поле", type: "text" }] })}>Поле</Button>
          </div>
          {customs.map((c, i) => (
            <div key={i} className="grid grid-cols-2 gap-1 sm:grid-cols-[1fr_1fr_120px_1fr_1fr_auto]">
              <Input value={c.label} onChange={(e) => setSchema({ customFields: customs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} aria-label="Подпись поля" />
              <Input value={c.key} onChange={(e) => setSchema({ customFields: customs.map((x, j) => (j === i ? { ...x, key: e.target.value.startsWith("custom") ? e.target.value : `custom${e.target.value}` } : x)) })} aria-label="Ключ поля" />
              <Select value={c.type} onChange={(e) => setSchema({ customFields: customs.map((x, j) => (j === i ? { ...x, type: e.target.value as FieldDef["type"] } : x)) })} aria-label="Тип поля">
                {["text", "textarea", "number", "money", "date", "boolean"].map((ty) => <option key={ty} value={ty}>{ty}</option>)}
              </Select>
              <Select value={c.showIf?.field ?? ""} onChange={(e) => setSchema({ customFields: customs.map((x, j) => (j === i ? { ...x, showIf: e.target.value ? { field: e.target.value, equals: x.showIf?.equals ?? "" } : undefined } : x)) })} aria-label="Показывать если">
                <option value="">показывать всегда</option>
                {allFields.filter((f) => f.key !== c.key).map((f) => <option key={f.key} value={f.key}>если «{f.label}» =</option>)}
              </Select>
              <Input disabled={!c.showIf} value={String(c.showIf?.equals ?? "")} onChange={(e) => setSchema({ customFields: customs.map((x, j) => (j === i && x.showIf ? { ...x, showIf: { ...x.showIf, equals: e.target.value } } : x)) })} aria-label="Значение условия" />
              <IconButton label="Удалить поле" onClick={() => setSchema({ customFields: customs.filter((_, j) => j !== i) })}><Trash2 className="size-3.5" /></IconButton>
            </div>
          ))}
        </section>

        <section className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-3">
          <Field label="Префикс номера"><Input value={v.numbering.prefix ?? ""} onChange={(e) => set({ numbering: { ...v.numbering, prefix: e.target.value } })} /></Field>
          <Field label="Шаблон номера" hint={`{prefix} {year} {seq} {seq:4} → ${numberPreview}`}><Input value={v.numbering.pattern ?? ""} onChange={(e) => set({ numbering: { ...v.numbering, pattern: e.target.value } })} /></Field>
          <Field label="Сброс счётчика">
            <Select value={v.numbering.reset ?? "year"} onChange={(e) => set({ numbering: { ...v.numbering, reset: e.target.value } })}>
              <option value="year">каждый год</option>
              <option value="never">никогда</option>
            </Select>
          </Field>
        </section>

        <section className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={v.layout.showLogo !== false} onChange={(e) => setLayout({ showLogo: e.target.checked })} /> Логотип организации</label>
          <Field label="Цвет линии оформления"><Input type="color" className="h-8 w-16 p-1" value={v.layout.accent ?? "#24300a"} onChange={(e) => setLayout({ accent: e.target.value })} /></Field>
          <Field label="Блоки подписей (через запятую)" className="sm:col-span-2"><Input value={(v.layout.signatures ?? []).join(", ")} onChange={(e) => setLayout({ signatures: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></Field>
          <Field label="Верхний колонтитул"><Textarea rows={2} value={v.layout.header ?? ""} onChange={(e) => setLayout({ header: e.target.value })} /></Field>
          <Field label="Нижний колонтитул"><Textarea rows={2} value={v.layout.footer ?? ""} onChange={(e) => setLayout({ footer: e.target.value })} /></Field>
          <Field label="Текст документа" hint="Подстановки: {{number}}, {{docDate}}, {{counterparty.name}}, {{fields.<ключ>}}, {{org.legalName}}" className="sm:col-span-2">
            <Textarea rows={8} value={v.schema.body ?? ""} onChange={(e) => setSchema({ body: e.target.value })} />
          </Field>
          <Field label="Кто может использовать (пусто — все)" className="sm:col-span-2">
            <div className="flex flex-wrap gap-1">
              {Object.entries(EDI_ROLES).map(([k, r]) => (
                <button key={k} onClick={() => set({ allowedRoles: v.allowedRoles.includes(k) ? v.allowedRoles.filter((x) => x !== k) : [...v.allowedRoles, k] })} className={cn("h-7 rounded-lg border px-2 text-xs", v.allowedRoles.includes(k) ? "border-ring bg-row-active" : "border-border")}>
                  {r.name}
                </button>
              ))}
            </div>
          </Field>
        </section>
        <p className="text-xs text-muted-foreground">Шаблон задаёт поля и печатное представление. Структурированные документы ФНС (УПД, счёт-фактура) формируются по утверждённым схемам независимо от оформления.</p>
      </div>
      <aside className="hidden w-[46%] max-w-[820px] shrink-0 overflow-auto border-l border-border bg-muted p-4 lg:block">
        <div className="origin-top scale-[0.85]">
          <PrintView
            doc={{ docType: v.docType, direction: type?.directions.includes("outgoing") ? "outgoing" : "internal", number: numberPreview, docDate: new Date().toISOString().slice(0, 10), title: v.name, currency: "RUB", amountNet: type?.hasLines ? 2000 : null, amountVat: type?.hasLines ? 400 : null, amountTotal: type?.hasLines ? 2400 : null, fields: { ...v.schema.defaults, templateBody: v.schema.body } }}
            cp={type?.hasCounterparty ? { name: 'ООО "Контрагент"', inn: "7707083893", kpp: "773601001" } : null}
            lines={type?.hasLines ? SAMPLE_LINES : []}
            org={org}
            layout={v.layout}
          />
        </div>
      </aside>
    </div>
  )
}
