import * as XLSX from "xlsx"

const SHEET_DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/
const LINE_TOTAL_HEADERS = new Set([
  "sipa",
  "devin",
  "jr",
  "итого кол-во бут",
  "дата",
  "итого",
])

export type SkitImportMode = "daily" | "monthly_plan"

export type SkitWorkbookProductColumn = {
  colIndex: number
  label: string
  lineCode: string | null
}

export type SkitWorkbookPlanRow = {
  sheetName: string
  sheetMonth: string
  planDate: string
  planDateTo: string | null
  productLabel: string
  lineCode: string | null
  plannedQty: number
  externalId: string
  importMode: SkitImportMode
}

export type SkitWorkbookParseResult = {
  sheetNames: string[]
  parsedSheets: string[]
  rows: SkitWorkbookPlanRow[]
  skippedSheets: string[]
  warnings: string[]
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

function sheetMonthFromName(name: string): string | null {
  const m = SHEET_DATE_RE.exec(name.trim())
  if (!m) return null
  return `${m[3]}-${m[2]}`
}

function monthEndDate(monthKey: string): string {
  const [y, mo] = monthKey.split("-").map(Number)
  const last = new Date(y, mo, 0)
  return toDateKey(last)
}

function cellToDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d)
  }
  if (typeof value === "string") {
    const s = value.trim()
    const dmy = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s)
    if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]))
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  }
  return null
}

function asQty(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const n = Number(value.replace(/\s/g, "").replace(",", "."))
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function isLineTotalHeader(label: string): boolean {
  const key = label.trim().toLowerCase()
  return LINE_TOTAL_HEADERS.has(key)
}

function findHeaderRow(matrix: unknown[][]): number {
  for (let i = 0; i < Math.min(matrix.length, 30); i++) {
    const b = matrix[i]?.[1]
    if (typeof b === "string" && b.trim().toLowerCase() === "дата") return i
  }
  return 18
}

function readProductColumns(matrix: unknown[][], headerRow: number, lineRow: number): SkitWorkbookProductColumn[] {
  const header = matrix[headerRow] ?? []
  const lines = matrix[lineRow] ?? []
  const out: SkitWorkbookProductColumn[] = []
  for (let col = 6; col < header.length; col++) {
    const raw = header[col]
    const label = typeof raw === "string" ? raw.trim() : raw != null ? String(raw).trim() : ""
    if (!label || isLineTotalHeader(label)) continue
    const lineRaw = lines[col]
    const lineCode =
      typeof lineRaw === "string" && lineRaw.trim() ? lineRaw.trim() : lineRaw != null ? String(lineRaw).trim() : null
    out.push({ colIndex: col, label, lineCode: lineCode || null })
  }
  return out
}

function parseDailyRows(
  matrix: unknown[][],
  sheetName: string,
  sheetMonth: string,
  headerRow: number,
  columns: SkitWorkbookProductColumn[]
): SkitWorkbookPlanRow[] {
  const rows: SkitWorkbookPlanRow[] = []
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? []
    const b = row[1]
    if (typeof b === "string" && /план|факт|откл/i.test(b)) continue
    const planDate = cellToDate(b)
    if (!planDate) continue
    const planDateKey = toDateKey(planDate)
    for (const col of columns) {
      const qty = asQty(row[col.colIndex])
      if (qty <= 0) continue
      const slug = slugify(col.label)
      rows.push({
        sheetName,
        sheetMonth,
        planDate: planDateKey,
        planDateTo: null,
        productLabel: col.label,
        lineCode: col.lineCode,
        plannedQty: qty,
        externalId: `skit:${sheetMonth}:${slug}:${planDateKey}`,
        importMode: "daily",
      })
    }
  }
  return rows
}

function parseMonthlyPlanRow(
  matrix: unknown[][],
  sheetName: string,
  sheetMonth: string,
  headerRow: number,
  columns: SkitWorkbookProductColumn[]
): SkitWorkbookPlanRow[] {
  const rows: SkitWorkbookPlanRow[] = []
  const planDate = `${sheetMonth}-01`
  const planDateTo = monthEndDate(sheetMonth)
  for (let r = headerRow + 1; r < Math.min(matrix.length, headerRow + 8); r++) {
    const row = matrix[r] ?? []
    const label = row[1]
    if (typeof label !== "string" || label.trim().toLowerCase() !== "план") continue
    for (const col of columns) {
      const qty = asQty(row[col.colIndex])
      if (qty <= 0) continue
      const slug = slugify(col.label)
      rows.push({
        sheetName,
        sheetMonth,
        planDate,
        planDateTo,
        productLabel: col.label,
        lineCode: col.lineCode,
        plannedQty: qty,
        externalId: `skit:${sheetMonth}:${slug}:month-plan`,
        importMode: "monthly_plan",
      })
    }
    break
  }
  return rows
}

export function parseSkitProductionWorkbook(
  buffer: ArrayBuffer,
  opts?: { mode?: SkitImportMode; sheetNames?: string[] }
): SkitWorkbookParseResult {
  const mode = opts?.mode ?? "daily"
  const wb = XLSX.read(buffer, { type: "array", cellDates: true })
  const wanted = opts?.sheetNames?.length
    ? new Set(opts.sheetNames)
    : null

  const rows: SkitWorkbookPlanRow[] = []
  const parsedSheets: string[] = []
  const skippedSheets: string[] = []
  const warnings: string[] = []

  for (const sheetName of wb.SheetNames) {
    if (!SHEET_DATE_RE.test(sheetName.trim())) continue
    if (wanted && !wanted.has(sheetName)) continue
    const sheetMonth = sheetMonthFromName(sheetName)
    if (!sheetMonth) {
      skippedSheets.push(sheetName)
      continue
    }
    const ws = wb.Sheets[sheetName]
    if (!ws) {
      skippedSheets.push(sheetName)
      continue
    }
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: null,
      raw: true,
    }) as unknown[][]
    const headerRow = findHeaderRow(matrix)
    const lineRow = Math.max(0, headerRow - 6)
    const columns = readProductColumns(matrix, headerRow, lineRow)
    if (columns.length === 0) {
      warnings.push(`Лист «${sheetName}»: не найдены колонки номенклатуры`)
      skippedSheets.push(sheetName)
      continue
    }
    const sheetRows =
      mode === "monthly_plan"
        ? parseMonthlyPlanRow(matrix, sheetName, sheetMonth, headerRow, columns)
        : parseDailyRows(matrix, sheetName, sheetMonth, headerRow, columns)
    if (sheetRows.length === 0) {
      warnings.push(`Лист «${sheetName}»: нет строк с количеством > 0`)
    } else {
      parsedSheets.push(sheetName)
      rows.push(...sheetRows)
    }
  }

  return {
    sheetNames: wb.SheetNames.filter((n) => SHEET_DATE_RE.test(n.trim())),
    parsedSheets,
    rows,
    skippedSheets,
    warnings,
  }
}

/** Токены для поиска номенклатуры WMS по подписи колонки книги. */
export function skitLabelSearchTokens(label: string): string[] {
  const normalized = label
    .toLowerCase()
    .replace(/№/g, " ")
    .replace(/[^\p{L}\p{N}\s,.]/gu, " ")
  const tokens = normalized
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !["газ", "н/г", "план", "славда", "напитки"].includes(t))
  return [...new Set(tokens)].slice(0, 4)
}
