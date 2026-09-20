/**
 * Конструктор задания: какие поля показывать при создании и как считать
 * срок годности от даты производства (12 месяцев, 2 недели и т.д.).
 */

export type TaskOperationType = "receipt" | "shipment" | "revision" | "transfer_erp"
export type TaskQtyMode = "pcs" | "weight"
export type ShelfLifeUnit = "day" | "week" | "month" | "year"

export type TaskConstructorFieldId =
  | "batch"
  | "manufacturedAt"
  | "shelfLife"
  | "qty"
  | "comment"
  | "locations"
  | "priority"

export type TaskConstructorSchema = {
  fields: TaskConstructorFieldId[]
}

export const TASK_CONSTRUCTOR_FIELD_META: Record<
  TaskConstructorFieldId,
  { label: string; hint: string }
> = {
  batch: { label: "Партия", hint: "Текстовый код партии / лота" },
  manufacturedAt: { label: "Дата производства", hint: "С неё считается срок годности" },
  shelfLife: { label: "Срок годности", hint: "Формула: 12 месяцев, 2 недели…" },
  qty: { label: "Количество", hint: "Штуки или вес с запятой" },
  comment: { label: "Комментарий", hint: "Для оператора на ТСД" },
  locations: { label: "Ячейки", hint: "Откуда / куда" },
  priority: { label: "Приоритет", hint: "Обычный или срочный" },
}

export const DEFAULT_TASK_CONSTRUCTOR_SCHEMA: TaskConstructorSchema = {
  fields: ["batch", "manufacturedAt", "shelfLife", "qty", "comment"],
}

const LS_KEY = "wms.taskConstructor.v1"

export function loadTaskConstructorSchema(): TaskConstructorSchema {
  if (typeof window === "undefined") return { ...DEFAULT_TASK_CONSTRUCTOR_SCHEMA, fields: [...DEFAULT_TASK_CONSTRUCTOR_SCHEMA.fields] }
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return { fields: [...DEFAULT_TASK_CONSTRUCTOR_SCHEMA.fields] }
    const parsed = JSON.parse(raw) as Partial<TaskConstructorSchema>
    const allowed = new Set(Object.keys(TASK_CONSTRUCTOR_FIELD_META) as TaskConstructorFieldId[])
    const fields = (parsed.fields ?? [])
      .filter((id): id is TaskConstructorFieldId => allowed.has(id as TaskConstructorFieldId))
    return { fields: fields.length > 0 ? fields : [...DEFAULT_TASK_CONSTRUCTOR_SCHEMA.fields] }
  } catch {
    return { fields: [...DEFAULT_TASK_CONSTRUCTOR_SCHEMA.fields] }
  }
}

export function saveTaskConstructorSchema(schema: TaskConstructorSchema): void {
  if (typeof window === "undefined") return
  localStorage.setItem(LS_KEY, JSON.stringify({ fields: schema.fields }))
}

export function hasField(schema: TaskConstructorSchema, id: TaskConstructorFieldId): boolean {
  return schema.fields.includes(id)
}

export function toggleField(schema: TaskConstructorSchema, id: TaskConstructorFieldId): TaskConstructorSchema {
  if (schema.fields.includes(id)) {
    return { fields: schema.fields.filter((x) => x !== id) }
  }
  return { fields: [...schema.fields, id] }
}

/** Разбор даты: 07.09.2026, 7.9.26, 2026-09-07. */
export function parseFlexibleDate(raw: string): Date | null {
  const text = raw.trim()
  if (!text) return null
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const ru = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/)
  if (ru) {
    let year = Number(ru[3])
    if (year < 100) year += 2000
    const d = new Date(year, Number(ru[2]) - 1, Number(ru[1]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(text)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatRuDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0")
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  return `${dd}.${mm}.${date.getFullYear()}`
}

export function formatIsoDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0")
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  return `${date.getFullYear()}-${mm}-${dd}`
}

export function addShelfLife(from: Date, amount: number, unit: ShelfLifeUnit): Date {
  const n = Math.max(0, Math.floor(amount))
  const next = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  switch (unit) {
    case "day":
      next.setDate(next.getDate() + n)
      break
    case "week":
      next.setDate(next.getDate() + n * 7)
      break
    case "month":
      next.setMonth(next.getMonth() + n)
      break
    case "year":
      next.setFullYear(next.getFullYear() + n)
      break
  }
  return next
}

export function computeExpiryIso(
  manufacturedRaw: string,
  amount: number,
  unit: ShelfLifeUnit
): string | null {
  const from = parseFlexibleDate(manufacturedRaw)
  if (!from || !Number.isFinite(amount) || amount <= 0) return null
  return formatIsoDate(addShelfLife(from, amount, unit))
}

/** Если в карточке есть дни — переводим в удобную единицу (12 мес., не 365 дн.). */
export function shelfLifeFromDays(days: number | null | undefined): { amount: number; unit: ShelfLifeUnit } {
  const n = Math.round(Number(days) || 0)
  if (n <= 0) return { amount: 12, unit: "month" }
  if (n % 365 === 0) return { amount: n / 365, unit: "year" }
  if (n % 30 === 0) return { amount: n / 30, unit: "month" }
  if (n % 7 === 0) return { amount: n / 7, unit: "week" }
  return { amount: n, unit: "day" }
}

export function parseQtyInput(raw: string, mode: TaskQtyMode): number {
  const n = Number(String(raw).trim().replace(",", ".").replace(/\s/g, ""))
  if (!Number.isFinite(n) || n <= 0) return 0
  return mode === "pcs" ? Math.round(n) : Math.round(n * 1000) / 1000
}

export const SHELF_LIFE_UNIT_LABEL: Record<ShelfLifeUnit, string> = {
  day: "дней",
  week: "недель",
  month: "месяцев",
  year: "лет",
}

export const OPERATION_TYPE_LABEL: Record<TaskOperationType, string> = {
  receipt: "Приёмка",
  shipment: "Отгрузка",
  revision: "Ревизия",
  transfer_erp: "Перемещение (ЕРП)",
}
