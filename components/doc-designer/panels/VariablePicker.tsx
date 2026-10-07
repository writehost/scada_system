"use client"

import { useMemo, useState } from "react"
import { Braces, Calendar, Hash, Image as ImageIcon, List, Search, ScanLine, Type, Wallet, ToggleLeft, Repeat } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { DataSchema, FieldType, SchemaField } from "@/lib/doc-templates/schema"
import { cn } from "@/lib/utils"
import type { LoopContext } from "../studio/labels"

/**
 * Выбор переменной по схеме данных (GET /schema). Ни одно поле не зашито в UI.
 * mode="value" — поле для вывода; mode="collection" — список для цикла или таблицы.
 */

type Item = { path: string; label: string; type: FieldType; hint?: string }
type Group = { id: string; label: string; items: Item[]; accent?: boolean }

const TYPE_ICON: Record<string, typeof Type> = {
  string: Type,
  number: Hash,
  money: Wallet,
  date: Calendar,
  boolean: ToggleLeft,
  image: ImageIcon,
  barcode: ScanLine,
  collection: List,
  object: Braces,
}

function fieldsOf(field: SchemaField): Record<string, SchemaField> {
  return (field.type === "collection" ? field.item : field.fields) ?? {}
}

function buildGroups(schema: DataSchema, loops: LoopContext, mode: "value" | "collection"): Group[] {
  const groups: Group[] = []
  // Сначала — текущие строки циклов: в таблицах и повторяющихся блоках нужны именно они.
  for (const [itemVar, source] of Object.entries(loops)) {
    let field: SchemaField | undefined
    let fields: Record<string, SchemaField> | undefined = schema
    for (const part of source.split(".")) {
      field = fields?.[part]
      fields = field ? fieldsOf(field) : undefined
    }
    if (!field || field.type !== "collection" || !field.item) continue
    const items: Item[] = []
    if (mode === "value") items.push({ path: "loop.index", label: "№ п/п", type: "number" })
    for (const [k, f] of Object.entries(field.item)) {
      if (mode === "collection" ? f.type === "collection" : f.type !== "collection" && f.type !== "object") {
        items.push({ path: `${itemVar}.${k}`, label: f.label, type: f.type })
      }
    }
    groups.push({ id: `loop:${itemVar}`, label: `Текущая строка · ${field.label}`, items, accent: true })
  }
  const walk = (prefix: string, label: string, fields: Record<string, SchemaField>) => {
    const items: Item[] = []
    for (const [k, f] of Object.entries(fields)) {
      const path = `${prefix}.${k}`
      if (f.type === "object" && f.fields) {
        walk(path, `${label} → ${f.label}`, f.fields)
        continue
      }
      if (f.type === "collection") {
        if (mode === "collection") items.push({ path, label: f.label, type: "collection", hint: `${Object.keys(f.item ?? {}).length} полей` })
        else items.push({ path: `${path} | length`, label: `${f.label}: количество`, type: "number" })
        continue
      }
      if (mode === "value") items.push({ path, label: f.label, type: f.type })
    }
    if (items.length) groups.push({ id: prefix, label, items })
  }
  for (const [k, f] of Object.entries(schema)) {
    if (f.type === "object" && f.fields) walk(k, f.label, f.fields)
    else if (f.type === "collection") {
      if (mode === "collection") groups.push({ id: k, label: f.label, items: [{ path: k, label: f.label, type: "collection" }] })
    } else if (mode === "value") groups.push({ id: k, label: f.label, items: [{ path: k, label: f.label, type: f.type }] })
  }
  return groups
}

export function VariablePicker({
  open,
  onOpenChange,
  schema,
  loops = {},
  mode = "value",
  title,
  onPick,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  schema: DataSchema
  loops?: LoopContext
  mode?: "value" | "collection"
  title?: string
  onPick: (path: string, item: Item) => void
}) {
  const [q, setQ] = useState("")
  const groups = useMemo(() => buildGroups(schema, loops, mode), [schema, loops, mode])
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return groups
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => i.label.toLowerCase().includes(s) || i.path.toLowerCase().includes(s) || g.label.toLowerCase().includes(s)),
      }))
      .filter((g) => g.items.length)
  }, [groups, q])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-slate-100 px-5 pb-3 pt-5">
          <DialogTitle className="text-[15px]">{title ?? (mode === "collection" ? "Источник данных" : "Вставить данные")}</DialogTitle>
          <DialogDescription className="text-[12px]">
            {mode === "collection" ? "Выберите список, строки которого будут повторяться." : "Поле подставится в документ при печати."}
          </DialogDescription>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск: ИНН, номер, дата…"
              className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-8 pr-3 text-[13px] outline-none focus:border-slate-400 focus:bg-white"
            />
          </div>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto px-2 py-2">
          {filtered.length === 0 && <div className="px-3 py-8 text-center text-[13px] text-slate-400">Ничего не найдено</div>}
          {filtered.map((g) => (
            <div key={g.id} className="mb-1">
              <div className={cn("flex items-center gap-1.5 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide", g.accent ? "text-sky-700" : "text-slate-400")}>
                {g.accent && <Repeat className="size-3" />}
                {g.label}
              </div>
              <div className="grid grid-cols-2 gap-0.5">
                {g.items.map((i) => {
                  const Icon = TYPE_ICON[i.type] ?? Type
                  return (
                    <button
                      key={i.path}
                      type="button"
                      onClick={() => {
                        onPick(i.path, i)
                        onOpenChange(false)
                        setQ("")
                      }}
                      className="group flex items-center gap-2 rounded-md px-3 py-1.5 text-left hover:bg-slate-100"
                      title={`{{ ${i.path} }}`}
                    >
                      <Icon className="size-3.5 shrink-0 text-slate-400 group-hover:text-slate-600" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-slate-800">{i.label}</span>
                        {i.hint && <span className="block text-[10.5px] text-slate-400">{i.hint}</span>}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
