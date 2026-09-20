"use client"

import { useMemo, useState } from "react"
import { FileDown, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { createWmsDocument } from "@/lib/wms-api"

type ParsedIncomingOrder = {
  orderNo: string
  supplierName: string
  warehouseCode: string
  orderDate: string
  comment: string
  lines: Array<{
    itemCode: string
    itemName: string
    qty: number
    uom: string
    barcode: string
    batch: string
    expiryDate: string
    note: string
  }>
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (c === "\"") {
      const next = line[i + 1]
      if (inQuotes && next === "\"") {
        current += "\""
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (c === delimiter && !inQuotes) {
      result.push(current.trim())
      current = ""
      continue
    }
    current += c
  }
  result.push(current.trim())
  return result
}

function normalizeCell(v: string | undefined): string {
  return (v || "").trim()
}

function looksLikeVariable(v: string): boolean {
  return v.includes("${") && v.includes("}")
}

function parseIncomingOrderCsv(raw: string): ParsedIncomingOrder {
  const text = raw.replace(/\r/g, "")
  const rawLines = text.split("\n").map((l) => l.trimEnd())
  const nonEmpty = rawLines.filter((l) => l.trim().length > 0)
  if (nonEmpty.length < 4) throw new Error("Файл слишком короткий, проверьте шаблон.")

  const sample = nonEmpty[0] || ""
  const commaCount = (sample.match(/,/g) || []).length
  const semicolonCount = (sample.match(/;/g) || []).length
  const delimiter = semicolonCount > commaCount ? ";" : ","

  const rows = nonEmpty.map((line) => parseCsvLine(line, delimiter))
  const key = (x: string) => x.trim().toLowerCase()

  const headerIndex = rows.findIndex((r) => r.some((c) => key(c) === "template_version"))
  if (headerIndex < 0 || headerIndex + 1 >= rows.length) {
    throw new Error("Не нашел шапку шаблона (template_version,...).")
  }
  const headerRow = rows[headerIndex].map(key)
  const valueRow = rows[headerIndex + 1]
  const headMap = new Map<string, string>()
  headerRow.forEach((h, idx) => headMap.set(h, normalizeCell(valueRow[idx])))

  const linesHeaderIndex = rows.findIndex((r) => r.some((c) => key(c) === "line_no") && r.some((c) => key(c) === "item_code"))
  if (linesHeaderIndex < 0) throw new Error("Не нашел таблицу строк (line_no,item_code,...).")
  const lineHeader = rows[linesHeaderIndex].map(key)

  const lines: ParsedIncomingOrder["lines"] = []
  for (let i = linesHeaderIndex + 1; i < rows.length; i += 1) {
    const row = rows[i]
    if (!row || row.length === 0) continue
    const map = new Map<string, string>()
    lineHeader.forEach((h, idx) => map.set(h, normalizeCell(row[idx])))
    const itemCode = map.get("item_code") || ""
    const qtyRaw = map.get("qty") || ""
    if (!itemCode || looksLikeVariable(itemCode)) continue
    if (!qtyRaw || looksLikeVariable(qtyRaw)) continue
    const qty = Number(qtyRaw.replace(",", "."))
    if (!Number.isFinite(qty) || qty <= 0) continue
    lines.push({
      itemCode,
      itemName: map.get("item_name") || "",
      qty,
      uom: map.get("uom") || "шт",
      barcode: map.get("barcode") || "",
      batch: map.get("batch") || "",
      expiryDate: map.get("expiry_date") || "",
      note: map.get("note") || "",
    })
  }

  if (lines.length === 0) {
    throw new Error("В файле нет валидных строк товаров (item_code + qty).")
  }

  const orderNo = headMap.get("order_no") || ""
  const supplierName = headMap.get("supplier_name") || ""
  const warehouseCode = headMap.get("warehouse_code") || ""
  const orderDate = headMap.get("order_date") || ""
  const comment = headMap.get("comment") || ""

  return { orderNo, supplierName, warehouseCode, orderDate, comment, lines }
}

type Props = {
  onImported?: () => Promise<void> | void
}

export function IncomingOrderImportDialog({ onImported }: Props) {
  const [open, setOpen] = useState(false)
  const [rawText, setRawText] = useState("")
  const [targetLocationCode, setTargetLocationCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsed = useMemo(() => {
    const t = rawText.trim()
    if (!t) return null
    try {
      return parseIncomingOrderCsv(t)
    } catch {
      return null
    }
  }, [rawText])

  async function onPickFile(file: File) {
    setError(null)
    const text = await file.text()
    setRawText(text)
  }

  async function importOrder() {
    setError(null)
    const text = rawText.trim()
    if (!text) {
      setError("Загрузите CSV файл или вставьте текст шаблона.")
      return
    }
    let data: ParsedIncomingOrder
    try {
      data = parseIncomingOrderCsv(text)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось разобрать шаблон.")
      return
    }

    setLoading(true)
    try {
      const commentParts = [
        data.supplierName ? `Поставщик: ${data.supplierName}` : "",
        data.orderDate ? `Дата ордера: ${data.orderDate}` : "",
        data.comment ? data.comment : "",
      ].filter(Boolean)

      await createWmsDocument({
        documentType: "receiving",
        documentNo: data.orderNo || undefined,
        externalRef: data.orderNo || undefined,
        targetWarehouseCode: data.warehouseCode || undefined,
        targetLocationCode: targetLocationCode.trim() || undefined,
        comment: commentParts.join(" | ") || undefined,
        lines: data.lines.map((line) => ({
          itemCode: line.itemCode,
          qty: line.qty,
          requestedUomCode: line.uom || "шт",
          targetLocationCode: targetLocationCode.trim() || undefined,
          batchLabel: line.batch || undefined,
          comment: line.note || undefined,
          taskPayload: {
            source: "incoming_order_template",
            supplierName: data.supplierName || null,
            orderDate: data.orderDate || null,
            orderNo: data.orderNo || null,
            itemName: line.itemName || null,
            barcode: line.barcode || null,
            expiryDate: line.expiryDate || null,
          },
        })),
      })

      setOpen(false)
      setRawText("")
      setTargetLocationCode("")
      await onImported?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать приходный ордер.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button variant="outline" className="rounded-xl" onClick={() => setOpen(true)}>
        <Upload className="mr-2 h-4 w-4" />
        Импорт приходного ордера
      </Button>

      <Dialog open={open} onOpenChange={(v) => !loading && setOpen(v)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Импорт приходного ордера</DialogTitle>
            <DialogDescription>
              Загрузите CSV из Excel по шаблону и создайте документ приемки сразу со всеми строками.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" asChild>
                <a href="/templates/incoming-order-template.csv" download>
                  <FileDown className="mr-2 h-4 w-4" />
                  Скачать шаблон CSV
                </a>
              </Button>
              <Input
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void onPickFile(f)
                }}
                disabled={loading}
              />
            </div>

            <Input
              value={targetLocationCode}
              onChange={(e) => setTargetLocationCode(e.target.value)}
              placeholder="Ячейка размещения (опционально), например A-01-02"
              disabled={loading}
            />

            <Textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="Или вставьте CSV сюда..."
              className="min-h-[220px] font-mono text-xs"
              disabled={loading}
            />

            {parsed && (
              <div className="rounded-lg border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
                Ордер: <span className="font-mono text-foreground">{parsed.orderNo || "—"}</span> | Поставщик:{" "}
                <span className="text-foreground">{parsed.supplierName || "—"}</span> | Склад:{" "}
                <span className="font-mono text-foreground">{parsed.warehouseCode || "—"}</span> | Строк:{" "}
                <span className="font-semibold text-foreground">{parsed.lines.length}</span>
              </div>
            )}

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Отмена
            </Button>
            <Button onClick={() => void importOrder()} disabled={loading}>
              {loading ? "Импорт..." : "Создать приходный ордер"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

