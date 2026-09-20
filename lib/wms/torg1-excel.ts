import * as XLSX from "xlsx"
import type { Torg1Fields, Torg1Line } from "@/lib/wms/torg1"
import { TORG1_OKUD, ruMonthGenitive, splitRuDate } from "@/lib/wms/torg1"
import obrazecGrid from "@/components/wms/torg1/torg1-obrazec-page1.json"
import { TORG1_OBRAZEC_FIELD_SLOTS } from "@/components/wms/torg1/torg1-obrazec-slots"
import { fillTorg1XlsxPreservingLayout } from "@/lib/wms/torg1-xlsx-preserving"

const SHEET_BLANK = "ТОРГ-1 стр.1"
const SHEET_GOODS = "Товар"
const SHEET_META = "_wms"
const SHEET_VARS = "Переменные"

/** Все ключи, которые можно ставить в шаблон как {{key}}. */
export const TORG1_EXCEL_VARIABLE_KEYS: Array<{ key: string; hint: string }> = [
  { key: "orgName", hint: "Организация" },
  { key: "orgAddress", hint: "Адрес" },
  { key: "orgPhone", hint: "Телефон" },
  { key: "orgLine", hint: "Организация, адрес, телефон одной строкой" },
  { key: "okpo", hint: "ОКПО" },
  { key: "okud", hint: "ОКУД" },
  { key: "okdp", hint: "ОКДП" },
  { key: "structuralUnit", hint: "Структурное подразделение / склад" },
  { key: "cameraNo", hint: "Камера" },
  { key: "sectionNo", hint: "Секция" },
  { key: "basisDoc", hint: "Основание (приказ…)" },
  { key: "basisNo", hint: "Номер основания" },
  { key: "basisDate", hint: "Дата основания (ДД.ММ.ГГГГ)" },
  { key: "operationKind", hint: "Вид операции" },
  { key: "documentNo", hint: "Номер документа" },
  { key: "composedAt", hint: "Дата составления" },
  { key: "approveTitle", hint: "Утверждаю — должность" },
  { key: "approveName", hint: "Утверждаю — ФИО" },
  { key: "approveSign", hint: "Утверждаю — подпись/фамилия" },
  { key: "approveDate", hint: "Дата утверждения" },
  { key: "place", hint: "Место приёмки" },
  { key: "commissionNote", hint: "Текст комиссии" },
  { key: "commissionDate", hint: "Дата комиссии" },
  { key: "accompanyingDocs", hint: "Сопроводительные документы" },
  { key: "representativeCall", hint: "Вызов представителя" },
  { key: "callDocNo", hint: "№ вызова" },
  { key: "callDocDate", hint: "Дата вызова" },
  { key: "shipper", hint: "Грузоотправитель" },
  { key: "manufacturer", hint: "Производитель" },
  { key: "supplier", hint: "Поставщик" },
  { key: "insurer", hint: "Страховая компания" },
  { key: "contractNo", hint: "№ договора" },
  { key: "contractDate", hint: "Дата договора" },
  { key: "invoiceNo", hint: "№ счёта-фактуры" },
  { key: "invoiceDate", hint: "Дата счёта-фактуры" },
  { key: "commercialAct", hint: "Коммерческий акт" },
  { key: "commercialActDate", hint: "Дата коммерческого акта" },
  { key: "vetCert", hint: "Вет. свидетельство" },
  { key: "vetCertDate", hint: "Дата вет. свидетельства" },
  { key: "railWaybill", hint: "Ж/д накладная" },
  { key: "railWaybillDate", hint: "Дата ж/д накладной" },
  { key: "deliveryMethod", hint: "Способ доставки" },
  { key: "vehicleNo", hint: "№ транспорта" },
  { key: "shipDate", hint: "Дата отправления" },
  { key: "fromStation", hint: "Станция отправления" },
  { key: "fromStationOrWarehouse", hint: "Склад отправителя" },
  { key: "meatTemp", hint: "Температура" },
  { key: "arrivedAt", hint: "Дата прибытия" },
  { key: "arrivedTime", hint: "Время прибытия" },
  { key: "acceptStart", hint: "Начало приёмки (дата)" },
  { key: "acceptStartTime", hint: "Начало приёмки (время)" },
  { key: "acceptPause", hint: "Приостановление (дата)" },
  { key: "acceptPauseTime", hint: "Приостановление (время)" },
  { key: "acceptResume", hint: "Возобновление (дата)" },
  { key: "acceptResumeTime", hint: "Возобновление (время)" },
  { key: "acceptEnd", hint: "Окончание (дата)" },
  { key: "acceptEndTime", hint: "Окончание (время)" },
  { key: "lines", hint: "Наименования товара (каждое с новой строки в ячейке; или разворот строк таблицы)" },
  { key: "lines.names", hint: "Только наименования, через перевод строки" },
  { key: "lines.count", hint: "Количество позиций" },
  { key: "line.name", hint: "В строке-шаблоне таблицы: наименование (размножается по строкам)" },
  { key: "line.qtyDoc", hint: "В строке-шаблоне: кол-во по документу" },
  { key: "line.qtyFact", hint: "В строке-шаблоне: кол-во факт" },
  { key: "line.itemCode", hint: "В строке-шаблоне: код номенклатуры" },
  { key: "line.uom", hint: "В строке-шаблоне: ед. изм." },
  { key: "line.lotCode", hint: "В строке-шаблоне: партия" },
  { key: "lines.1.name", hint: "Наименование 1-й позиции (lines.2.name, …)" },
  { key: "composedAt.day", hint: "День даты составления" },
  { key: "composedAt.month", hint: "Месяц (число) даты составления" },
  { key: "composedAt.monthWord", hint: "Месяц словом (августа)" },
  { key: "composedAt.year", hint: "Год даты составления" },
  { key: "composedAt.yearShort", hint: "Год короткий (26)" },
  { key: "approveDate.day", hint: "День даты утверждения" },
  { key: "approveDate.monthWord", hint: "Месяц словом даты утверждения" },
  { key: "approveDate.year", hint: "Год даты утверждения" },
  { key: "approveDate.yearShort", hint: "Год короткий утверждения" },
]

