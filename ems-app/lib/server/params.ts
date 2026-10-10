import { badRequest } from "./errors.ts"
import { isUuid } from "./db.ts"

export function idParam(v: string | undefined, label = "Идентификатор"): string {
  if (!isUuid(v)) throw badRequest(`${label}: неверный формат`)
  return v
}

export function intParam(v: string | null | undefined, label: string): number {
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${label}: неверный формат`)
  return n
}

export function optUuid(url: URL, key: string): string | null {
  const v = url.searchParams.get(key)
  if (!v) return null
  if (!isUuid(v)) throw badRequest(`Параметр ${key}: неверный формат`)
  return v
}

export function timeParam(url: URL, key: string, fallback: number): number {
  const v = url.searchParams.get(key)
  if (!v) return fallback
  const t = /^\d+$/.test(v) ? Number(v) : Date.parse(v)
  if (!Number.isFinite(t)) throw badRequest(`Параметр ${key}: неверная дата`)
  return t
}
