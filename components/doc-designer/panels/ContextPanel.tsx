"use client"

import { useState } from "react"
import type { Component, Editor } from "grapesjs"
import { ArrowUpToLine, Copy, Diamond, ImageIcon, Lock, Plus, Repeat, Trash2, Rows3, Columns3 } from "lucide-react"
import { BARCODE_KINDS, isLinearBarcode, type BarcodeKind } from "@/lib/doc-templates/barcode"
import { parseLoopHeader, parseVarExpr, buildVarExpr } from "@/lib/doc-templates/jinja/expressions"
import { ATTR_BRANCH, ATTR_COND, ATTR_FOR, ATTR_IF, ATTR_PREFIX_ATTR, ATTR_RAW, ATTR_VAR, ATTR_WRAP } from "@/lib/doc-templates/jinja/markers"
import { listCollections } from "@/lib/doc-templates/schema"
import { evaluatePreview } from "@/lib/doc-templates/preview-eval"
import { cn } from "@/lib/utils"
import { useDesigner, type DesignerStore } from "../state"
import { DOC_TYPES, contextFor, readBarcodeConfig, readTableConfigPublic, writeBarcodeConfig, writeTableConfig } from "../studio/plugin"
import { labelForExpr, shortLabel } from "../studio/labels"
import { ConditionEditor } from "./ConditionEditor"
import { DataTableEditor } from "./DataTableEditor"
import { Field, NativeSelect, NumberInput, Section, Segmented, SmallButton, TextInput, Toggle, inputClassName } from "./fields"
import { PageSettingsPanel } from "./PageSettingsPanel"
import { VariablePicker } from "./VariablePicker"

const TEXT_PRESETS: { id: string; label: string; style: Record<string, string> }[] = [
  { id: "normal", label: "Обычный", style: { "font-size": "10pt", "font-weight": "400", color: "" } },
  { id: "h1", label: "Заголовок 1", style: { "font-size": "16pt", "font-weight": "700", color: "" } },
  { id: "h2", label: "Заголовок 2", style: { "font-size": "13pt", "font-weight": "700", color: "" } },
  { id: "small", label: "Мелкий", style: { "font-size": "8pt", "font-weight": "400", color: "" } },
  { id: "caption", label: "Подпись", style: { "font-size": "7pt", "font-weight": "400", color: "#64748b" } },
]

const VAR_FORMATS: { value: string; label: string; filter: { name: string; args: string } | null }[] = [
  { value: "", label: "Как есть", filter: null },
  { value: "date", label: "Дата 05.10.2026", filter: { name: "date", args: "" } },
  { value: "date-long", label: "Дата 5 октября 2026", filter: { name: "date", args: '"D MMMM YYYY"' } },
  { value: "number", label: "Число 1 200", filter: { name: "number", args: "" } },
  { value: "money", label: "Сумма 1 200,00", filter: { name: "money", args: "" } },
  { value: "upper", label: "ПРОПИСНЫМИ", filter: { name: "upper", args: "" } },
]

function formatOf(expr: string): string {
  const m = parseVarExpr(expr)
  const f = m?.filters[0]
  if (!f) return ""
  if (f.name === "date") return f.args.includes("MMMM") ? "date-long" : "date"
  return VAR_FORMATS.some((x) => x.value === f.name) ? f.name : ""
}

function isText(c: Component): boolean {
  return c.is("text") || ["p", "h1", "h2", "h3", "span", "li", "td", "th"].includes(String(c.get("tagName")))
}

export function ContextPanel({ editor, store }: { editor: Editor; store: DesignerStore }) {
  useDesigner(store, (s) => s.selectionTick)
  const schema = useDesigner(store, (s) => s.schema)
  const page = useDesigner(store, (s) => s.page)
  const pageCount = useDesigner(store, (s) => s.pageCount)
  const canEditRaw = useDesigner(store, (s) => s.canEditRaw)
  useDesigner(store, (s) => s.sampleData)
  const selected = editor?.getSelected()
  const isWrapper = !selected || selected === editor.getWrapper() || !selected.parent()

  if (!editor) return null
  if (isWrapper) {
    return (
      <div className="doc-ui block h-full overflow-y-auto bg-white text-slate-800">
        <PanelTitle title="Документ" subtitle="Ничего не выбрано — параметры листа" />
        <PageSettingsPanel page={page} designPages={pageCount} onChange={(p) => store.set({ page: p })} />
      </div>
    )
  }
  return (
    <div className="doc-ui block h-full overflow-y-auto bg-white text-slate-800" key={selected.getId()}>
      <ComponentHeader editor={editor} cmp={selected} />
      <ComponentSections editor={editor} cmp={selected} store={store} schemaKey={schema} canEditRaw={canEditRaw} />
    </div>
  )
}

function PanelTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="border-b border-slate-200 px-3.5 py-3">
      <div className="text-[13px] font-semibold text-slate-900">{title}</div>
      {subtitle && <div className="text-[11px] text-slate-400">{subtitle}</div>}
    </div>
  )
}

function ComponentHeader({ editor, cmp }: { editor: Editor; cmp: Component }) {
  const parent = cmp.parent()
  return (
    <div className="flex items-center gap-1 border-b border-slate-200 px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-slate-900">{cmp.getName()}</div>
        {parent && <div className="truncate text-[11px] text-slate-400">в «{parent.getName()}»</div>}
      </div>
      {parent && parent !== editor.getWrapper() && (
        <button type="button" title="Выбрать родителя" onClick={() => editor.select(parent)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <ArrowUpToLine className="size-3.5" />
        </button>
      )}
      <button
        type="button"
        title="Дублировать"
        onClick={() => {
          const coll = cmp.collection
          const clone = cmp.clone()
          coll.add(clone, { at: coll.indexOf(cmp) + 1 })
          editor.select(clone)
        }}
        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        <Copy className="size-3.5" />
      </button>
      <button type="button" title="Удалить" onClick={() => cmp.remove()} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )
}

function ComponentSections({ editor, cmp, store, canEditRaw }: { editor: Editor; cmp: Component; store: DesignerStore; schemaKey: unknown; canEditRaw: boolean }) {
  const type = cmp.get("type")
  const attrs = cmp.getAttributes()
  const { schema } = store.get()
  const outerLoops = contextFor(cmp.parent(), store).loops
  const ownLoops = contextFor(cmp, store).loops

  if (type === DOC_TYPES.variable) return <VariableSection cmp={cmp} store={store} />
  if (type === DOC_TYPES.raw) return <RawSection cmp={cmp} canEdit={canEditRaw} />

  return (
    <>
      {type === DOC_TYPES.table && (
        <DataTableEditor cfg={readTableConfigPublic(cmp)} schema={schema} loops={outerLoops} onChange={(cfg) => writeTableConfig(cmp, cfg)} />
      )}
      {type === DOC_TYPES.barcode && <BarcodeSection cmp={cmp} store={store} />}
      {type === DOC_TYPES.region && <RegionSection cmp={cmp} />}
      {isText(cmp) && type !== DOC_TYPES.table && <TextSection editor={editor} cmp={cmp} store={store} />}
      {cmp.is("image") && <ImageSection editor={editor} cmp={cmp} store={store} />}
      {String(cmp.get("tagName")) === "table" && type !== DOC_TYPES.table && <BasicTableSection cmp={cmp} />}
      {["td", "th", "tr"].includes(String(cmp.get("tagName"))) && <BasicTableSection cmp={cmp.closestType("table") ?? cmp} cell={cmp} />}
      {attrs[ATTR_WRAP] === "if" && !attrs[ATTR_IF] && <IfBranchesSection cmp={cmp} />}
      {attrs[ATTR_BRANCH] && attrs[ATTR_BRANCH] !== "else" && attrs[ATTR_BRANCH] !== "body" && (
        <Section title="Условие варианта">
          <ConditionEditor value={String(attrs[ATTR_COND] ?? "")} schema={schema} loops={outerLoops} onChange={(v) => cmp.addAttributes({ [ATTR_COND]: v })} />
        </Section>
      )}
      {!attrs[ATTR_BRANCH] && !(attrs[ATTR_WRAP] === "if" && !attrs[ATTR_IF]) && type !== DOC_TYPES.region && (
        <DataDirectivesSection cmp={cmp} store={store} outerLoops={outerLoops} ownLoops={ownLoops} />
      )}
    </>
  )
}

function VariableSection({ cmp, store }: { cmp: Component; store: DesignerStore }) {
  const [pick, setPick] = useState(false)
  const expr = String(cmp.getAttributes()[ATTR_VAR] ?? "")
  const { schema, mode } = store.get()
  const { loops, scope } = contextFor(cmp, store)
  const label = labelForExpr(schema, expr, loops)
  const model = parseVarExpr(expr)
  const setExpr = (v: string) => cmp.addAttributes({ [ATTR_VAR]: v })
  return (
    <>
      <Section title="Данные">
        <div className="rounded-md border border-indigo-100 bg-indigo-50/50 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-indigo-500">
            <Diamond className="size-3" /> {label.group || "Переменная"}
          </div>
          <div className="text-[13px] font-medium text-indigo-950">{label.label}</div>
          {mode === "data" && (
            <div className="mt-1 text-[11px] text-slate-500">
              Пример: <span className="text-slate-800">{evaluatePreview(expr, scope).text || "—"}</span>
            </div>
          )}
        </div>
        <SmallButton onClick={() => setPick(true)} className="w-full">
          Выбрать другое поле
        </SmallButton>
        {model && (
          <Field label="Формат">
            <NativeSelect
              value={formatOf(expr)}
              onChange={(v) => {
                const f = VAR_FORMATS.find((x) => x.value === v)
                setExpr(buildVarExpr({ path: model.path, filters: f?.filter ? [f.filter] : [] }))
              }}
              options={VAR_FORMATS.map((f) => ({ value: f.value, label: f.label }))}
            />
          </Field>
        )}
      </Section>
      <Section title="Advanced" defaultOpen={!model}>
        <Field label="Выражение Jinja" hint="Так переменная попадёт в шаблон: {{ … }}">
          <TextInput value={expr} mono onCommit={(v) => v.trim() && setExpr(v.trim())} />
        </Field>
      </Section>
      <VariablePicker
        open={pick}
        onOpenChange={setPick}
        schema={schema}
        loops={loops}
        onPick={(path, item) => {
          const fmt = item.type === "date" ? [{ name: "date", args: "" }] : item.type === "money" ? [{ name: "money", args: "" }] : []
          setExpr(buildVarExpr({ path, filters: fmt }))
        }}
      />
    </>
  )
}

function RawSection({ cmp, canEdit }: { cmp: Component; canEdit: boolean }) {
  const src = String(cmp.getAttributes()[ATTR_RAW] ?? "")
  const [draft, setDraft] = useState(src)
  return (
    <Section title="Advanced Jinja">
      <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] leading-snug text-slate-500">
        Технический блок: фрагмент шаблона, который визуальный редактор не разбирает. Он попадёт в документ без изменений.
      </div>
      <textarea
        className={cn(inputClassName, "h-48 resize-y py-1.5 text-[11.5px]", !canEdit && "bg-slate-50")}
        style={{ fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" }}
        value={draft}
        readOnly={!canEdit}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => canEdit && draft !== src && cmp.addAttributes({ [ATTR_RAW]: draft })}
        onKeyDown={(e) => e.stopPropagation()}
      />
      {!canEdit && (
        <div className="flex items-center gap-1.5 text-[11px] text-amber-700">
          <Lock className="size-3" /> Изменять Jinja-блоки может только администратор
        </div>
      )}
    </Section>
  )
}

function BarcodeSection({ cmp, store }: { cmp: Component; store: DesignerStore }) {
  const [pick, setPick] = useState(false)
  const cfg = readBarcodeConfig(cmp)
  const { schema } = store.get()
  const { loops } = contextFor(cmp, store)
  const set = (patch: Partial<typeof cfg>) => writeBarcodeConfig(cmp, { ...cfg, ...patch })
  return (
    <>
      <Section title="Данные кода">
        <Field label="Значение">
          <button type="button" className={cn(inputClassName, "truncate text-left")} onClick={() => setPick(true)} title={cfg.expr}>
            ◇ {shortLabel(schema, cfg.expr, loops)}
          </button>
        </Field>
        <Field label="Выражение" hint="Можно указать путь или строку в кавычках">
          <TextInput value={cfg.expr} mono onCommit={(expr) => set({ expr })} />
        </Field>
      </Section>
      <Section title="Вид и размер">
        <Field label="Символика">
          <NativeSelect<BarcodeKind> value={cfg.kind} onChange={(kind) => set({ kind })} options={BARCODE_KINDS.map((k) => ({ value: k.id, label: k.label }))} />
        </Field>
        <Field label={isLinearBarcode(cfg.kind) ? "Высота, мм" : "Сторона, мм"}>
          <NumberInput value={cfg.sizeMm} min={5} max={200} suffix="мм" onCommit={(sizeMm) => set({ sizeMm })} />
        </Field>
        {cfg.kind === "qrcode" && (
          <Field label="Коррекция ошибок">
            <Segmented
              value={cfg.ecc ?? "M"}
              onChange={(ecc) => set({ ecc })}
              options={[
                { value: "L", label: "L 7%" },
                { value: "M", label: "M 15%" },
                { value: "Q", label: "Q 25%" },
                { value: "H", label: "H 30%" },
              ]}
            />
          </Field>
        )}
        {isLinearBarcode(cfg.kind) && <Toggle label="Подпись под кодом" checked={!!cfg.humanReadable} onChange={(humanReadable) => set({ humanReadable })} />}
        <Field label="Поворот">
          <Segmented
            value={String(cfg.rotate ?? 0) as "0" | "90" | "180" | "270"}
            onChange={(r) => set({ rotate: Number(r) as 0 | 90 | 180 | 270 })}
            options={[
              { value: "0", label: "0°" },
              { value: "90", label: "90°" },
              { value: "180", label: "180°" },
              { value: "270", label: "270°" },
            ]}
          />
        </Field>
      </Section>
      <VariablePicker open={pick} onOpenChange={setPick} schema={schema} loops={loops} title="Данные для кода" onPick={(path) => set({ expr: path })} />
    </>
  )
}

function RegionSection({ cmp }: { cmp: Component }) {
  const attrs = cmp.getAttributes()
  const region = String(attrs["data-doc-region"] ?? "header") as "header" | "footer"
  const repeat = String(attrs["data-doc-repeat"] ?? "all") as "all" | "first" | "last"
  return (
    <Section title="Колонтитул">
      <Field label="Положение">
        <Segmented
          value={region}
          onChange={(v) =>
            cmp.addAttributes({ "data-doc-region": v, class: `doc-region ${v === "header" ? "doc-region-header" : "doc-region-footer"}` })
          }
          options={[
            { value: "header", label: "Верхний" },
            { value: "footer", label: "Нижний" },
          ]}
        />
      </Field>
      <Field label="Показывать" hint={repeat === "all" ? "В PDF выводится в поле каждой страницы; доступны «Номер страницы» и «Всего страниц»." : undefined}>
        <NativeSelect
          value={repeat}
          onChange={(v) => cmp.addAttributes({ "data-doc-repeat": v })}
          options={[
            { value: "all", label: "На каждой странице" },
            { value: "first", label: "Только на первой" },
            { value: "last", label: "Только на последней" },
          ]}
        />
      </Field>
    </Section>
  )
}

function insertVariable(editor: Editor, cmp: Component, expr: string) {
  const def = { type: DOC_TYPES.variable, attributes: { [ATTR_VAR]: expr } }
  const editing = editor.getEditing()
  const view = editing?.getView() as unknown as { insertComponent?: (c: unknown, o?: unknown) => void } | undefined
  if (editing && view?.insertComponent) {
    view.insertComponent(def, { useDomContent: true })
    return
  }
  if (isText(cmp)) {
    cmp.components().add({ type: "textnode", content: " " })
    cmp.components().add(def)
    return
  }
  const coll = cmp.collection
  coll?.add(def, { at: coll.indexOf(cmp) + 1 })
}

function TextSection({ editor, cmp, store }: { editor: Editor; cmp: Component; store: DesignerStore }) {
  const [pick, setPick] = useState(false)
  const { schema } = store.get()
  const { loops } = contextFor(cmp, store)
  return (
    <Section title="Текст">
      <SmallButton variant="primary" className="w-full" onClick={() => setPick(true)}>
        <Plus className="size-3.5" /> Вставить данные в текст
      </SmallButton>
      <div className="text-[10.5px] text-slate-400">Дважды щёлкните текст на листе, поставьте курсор и вставьте поле — оно встанет в позицию курсора.</div>
      <Field label="Стиль">
        <div className="flex flex-wrap gap-1">
          {TEXT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                const style = { ...cmp.getStyle() } as Record<string, string>
                for (const [k, v] of Object.entries(p.style)) {
                  if (v) style[k] = v
                  else delete style[k]
                }
                cmp.setStyle(style)
              }}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>
      <VariablePicker open={pick} onOpenChange={setPick} schema={schema} loops={loops} onPick={(path, item) => {
        const expr = item.type === "date" ? `${path} | date` : item.type === "money" ? `${path} | money` : path
        insertVariable(editor, cmp, expr)
      }} />
    </Section>
  )
}

