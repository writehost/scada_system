"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Download, ExternalLink, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  downloadDocumentTorg16File,
  getDocumentTorg16,
  type WmsDocumentRow,
  type WmsTorg16Fields,
  type WmsTorg16FormRecord,
} from "@/lib/wms-api"
import { documentStatusLabelRU } from "@/lib/wms-labels"
import { cn } from "@/lib/utils"

type Props = {
  doc: WmsDocumentRow
  className?: string
}

export function WriteoffTorg16Panel({ doc, className }: Props) {
  const [form, setForm] = useState<WmsTorg16FormRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getDocumentTorg16(doc.documentId)
      setForm(res.form)
    } catch (e) {
      setForm(null)
      setError(e instanceof Error ? e.message : "Не удалось загрузить ТОРГ-16")
    } finally {
      setLoading(false)
    }
  }, [doc.documentId])

  useEffect(() => {
    void load()
  }, [load])

  const fields: WmsTorg16Fields | null = form?.fields ?? null

  return (
    <aside className={cn("overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm", className)}>
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-semibold">{doc.documentNo || `Документ ${doc.documentId}`}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">Списание · акт ТОРГ-16</div>
          </div>
          <Badge variant="secondary" className="rounded-lg">
            {documentStatusLabelRU(doc.documentStatus)}
          </Badge>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка акта…
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : fields ? (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Дата</dt>
                <dd>{fields.composedAt || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Основание</dt>
                <dd>{fields.reasonName || "—"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Ячейка</dt>
                <dd className="font-mono">
                  {fields.locationCode}
                  {fields.locationName ? ` · ${fields.locationName}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Позиций</dt>
                <dd>{fields.lines.length}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Кодов</dt>
                <dd>{fields.codesCount}</dd>
              </div>
            </dl>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                className="rounded-xl"
                disabled={downloading}
                onClick={() => {
                  setDownloading(true)
                  void downloadDocumentTorg16File(doc.documentId, `TORG-16-${fields.documentNo || doc.documentId}`)
                    .catch((e) => setError(e instanceof Error ? e.message : "Не удалось скачать"))
                    .finally(() => setDownloading(false))
                }}
              >
                {downloading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
                Скачать ТОРГ-16
              </Button>
              <Button type="button" variant="outline" size="sm" className="rounded-xl" asChild>
                <Link href={`/documents/${encodeURIComponent(doc.documentId)}`}>
                  <ExternalLink className="mr-1.5 h-4 w-4" />
                  Карточка
                </Link>
              </Button>
            </div>

            <div className="rounded-xl border border-border/70 bg-muted/20">
              <div className="border-b border-border px-3 py-2 text-sm font-semibold">Состав</div>
              {fields.lines.length ? (
                <div className="max-h-80 divide-y divide-border overflow-y-auto">
                  {fields.lines.map((line) => (
                    <div key={`${line.lineNo}-${line.itemCode}-${line.lotCode}`} className="px-3 py-2 text-sm">
                      <div className="line-clamp-2 font-medium">{line.name || line.itemCode}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {line.itemCode}
                        {line.qty ? ` · ${line.qty} ${line.uom || "шт"}` : ""}
                        {line.lotCode ? ` · партия ${line.lotCode}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 text-sm text-muted-foreground">Строки не загружены.</div>
              )}
            </div>

            {fields.codes ? (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Списанные коды</p>
                <pre className="max-h-40 overflow-auto rounded-xl bg-secondary/40 p-2 font-mono text-[10px] leading-relaxed">
                  {fields.codes}
                </pre>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </aside>
  )
}