const VAR_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g

const LINE_FIELD_GETTERS: Record<string, (line: Torg1Line, index: number) => string> = {
  name: (l) => (l.name || l.itemCode || "").trim(),
  itemCode: (l) => (l.itemCode || "").trim(),
  uom: (l) => (l.uom || "").trim(),
  qtyDoc: (l) => String(l.qtyDoc ?? "").trim(),
  qtyFact: (l) => String(l.qtyFact ?? "").trim(),
  lotCode: (l) => (l.lotCode || "").trim(),
  note: (l) => (l.note || "").trim(),
  lineNo: (_l, i) => String(i + 1),
}

function lineFieldValue(line: Torg1Line, field: string, index: number): string {
  const getter = LINE_FIELD_GETTERS[field]
  return getter ? getter(line, index) : ""
}

function appendLineVars(map: Record<string, string>, lines: Torg1Line[]) {
  const names = lines.map((l, i) => lineFieldValue(l, "name", i)).filter(Boolean)
  map.lines = names.join("\n")
  map["lines.names"] = map.lines
  map["lines.count"] = String(lines.length)

  lines.forEach((line, i) => {
    const n = i + 1
    for (const field of Object.keys(LINE_FIELD_GETTERS)) {
      const val = lineFieldValue(line, field, i)
      map[`lines.${n}.${field}`] = val
      map[`line.${n}.${field}`] = val
    }
  })
}

function buildLineRowVars(line: Torg1Line, index: number): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const field of Object.keys(LINE_FIELD_GETTERS)) {
    vars[`line.${field}`] = lineFieldValue(line, field, index)
    vars[`lines.${index + 1}.${field}`] = lineFieldValue(line, field, index)
  }
  return vars
}

