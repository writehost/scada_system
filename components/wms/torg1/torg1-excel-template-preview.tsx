"use client"

import { Download, FileSpreadsheet, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  WMS_DOCUMENT_TYPE_LABEL_RU,
  type WmsDocumentTypeCode,
  type WmsTorg1ExcelTemplateSlot,
  wmsDocumentTypeLabelRu,
} from "@/lib/wms-api"

type Props = {
  templates: WmsTorg1ExcelTemplateSlot[]
  busy?: boolean
  onDownload: (slot: string, fileName: string) => void
  onDelete: (slot: string) => void
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function formatWhen(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("ru-RU")
}

function scopeLabel(template: WmsTorg1ExcelTemplateSlot): string {
  const typeLabel =
    template.documentType in WMS_DOCUMENT_TYPE_LABEL_RU
      ? WMS_DOCUMENT_TYPE_LABEL_RU[template.documentType as WmsDocumentTypeCode]
      : wmsDocumentTypeLabelRu(template.documentType)
  if (template.categoryCode) return `${typeLabel} · категория ${template.categoryCode}`
  if (template.key === "default") return `${typeLabel} · по умолчанию`
  return typeLabel
}

export function Torg1ExcelTemplatePreview({
  templates,
  busy = false,
  onDownload,
  onDelete,
}: Props) {
  if (templates.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
        Своих Excel-шаблонов пока нет. Загрузите .xlsx выше.
      </div>
    )
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Загруженные шаблоны</h3>
      <div className="space-y-2">
        {templates.map((template) => (
          <article
            key={template.key}
            className="rounded-2xl border border-border/70 bg-card p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-700" />
                  <h4 className="truncate text-sm font-semibold">{template.label}</h4>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {scopeLabel(template)} · {template.originalName} · {formatBytes(template.bytes)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Обновлён {formatWhen(template.updatedAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-xl"
                  disabled={busy}
                  onClick={() => onDownload(template.key, template.originalName || `${template.key}.xlsx`)}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Скачать
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-xl text-destructive"
                  disabled={busy}
                  onClick={() => onDelete(template.key)}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Удалить
                </Button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Листы
                </div>
                <div className="flex flex-wrap gap-1">
                  {(template.sheets.length ? template.sheets : ["—"]).map((sheet) => (
                    <span
                      key={`${template.key}-${sheet}`}
                      className="rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-xs"
                    >
                      {sheet}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Переменные в файле
                </div>
                <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                  {(template.variables.length ? template.variables : ["не найдены"]).map((variable) => (
                    <span
                      key={`${template.key}-${variable}`}
                      className="rounded-md border border-amber-300/50 bg-amber-50 px-2 py-0.5 font-mono text-[11px] text-amber-950"
                    >
                      {variable === "не найдены" ? variable : `{{${variable}}}`}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
