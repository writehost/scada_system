// Небольшие помощники проверки входных данных с понятными сообщениями.
import { badRequest } from "./errors.ts"
import { isUuid } from "./db.ts"
import { isDateKey } from "../domain/time.ts"

export type Body = Record<string, unknown>

export function str(body: Body, key: string, label: string, opts: { required?: boolean; max?: number; min?: number } = {}): string | null {
  const v = body[key]
  if (v == null || (typeof v === "string" && v.trim() === "")) {
    if (opts.required) throw badRequest(`Заполните поле «${label}»`, "invalid_input", { field: key })
    return null
  }
  if (typeof v !== "string" && typeof v !== "number") throw badRequest(`Поле «${label}»: ожидается текст`, "invalid_input", { field: key })
  const s = String(v).trim()
  if (opts.max && s.length > opts.max) throw badRequest(`Поле «${label}»: не длиннее ${opts.max} символов`, "invalid_input", { field: key })
  if (opts.min && s.length < opts.min) throw badRequest(`Поле «${label}»: не короче ${opts.min} символов`, "invalid_input", { field: key })
  return s
}

export function reqStr(body: Body, key: string, label: string, max = 200): string {
  return str(body, key, label, { required: true, max })!
}

export function num(body: Body, key: string, label: string, opts: { required?: boolean; min?: number; max?: number; integer?: boolean } = {}): number | null {
  const v = body[key]
  if (v == null || v === "") {
    if (opts.required) throw badRequest(`Заполните поле «${label}»`, "invalid_input", { field: key })
    return null
  }
  const n = typeof v === "string" ? Number(v.replace(/\s/g, "").replace(",", ".")) : Number(v)
  if (!Number.isFinite(n)) throw badRequest(`Поле «${label}»: нужно число`, "invalid_input", { field: key })
  if (opts.integer && !Number.isInteger(n)) throw badRequest(`Поле «${label}»: нужно целое число`, "invalid_input", { field: key })
  if (opts.min != null && n < opts.min) throw badRequest(`Поле «${label}»: не меньше ${opts.min}`, "invalid_input", { field: key })
  if (opts.max != null && n > opts.max) throw badRequest(`Поле «${label}»: не больше ${opts.max}`, "invalid_input", { field: key })
  return n
}

export function oneOf<T extends string>(body: Body, key: string, label: string, values: readonly T[], fallback?: T): T {
  const v = body[key]
  if ((v == null || v === "") && fallback !== undefined) return fallback
  if (typeof v !== "string" || !(values as readonly string[]).includes(v)) {
    throw badRequest(`Поле «${label}»: недопустимое значение`, "invalid_input", { field: key, allowed: values })
  }
  return v as T
}

export function uuid(body: Body, key: string, label: string, required = false): string | null {
  const v = body[key]
  if (v == null || v === "") {
    if (required) throw badRequest(`Укажите «${label}»`, "invalid_input", { field: key })
    return null
  }
  if (!isUuid(v)) throw badRequest(`Поле «${label}»: неверный идентификатор`, "invalid_input", { field: key })
  return v
}

export function dateKey(body: Body, key: string, label: string, required = false): string | null {
  const v = body[key]
  if (v == null || v === "") {
    if (required) throw badRequest(`Укажите дату «${label}»`, "invalid_input", { field: key })
    return null
  }
  if (!isDateKey(v)) throw badRequest(`Поле «${label}»: дата в формате ГГГГ-ММ-ДД`, "invalid_input", { field: key })
  return v
}

export function timestamp(body: Body, key: string, label: string, required = false): number | null {
  const v = body[key]
  if (v == null || v === "") {
    if (required) throw badRequest(`Укажите «${label}»`, "invalid_input", { field: key })
    return null
  }
  const t = typeof v === "number" ? v : Date.parse(String(v))
  if (!Number.isFinite(t)) throw badRequest(`Поле «${label}»: неверная дата и время`, "invalid_input", { field: key })
  return t
}

export function bool(body: Body, key: string, fallback = false): boolean {
  const v = body[key]
  if (v == null) return fallback
  return v === true || v === "true" || v === 1 || v === "1"
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function email(body: Body, key: string, label = "Email", required = true): string | null {
  const s = str(body, key, label, { required, max: 254 })
  if (s == null) return null
  const e = s.toLowerCase()
  if (!EMAIL_RE.test(e)) throw badRequest(`Поле «${label}»: неверный адрес почты`, "invalid_input", { field: key })
  return e
}
