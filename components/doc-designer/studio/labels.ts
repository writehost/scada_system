import type { DataSchema, FieldType, SchemaField } from "@/lib/doc-templates/schema"
import { listCollections } from "@/lib/doc-templates/schema"
import { parseVarExpr } from "@/lib/doc-templates/jinja/expressions"

/**
 * Человеческие подписи для переменных: `organization.name` → «Организация · Название».
 * Переменные элемента цикла (`item.name`) подписываются по полям коллекции.
 */

export type VarLabel = { group: string; label: string; type: FieldType | null; known: boolean }

const FORMAT_LABELS: Record<string, string> = {
  date: "дата",
  money: "денежный",
  number: "число",
  upper: "ПРОПИСНЫЕ",
  lower: "строчные",
  default: "по умолчанию",
}

export type LoopContext = Record<string, string>

function findField(schema: DataSchema, path: string[]): { field: SchemaField; group: string } | null {
  let fields: Record<string, SchemaField> | undefined = schema
  let group = ""
  let field: SchemaField | undefined
  for (let i = 0; i < path.length; i++) {
    field = fields?.[path[i]]
    if (!field) return null
    if (i < path.length - 1) {
      group = field.label
      fields = field.type === "collection" ? field.item : field.fields
    }
  }
  return field ? { field, group } : null
}

export function labelForPath(schema: DataSchema, path: string, loops: LoopContext = {}): VarLabel {
  const parts = path.replace(/\[\d+\]/g, "").split(".")
  if (parts[0] === "loop") {
    const map: Record<string, string> = { index: "№", index0: "№ с нуля", length: "Всего строк", first: "Первая строка", last: "Последняя строка" }
    return { group: "Цикл", label: map[parts[1]] ?? parts.slice(1).join("."), type: "number", known: !!map[parts[1]] }
  }
  const loopSource = loops[parts[0]]
  if (loopSource) {
    const coll = findField(schema, loopSource.split("."))
    const itemFields = coll?.field.type === "collection" ? coll.field.item : undefined
    if (itemFields) {
      const inner = findField(itemFields, parts.slice(1))
      if (inner) return { group: coll!.field.label, label: inner.field.label, type: inner.field.type, known: true }
    }
  }
  const direct = findField(schema, parts)
  if (direct) return { group: direct.group, label: direct.field.label, type: direct.field.type, known: true }
  // Переменная цикла без известного контекста: ищем коллекцию с таким же itemVar.
  for (const c of listCollections(schema)) {
    if (c.itemVar !== parts[0]) continue
    const inner = findField(c.item, parts.slice(1))
    if (inner) return { group: c.label.split(" → ").pop() ?? c.label, label: inner.field.label, type: inner.field.type, known: true }
  }
  return { group: parts.length > 1 ? parts.slice(0, -1).join(".") : "", label: parts[parts.length - 1] || path, type: null, known: false }
}

export function labelForExpr(schema: DataSchema, expr: string, loops: LoopContext = {}): VarLabel & { format: string; advanced: boolean } {
  const model = parseVarExpr(expr)
  if (!model) return { group: "Выражение", label: expr, type: null, known: false, format: "", advanced: true }
  const base = labelForPath(schema, model.path, loops)
  const format = model.filters.map((f) => FORMAT_LABELS[f.name] ?? f.name).join(", ")
  return { ...base, format, advanced: false }
}

export function shortLabel(schema: DataSchema, expr: string, loops: LoopContext = {}): string {
  const l = labelForExpr(schema, expr, loops)
  return l.group ? `${l.group} · ${l.label}` : l.label
}
