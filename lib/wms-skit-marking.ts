export type SkitMarkingKind = "item" | "loc" | "pallet" | "lot" | "unknown"

export type ParsedSkitMarking = {
  kind: SkitMarkingKind
  fields: Record<string, string>
  raw: string
  lookupQuery: string | null
  locationCode: string | null
}

const TYPE_ALIASES: Record<string, SkitMarkingKind> = {
  item: "item",
  box: "item",
  товар: "item",
  loc: "loc",
  location: "loc",
  ячейка: "loc",
  pallet: "pallet",
  паллета: "pallet",
  lot: "lot",
  batch: "lot",
  партия: "lot",
}

const FIELD_LABELS_RU: Record<string, string> = {
  type: "Тип",
  org: "Организация",
  ver: "Версия формата",
  wh: "Склад",
  loc: "Ячейка",
  gtin: "GTIN",
  sku: "Артикул",
  qty: "Количество",
  lot: "Партия",
  uid: "Идентификатор",
  inn: "ИНН",
}

const KIND_LABELS_RU: Record<SkitMarkingKind, string> = {
  item: "Товар или упаковка",
  loc: "Ячейка",
  pallet: "Паллета",
  lot: "Партия",
  unknown: "Произвольный код",
}

export function skitMarkingKindLabelRu(kind: SkitMarkingKind): string {
  return KIND_LABELS_RU[kind]
}

export function skitMarkingFieldLabelRu(key: string): string {
  const k = key.trim().toLowerCase()
  return FIELD_LABELS_RU[k] ?? key
}

function splitSegments(raw: string): string[] {
  return raw
    .trim()
    .split("$")
    .map((s) => s.trim())
    .filter(Boolean)
}

function parseKeyValueSegments(segments: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const seg of segments) {
    const i = seg.indexOf("=")
    if (i <= 0) continue
    const key = seg.slice(0, i).trim().toLowerCase()
    const val = seg.slice(i + 1).trim()
    if (key) out[key] = val
  }
  return out
}

function parseCompactNoEquals(raw: string): Record<string, string> {
  const parts = splitSegments(raw)
  if (parts.length < 2) return {}
  const [org, wh, ...rest] = parts
  const fields: Record<string, string> = { org, wh }
  if (rest.length === 1) {
    const v = rest[0]
    if (/^\d{8,14}$/.test(v)) fields.gtin = v
    else fields.sku = v
  } else if (rest.length >= 2) {
    const loc = rest[0]
    const code = rest[1]
    fields.loc = loc
    if (/^\d{8,14}$/.test(code)) fields.gtin = code
    else fields.sku = code
    if (rest[2]) fields.qty = rest[2]
    if (rest[3]) fields.lot = rest[3]
  }
  return fields
}

function normalizeKind(v: string | undefined): SkitMarkingKind | null {
  if (!v) return null
  const k = v.trim().toLowerCase()
  return TYPE_ALIASES[k] ?? null
}

function inferKind(fields: Record<string, string>): SkitMarkingKind {
  const explicit = normalizeKind(fields.type)
  if (explicit) return explicit
  if (fields.uid?.toUpperCase().startsWith("PL")) return "pallet"
  if (fields.uid && !fields.gtin && !fields.sku && fields.wh && !fields.loc) return "pallet"
  if (fields.lot && !fields.gtin && !fields.sku && !fields.loc) return "lot"
  if (fields.lot && fields.gtin && !fields.loc && !fields.qty) return "lot"
  if (fields.loc && !fields.gtin && !fields.sku && !fields.lot && !fields.uid) return "loc"
  if (fields.gtin || fields.sku || fields.qty || fields.uid?.toUpperCase().startsWith("BX")) return "item"
  if (fields.loc && (fields.gtin || fields.sku)) return "item"
  return "unknown"
}

function buildLookupQuery(kind: SkitMarkingKind, fields: Record<string, string>): string | null {
  const gtin = fields.gtin?.trim()
  const sku = fields.sku?.trim()
  const loc = fields.loc?.trim()
  const lot = fields.lot?.trim()
  const uid = fields.uid?.trim()

  switch (kind) {
    case "loc":
      return loc || null
    case "item":
      return gtin || sku || uid || null
    case "pallet":
      return uid || null
    case "lot":
      return gtin || lot || null
    default:
      return null
  }
}

export function parseSkitMarking(raw: string): ParsedSkitMarking {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { kind: "unknown", fields: {}, raw: trimmed, lookupQuery: null, locationCode: null }
  }

  let fields: Record<string, string> = {}

  if (hasAnyKeyEquals(trimmed)) {
    fields = parseKeyValueSegments(splitSegments(trimmed))
  } else if (trimmed.includes("$")) {
    fields = parseCompactNoEquals(trimmed)
  }

  const kind = inferKind(fields)
  let lookupQuery = buildLookupQuery(kind, fields)
  if (lookupQuery == null && kind !== "loc") {
    if (kind === "unknown" || Object.keys(fields).length === 0) {
      lookupQuery = trimmed
    }
  }

  const locationCode = fields.loc?.trim() || null

  return {
    kind,
    fields,
    raw: trimmed,
    lookupQuery,
    locationCode,
  }
}

function hasAnyKeyEquals(s: string): boolean {
  return splitSegments(s).some((seg) => {
    const i = seg.indexOf("=")
    return i > 0 && i < seg.length - 1
  })
}

export function skitMarkingHumanLines(parsed: ParsedSkitMarking): string[] {
  const lines: string[] = []
  const order = ["type", "org", "ver", "wh", "loc", "gtin", "sku", "qty", "lot", "uid", "inn"]
  const shown = new Set<string>()
  for (const key of order) {
    const v = parsed.fields[key]
    if (v) {
      lines.push(`${skitMarkingFieldLabelRu(key)}: ${v}`)
      shown.add(key)
    }
  }
  for (const key of Object.keys(parsed.fields).sort()) {
    if (shown.has(key)) continue
    lines.push(`${skitMarkingFieldLabelRu(key)}: ${parsed.fields[key]}`)
  }
  if (lines.length === 0 && parsed.raw) {
    lines.push(`Код: ${parsed.raw}`)
  }
  return lines
}
