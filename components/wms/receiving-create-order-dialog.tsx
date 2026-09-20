"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Download, FileInput } from "lucide-react"
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
import { createWmsDocument } from "@/lib/wms-api"
import { buildReceivingOrderLines, downloadReceivingOrderExcel } from "@/lib/receiving-order-excel"
import type { ReceivingScanEventRow } from "@/components/wms/receiving-scan-events-table"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionDocId: string
  scanRows: ReceivingScanEventRow[]
  onCreated?: () => void
}

export function ReceivingCreateOrderDialog({
  open,
  onOpenChange,
  sessionDocId,
  scanRows,
  onCreated,
}: Props) {
  const [supplierName, setSupplierName] = useState("")
  const [documentNo, setDocumentNo] = useState("")
  const [orderDate, setOrderDate] = useState("")
  const [targetLocationCode, setTargetLocationCode] = useState("")
  const [loading, setLoading] = useState<"excel" | "wms" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createdDocId, setCreatedDocId] = useState<string | null>(null)
  const [excelDone, setExcelDone] = useState(false)

  useEffect(() => {
    if (!open) return
    const today = new Date()
    const isoDate = today.toISOString().slice(0, 10)
    setOrderDate((prev) => prev || isoDate)
    setDocumentNo((prev) => prev || `ПО-${sessionDocId.slice(0, 8)}`)
    setError(null)
    setCreatedDocId(null)
    setExcelDone(false)
  }, [open, sessionDocId])

  const lines = useMemo(() => buildReceivingOrderLines(scanRows), [scanRows])
  const totalQty = useMemo(() => lines.reduce((sum, line) => sum + line.qty, 0), [lines])

  function handleDownloadExcel() {
    setError(null)
    try {
      downloadReceivingOrderExcel({
        orderNo: documentNo,
        supplierName,
        orderDate,
        sessionDocId,
        scanRows,
      })
      setExcelDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сформировать Excel")
    }
  }

  async function handleCreateWms() {
    setError(null)
    const withGtin = lines.filter((line) => line.itemCode)
    if (withGtin.length === 0) {
      setError("Нет строк с GTIN — документ WMS создать нельзя.")
      return
    }
    setLoading("wms")
    try {
      const result = await createWmsDocument({
        documentType: "receiving",
        documentNo: documentNo.trim() || undefined,
        externalRef: sessionDocId,
        targetLocationCode: targetLocationCode.trim() || undefined,
        comment: [
          supplierName.trim() ? `Поставщик: ${supplierName.trim()}` : "",
          `Сессия ТСД ${sessionDocId}`,
        ]
          .filter(Boolean)
          .join(" | "),
        lines: withGtin.map((line) => ({
          itemCode: line.itemCode,
          qty: line.qty,
          targetLocationCode: targetLocationCode.trim() || undefined,
          comment: line.markingCode.slice(0, 120),
          taskPayload: {
            source: "receiving_session",
            tsdDocumentId: sessionDocId,
            itemName: line.itemName,
            markingCode: line.markingCode,
            lineNo: line.lineNo,
            supplierName: supplierName.trim() || null,
            orderDate: orderDate || null,
          },
        })),
      })
      setCreatedDocId(result.documentId)
      onCreated?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать документ WMS")
    } finally {
      setLoading(null)
    }
  }

  function handleClose(next: boolean) {
    if (!next) {
      setError(null)
      setCreatedDocId(null)
      setExcelDone(false)
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[min(92vh,52rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-border/60 px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-2 pr-8">
            <FileInput className="h-5 w-5 shrink-0" />
            Приходный ордер из сессии
          </DialogTitle>
          <DialogDescription>
            Каждый скан сессии <span className="font-mono text-xs">{sessionDocId}</span> — отдельная строка в
            таблице. Excel и «Документ WMS» <strong>не кладут остаток в ячейку</strong> — для этого после закрытия
            сессии нажмите «Провести на остаток».
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {createdDocId ? (
          <div className="space-y-3">
            <p className="text-sm text-foreground">
              Документ WMS <span className="font-medium">#{createdDocId}</span> создан ({lines.length} строк).
            </p>
            <Button asChild className="rounded-xl">
              <Link href={`/documents/${encodeURIComponent(createdDocId)}`}>Открыть документ WMS</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">От кого (поставщик)</label>
                <Input
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="ООО Поставщик"
                  className="rounded-xl"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Номер приходного</label>
                <Input
                  value={documentNo}
                  onChange={(e) => setDocumentNo(e.target.value)}
                  placeholder={`ПО-${sessionDocId.slice(0, 8)}`}
                  className="rounded-xl"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Дата</label>
                <Input
                  type="date"
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                  className="rounded-xl"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Ячейка приёмки WMS (только для создания документа)
                </label>
                <Input
                  value={targetLocationCode}
                  onChange={(e) => setTargetLocationCode(e.target.value)}
                  placeholder="RCV-01"
                  className="rounded-xl"
                />
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border/60">
              <div className="border-b border-border/60 bg-secondary/20 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Позиции ({lines.length}) · кол-во {totalQty}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-secondary/10 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">№</th>
                      <th className="px-3 py-2">Наименование</th>
                      <th className="px-3 py-2">GTIN</th>
                      <th className="px-3 py-2 text-right">Кол-во</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={`${line.lineNo}-${line.markingCode}`} className="border-t border-border/60">
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{line.lineNo}</td>
                        <td className="min-w-[240px] px-3 py-2 align-top">
                          <div className="whitespace-normal break-words font-medium leading-snug">
                            {line.itemName}
                          </div>
                          <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                            {line.markingCode}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{line.itemCode || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{line.qty}</td>
                      </tr>
                    ))}
                    {lines.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">
                          В сессии нет сканов
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {excelDone ? (
              <p className="text-xs text-emerald-700">Excel-файл сформирован и скачан.</p>
            ) : null}

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        )}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-border/60 bg-background px-6 py-4 sm:justify-between">
          {createdDocId ? (
            <Button variant="outline" className="rounded-xl" onClick={() => handleClose(false)}>
              Закрыть
            </Button>
          ) : (
            <>
              <Button variant="outline" className="rounded-xl" onClick={() => handleClose(false)} disabled={!!loading}>
                Отмена
              </Button>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => void handleCreateWms()}
                  disabled={!!loading || lines.filter((l) => l.itemCode).length === 0}
                >
                  {loading === "wms" ? "Создание…" : "Документ WMS"}
                </Button>
                <Button
                  className="rounded-xl"
                  onClick={handleDownloadExcel}
                  disabled={!!loading || lines.length === 0}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Скачать Excel
                </Button>
              </div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