function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v == null) return ""
  return String(cell.v)
}

function cloneCell(cell: XLSX.CellObject): XLSX.CellObject {
  return {
    ...cell,
    s: cell.s && typeof cell.s === "object" ? { ...cell.s } : cell.s,
  }
}

/** Заменяет значение, не уничтожая стиль, рамку и формат исходной ячейки. */
function setCellText(
  ws: XLSX.WorkSheet,
  row: number,
  col: number,
  text: string,
  source?: XLSX.CellObject
) {
  const addr = XLSX.utils.encode_cell({ r: row, c: col })
  const current = source ?? (ws[addr] as XLSX.CellObject | undefined)
  const next = current ? cloneCell(current) : ({ t: "s", v: "" } as XLSX.CellObject)
  next.t = "s"
  next.v = text
  delete next.w
  delete next.f
  ws[addr] = next
}

function shiftSheetRowsDown(ws: XLSX.WorkSheet, fromRow: number, count: number) {
  if (count <= 0) return
  const ref = ws["!ref"]
  if (!ref) return
  const range = XLSX.utils.decode_range(ref)
  for (let r = range.e.r; r >= fromRow; r -= 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const fromAddr = XLSX.utils.encode_cell({ r, c })
      const cell = ws[fromAddr]
      if (!cell) continue
      delete ws[fromAddr]
      ws[XLSX.utils.encode_cell({ r: r + count, c })] = cell
    }
  }

  const rows = ws["!rows"]
  if (rows) {
    for (let r = rows.length - 1; r >= fromRow; r -= 1) {
      rows[r + count] = rows[r]
    }
    for (let r = fromRow; r < fromRow + count; r += 1) {
      rows[r] = undefined
    }
  }

  if (ws["!merges"]) {
    ws["!merges"] = ws["!merges"].map((m) => {
      if (m.s.r >= fromRow) {
        return { s: { r: m.s.r + count, c: m.s.c }, e: { r: m.e.r + count, c: m.e.c } }
      }
      if (m.e.r >= fromRow) {
        return { s: m.s, e: { r: m.e.r + count, c: m.e.c } }
      }
      return m
    })
  }
  range.e.r += count
  ws["!ref"] = XLSX.utils.encode_range(range)
}

const LINE_TEMPLATE_RE =
  /\{\{?\s*(?:line\.(?:name|itemCode|uom|qtyDoc|qtyFact|lotCode|note|lineNo)|lines(?:\.names)?)\s*\}\}/

function rowHasLineTemplate(ws: XLSX.WorkSheet, row: number, colStart: number, colEnd: number): boolean {
  for (let c = colStart; c <= colEnd; c += 1) {
    const t = cellText(ws[XLSX.utils.encode_cell({ r: row, c })])
    if (LINE_TEMPLATE_RE.test(t)) return true
  }
  return false
}

function substituteLineVars(text: string, line: Torg1Line, index: number): string {
  const lineVars = buildLineRowVars(line, index)
  const name = lineFieldValue(line, "name", index)
  return text.replace(
    /\{\{?\s*(line\.(?:name|itemCode|uom|qtyDoc|qtyFact|lotCode|note|lineNo)|lines(?:\.names)?)\s*\}\}/g,
    (_full, key: string) => {
      if (key === "lines" || key === "lines.names") return name
      return lineVars[key] ?? ""
    }
  )
}

type TemplateRowCell = {
  col: number
  cell: XLSX.CellObject
  text: string
  isLineVariable: boolean
}

function snapshotTemplateRow(
  ws: XLSX.WorkSheet,
  row: number,
  colStart: number,
  colEnd: number
): TemplateRowCell[] {
  const cells: TemplateRowCell[] = []
  for (let c = colStart; c <= colEnd; c += 1) {
    const addr = XLSX.utils.encode_cell({ r: row, c })
    const cell = ws[addr] as XLSX.CellObject | undefined
    if (!cell) continue
    const text = cellText(cell)
    cells.push({
      col: c,
      cell: cloneCell(cell),
      text,
      isLineVariable: LINE_TEMPLATE_RE.test(text),
    })
  }
  return cells
}

