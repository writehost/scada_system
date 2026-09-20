"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  Boxes,
  Download,
  FileText,
  MapPin,
  Package,
  Truck,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  getWmsDocumentDetail,
  type WmsDocumentDetailResponse,
} from "@/lib/wms-api"

function formatQty(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—"
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(n)
}

function formatTs(iso: string | null | undefined) {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function resolveLineCode(line: WmsDocumentDetailResponse["lines"][number]) {
  const primary = line.itemCode?.trim()
  if (primary) return primary
  return line.itemName?.trim() || ""
}

function resolveDocumentId(paramValue: string, queryValue: string | null): string {
  const fromQuery = (queryValue || "").trim()
  const fromParam = (paramValue || "").trim()
  // Static export in APK serves placeholder route `/mobile/documents/__`
  // and passes real id via query parameter.
  if (fromQuery) return fromQuery
  if (fromParam === "__" || fromParam === "__export__") return ""
  return fromParam
}

function MobileDocumentBody() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const paramDocumentId = typeof params.documentId === "string" ? params.documentId : ""
  const documentId = resolveDocumentId(paramDocumentId, searchParams.get("documentId"))
  const taskIdFromQuery = searchParams.get("taskId")?.trim() || undefined

  const [data, setData] = useState<WmsDocumentDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!documentId.trim()) {
      setLoading(false)
      setError("Не указан документ")
      return
    }
    let cancelled = false
    async function run() {
      setLoading(true)
      setError(null)
      try {
        const d = await getWmsDocumentDetail(documentId, { taskId: taskIdFromQuery || null })
        if (!cancelled) setData(d)
      } catch (e) {
        if (!cancelled) {
          setData(null)
          setError(e instanceof Error ? e.message : "Не удалось загрузить документ")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [documentId, taskIdFromQuery])

  const doc = data?.document
  const isSimpleCodeList = doc?.documentType === "scanner_collect" || documentId.startsWith("code-list:")

  function downloadCodeListTxt() {
    if (!data?.lines?.length) return
    const rows = data.lines
      .map((line) => resolveLineCode(line))
      .filter((code) => code.length > 0)
    if (!rows.length) return
    const fileText = rows.join("\n")
    const blob = new Blob([fileText], { type: "text/plain;charset=utf-8" })
    const href = URL.createObjectURL(blob)
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const safeNo = (doc?.documentNo || documentId || "codes").replace(/[^\w.-]+/g, "_")
    const a = document.createElement("a")
    a.href = href
    a.download = `${safeNo}-${stamp}.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(href)
  }

  return (
    <div className="flex flex-col gap-4 p-4 pb-28">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 rounded-xl"
          onClick={() => router.back()}
          aria-label="Назад"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-foreground">
            {loading ? "Загрузка…" : doc?.documentNo || `Документ ${documentId}`}
          </h1>
          <p className="text-xs text-muted-foreground">Складской документ (ТСД)</p>
        </div>
      </div>

      {taskIdFromQuery && (
        <p className="text-xs text-muted-foreground">
          Контекст задания:{" "}
          <Link href={`/mobile/tasks/${encodeURIComponent(taskIdFromQuery)}`} className="text-primary underline-offset-2 hover:underline">
            открыть карточку
          </Link>
        </p>
      )}

      {error && (
        <div className="rounded-2xl bg-card p-4 text-sm text-destructive shadow-sm">{error}</div>
      )}

      {doc && (
        <>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="rounded-lg">
              {doc.documentType}
            </Badge>
            <Badge variant="outline" className="rounded-lg">
              {doc.documentStatus}
            </Badge>
            {doc.priorityCode && (
              <Badge variant="outline" className="rounded-lg">
                {doc.priorityCode}
              </Badge>
            )}
          </div>

          <section className="rounded-2xl bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <FileText className="h-4 w-4" />
              Реквизиты
            </div>
            <dl className="space-y-2 text-sm">
              {doc.externalRef && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Внешний номер</dt>
                  <dd className="max-w-[60%] text-right font-mono text-xs text-foreground">{doc.externalRef}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Создан</dt>
                <dd className="text-right text-foreground">{formatTs(doc.createdAt)}</dd>
              </div>
              {doc.appliedAt && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Проведён</dt>
                  <dd className="text-right text-foreground">{formatTs(doc.appliedAt)}</dd>
                </div>
              )}
              {doc.receiptAt && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Оприходование</dt>
                  <dd className="text-right text-foreground">{formatTs(doc.receiptAt)}</dd>
                </div>
              )}
              {doc.releasedAt && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Released</dt>
                  <dd className="text-right text-foreground">{formatTs(doc.releasedAt)}</dd>
                </div>
              )}
              {doc.comment && (
                <div>
                  <div className="text-muted-foreground">Комментарий</div>
                  <div className="mt-1 whitespace-pre-wrap text-foreground">{doc.comment}</div>
                </div>
              )}
            </dl>
          </section>

          {(doc.sourceWarehouseCode ||
            doc.targetWarehouseCode ||
            doc.sourceLocationCode ||
            doc.targetLocationCode) && (
            <section className="rounded-2xl bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <MapPin className="h-4 w-4" />
                Склады и зоны
              </div>
              <dl className="space-y-2 text-sm">
                {doc.sourceWarehouseCode && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Склад (откуда)</dt>
                    <dd className="text-right">{doc.sourceWarehouseCode}</dd>
                  </div>
                )}
                {doc.targetWarehouseCode && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Склад (куда)</dt>
                    <dd className="text-right">{doc.targetWarehouseCode}</dd>
                  </div>
                )}
                {doc.sourceLocationCode && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Ячейка (откуда)</dt>
                    <dd className="font-mono text-right">{doc.sourceLocationCode}</dd>
                  </div>
                )}
                {doc.targetLocationCode && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Ячейка (куда)</dt>
                    <dd className="font-mono text-right">{doc.targetLocationCode}</dd>
                  </div>
                )}
              </dl>
            </section>
          )}

          {data.lines.length > 0 && (
            <section className="rounded-2xl bg-card p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Package className="h-4 w-4" />
                  {isSimpleCodeList ? `Список кодов (${data.lines.length})` : `Строки (${data.lines.length})`}
                </div>
                {isSimpleCodeList && (
                  <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={downloadCodeListTxt}>
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    Скачать
                  </Button>
                )}
              </div>
              <div className="space-y-3">
                {data.lines.map((line) => (
                  <div
                    key={line.documentLineId}
                    className="rounded-xl border border-border bg-muted/20 p-3 text-sm"
                  >
                    {isSimpleCodeList ? (
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 break-all font-mono text-sm text-foreground">{resolveLineCode(line)}</div>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">#{line.lineNo}</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 font-medium text-foreground">{line.itemName}</div>
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">
                            #{line.lineNo}
                          </span>
                        </div>
                        <div className="mt-1 font-mono text-xs text-muted-foreground">{line.itemCode}</div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">Запрошено</span>
                            <div className="font-semibold text-foreground">
                              {formatQty(line.requestedQty)} {line.requestedUomCode || ""}
                            </div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Подтверждено</span>
                            <div className="font-semibold text-foreground">{formatQty(line.confirmedQty)}</div>
                          </div>
                        </div>
                        {(line.sourceLocationCode || line.targetLocationCode) && (
                          <div className="mt-2 text-xs text-muted-foreground">
                            {line.sourceLocationCode || "—"} → {line.targetLocationCode || "—"}
                          </div>
                        )}
                        {(line.lotCode || line.batchLabel) && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {line.lotCode && <span>Партия: {line.lotCode} </span>}
                            {line.batchLabel && <span>• {line.batchLabel}</span>}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {data.loadUnits.length > 0 && (
            <section className="rounded-2xl bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Boxes className="h-4 w-4" />
                Единицы загрузки
              </div>
              <ul className="space-y-2 text-sm">
                {data.loadUnits.map((lu) => (
                  <li key={lu.loadUnitId} className="rounded-xl border border-border bg-muted/20 p-3">
                    <div className="font-mono font-medium text-foreground">{lu.loadUnitCode}</div>
                    <div className="text-xs text-muted-foreground">
                      {lu.loadUnitType || "—"} · {lu.statusCode || "—"} · строк: {lu.lineCount} · Σ{" "}
                      {formatQty(lu.totalBaseQty)}
                    </div>
                    {lu.label && <div className="mt-1 text-xs text-foreground">{lu.label}</div>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.tasks.length > 0 && (
            <section className="rounded-2xl bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Truck className="h-4 w-4" />
                Задания по документу
              </div>
              <ul className="space-y-2">
                {data.tasks.map((t) => (
                  <li key={t.taskId}>
                    <Link
                      href={`/mobile/tasks/${encodeURIComponent(t.taskId)}`}
                      className="flex flex-col rounded-xl border border-border bg-muted/20 p-3 text-sm transition-colors hover:bg-muted/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground">{t.taskCode}</span>
                        <Badge variant="outline" className="shrink-0 rounded-md text-[10px]">
                          {t.taskStatus}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t.taskType} · план {formatQty(t.plannedQty)} · факт {formatQty(t.confirmedQty)}
                      </div>
                      {t.assignedDevice && (
                        <div className="mt-1 text-xs text-muted-foreground">ТСД: {t.assignedDevice}</div>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1 rounded-xl" asChild>
          <Link href="/documents">Журнал (веб)</Link>
        </Button>
        <Button className="flex-1 rounded-xl" asChild>
          <Link href="/mobile/tasks">К задачам</Link>
        </Button>
      </div>
    </div>
  )
}

export default function MobileDocumentPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 text-sm text-muted-foreground">Загрузка документа…</div>
      }
    >
      <MobileDocumentBody />
    </Suspense>
  )
}
