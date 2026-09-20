"use client"

import dynamic from "next/dynamic"
import { useEffect, useMemo, useRef, useState } from "react"
import { Copy, ExternalLink, Printer, QrCode } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  buildCellLabelPrintHtml,
  buildCellLabelValues,
  openLabelPrintWindow,
  readCellLabelTemplate,
  CELL_LABEL_TEMPLATE_EVENT,
  type CellLabelRenderContext,
} from "@/lib/cell-label-template"
import { cellScanUrl } from "@/lib/cell-scan-url"
import { cn } from "@/lib/utils"
import type { StorageSlotProfile } from "@/lib/storage-slot-ui"

const CellLabelPreview = dynamic(
  () => import("@/components/wms/cell-label-preview").then((m) => m.CellLabelPreview),
  { ssr: false, loading: () => <div className="h-32 w-full animate-pulse rounded-xl bg-muted/40" /> }
)

type Props = {
  locationCode: string
  title?: string | null
  subtitle?: string | null
  warehouseCode?: string | null
  zoneCode?: string | null
  slotProfile?: StorageSlotProfile | null
  displayName?: string | null
  triggerOnly?: boolean
  className?: string
}

export function CellLocationBarcode({
  locationCode,
  title,
  subtitle,
  warehouseCode,
  zoneCode,
  slotProfile,
  displayName,
  triggerOnly = false,
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)
  const [template, setTemplate] = useState(() => readCellLabelTemplate())
  const [scanUrl, setScanUrl] = useState(() => cellScanUrl(locationCode))

  useEffect(() => {
    setScanUrl(cellScanUrl(locationCode, window.location.origin))
  }, [locationCode])

  const labelContext: CellLabelRenderContext = useMemo(
    () => ({
      locationCode,
      title,
      subtitle,
      warehouseCode,
      zoneCode,
      slotProfile,
      displayName,
    }),
    [locationCode, title, subtitle, warehouseCode, zoneCode, slotProfile, displayName]
  )

  const values = useMemo(() => buildCellLabelValues(labelContext), [labelContext])

  useEffect(() => {
    const sync = () => setTemplate(readCellLabelTemplate())
    window.addEventListener(CELL_LABEL_TEMPLATE_EVENT, sync)
    window.addEventListener("storage", sync)
    return () => {
      window.removeEventListener(CELL_LABEL_TEMPLATE_EVENT, sync)
      window.removeEventListener("storage", sync)
    }
  }, [])

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(locationCode)
    } catch {
      /* ignore */
    }
  }

  async function copyScanUrl() {
    try {
      await navigator.clipboard.writeText(scanUrl)
    } catch {
      /* ignore */
    }
  }

  function printLabel() {
    const svg = previewRef.current?.querySelector("svg")
    if (!svg) return
    const html = buildCellLabelPrintHtml(template, values, svg.outerHTML)
    openLabelPrintWindow(html, 520, 720)
  }

  const trigger = (
    <Button
      type="button"
      variant={triggerOnly ? "outline" : "secondary"}
      size={triggerOnly ? "sm" : "default"}
      className={cn(
        "rounded-xl",
        triggerOnly && "h-8 max-w-full shrink whitespace-normal px-2.5 text-xs leading-tight",
        className
      )}
      onClick={() => setOpen(true)}
    >
      <QrCode className={cn("h-4 w-4 shrink-0", triggerOnly ? "mr-1" : "mr-1.5")} />
      {triggerOnly ? (
        <>
          <span className="sm:hidden">QR</span>
          <span className="hidden sm:inline">Штрихкод</span>
        </>
      ) : (
        "Штрихкод ячейки"
      )}
    </Button>
  )

  return (
    <>
      {!triggerOnly ? (
        <div className={cn("overflow-hidden rounded-xl border border-border/60 bg-secondary/20 p-3", className)}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="break-all font-mono text-[11px] text-muted-foreground">{locationCode}</p>
            {trigger}
          </div>
        </div>
      ) : (
        trigger
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Этикетка ячейки</DialogTitle>
          </DialogHeader>

          <div ref={previewRef} className="space-y-3">
            {open ? (
              <div className="flex justify-center overflow-x-auto py-1">
                <CellLabelPreview
                  context={labelContext}
                  template={template}
                  scale={1}
                  qrPayload={scanUrl}
                  className="shadow-md"
                />
              </div>
            ) : null}

            <p className="break-all text-center font-mono text-xs text-muted-foreground">{locationCode}</p>
            <p className="break-all text-center text-[10px] text-muted-foreground">{scanUrl}</p>
            <p className="text-center text-[10px] text-muted-foreground">
              QR ведёт на страницу ячейки (телефон). Шаблон: {template.widthMm}×{template.heightMm} мм
            </p>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              type="button"
              className="w-full rounded-xl"
              onClick={printLabel}
              disabled={!locationCode.trim()}
            >
              <Printer className="mr-2 h-4 w-4" />
              Печать этикетки
            </Button>
            <Button type="button" variant="outline" className="w-full rounded-xl" asChild>
              <a href={scanUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Открыть страницу ячейки
              </a>
            </Button>
            <Button type="button" variant="outline" className="w-full rounded-xl" onClick={() => void copyScanUrl()}>
              <Copy className="mr-2 h-4 w-4" />
              Копировать ссылку
            </Button>
            <Button type="button" variant="ghost" className="w-full rounded-xl" onClick={() => void copyCode()}>
              Копировать код ячейки
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
