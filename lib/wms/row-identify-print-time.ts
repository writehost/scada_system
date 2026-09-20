export type ScanCodeKind = "sscc" | "unit" | "other"

const AGGREGATE_PACKAGE_TYPES = new Set([
  "LEVEL1",
  "LEVEL2",
  "LEVEL3",
  "LEVEL4",
  "GROUP",
  "BOX",
  "PALLET",
  "BUNDLE",
])

/** Сканер ТСД: AIM `]d2`, скобки GS1, GS, пробелы. */
export function compactMarking(raw: string): string {
  return String(raw || "")
    .replace(/^\][A-Za-z0-9]{1,2}/, "")
    .replace(/[\s\u001d()]/g, "")
}

/** Единичный КМ продукта: 01 + GTIN + 21 + серийник. У него в Vekas есть PrintedOn. */
export function isUnitMarkingCode(raw: string): boolean {
  const compact = compactMarking(raw)
  return /^01\d{14}21.+/.test(compact) || /^\(01\)\d{14}\(21\).+/.test(String(raw || ""))
}

/** SSCC палеты: 00 + 18 цифр. У палеты PrintedOn нет. */
export function isSsccCode(raw: string): boolean {
  if (isUnitMarkingCode(raw)) return false
  const compact = compactMarking(raw)
  if (/^00\d{18}$/.test(compact)) return true
  if (/^\d{18}$/.test(compact)) return true
  return false
}

export function classifyScanCode(raw: string): ScanCodeKind {
  if (isUnitMarkingCode(raw)) return "unit"
  if (isSsccCode(raw)) return "sscc"
  return "other"
}

export function normalizeSscc(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "")
  if (digits.length === 18) return `00${digits}`
  if (digits.length === 20 && digits.startsWith("00")) return digits
  return String(raw || "").trim()
}

/** Vekas PrintedOn без таймзоны — не переводим в UTC. */
export function printTimeKey(value: string | null | undefined): string {
  return String(value || "")
    .replace(/Z$/i, "")
    .trim()
    .slice(0, 19)
}

export function pickPrintTime(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const key = printTimeKey(value)
    if (key.length >= 10) return key
  }
  return ""
}

/** Окно партий Vekas вокруг даты ЧЗ / нанесения. */
export function producedFromHint(...values: Array<string | null | undefined>): string | undefined {
  const key = pickPrintTime(...values)
  return key.slice(0, 10) || undefined
}

export function pickRangeCode(children: string[], role: "start" | "end"): string | null {
  const codes = children.map((code) => String(code || "").trim()).filter(Boolean)
  if (codes.length === 0) return null
  return role === "end" ? codes[codes.length - 1] : codes[0]
}

/** Блок/короб/палета — формат 01+21 как у бутылки, но PrintedOn там нет. */
export function isAggregatePackageType(packageType: string | null | undefined, childCount = 0): boolean {
  const type = String(packageType || "")
    .trim()
    .toUpperCase()
  if (type === "UNIT") return false
  if (AGGREGATE_PACKAGE_TYPES.has(type)) return true
  return childCount > 0
}