function ImageSection({ editor, cmp, store }: { editor: Editor; cmp: Component; store: DesignerStore }) {
  const [pick, setPick] = useState(false)
  const attrs = cmp.getAttributes()
  const bound = typeof attrs[`${ATTR_PREFIX_ATTR}src`] === "string" ? String(attrs[`${ATTR_PREFIX_ATTR}src`]) : ""
  const { schema } = store.get()
  const { loops } = contextFor(cmp, store)
  return (
    <Section title="Изображение">
      <SmallButton className="w-full" onClick={() => editor.runCommand("core:open-assets", { target: cmp, types: ["image"], accept: "image/*" })}>
        <ImageIcon className="size-3.5" /> Выбрать файл
      </SmallButton>
      <Field label="Из данных документа" hint="Например, логотип или изображение подписи">
        {bound ? (
          <div className="flex gap-1">
            <div className={cn(inputClassName, "flex items-center truncate")}>◇ {shortLabel(schema, bound.replace(/^\{\{\s*|\s*\}\}$/g, ""), loops)}</div>
            <SmallButton variant="ghost" onClick={() => cmp.removeAttributes([`${ATTR_PREFIX_ATTR}src`])}>
              ✕
            </SmallButton>
          </div>
        ) : (
          <SmallButton className="w-full" onClick={() => setPick(true)}>
            ◇ Привязать к полю
          </SmallButton>
        )}
      </Field>
      <VariablePicker open={pick} onOpenChange={setPick} schema={schema} loops={loops} title="Источник изображения" onPick={(path) => cmp.addAttributes({ [`${ATTR_PREFIX_ATTR}src`]: `{{ ${path} }}` })} />
    </Section>
  )
}

