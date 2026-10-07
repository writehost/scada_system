"use client"

import { useEffect, useRef, useState } from "react"
import { ExternalLink, FileText, Printer, RefreshCw } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { renderUrl } from "../api"
import { useDesigner, type DesignerStore } from "../state"

/**
 * Настоящий предпросмотр: сохранённый черновик → backend Jinja-рендер с тестовыми данными.
 * Это тот же renderer, что печатает production; PDF — тот же Chromium.
 */
export function PreviewDialog({
  open,
  onOpenChange,
  templateId,
  store,
  format: initialFormat = "html",
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  templateId: string
  store: DesignerStore
  format?: "html" | "pdf"
}) {
  const [format, setFormat] = useState<"html" | "pdf">(initialFormat)
  const [nonce, setNonce] = useState(0)
  const [loading, setLoading] = useState(true)
  const frame = useRef<HTMLIFrameElement>(null)
  const sampleId = useDesigner(store, (s) => s.sampleId)
  const documentId = useDesigner(store, (s) => s.documentId)
  const samples = useDesigner(store, (s) => s.samples)
  const working = useDesigner(store, (s) => s.working)
  useEffect(() => {
    if (open) {
      setFormat(initialFormat)
      setNonce((n) => n + 1)
    }
  }, [open, initialFormat])
  useEffect(() => setLoading(true), [format, nonce, sampleId, documentId])

  const url = `${renderUrl(templateId, { version: working?.versionId ?? "working", sample: sampleId, documentId, format })}&_=${nonce}`
  const sourceLabel = documentId ? `документ WMS #${documentId}` : samples.find((s) => s.id === sampleId)?.label ?? "тестовые данные"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] max-w-[min(1100px,96vw)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1100px,96vw)]">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-2.5 pr-12">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[14px]">Предпросмотр документа</DialogTitle>
            <DialogDescription className="truncate text-[11.5px]">
              Версия {working?.versionNo} · данные: {sourceLabel} · рендер на сервере
            </DialogDescription>
          </div>
          <div className="flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
            {(["html", "pdf"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFormat(f)}
                className={cn("h-7 rounded px-3 text-[12px]", format === f ? "bg-white font-medium shadow-sm" : "text-slate-500 hover:text-slate-900")}
              >
                {f === "html" ? "HTML" : "PDF"}
              </button>
            ))}
          </div>
          <button type="button" title="Обновить" onClick={() => setNonce((n) => n + 1)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100">
            <RefreshCw className="size-4" />
          </button>
          {format === "html" ? (
            <button
              type="button"
              onClick={() => frame.current?.contentWindow?.print()}
              className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-[12.5px] hover:bg-slate-50"
            >
              <Printer className="size-4" /> Печать
            </button>
          ) : (
            <a href={url} target="_blank" rel="noreferrer" className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-[12.5px] hover:bg-slate-50">
              <ExternalLink className="size-4" /> Открыть PDF
            </a>
          )}
        </div>
        <div className="relative min-h-0 flex-1 bg-[#e5e7eb]">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-[13px] text-slate-500">
              <FileText className="size-4 animate-pulse" /> {format === "pdf" ? "Печатаем PDF…" : "Рендерим документ…"}
            </div>
          )}
          {open && (
            <iframe
              key={url}
              ref={frame}
              src={url}
              title="Предпросмотр"
              onLoad={() => setLoading(false)}
              sandbox={format === "html" ? "allow-same-origin allow-modals" : undefined}
              className="h-full w-full border-0"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
