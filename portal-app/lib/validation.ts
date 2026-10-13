import { requestableProducts } from "./products"

export const CONSENT_VERSION = "2026-10"

export type RequestInput = {
  firstName: string
  lastName: string
  email: string
  company: string
  jobTitle: string
  phone: string | null
  comment: string | null
  modules: string[]
  idempotencyKey: string
  formToken: string
  honeypot: string
}

const EMAIL_RE = /^[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[a-zA-Zа-яА-Я]{2,}$/
const PHONE_RE = /^\+?[0-9\s()\-]{6,24}$/
const KEY_RE = /^[A-Za-z0-9_-]{16,80}$/

function str(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""
}

function multiline(v: unknown): string {
  return typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : ""
}

/** Только печатаемые символы — режем управляющие и разметку в именах. */
function cleanName(v: string): string {
  return v.replace(/[\u0000-\u001f<>]/g, "")
}

export function normalizeEmail(v: unknown): string {
  return str(v).toLowerCase()
}

export function validateRequestInput(
  body: Record<string, unknown>
): { ok: true; value: RequestInput } | { ok: false; fields: Record<string, string> } {
  const fields: Record<string, string> = {}
  const firstName = cleanName(str(body.firstName))
  const lastName = cleanName(str(body.lastName))
  const email = normalizeEmail(body.email)
  const company = cleanName(str(body.company))
  const jobTitle = cleanName(str(body.jobTitle))
  const phoneRaw = str(body.phone)
  const commentRaw = multiline(body.comment)

  if (firstName.length < 1 || firstName.length > 80) fields.firstName = "Укажите имя"
  if (lastName.length < 1 || lastName.length > 80) fields.lastName = "Укажите фамилию"
  if (!EMAIL_RE.test(email) || email.length > 254) fields.email = "Укажите корректный email"
  if (company.length < 2 || company.length > 200) fields.company = "Укажите название организации"
  if (jobTitle.length < 2 || jobTitle.length > 120) fields.jobTitle = "Укажите должность"
  if (phoneRaw && !PHONE_RE.test(phoneRaw)) fields.phone = "Телефон в формате +7 900 000-00-00"
  if (commentRaw.length > 2000) fields.comment = "Не больше 2000 символов"
  if (body.consent !== true) fields.consent = "Нужно согласие на обработку персональных данных"

  const allowed = new Set(requestableProducts().map((p) => p.key as string))
  const rawModules = Array.isArray(body.modules) ? body.modules : []
  const modules = [...new Set(rawModules.filter((m): m is string => typeof m === "string"))]
  if (modules.length === 0) fields.modules = "Выберите хотя бы один продукт"
  else if (modules.some((m) => !allowed.has(m))) fields.modules = "Выбран недоступный для подключения продукт"

  const idempotencyKey = str(body.idempotencyKey)
  if (!KEY_RE.test(idempotencyKey)) fields.idempotencyKey = "Некорректный ключ отправки"

  if (Object.keys(fields).length) return { ok: false, fields }
  return {
    ok: true,
    value: {
      firstName,
      lastName,
      email,
      company,
      jobTitle,
      phone: phoneRaw || null,
      comment: commentRaw || null,
      modules,
      idempotencyKey,
      formToken: str(body.formToken),
      honeypot: str(body.website),
    },
  }
}
