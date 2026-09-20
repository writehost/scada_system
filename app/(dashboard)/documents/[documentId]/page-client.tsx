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
  downloadDocumentTorg16File,
  getWmsDocumentDetail,
  type WmsDocumentDetailResponse,
} from "@/lib/wms-api"
import {
  documentStatusLabelRU,
  documentTypeLabelRU,
  taskStatusLabelRU,
  warehouseDisplayName,
  warehouseRouteLabel,
} from "@/lib/wms-labels"

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
  // Static export in APK serves placeholder route `/documents/__export__`
  // and passes real id via query parameter.
  if (fromQuery) return fromQuery
  if (fromParam === "__" || fromParam === "__export__") return ""
  return fromParam
}

function DocumentDetailBody() {
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

  useEffect(() => {
    if (!documentId.startsWith("code-list:")) return
    let cancelled = false
    const timer = setInterval(() => {
      void (async () => {
        try {
          const d = await getWmsDocumentDetail(documentId, { taskId: taskIdFromQuery || null })
          if (!cancelled) setData(d)
        } catch {
          // ignore polling errors
        }
      })()
    }, 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
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
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-xl"
          onClick={() => router.push("/documents")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          К журналу
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-foreground">
            {loading ? "Загрузка…" : doc?.documentNo || `Документ ${documentId}`}
          </h1>
          <p className="text-sm text-muted-foreground">
            {doc ? documentTypeLabelRU(doc.documentType) : "Складской документ"}
          </p>
          {doc ? (
            <p className="mt-1 text-base font-semibold text-foreground">
              {warehouseRouteLabel(doc) || "Маршрут не задан"}
            </p>
          ) : null}
        </div>
      </div>

      {taskIdFromQuery && (
        <p className="mb-4 text-sm text-muted-foreground">
          Контекст задания:{" "}
          <Link href={`/tasks/${encodeURIComponent(taskIdFromQuery)}`} className="text-primary underline-offset-2 hover:underline">
            открыть задание
          </Link>
        </p>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
      )}

      {doc && (
        <>
          <div className="mb-6 flex flex-wrap gap-2">
            {(doc.documentType || "").toLowerCase() === "writeoff" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() =>
                  void downloadDocumentTorg16File(documentId, `TORG-16-${doc.documentNo || documentId}`)
                }
              >
                <Download className="mr-2 h-4 w-4" />
                Скачать ТОРГ-16
              </Button>
            ) : null}
            <Badge variant="secondary" className="rounded-lg">
              {documentTypeLabelRU(doc.documentType)}
            </Badge>
            <Badge variant="outline" className="rounded-lg">
              {documentStatusLabelRU(doc.documentStatus)}
            </Badge>
            {doc.priorityCode && (
              <Badge variant="outline" className="rounded-lg">
                {doc.priorityCode}
              </Badge>
            )}
          </div>

          <section className="mb-6 rounded-2xl bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
              <FileText className="h-5 w-5" />
              Реквизиты
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {doc.externalRef && (
                <div>
                  <dt className="text-muted-foreground">Внешний номер</dt>
                  <dd className="mt-1 font-mono text-foreground">{doc.externalRef}</dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground">Создан</dt>
                <dd className="mt-1 text-foreground">{formatTs(doc.createdAt)}</dd>
              </div>
              {doc.appliedAt && (
                <div>
                  <dt className="text-muted-foreground">Проведён</dt>
                  <dd className="mt-1 text-foreground">{formatTs(doc.appliedAt)}</dd>
                </div>
              )}
              {doc.receiptAt && (
                <div>
                  <dt className="text-muted-foreground">Оприходование</dt>
                  <dd className="mt-1 text-foreground">{formatTs(doc.receiptAt)}</dd>
                </div>
              )}
              {doc.releasedAt && (
                <div>
                  <dt className="text-muted-foreground">Выпуск / отгрузка</dt>
                  <dd className="mt-1 text-foreground">{formatTs(doc.releasedAt)}</dd>
                </div>
              )}
              {doc.comment && (
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Комментарий</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-foreground">{doc.comment}</dd>
                </div>
              )}
            </dl>
          </section>

          {(doc.sourceWarehouseCode ||
            doc.targetWarehouseCode ||
            doc.sourceLocationCode ||
            doc.targetLocationCode) && (
            <section className="mb-6 rounded-2xl bg-card p-6 shadow-sm">
              <div className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
                <MapPin className="h-5 w-5" />
                Склады и ячейки
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                {doc.sourceWarehouseCode && (
                  <div>
                    <dt className="text-muted-foreground">Склад-отправитель</dt>
                    <dd className="mt-1">
                      {warehouseDisplayName(doc.sourceWarehouseCode, doc.sourceWarehouseName)}
                    </dd>
                  </div>
                )}
                {doc.targetWarehouseCode && (
                  <div>
                    <dt className="text-muted-foreground">Склад-получатель</dt>
                    <dd className="mt-1 text-base font-semibold">
                      {warehouseDisplayName(doc.targetWarehouseCode, doc.targetWarehouseName)}
                    </dd>
                  </div>
                )}
                {doc.sourceLocationCode && (
                  <div>
                    <dt className="text-muted-foreground">
                      {(doc.documentType || "").toLowerCase().includes("production_consumption")
                        ? "Ячейка списания"
                        : "Ячейка (откуда)"}
                    </dt>
                    <dd className="mt-1 font-mono">{doc.sourceLocationCode}</dd>
                  </div>
                )}
                {(doc as { lineName?: string | null }).lineName ? (
                  <div>
                    <dt className="text-muted-foreground">Линия</dt>
                    <dd className="mt-1">{(doc as { lineName?: string | null }).lineName}</dd>
                  </div>
                ) : null}
                {doc.targetLocationCode && (
                  <div>
                    <dt className="text-muted-foreground">Ячейка (куда)</dt>
                    <dd className="mt-1 font-mono">{doc.targetLocationCode}</dd>
                  </div>
                )}
              </dl>
            </section>
          )}

          {data.lines.length > 0 && (
            <section className="mb-6 rounded-2xl bg-card p-6 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <Package className="h-5 w-5" />
                  {isSimpleCodeList ? `Список кодов (${data.lines.length})` : `Строки (${data.lines.length})`}
                </div>
                {isSimpleCodeList && (
                  <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={downloadCodeListTxt}>
                    <Download className="mr-2 h-4 w-4" />
                    Скачать список
                  </Button>
                )}
              </div>
              <div className="space-y-4">
                {data.lines.map((line) => (
                  <div key={line.documentLineId} className="rounded-xl border border-border bg-muted/20 p-4 text-sm">
                    {isSimpleCodeList ? (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 break-all font-mono text-sm text-foreground">{resolveLineCode(line)}</div>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">#{line.lineNo}</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 font-medium text-foreground">{line.itemName}</div>
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">#{line.lineNo}</span>
                        </div>
                        <div className="mt-1 font-mono text-xs text-muted-foreground">{line.itemCode}</div>
                        <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
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
                            {(doc.documentType || "").toLowerCase().includes("production_consumption")
                              ? `Списано с ${line.sourceLocationCode || "—"}`
                              : `${line.sourceLocationCode || "—"} → ${line.targetLocationCode || "—"}`}
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
            <section className="mb-6 rounded-2xl bg-card p-6 shadow-sm">
              <div className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
                <Boxes className="h-5 w-5" />
                Единицы загрузки
              </div>
              <ul className="space-y-3 text-sm">
                {data.loadUnits.map((lu) => (
                  <li key={lu.loadUnitId} className="rounded-xl border border-border bg-muted/20 p-4">
                    <div className="font-mono font-medium text-foreground">{lu.loadUnitCode}</div>
                    <div className="text-xs text-muted-foreground">
                      {lu.loadUnitType || "—"} · {taskStatusLabelRU(lu.statusCode) || lu.statusCode || "—"} · строк: {lu.lineCount} · Σ{" "}
                      {formatQty(lu.totalBaseQty)}
                    </div>
                    {lu.label && <div className="mt-1 text-xs text-foreground">{lu.label}</div>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.tasks.length > 0 && (
            <section className="mb-6 rounded-2xl bg-card p-6 shadow-sm">
              <div className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
                <Truck className="h-5 w-5" />
                Задания по документу
              </div>
              <ul className="space-y-2">
                {data.tasks.map((t) => (
                  <li key={t.taskId}>
                    <Link
                      href={`/tasks/${encodeURIComponent(t.taskId)}`}
                      className="flex flex-col rounded-xl border border-border bg-muted/20 p-4 text-sm transition-colors hover:bg-muted/40"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-foreground">{t.taskCode}</span>
                        <Badge variant="outline" className="shrink-0 rounded-md text-xs">
                          {taskStatusLabelRU(t.taskStatus)}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {documentTypeLabelRU(t.taskType)} · план {formatQty(t.plannedQty)} · факт {formatQty(t.confirmedQty)}
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
    </div>
  )
}

export default function DocumentDetailPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Загрузка документа…</div>}>
      <DocumentDetailBody />
    </Suspense>
  )
}