function applyFirstLineToTemplateRow(
  ws: XLSX.WorkSheet,
  row: number,
  cells: TemplateRowCell[],
  line: Torg1Line,
  index: number
) {
  for (const item of cells) {
    if (!item.isLineVariable) continue
    setCellText(ws, row, item.col, substituteLineVars(item.text, line, index), item.cell)
  }
}

function cloneTemplateRowForLine(
  ws: XLSX.WorkSheet,
  targetRow: number,
  cells: TemplateRowCell[],
  line: Torg1Line,
  index: number
) {
  for (const item of cells) {
    const cloned = cloneCell(item.cell)
    if (item.isLineVariable) {
      setCellText(ws, targetRow, item.col, substituteLineVars(item.text, line, index), cloned)
    } else {
      // Сохраняем рамки/формат строки, но не повторяем дату и другой статичный текст.
      setCellText(ws, targetRow, item.col, "", cloned)
    }
  }
}

/** {{lines}} или {{line.name}} в строке — размножить строки таблицы товара. */
function expandLineRowsInSheet(ws: XLSX.WorkSheet, fields: Torg1Fields) {
  const ref = ws["!ref"]
  if (!ref) return
  const range = XLSX.utils.decode_range(ref)
  const templateRows: number[] = []

  for (let r = range.s.r; r <= range.e.r; r += 1) {
    if (rowHasLineTemplate(ws, r, range.s.c, range.e.c)) templateRows.push(r)
  }
  templateRows.sort((a, b) => b - a)

  for (const templateRow of templateRows) {
    const lines = fields.lines.length
      ? fields.lines
      : [{ lineNo: 1, name: "", itemCode: "", uom: "шт", qtyDoc: "", qtyFact: "", lotCode: "", note: "" }]
    const templateCells = snapshotTemplateRow(ws, templateRow, range.s.c, range.e.c)
    const templateRowInfo = ws["!rows"]?.[templateRow]
      ? { ...ws["!rows"]![templateRow] }
      : undefined
    const rowMerges = (ws["!merges"] ?? [])
      .filter((merge) => merge.s.r === templateRow && merge.e.r === templateRow)
      .map((merge) => ({
        s: { r: merge.s.r, c: merge.s.c },
        e: { r: merge.e.r, c: merge.e.c },
      }))

    const extra = lines.length - 1
    if (extra > 0) shiftSheetRowsDown(ws, templateRow + 1, extra)

    applyFirstLineToTemplateRow(ws, templateRow, templateCells, lines[0], 0)

    for (let i = 1; i < lines.length; i += 1) {
      const targetRow = templateRow + i
      cloneTemplateRowForLine(ws, targetRow, templateCells, lines[i], i)
      if (templateRowInfo) {
        ws["!rows"] ??= []
        ws["!rows"]![targetRow] = { ...templateRowInfo }
      }
      for (const merge of rowMerges) {
        ws["!merges"] ??= []
        ws["!merges"]!.push({
          s: { r: targetRow, c: merge.s.c },
          e: { r: targetRow, c: merge.e.c },
        })
      }
    }
  }
}

function dateParts(value: string) {
  const [day, month, year] = splitRuDate(value)
  const monthWord = ruMonthGenitive(month) || month
  const yearShort = year.length === 4 ? year.slice(2) : year
  return { day, month, year, monthWord, yearShort }
}

