"use client"

import { useEffect, useMemo, useState } from "react"
import { StyledQrCode } from "@/components/wms/styled-qr-code"
import {
  buildCellLabelValues,
  readCellLabelTemplate,
  renderCellLabelText,
  CELL_LABEL_TEMPLATE_EVENT,
  type CellLabelRenderContext,
  type CellLabelTemplate,
} from "@/lib/cell-label-template"
import { cn } from "@/lib/utils"

type Props = {
  context: CellLabelRenderContext
  template?: CellLabelTemplate
  className?: string
  /** Масштаб превью относительно реального размера (1 = 100%) */
  scale?: number
  /** Данные QR: по умолчанию код ячейки, для печати — URL страницы */
  qrPayload?: string
}

function blockClass(block: { fontWeight: string; fontSizePt: number; align: string }) {
  return cn(
    "leading-snug",
    block.align === "left" && "text-left",
    block.align === "right" && "text-right",
    block.align === "center" && "text-center",
    block.fontWeight === "bold" && "font-semibold",
    block.fontWeight === "mono" && "font-mono",
    block.fontSizePt <= 7 && "text-muted-foreground"
  )
}

export function CellLabelPreview({
  context,
  template: templateProp,
  className,
  scale = 0.55,
  qrPayload,
}: Props) {
  const [stored, setStored] = useState<CellLabelTemplate>(() => readCellLabelTemplate())

  useEffect(() => {
    const sync = () => setStored(readCellLabelTemplate())
    window.addEventListener(CELL_LABEL_TEMPLATE_EVENT, sync)
    window.addEventListener("storage", sync)
    return () => {
      window.removeEventListener(CELL_LABEL_TEMPLATE_EVENT, sync)
      window.removeEventListener("storage", sync)
    }
  }, [])

  const template = templateProp ?? stored
  const values = useMemo(() => buildCellLabelValues(context), [context])
  const before = (template.textBlocks ?? []).filter((b) => b.visible && b.placement === "before")
  const after = (template.textBlocks ?? []).filter((b) => b.visible && b.placement === "after")
  const previewWidth = template.widthMm * scale * 3.78
  const previewHeight = template.heightMm * scale * 3.78
  const qrPx = Math.round(template.qrSizeMm * scale * 3.78)

  return (
    <div
      className={cn("inline-flex flex-col items-stretch rounded-xl border border-border/60 bg-white p-2 shadow-sm", className)}
      style={{ width: previewWidth, minHeight: previewHeight }}
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-1 py-2">
        {before.map((block) => {
          const text = renderCellLabelText(block.template, values)
          if (!text) return null
          return (
            <p key={block.id} className={blockClass(block)} style={{ fontSize: `${block.fontSizePt * scale}pt` }}>
              {text}
            </p>
          )
        })}
        {template.showQr && (qrPayload || context.locationCode).trim() ? (
          <StyledQrCode data={(qrPayload || context.locationCode).trim()} size={qrPx} className="my-1" />
        ) : null}
        {after.map((block) => {
          const text = renderCellLabelText(block.template, values)
          if (!text) return null
          return (
            <p key={block.id} className={blockClass(block)} style={{ fontSize: `${block.fontSizePt * scale}pt` }}>
              {text}
            </p>
          )
        })}
      </div>
      <p className="border-t border-border/40 pt-1 text-center text-[9px] text-muted-foreground">
        {template.widthMm}×{template.heightMm} мм
      </p>
    </div>
  )
}
