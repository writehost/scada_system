"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CreateDocumentDialog } from "@/components/wms/create-document-dialog"
import { ReceivingQuickScan } from "@/components/wms/receiving-quick-scan"
import { Input } from "@/components/ui/input"
import {
  listDocuments,
  listTasks,
  wmsDocumentTypeLabelRu,
  type WmsDocumentRow,
  type WmsDocumentTypeCode,
  type WmsTaskRow,
} from "@/lib/wms-api"
import { documentStatusLabelRU, warehouseRouteLabel } from "@/lib/wms-labels"
import { plural } from "@/lib/wms/dashboard-data"
import { cn } from "@/lib/utils"

type OperationKind = "receiving" | "movement" | "issue" | "return" | "revision"

const operationMeta: Record<
  OperationKind,
  { title: string; description: string; action: string; aliases: string[] }
> = {
  receiving: {
    title: "Приёмка",
    description: "Документы приёмки WMS",
    action: "Новая приёмка",
    aliases: ["receipt", "receiv", "inbound"],
  },
  movement: {
    title: "Перемещения",
    description: "Внутрискладские и межскладские документы",
    action: "Новый документ",
    aliases: ["move", "movement", "transfer", "putaway"],
  },
  issue: {
    title: "Выдача",
    description: "Документы выдачи и отгрузки",
    action: "Новая выдача",
    aliases: ["issue", "ship", "outbound"],
  },
  return: {
    title: "Возвраты",
    description: "Документы возврата",
    action: "Новый возврат",
    aliases: ["return"],
  },
  revision: {
    title: "Ревизия",
    description: "Документы ревизии",
    action: "Новая ревизия",
    aliases: ["revision", "count"],
  },
}

const operationDocumentType: Record<OperationKind, WmsDocumentTypeCode> = {
  receiving: "receiving",
  movement: "transfer",
  issue: "issue",
  return: "return",
  revision: "revision",
}

function matchesOperation(code: string | null | undefined, aliases: string[]) {
  const value = (code || "").toLowerCase()
  return aliases.some((alias) => value.includes(alias))
}

function statusTone(status: string | null | undefined): string {
  const value = (status || "").toLowerCase()
  const label = documentStatusLabelRU(status)
  if (value.includes("complete") || value.includes("done") || value.includes("applied") || label.includes("Провед")) {
    return "text-emerald-700 dark:text-emerald-400"
  }
  if (value.includes("cancel") || label.includes("Отмен")) {
    return "text-destructive"
  }
  if (value.includes("progress") || value.includes("started") || value.includes("released") || label.includes("работе")) {
    return "text-amber-700 dark:text-amber-400"
  }
  return "text-muted-foreground"
}

