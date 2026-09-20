"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Copy, Printer, QrCode } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { buildRackQrContent, buildRackScanPayload } from "@/lib/wms/rack-directory-meta"
import { sortSequentialCellCodes } from "@/lib/wms/workshop-waiting-cell"
import { getSiteCode } from "@/lib/wms-api"
import { cn } from "@/lib/utils"
import { StyledQrCode } from "@/components/wms/styled-qr-code"

type Props = {
  rackCode: string
  rackName: string
  cellCodes: string[]
  triggerOnly?: boolean
  className?: string
}

function buildPrintHtml(
  rackCode: string,
  rackName: string,
  cellCodes: string[],
  scanPayload: string,
  svgOuter: string
) {
  const cellsHtml = cellCodes
    .map(
      (c) =>
        `<li style="font-family:Consolas,monospace;font-size:8pt;margin:2px 0;word-break:break-all">${c.replace(/</g, "&lt;")}</li>`
    )
    .join("")
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Стеллаж ${rackCode}</title>
  <style>
    @page { size: 100mm 140mm; margin: 4mm; }
    body { font-family: Arial, sans-serif; margin: 0; padding: 8px; }
    h1 { font-size: 12pt; margin: 0 0 4px; font-weight: 600; text-align: center; }
    p.sub { font-size: 9pt; color: #444; margin: 0 0 8px; text-align: center; }
    .qr { text-align: center; margin: 8px 0; }
    .code { font-family: Consolas, monospace; font-size: 9pt; text-align: center; word-break: break-all; }
    ul { margin: 8px 0 0; padding-left: 16px; max-height: 55mm; overflow: hidden; }
    h2 { font-size: 9pt; margin: 10px 0 4px; }
  </style>
</head>
<body>
  <h1>${rackName.replace(/</g, "&lt;")}</h1>
  <p class="sub">Стеллаж · ${rackCode.replace(/</g, "&lt;")}</p>
  <div class="qr">${svgOuter}</div>
  <p class="code">${rackCode.replace(/</g, "&lt;")}</p>
  <h2>Ячейки (${cellCodes.length})</h2>
  <ul>${cellsHtml}</ul>
  <script>window.onload = () => { setTimeout(() => window.print(), 120); };</script>
</body>
</html>`
}

function openRackPrintWindow(html: string): boolean {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const w = window.open(url, "_blank", "width=520,height=720")
  if (!w) {
    URL.revokeObjectURL(url)
    return false
  }
  w.addEventListener("load", () => URL.revokeObjectURL(url), { once: true })
  return true
}

export function RackBarcode({ rackCode, rackName, cellCodes, triggerOnly = false, className }: Props) {
  const [open, setOpen] = useState(false)
  const [qrHost, setQrHost] = useState<HTMLDivElement | null>(null)

  const sortedCellCodes = useMemo(() => sortSequentialCellCodes(cellCodes), [cellCodes])
  const qrContent = buildRackQrContent(rackCode)
  const tsdPayload = buildRackScanPayload(getSiteCode(), rackCode, sortedCellCodes)

  const onQrHostRef = useCallback((node: HTMLDivElement | null) => {
    setQrHost(node)
  }, [])

  useEffect(() => {
    if (!open) setQrHost(null)
  }, [open])

  async function copyPayload() {
    try {
      await navigator.clipboard.writeText(tsdPayload)
    } catch {
      /* ignore */
    }
  }

  function printLabel() {
    const svg = qrHost?.querySelector("svg")
    if (!svg) return
    openRackPrintWindow(buildPrintHtml(rackCode, rackName, sortedCellCodes, qrContent, svg.outerHTML))
  }

  const trigger = (
    <Button
      type="button"
      variant={triggerOnly ? "outline" : "secondary"}
      size={triggerOnly ? "sm" : "default"}
      className={cn("rounded-xl", triggerOnly && "h-8 text-xs", className)}
      onClick={() => setOpen(true)}
      disabled={sortedCellCodes.length === 0}
    >
      <QrCode className="mr-1.5 h-4 w-4 shrink-0" />
      {triggerOnly ? "QR стеллажа" : "Штрихкод стеллажа"}
    </Button>
  )

  return (
    <>
      {trigger}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Этикетка стеллажа</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-center">
              <p className="text-sm font-semibold">{rackName}</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{rackCode}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                QR: <span className="font-mono">{qrContent}</span>
                {sortedCellCodes.length > 0 ? ` · ${sortedCellCodes.length} ячеек на стеллаже` : ""}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Список ячеек подгружается по коду стеллажа, не из QR
              </p>
            </div>
            <div
              ref={onQrHostRef}
              className="flex min-h-[180px] items-center justify-center rounded-xl border border-border/60 bg-white p-3"
            >
              {open && qrContent ? <StyledQrCode data={qrContent} size={240} className="max-w-[240px]" /> : null}
            </div>
            {sortedCellCodes.length > 0 ? (
              <div className="max-h-32 overflow-y-auto rounded-xl border bg-muted/20 p-2">
                <ul className="space-y-1 font-mono text-[10px] text-muted-foreground">
                  {sortedCellCodes.map((c) => (
                    <li key={c} className="break-all">
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button type="button" className="w-full rounded-xl" onClick={printLabel} disabled={!qrContent}>
              <Printer className="mr-2 h-4 w-4" />
              Печать этикетки
            </Button>
            <Button type="button" variant="outline" className="w-full rounded-xl" onClick={() => void copyPayload()}>
              <Copy className="mr-2 h-4 w-4" />
              Копировать JSON для ТСД
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
