"use client"

import { useState } from "react"
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import { newColumnId, type DataTableColumn, type DataTableConfig } from "@/lib/doc-templates/data-table"
import type { DataSchema } from "@/lib/doc-templates/schema"
import { listCollections } from "@/lib/doc-templates/schema"
import { cn } from "@/lib/utils"
import { shortLabel, type LoopContext } from "../studio/labels"
import { Field, NativeSelect, NumberInput, Section, Segmented, SmallButton, TextInput, Toggle, inputClassName } from "./fields"
import { VariablePicker } from "./VariablePicker"

/** Настройки «Таблицы данных»: источник, колонки, шапка, итоги, пагинация, стиль. */
export function DataTableEditor({
  cfg,
  onChange,
  schema,
  loops,
}: {
  cfg: DataTableConfig
  onChange: (cfg: DataTableConfig) => void
  schema: DataSchema
  loops: LoopContext
}) {
  const [pickSource, setPickSource] = useState(false)
  const [pickColumn, setPickColumn] = useState<string | null>(null)
  const [pickTotal, setPickTotal] = useState<string | null>(null)
  const tableLoops = { ...loops, [cfg.itemVar]: loops[cfg.source.split(".")[0]] ?? cfg.source }
  const setCol = (id: string, patch: Partial<DataTableColumn>) => onChange({ ...cfg, columns: cfg.columns.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
  const move = (idx: number, dir: -1 | 1) => {
    const cols = cfg.columns.slice()
    const j = idx + dir
    if (j < 0 || j >= cols.length) return
    ;[cols[idx], cols[j]] = [cols[j], cols[idx]]
    onChange({ ...cfg, columns: cols })
  }
  const collections = listCollections(schema)

  return (
    <>
      <Section title="Источник данных">
        <Field label="Строки таблицы">
          <button type="button" className={cn(inputClassName, "truncate text-left")} onClick={() => setPickSource(true)} title={cfg.source}>
            {shortLabel(schema, cfg.source, loops)}
          </button>
        </Field>
        <div className="text-[10.5px] text-slate-400">
          Строка-шаблон повторяется для каждого элемента. Имя строки в выражениях: <code className="text-slate-500">{cfg.itemVar}</code>
        </div>
        <Field label="Текст, если строк нет">
          <TextInput value={cfg.emptyText} placeholder="не выводить" onCommit={(emptyText) => onChange({ ...cfg, emptyText })} />
        </Field>
      </Section>

      <Section title={`Колонки · ${cfg.columns.length}`}>
        <div className="space-y-2">
          {cfg.columns.map((c, i) => (
            <div key={c.id} className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50/60 p-2">
              <div className="flex items-center gap-1">
                <TextInput value={c.label} placeholder="Заголовок" onCommit={(label) => setCol(c.id, { label })} />
                <button type="button" title="Выше" onClick={() => move(i, -1)} className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700">
                  <ArrowUp className="size-3.5" />
                </button>
                <button type="button" title="Ниже" onClick={() => move(i, 1)} className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700">
                  <ArrowDown className="size-3.5" />
                </button>
                <button type="button" title="Удалить колонку" onClick={() => onChange({ ...cfg, columns: cfg.columns.filter((x) => x.id !== c.id) })} className="rounded p-1 text-slate-400 hover:bg-white hover:text-red-600">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <button type="button" onClick={() => setPickColumn(c.id)} className={cn(inputClassName, "truncate text-left text-[12px]", !c.expr && "text-slate-400")} title={c.expr}>
                {c.expr ? `◇ ${shortLabel(schema, c.expr, tableLoops)}` : "Пустая колонка (выберите поле)"}
              </button>
              <div className="grid grid-cols-2 gap-1.5">
                <TextInput value={c.width} placeholder="авто" onCommit={(width) => setCol(c.id, { width: /^\d+(\.\d+)?$/.test(width.trim()) ? `${width.trim()}mm` : width.trim() })} />
                <NativeSelect
                  value={c.align}
                  onChange={(align) => setCol(c.id, { align })}
                  options={[
                    { value: "left", label: "Слева" },
                    { value: "center", label: "Центр" },
                    { value: "right", label: "Справа" },
                  ]}
                />
              </div>
              <div>
                <NativeSelect
                  value={c.format}
                  onChange={(format) => setCol(c.id, { format })}
                  options={[
                    { value: "", label: "Как есть" },
                    { value: "number", label: "Число" },
                    { value: "money", label: "Деньги" },
                    { value: "date", label: "Дата" },
                  ]}
                />
              </div>
            </div>
          ))}
          <SmallButton onClick={() => onChange({ ...cfg, columns: [...cfg.columns, { id: newColumnId(), label: "Колонка", expr: "", width: "", align: "left", format: "" }] })}>
            <Plus className="size-3.5" /> Колонка
          </SmallButton>
        </div>
      </Section>

      <Section title="Шапка" defaultOpen={false}>
        <Toggle label="Показывать шапку" checked={cfg.header.show} onChange={(show) => onChange({ ...cfg, header: { ...cfg.header, show } })} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Фон">
            <input type="color" className="h-8 w-full cursor-pointer rounded-md border border-slate-200 bg-white p-0.5" value={cfg.header.background || "#ffffff"} onChange={(e) => onChange({ ...cfg, header: { ...cfg.header, background: e.target.value } })} />
          </Field>
          <Field label="Текст">
            <input type="color" className="h-8 w-full cursor-pointer rounded-md border border-slate-200 bg-white p-0.5" value={cfg.header.color || "#111111"} onChange={(e) => onChange({ ...cfg, header: { ...cfg.header, color: e.target.value } })} />
          </Field>
        </div>
        <Toggle label="Жирный шрифт" checked={cfg.header.bold} onChange={(bold) => onChange({ ...cfg, header: { ...cfg.header, bold } })} />
      </Section>

      <Section title="Итоговая строка" defaultOpen={false}>
        <Toggle label="Показывать итоги" checked={cfg.totals.show} onChange={(show) => onChange({ ...cfg, totals: { ...cfg.totals, show } })} />
        {cfg.totals.show &&
          cfg.columns.map((c) => {
            const cell = cfg.totals.cells[c.id] ?? {}
            return (
              <Field key={c.id} label={c.label || "Колонка"}>
                <div className="flex gap-1">
                  {cell.expr ? (
                    <button type="button" onClick={() => setPickTotal(c.id)} className={cn(inputClassName, "truncate text-left")}>
                      ◇ {shortLabel(schema, cell.expr, loops)}
                    </button>
                  ) : (
                    <TextInput value={cell.text ?? ""} placeholder="текст" onCommit={(text) => onChange({ ...cfg, totals: { ...cfg.totals, cells: { ...cfg.totals.cells, [c.id]: { text } } } })} />
                  )}
                  <SmallButton
                    title={cell.expr ? "Заменить на текст" : "Вставить поле данных"}
                    onClick={() =>
                      cell.expr
                        ? onChange({ ...cfg, totals: { ...cfg.totals, cells: { ...cfg.totals.cells, [c.id]: { text: "" } } } })
                        : setPickTotal(c.id)
                    }
                  >
                    {cell.expr ? "Aa" : "◇"}
                  </SmallButton>
                </div>
              </Field>
            )
          })}
      </Section>

      <Section title="Пагинация" defaultOpen={false}>
        <Toggle label="Повторять шапку на новой странице" checked={cfg.repeatHeader} onChange={(repeatHeader) => onChange({ ...cfg, repeatHeader })} />
        <Toggle label="Не разрывать строку между страницами" checked={cfg.avoidRowSplit} onChange={(avoidRowSplit) => onChange({ ...cfg, avoidRowSplit })} />
      </Section>

      <Section title="Стиль таблицы" defaultOpen={false}>
        <Field label="Границы">
          <Segmented
            value={cfg.borders}
            onChange={(borders) => onChange({ ...cfg, borders })}
            options={[
              { value: "all", label: "Все" },
              { value: "horizontal", label: "Строки" },
              { value: "outer", label: "Контур" },
              { value: "none", label: "Нет" },
            ]}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Толщина, pt">
            <NumberInput value={cfg.borderWidthPt} min={0} max={4} step={0.25} onCommit={(borderWidthPt) => onChange({ ...cfg, borderWidthPt })} />
          </Field>
          <Field label="Цвет линий">
            <input type="color" className="h-8 w-full cursor-pointer rounded-md border border-slate-200 bg-white p-0.5" value={cfg.borderColor} onChange={(e) => onChange({ ...cfg, borderColor: e.target.value })} />
          </Field>
          <Field label="Поля ячеек, мм">
            <NumberInput value={cfg.paddingMm} min={0} max={10} step={0.5} onCommit={(paddingMm) => onChange({ ...cfg, paddingMm })} />
          </Field>
          <Field label="Шрифт, pt">
            <NumberInput value={cfg.fontSizePt} min={5} max={24} step={0.5} onCommit={(fontSizePt) => onChange({ ...cfg, fontSizePt })} />
          </Field>
        </div>
        <Toggle label="Чередовать фон строк" checked={cfg.zebra} onChange={(zebra) => onChange({ ...cfg, zebra })} />
      </Section>

      <VariablePicker
        open={pickSource}
        onOpenChange={setPickSource}
        schema={schema}
        loops={loops}
        mode="collection"
        onPick={(path) => {
          const coll = collections.find((c) => c.path === path)
          const itemVar = coll?.itemVar ?? "item"
          const columns = cfg.columns.map((c) => ({ ...c, expr: c.expr.replace(new RegExp(`^${cfg.itemVar}\\.`), `${itemVar}.`) }))
          onChange({ ...cfg, source: path, itemVar, columns })
        }}
      />
      <VariablePicker
        open={pickColumn !== null}
        onOpenChange={(o) => !o && setPickColumn(null)}
        schema={schema}
        loops={tableLoops}
        onPick={(path, item) => {
          const col = cfg.columns.find((c) => c.id === pickColumn)
          const format = item.type === "money" ? "money" : item.type === "date" ? "date" : item.type === "number" ? "number" : ""
          setCol(pickColumn!, {
            expr: path,
            label: col && (col.label === "Колонка" || !col.label) ? item.label : col?.label ?? item.label,
            format: format as DataTableColumn["format"],
            align: format === "money" || format === "number" ? "right" : col?.align ?? "left",
          })
        }}
      />
      <VariablePicker
        open={pickTotal !== null}
        onOpenChange={(o) => !o && setPickTotal(null)}
        schema={schema}
        loops={loops}
        title="Значение итога"
        onPick={(path) => onChange({ ...cfg, totals: { ...cfg.totals, cells: { ...cfg.totals.cells, [pickTotal!]: { expr: path } } } })}
      />
    </>
  )
}