/** Карта значений для подстановки {{key}}. */
export function buildTorg1VarMap(fields: Torg1Fields): Record<string, string> {
  const map: Record<string, string> = {}
  for (const [k, v] of Object.entries(fields)) {
    if (k === "lines") continue
    if (typeof v === "string") map[k] = v
  }
  map.orgLine = [fields.orgName, fields.orgAddress, fields.orgPhone].filter(Boolean).join(", ")
  map.okud = fields.okud || TORG1_OKUD

  for (const dateKey of [
    "composedAt",
    "approveDate",
    "basisDate",
    "commissionDate",
    "callDocDate",
    "contractDate",
    "invoiceDate",
    "commercialActDate",
    "vetCertDate",
    "railWaybillDate",
    "shipDate",
    "arrivedAt",
    "acceptStart",
    "acceptPause",
    "acceptResume",
    "acceptEnd",
  ] as const) {
    const parts = dateParts(fields[dateKey] || "")
    map[`${dateKey}.day`] = parts.day
    map[`${dateKey}.month`] = parts.month
    map[`${dateKey}.monthWord`] = parts.monthWord
    map[`${dateKey}.year`] = parts.year
    map[`${dateKey}.yearShort`] = parts.yearShort
  }

  appendLineVars(map, fields.lines)
  return map
}

export function substituteTorg1Vars(text: string, vars: Record<string, string>): string {
  if (!text || !text.includes("{{")) return text
  return text.replace(VAR_RE, (_, key: string) => {
    const k = key.trim()
    return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] ?? "" : `{{${k}}}`
  })
}

function linesToAoA(lines: Torg1Line[]): unknown[][] {
  const header = ["№", "Наименование", "Код", "ЕИ", "Кол-во по док.", "Кол-во факт", "Партия", "Примечание"]
  const body = lines.map((line) => [
    line.lineNo,
    line.name,
    line.itemCode,
    line.uom,
    line.qtyDoc,
    line.qtyFact,
    line.lotCode,
    line.note,
  ])
  return [header, ...body]
}

function applyVarsToSheet(ws: XLSX.WorkSheet, vars: Record<string, string>) {
  const ref = ws["!ref"]
  if (!ref) return
  const range = XLSX.utils.decode_range(ref)
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c })
      const cell = ws[addr] as XLSX.CellObject | undefined
      if (!cell || cell.v == null) continue
      if (typeof cell.v === "string" && cell.v.includes("{{")) {
        cell.v = substituteTorg1Vars(cell.v, vars)
        cell.t = "s"
        if (cell.w) delete cell.w
      }
    }
  }
}

function upsertGoodsSheet(wb: XLSX.WorkBook, lines: Torg1Line[]) {
  const goods = XLSX.utils.aoa_to_sheet(linesToAoA(lines))
  goods["!cols"] = [
    { wch: 4 },
    { wch: 48 },
    { wch: 18 },
    { wch: 6 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 18 },
  ]
  if (wb.Sheets[SHEET_GOODS]) {
    wb.Sheets[SHEET_GOODS] = goods
  } else {
    XLSX.utils.book_append_sheet(wb, goods, SHEET_GOODS)
  }
}

/** Стартовый шаблон: бланк с {{переменными}} в слотах + лист «Переменные». */
export function buildTorg1PlaceholderTemplate(): XLSX.WorkBook {
  const grid = obrazecGrid.rows.map((row) => row.map((cell) => String(cell ?? "")))
  for (const slot of TORG1_OBRAZEC_FIELD_SLOTS) {
    if (!grid[slot.row]) continue
    if (slot.kind === "orgLine") {
      grid[slot.row][slot.col] = "{{orgLine}}"
    } else if (slot.kind === "datePart") {
      grid[slot.row][slot.col] = `{{${slot.key}.${slot.part}}}`
    } else {
      grid[slot.row][slot.col] = `{{${slot.key}}}`
    }
  }

  const wb = XLSX.utils.book_new()
  const blank = XLSX.utils.aoa_to_sheet(grid)
  blank["!cols"] = Array.from({ length: obrazecGrid.cols }, () => ({ wch: 3 }))
  XLSX.utils.book_append_sheet(wb, blank, SHEET_BLANK)

  upsertGoodsSheet(wb, [])

  const varsAoA: unknown[][] = [["Переменная", "Описание", "Пример в ячейке"]]
  for (const v of TORG1_EXCEL_VARIABLE_KEYS) {
    varsAoA.push([v.key, v.hint, `{{${v.key}}}`])
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(varsAoA), SHEET_VARS)

  const meta = XLSX.utils.aoa_to_sheet([
    ["wmsForm", "torg1-template"],
    ["placeholderStyle", "{{variable}}"],
    ["note", "Правьте лист ТОРГ-1: оставляйте {{documentNo}} и т.п. — WMS подставит значения"],
  ])
  XLSX.utils.book_append_sheet(wb, meta, SHEET_META)
  return wb
}

