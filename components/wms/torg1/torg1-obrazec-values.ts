import type { Torg1Fields } from "@/lib/wms/torg1"
import { joinRuDate, ruMonthGenitive, splitRuDate } from "@/lib/wms/torg1"
import type { Torg1ObrazecSlot } from "./torg1-obrazec-slots"

type DatePart = "day" | "month" | "year" | "monthWord" | "yearShort"

function fieldStr(fields: Torg1Fields, key: keyof Torg1Fields): string {
  const v = fields[key]
  return typeof v === "string" ? v : ""
}

function dateParts(value: string): {
  day: string
  month: string
  year: string
  monthWord: string
  yearShort: string
} {
  const [day, month, year] = splitRuDate(value)
  const monthWord = ruMonthGenitive(month) || month
  const yearShort = year.length === 4 ? year.slice(2) : year
  return { day, month, year, monthWord, yearShort }
}

export function obrazecSlotValue(fields: Torg1Fields, slot: Torg1ObrazecSlot): string {
  if (slot.kind === "orgLine") {
    return [fields.orgName, fields.orgAddress, fields.orgPhone].filter(Boolean).join(", ")
  }
  if (slot.kind === "datePart") {
    const parts = dateParts(fieldStr(fields, slot.key))
    return parts[slot.part as DatePart] ?? ""
  }
  if (slot.kind === "field") {
    const raw = fieldStr(fields, slot.key as keyof Torg1Fields)
    if (slot.key === "meatTemp") return raw.replace(/[°СC]/gi, "").trim()
    return raw
  }
  return ""
}

export function obrazecSlotPatch(
  fields: Torg1Fields,
  slot: Torg1ObrazecSlot,
  raw: string
): Torg1Fields {
  if (slot.kind === "orgLine") {
    return { ...fields, orgName: raw.trim(), orgAddress: "", orgPhone: "" }
  }
  if (slot.kind === "datePart") {
    const key = slot.key
    const cur = fieldStr(fields, key)
    const parts = dateParts(cur)
    const next = { ...parts, [slot.part]: raw.trim() }
    let month = next.month
    if (slot.part === "monthWord") {
      const idx = [
        "января",
        "февраля",
        "марта",
        "апреля",
        "мая",
        "июня",
        "июля",
        "августа",
        "сентября",
        "октября",
        "ноября",
        "декабря",
      ].indexOf(raw.trim().toLowerCase())
      month = idx >= 0 ? String(idx + 1).padStart(2, "0") : raw.trim()
    }
    const joined = joinRuDate(next.day, month, next.year || (next.yearShort ? `20${next.yearShort}` : ""))
    return { ...fields, [key]: joined }
  }
  if (slot.kind === "field") {
    let v = raw
    if (slot.key === "meatTemp") v = raw.replace(/[°СC]/gi, "").trim()
    return { ...fields, [slot.key]: v }
  }
  return fields
}

export function obrazecSlotKey(slot: Torg1ObrazecSlot): string {
  if (slot.kind === "orgLine") return "orgLine"
  if (slot.kind === "datePart") return `${slot.key}:${slot.part}`
  return slot.key
}