function BasicTableSection({ cmp, cell }: { cmp: Component; cell?: Component }) {
  const tbody = cmp.find("tbody")[0] ?? cmp
  const rows = tbody.components().filter((r) => String(r.get("tagName")) === "tr")
  const cols = rows[0]?.components().length ?? 0
  const cellStyle = "border:0.75pt solid #333;padding:1.5mm"
  const addRow = () => tbody.components().add(`<tr>${Array.from({ length: Math.max(cols, 1) }, () => `<td style="${cellStyle}">Ячейка</td>`).join("")}</tr>`)
  const addCol = () => rows.forEach((r) => r.components().add(`<td style="${cellStyle}">Ячейка</td>`))
  const removeRow = () => {
    const row = cell ? (String(cell.get("tagName")) === "tr" ? cell : cell.parent()) : rows[rows.length - 1]
    if (rows.length > 1) row?.remove()
  }
  const removeCol = () => {
    const idx = cell && String(cell.get("tagName")) !== "tr" ? cell.index() : cols - 1
    if (cols > 1) rows.forEach((r) => r.components().at(idx)?.remove())
  }
  return (
    <Section title="Таблица">
      <div className="grid grid-cols-2 gap-1.5">
        <SmallButton onClick={addRow}>
          <Rows3 className="size-3.5" /> + строка
        </SmallButton>
        <SmallButton onClick={addCol}>
          <Columns3 className="size-3.5" /> + столбец
        </SmallButton>
        <SmallButton variant="ghost" onClick={removeRow}>
          − строка
        </SmallButton>
        <SmallButton variant="ghost" onClick={removeCol}>
          − столбец
        </SmallButton>
      </div>
      <div className="text-[10.5px] text-slate-400">Для строк из данных используйте блок «Таблица данных» или включите повтор у строки ниже.</div>
    </Section>
  )
}

