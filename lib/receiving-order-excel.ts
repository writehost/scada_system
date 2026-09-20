import * as XLSX from "xlsx"
import type { ReceivingScanEventRow } from "@/components/wms/receiving-scan-events-table"

export type ReceivingOrderExcelInput = {
  orderNo: string
  supplierName: string
  orderDate: string
  sessionDocId: string
  scanRows: ReceivingScanEventRow[]
}

export type ReceivingOrderLine = {
  lineNo: number
  itemName: string
  itemCode: string
  markingCode: string
  qty: number
  uom: string
  scannedAt: string
}

function fmtRuDate(isoOrDate: string): string {
  const d = new Date(isoOrDate)
  if (Number.isNaN(d.getTime())) return isoOrDate
  return d.toLocaleDateString("ru-RU")
}

function fmtRuDateTime(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "medium" })
}

/** Каждый скан сессии — отдельная строка ордера (без группировки по GTIN). */
export function buildReceivingOrderLines(scanRows: ReceivingScanEventRow[]): ReceivingOrderLine[] {
  const sorted = [...scanRows].sort(
    (a, b) =>
      Date.parse(a.scannedAtIso || a.createdAt) - Date.parse(b.scannedAtIso || b.createdAt)
  )
  return sorted.map((row, index) => ({
    lineNo: index + 1,
    itemName: row.itemName?.trim() || "—",
    itemCode: row.itemCode?.trim() || "",
    markingCode: row.code,
    qty: row.qty ?? 1,
    uom: "шт",
    scannedAt: fmtRuDateTime(row.scannedAtIso || row.createdAt),
  }))
}

function buildSheetRows(input: ReceivingOrderExcelInput, lines: ReceivingOrderLine[]): unknown[][] {
  const orderNo = input.orderNo.trim() || `ПО-${input.sessionDocId.slice(0, 8)}`
  const supplier = input.supplierName.trim() || "—"
  const orderDate = input.orderDate.trim()
    ? fmtRuDate(input.orderDate.trim())
    : fmtRuDate(new Date().toISOString())
  const totalQty = lines.reduce((sum, line) => sum + line.qty, 0)

  const rows: unknown[][] = [
    ["Приходный ордер"],
    [],
    ["От кого:", supplier],
    ["Номер приходного:", orderNo],
    ["Дата:", orderDate],
    ["Сессия ТСД:", input.sessionDocId],
    [],
    ["№", "Наименование", "GTIN / артикул", "Код маркировки", "Кол-во", "Ед.", "Время скана"],
  ]

  for (const line of lines) {
    rows.push([
      line.lineNo,
      line.itemName,
      line.itemCode,
      line.markingCode,
      line.qty,
      line.uom,
      line.scannedAt,
    ])
  }

  rows.push([])
  rows.push(["Итого", "", "", `${lines.length} поз.`, totalQty, "шт", ""])

  return rows
}

export function downloadReceivingOrderExcel(input: ReceivingOrderExcelInput): { lineCount: number; totalQty: number } {
  const lines = buildReceivingOrderLines(input.scanRows)
  if (lines.length === 0) {
    throw new Error("Нет сканов для формирования ордера")
  }

  const sheetRows = buildSheetRows(input, lines)
  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows)

  worksheet["!cols"] = [
    { wch: 6 },
    { wch: 36 },
    { wch: 18 },
    { wch: 42 },
    { wch: 10 },
    { wch: 6 },
    { wch: 20 },
  ]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, "Приходный ордер")

  const orderNo = input.orderNo.trim() || `PO-${input.sessionDocId.slice(0, 8)}`
  const safeName = orderNo.replace(/[^\w\u0400-\u04FF.-]+/g, "_")
  XLSX.writeFile(workbook, `${safeName}.xlsx`, { bookType: "xlsx", compression: true })

  return {
    lineCount: lines.length,
    totalQty: lines.reduce((sum, line) => sum + line.qty, 0),
  }
}