function formatDocWhen(value: string | null | undefined) {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function docHref(documentId: string) {
  return `/documents/${encodeURIComponent(documentId)}`
}

function routeText(doc: WmsDocumentRow): string {
  return (
    warehouseRouteLabel({
      sourceWarehouseCode: doc.sourceWarehouseCode,
      targetWarehouseCode: doc.targetWarehouseCode,
      sourceWarehouseName: doc.sourceWarehouseName,
      targetWarehouseName: doc.targetWarehouseName,
      sourceLocationCode: doc.sourceLocationCode,
      targetLocationCode: doc.targetLocationCode,
    }) || "Маршрут не задан"
  )
}

function isTaskOpen(task: WmsTaskRow) {
  const status = (task.taskStatus || "").toLowerCase()
  return !task.completedAt && !status.includes("complete") && !status.includes("cancel")
}

export function OperationDocumentsPage({
  kind,
  embedded = false,
}: {
  kind: OperationKind
  embedded?: boolean
}) {
  const router = useRouter()
  const meta = operationMeta[kind]
  const [query, setQuery] = useState("")
  const [documents, setDocuments] = useState<WmsDocumentRow[]>([])
  const [tasks, setTasks] = useState<WmsTaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openCreateFromQuery, setOpenCreateFromQuery] = useState(false)

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [docs, taskRows] = await Promise.all([listDocuments({ limit: 100 }), listTasks({ limit: 100 })])
      setDocuments(docs.documents || [])
      setTasks(taskRows.tasks || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить документы")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("new") !== "1") return
    if (kind !== "receiving" && kind !== "movement" && kind !== "issue") return
    setOpenCreateFromQuery(true)
    router.replace(
      kind === "receiving" ? "/receiving" : kind === "movement" ? "/movement" : "/issue",
      { scroll: false }
    )
  }, [kind, router])

  const rows = useMemo(() => {
    const aliases = meta.aliases
    const q = query.trim().toLowerCase()
    return documents
      .filter((document) => matchesOperation(document.documentType, aliases))
      .filter((document) => {
        if (!q) return true
        return [
          document.documentId,
          document.documentNo,
          document.externalRef,
          document.comment,
          document.documentType,
          wmsDocumentTypeLabelRu(document.documentType),
          document.documentStatus,
          documentStatusLabelRU(document.documentStatus),
          document.sourceLocationCode,
          document.targetLocationCode,
          document.sourceWarehouseCode,
          document.targetWarehouseCode,
          routeText(document),
        ].some((value) => (value || "").toLowerCase().includes(q))
      })
      .slice()
      .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
  }, [documents, meta.aliases, query])

  const relatedTasks = tasks.filter((task) => matchesOperation(task.taskType, meta.aliases))
  const activeCount = relatedTasks.filter(isTaskOpen).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          {embedded ? null : (
            <>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">{meta.title}</h1>
              <p className="text-[13px] text-muted-foreground">{meta.description}</p>
            </>
          )}
          <p className={cn("text-[13px] text-muted-foreground", !embedded && "mt-1")}>
            {rows.length} {plural(rows.length, "документ", "документа", "документов")}
            {activeCount > 0
              ? ` · ${activeCount} ${plural(activeCount, "задание", "задания", "заданий")} в работе`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {kind === "receiving" ? <ReceivingQuickScan onApplied={loadData} /> : null}
          <CreateDocumentDialog
            triggerLabel={meta.action}
            triggerClassName="h-8 rounded-md px-3 text-xs"
            title={kind === "receiving" ? "Новая приёмка" : "Новый документ"}
            description={
              kind === "receiving"
                ? "Документ приёмки с одной строкой: номенклатура, количество, при необходимости зона и ячейка."
                : undefined
            }
            defaultDocumentType={operationDocumentType[kind]}
            lockDocumentType
            onCreated={loadData}
            initialOpen={openCreateFromQuery}
          />
        </div>
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Номер, тип, ячейка, статус…"
        className="h-8 max-w-md rounded-md text-sm"
      />

      {error ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          <p className="text-destructive">
            Не удалось загрузить документы
            <span className="text-muted-foreground"> — {error}</span>
          </p>
          <button
            type="button"
            className="font-medium text-foreground underline-offset-2 hover:underline"
            onClick={() => void loadData()}
          >
            Повторить
          </button>
        </div>
      ) : null}

      <div className="border-y border-border">
        <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(5.5rem,auto)_3.5rem_6.5rem] gap-3 border-b border-border/70 py-1.5 text-[11px] font-medium text-muted-foreground md:grid">
          <div>Документ</div>
          <div>Тип</div>
          <div>Маршрут</div>
          <div>Статус</div>
          <div className="text-right">Строк</div>
          <div className="text-right">Дата</div>
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Загрузка…</p>
        ) : documents.length === 0 && !error ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Документов пока нет</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {query.trim() ? "Нет совпадений" : "Нет документов этого типа"}
          </p>
        ) : (
          <ul>
            {rows.map((document) => {
              const status = documentStatusLabelRU(document.documentStatus)
              return (
                <li key={document.documentId} className="border-b border-border/60 last:border-b-0">
                  <Link
                    href={docHref(document.documentId)}
                    prefetch={false}
                    className="block py-2 hover:bg-muted/40 md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(5.5rem,auto)_3.5rem_6.5rem] md:items-baseline md:gap-3"
                  >
                    <span className="flex items-baseline justify-between gap-3 md:contents">
                      <span className="truncate font-mono text-[13px] font-medium text-foreground">
                        {document.documentNo || `#${document.documentId}`}
                      </span>
                      <span className={cn("shrink-0 text-[13px] md:hidden", statusTone(document.documentStatus))}>
                        {status}
                      </span>
                    </span>
                    <span className="hidden truncate text-[13px] text-muted-foreground md:block">
                      {wmsDocumentTypeLabelRu(document.documentType)}
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-muted-foreground md:mt-0 md:text-foreground">
                      <span className="md:hidden">
                        {wmsDocumentTypeLabelRu(document.documentType)} ·{" "}
                      </span>
                      {routeText(document)}
                    </span>
                    <span className={cn("hidden text-[13px] md:block", statusTone(document.documentStatus))}>
                      {status}
                    </span>
                    <span className="mt-0.5 block text-[12px] tabular-nums text-muted-foreground md:mt-0 md:text-right md:text-[13px]">
                      <span className="md:hidden">{document.lineCount} стр. · </span>
                      <span className="hidden md:inline">{document.lineCount}</span>
                      <span className="md:hidden">{formatDocWhen(document.createdAt)}</span>
                    </span>
                    <span className="hidden text-right text-[13px] tabular-nums text-muted-foreground md:block">
                      {formatDocWhen(document.createdAt)}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