function IfBranchesSection({ cmp }: { cmp: Component }) {
  const branches = cmp.components().filter((c) => c.getAttributes()[ATTR_BRANCH])
  const hasElse = branches.some((b) => b.getAttributes()[ATTR_BRANCH] === "else")
  const tag = String(cmp.get("tagName") || "div")
  return (
    <Section title="Варианты условия">
      <div className="text-[11px] text-slate-500">Выводится первый вариант, условие которого выполнено. Выберите вариант на листе, чтобы задать условие.</div>
      <div className="flex flex-wrap gap-1.5">
        <SmallButton
          onClick={() => {
            const at = hasElse ? branches.length - 1 : branches.length
            cmp.components().add(`<${tag} ${ATTR_BRANCH}="elif" ${ATTR_COND}=""><p>Ещё вариант</p></${tag}>`, { at })
          }}
        >
          <Plus className="size-3.5" /> Иначе если
        </SmallButton>
        {!hasElse && (
          <SmallButton onClick={() => cmp.components().add(`<${tag} ${ATTR_BRANCH}="else"><p>Во всех остальных случаях</p></${tag}>`)}>
            <Plus className="size-3.5" /> Иначе
          </SmallButton>
        )}
      </div>
    </Section>
  )
}

function DataDirectivesSection({ cmp, store, outerLoops, ownLoops }: { cmp: Component; store: DesignerStore; outerLoops: Record<string, string>; ownLoops: Record<string, string> }) {
  const [pickSource, setPickSource] = useState(false)
  const attrs = cmp.getAttributes()
  const { schema } = store.get()
  const cond = typeof attrs[ATTR_IF] === "string" ? String(attrs[ATTR_IF]) : null
  const loopHeader = typeof attrs[ATTR_FOR] === "string" ? String(attrs[ATTR_FOR]) : null
  const loop = loopHeader ? parseLoopHeader(loopHeader) : null
  const isWrapper = attrs[ATTR_WRAP] === "for" || attrs[ATTR_WRAP] === "if"
  const collections = listCollections(schema)
  return (
    <>
      <Section title="Показывать, если" aside={cond != null ? <span className="rounded bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800 normal-case">условие</span> : null} defaultOpen={cond != null}>
        {cond == null ? (
          <SmallButton className="w-full" onClick={() => cmp.addAttributes({ [ATTR_IF]: "" })}>
            Добавить условие показа
          </SmallButton>
        ) : (
          <>
            <ConditionEditor value={cond} schema={schema} loops={loopHeader ? ownLoops : outerLoops} onChange={(v) => cmp.addAttributes({ [ATTR_IF]: v })} />
            {!isWrapper && (
              <SmallButton variant="danger" onClick={() => cmp.removeAttributes([ATTR_IF])}>
                Убрать условие
              </SmallButton>
            )}
          </>
        )}
      </Section>
      <Section
        title="Повторять для каждого"
        aside={loopHeader ? <span className="rounded bg-sky-100 px-1.5 text-[10px] font-semibold text-sky-800 normal-case">цикл</span> : null}
        defaultOpen={!!loopHeader}
      >
        {loopHeader == null ? (
          <SmallButton className="w-full" onClick={() => setPickSource(true)}>
            <Repeat className="size-3.5" /> Повторять блок по списку
          </SmallButton>
        ) : loop ? (
          <>
            <Field label="Список">
              <button type="button" className={cn(inputClassName, "truncate text-left")} onClick={() => setPickSource(true)}>
                ↻ {shortLabel(schema, loop.source, outerLoops)}
              </button>
            </Field>
            <Field label="Имя строки в выражениях">
              <TextInput value={loop.itemVar} mono onCommit={(v) => /^[A-Za-z_]\w*$/.test(v) && cmp.addAttributes({ [ATTR_FOR]: `${v} in ${loop.source}` })} />
            </Field>
            {!isWrapper && (
              <SmallButton variant="danger" onClick={() => cmp.removeAttributes([ATTR_FOR])}>
                Не повторять
              </SmallButton>
            )}
          </>
        ) : (
          <Field label="Заголовок цикла (Advanced)">
            <TextInput value={loopHeader} mono onCommit={(v) => cmp.addAttributes({ [ATTR_FOR]: v })} />
          </Field>
        )}
      </Section>
      <VariablePicker
        open={pickSource}
        onOpenChange={setPickSource}
        schema={schema}
        loops={outerLoops}
        mode="collection"
        onPick={(path) => {
          const itemVar = loop?.itemVar ?? collections.find((c) => c.path === path)?.itemVar ?? "item"
          cmp.addAttributes({ [ATTR_FOR]: `${itemVar} in ${path}` })
        }}
      />
    </>
  )
}