/** Заполнить шаблон (Buffer/WB) значениями полей. */
export function fillTorg1ExcelTemplate(template: ArrayBuffer | Buffer | XLSX.WorkBook, fields: Torg1Fields): XLSX.WorkBook {
  const wb =
    typeof (template as XLSX.WorkBook).SheetNames !== "undefined"
      ? (template as XLSX.WorkBook)
      : XLSX.read(template as ArrayBuffer | Buffer, { type: "array", cellStyles: true })

  const vars = buildTorg1VarMap(fields)
  for (const name of wb.SheetNames) {
    if (name === SHEET_META || name === SHEET_VARS) continue
    const ws = wb.Sheets[name]
    if (!ws) continue
    expandLineRowsInSheet(ws, fields)
    applyVarsToSheet(ws, vars)
  }
  // Пользовательский шаблон не меняем добавлением лишних листов.
  // В стартовом шаблоне лист «Товар» уже существует и обновляется здесь.
  if (wb.Sheets[SHEET_GOODS]) {
    upsertGoodsSheet(wb, fields.lines)
  }
  return wb
}

export function workbookToArrayBuffer(wb: XLSX.WorkBook): ArrayBuffer {
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as Uint8Array
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer
}

export function downloadWorkbook(wb: XLSX.WorkBook, fileName: string) {
  const safe = fileName.replace(/[\\/:*?"<>|]+/g, "_").trim() || "torg1"
  XLSX.writeFile(wb, safe.toLowerCase().endsWith(".xlsx") ? safe : `${safe}.xlsx`)
}

/** Fallback без загруженного шаблона: генерим placeholder-template и сразу заполняем. */
export function buildFilledTorg1Excel(fields: Torg1Fields): XLSX.WorkBook {
  return fillTorg1ExcelTemplate(buildTorg1PlaceholderTemplate(), fields)
}

export function downloadTorg1Excel(fields: Torg1Fields, fileName: string) {
  downloadWorkbook(buildFilledTorg1Excel(fields), fileName)
}

export function downloadTorg1PlaceholderTemplate(fileName = "TORG-1-shablon.xlsx") {
  downloadWorkbook(buildTorg1PlaceholderTemplate(), fileName)
}

export async function fillTorg1ExcelFromTemplateBytes(
  templateBytes: ArrayBuffer,
  fields: Torg1Fields,
  fileName: string
) {
  const bytes = fillTorg1XlsxPreservingLayout(
    templateBytes,
    buildTorg1VarMap(fields),
    fields.lines
  )
  const safe = fileName.replace(/[\\/:*?"<>|]+/g, "_").trim() || "torg1"
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = safe.toLowerCase().endsWith(".xlsx") ? safe : `${safe}.xlsx`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Заполненный xlsx в память (для массовой выгрузки). templateBytes=null → стартовый шаблон. */
export function fillTorg1ExcelToBytes(templateBytes: ArrayBuffer | null, fields: Torg1Fields): ArrayBuffer {
  if (templateBytes) {
    return fillTorg1XlsxPreservingLayout(
      templateBytes,
      buildTorg1VarMap(fields),
      fields.lines
    )
  }
  return workbookToArrayBuffer(buildFilledTorg1Excel(fields))
}
