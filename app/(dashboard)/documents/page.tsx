"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  Printer,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { CreateDocumentDialog } from "@/components/wms/create-document-dialog"
import { IncomingOrderImportDialog } from "@/components/wms/incoming-order-import-dialog"
import { ReceivingTorg1Panel } from "@/components/wms/torg1/receiving-torg1-panel"
import { WriteoffTorg16Panel } from "@/components/wms/torg16/writeoff-torg16-panel"
import { Tree, type TreeViewElement } from "@/registry/magicui/file-tree"
import {
  WmsEmptyState,
  WmsErrorState,
  WmsTableSkeleton,
} from "@/components/wms/wms-shared"
import {
  getWmsDocumentDetail,
  getSiteCode,
  listDocuments,
  refreshReceivingTorg1Documents,
  type WmsDocumentDetailResponse,
  type WmsDocumentRow,
} from "@/lib/wms-api"
import { documentStatusLabelRU, documentTypeLabelRU, warehouseDisplayName } from "@/lib/wms-labels"
import { cn } from "@/lib/utils"

type DocumentFolder = {
  key: string
  title: string
  typeCode: string
  typeLabel: string
  dateKey: string
  dateLabel: string
  docs: WmsDocumentRow[]
  totalLines: number
  latestAt: string
}

type TsdReceivingSessionRow = {
  documentId: string
  status: string
  lineCount: number | null
  updatedAtIso: string | null
  deviceUid: string | null
  productGroup?: string | null
  stockPosted?: boolean
  stockPartiallyPosted?: boolean
  stockPostedAtIso?: string | null
  stockLocationCode?: string | null
  stockDismissedEmpty?: boolean
  stockPendingLineCount?: number
}

type ReceivingOperatorFeed = {
  tsdSessions?: TsdReceivingSessionRow[]
}

const RECEIVING_SESSION_DOC_PREFIX = "receiving-session:"

function isReceivingSessionDoc(doc: WmsDocumentRow | null | undefined): boolean {
  return Boolean(doc?.documentId?.startsWith(RECEIVING_SESSION_DOC_PREFIX))
}

function receivingSessionIdFromDoc(doc: WmsDocumentRow): string {
  return doc.documentId.slice(RECEIVING_SESSION_DOC_PREFIX.length)
}

function mapReceivingSessionToDocument(session: TsdReceivingSessionRow): WmsDocumentRow {
  const updatedAt = session.updatedAtIso || new Date().toISOString()
  const posted = session.stockPosted === true
  const status = posted
    ? "posted"
    : session.status === "closed" || session.status === "active" || session.status === "paused"
      ? session.status
      : "in_progress"
  return {
    cursor: `${RECEIVING_SESSION_DOC_PREFIX}${session.documentId}`,
    documentId: `${RECEIVING_SESSION_DOC_PREFIX}${session.documentId}`,
    documentType: "receiving",
    documentStatus: status,
    documentNo: `Приёмка ${session.documentId}`,
    sourceWarehouseCode: null,
    targetWarehouseCode: null,
    sourceLocationCode: null,
    targetLocationCode: session.stockLocationCode ?? null,
    externalRef: session.deviceUid ? `ТСД ${session.deviceUid}` : null,
    comment: [
      session.productGroup ? `Группа: ${session.productGroup}` : "",
      session.stockPartiallyPosted ? "частично оприходовано" : "",
      session.stockDismissedEmpty ? "закрыто без остатков" : "",
    ].filter(Boolean).join(" · ") || null,
    priorityCode: null,
    createdAt: updatedAt,
    appliedAt: session.stockPostedAtIso ?? null,
    receiptAt: session.stockPostedAtIso ?? null,
    releasedAt: null,
    payloadJson: { virtualKind: "receiving_session", sourceDocumentId: session.documentId },
    lineCount: session.lineCount ?? 0,
    taskCount: 0,
  }
}

async function listReceivingSessionDocuments(): Promise<WmsDocumentRow[]> {
  const qp = new URLSearchParams()
  qp.set("siteCode", getSiteCode())
  qp.set("limit", "300")
  const r = await fetch(`/api/wms/receiving/operator-feed?${qp.toString()}`, { cache: "no-store" })
  const json = (await r.json().catch(() => ({}))) as ReceivingOperatorFeed & { error?: string }
  if (!r.ok) throw new Error(json.error || "Не удалось загрузить документы приёмки")
  return (json.tsdSessions ?? []).map(mapReceivingSessionToDocument)
}

function statusView(status: string | null | undefined) {
  const value = (status || "").toLowerCase()
  const label = documentStatusLabelRU(status)
  if (value.includes("complete") || value.includes("applied") || value.includes("posted") || label.includes("Провед")) {
    return { label, icon: CheckCircle2, color: "bg-emerald-500/10 text-emerald-800 border-emerald-500/20" }
  }
  if (value.includes("cancel") || label.includes("Отмен")) {
    return { label, icon: XCircle, color: "bg-destructive/10 text-destructive border-destructive/20" }
  }
  return { label: label || "Активен", icon: Clock, color: "bg-amber-500/10 text-amber-800 border-amber-500/20" }
}

function formatDateKey(value: string | null | undefined): string {
  if (!value) return "unknown"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "unknown"
  return d.toISOString().slice(0, 10)
}

function formatDateRu(value: string | null | undefined): string {
  if (!value) return "без даты"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "без даты"
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function formatDateTimeRu(value: string | null | undefined): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function folderTitle(typeLabel: string, dateLabel: string): string {
  const lower = typeLabel.toLowerCase()
  if (lower.includes("приём")) return `Документы приёмки за ${dateLabel}`
  if (lower.includes("выдач")) return `Документы выдачи за ${dateLabel}`
  if (lower.includes("перемещ")) return `Документы перемещения за ${dateLabel}`
  if (lower.includes("возврат")) return `Документы возврата за ${dateLabel}`
  if (lower.includes("ревиз")) return `Документы ревизии за ${dateLabel}`
  if (lower.includes("спис")) return `Документы списания за ${dateLabel}`
  return `${typeLabel}: документы за ${dateLabel}`
}

function docDisplayNo(doc: WmsDocumentRow): string {
  return doc.documentNo?.trim() || `Документ ${doc.documentId}`
}

function docRoute(doc: WmsDocumentRow): string {
  if (isReceivingSessionDoc(doc)) {
    return `/receiving/session/${encodeURIComponent(receivingSessionIdFromDoc(doc))}`
  }
  return `/documents/__export__?documentId=${encodeURIComponent(doc.documentId)}`
}

function folderTypeCode(documentType: string | null | undefined): string {
  const type = (documentType || "unknown").toLowerCase().replace(/-/g, "_")
  if (type === "interwarehouse_transfer") return "transfer"
  return documentType || "unknown"
}

function buildFolders(docs: WmsDocumentRow[]): DocumentFolder[] {
  const map = new Map<string, DocumentFolder>()
  for (const doc of docs) {
    const typeCode = folderTypeCode(doc.documentType)
    const typeLabel = documentTypeLabelRU(typeCode)
    const dateKey = formatDateKey(doc.createdAt)
    const dateLabel = formatDateRu(doc.createdAt)
    const key = `${typeCode}:${dateKey}`
    const existing = map.get(key)
    if (existing) {
      existing.docs.push(doc)
      existing.totalLines += doc.lineCount ?? 0
      if (Date.parse(doc.createdAt) > Date.parse(existing.latestAt)) existing.latestAt = doc.createdAt
      continue
    }
    map.set(key, {
      key,
      title: folderTitle(typeLabel, dateLabel),
      typeCode,
      typeLabel,
      dateKey,
      dateLabel,
      docs: [doc],
      totalLines: doc.lineCount ?? 0,
      latestAt: doc.createdAt,
    })
  }
  return [...map.values()].sort((a, b) => {
    const d = b.dateKey.localeCompare(a.dateKey)
    if (d !== 0) return d
    return a.typeLabel.localeCompare(b.typeLabel, "ru")
  })
}

const DOC_TREE_ROOT_ID = "documents-root"

function treeDocId(documentId: string): string {
  return `doc:${documentId}`
}

function treeTypeId(typeCode: string): string {
  return `type:${typeCode}`
}

function treeFolderId(folderKey: string): string {
  return `folder:${folderKey}`
}

function buildDocumentTree(docs: WmsDocumentRow[]): TreeViewElement[] {
  const folders = buildFolders(docs)
  const byType = new Map<string, { typeLabel: string; folders: DocumentFolder[] }>()
  for (const folder of folders) {
    const bucket = byType.get(folder.typeCode)
    if (bucket) bucket.folders.push(folder)
    else byType.set(folder.typeCode, { typeLabel: folder.typeLabel, folders: [folder] })
  }

  const typeNodes: TreeViewElement[] = [...byType.entries()].map(([typeCode, bucket]) => ({
    id: treeTypeId(typeCode),
    name: bucket.typeLabel,
    type: "folder",
    isSelectable: true,
    children: bucket.folders.map((folder) => ({
      id: treeFolderId(folder.key),
      name: folder.dateLabel,
      type: "folder",
      isSelectable: true,
      children: folder.docs
        .slice()
        .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
        .map((doc) => ({
          id: treeDocId(doc.documentId),
          name: docDisplayNo(doc),
          type: "file" as const,
          isSelectable: true,
        })),
    })),
  }))

  return [
    {
      id: DOC_TREE_ROOT_ID,
      name: "Документы",
      type: "folder",
      isSelectable: true,
      children: typeNodes,
    },
  ]
}

function collectDefaultExpandedIds(nodes: TreeViewElement[]): string[] {
  const ids: string[] = []
  for (const node of nodes) {
    if (!isFolderLike(node)) continue
    ids.push(node.id)
    if (node.children) {
      for (const child of node.children) {
        if (isFolderLike(child)) ids.push(child.id)
      }
    }
  }
  return ids
}

function isFolderLike(node: TreeViewElement): boolean {
  return node.type === "folder" || (node.children?.length ?? 0) > 0
}

function isProductionConsumptionDoc(doc: Pick<WmsDocumentRow, "documentType">): boolean {
  return (doc.documentType || "").toLowerCase().replace(/-/g, "_") === "production_consumption"
}

function routeText(doc: WmsDocumentRow): string {
  const fromWh = warehouseDisplayName(doc.sourceWarehouseCode, doc.sourceWarehouseName)
  const toWh = warehouseDisplayName(doc.targetWarehouseCode, doc.targetWarehouseName)
  const from = (fromWh || doc.sourceLocationCode || "").trim()
  const to = (toWh || doc.targetLocationCode || "").trim()
  const line = (doc.lineName || "").trim()

  if (isProductionConsumptionDoc(doc) || (!to && from && (doc.comment || "").toLowerCase().includes("списан"))) {
    const bits: string[] = []
    if (from) bits.push(from)
    if (line && line.toUpperCase() !== from.toUpperCase()) bits.push(`линия ${line}`)
    if (bits.length) return `Списано с ${bits.join(" · ")}`
    return (doc.comment || "").trim() || "Списание с линии"
  }

  if (!from && !to) return "Маршрут не задан"
  return `${from || "откуда не задано"} → ${to || "куда не задано"}`
}

export default function DocumentsPage() {
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState("")
  const [documents, setDocuments] = useState<WmsDocumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedFolderKey, setSelectedFolderKey] = useState<string | null>(null)
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [detail, setDetail] = useState<WmsDocumentDetailResponse | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [openCreateFromQuery, setOpenCreateFromQuery] = useState(false)
  const [bulkRefreshBusy, setBulkRefreshBusy] = useState(false)
  const [bulkRefreshMsg, setBulkRefreshMsg] = useState<string | null>(null)
  const [bulkRefreshError, setBulkRefreshError] = useState<string | null>(null)
  const [bulkRefreshVersion, setBulkRefreshVersion] = useState(0)

  async function loadDocuments(opts?: { quiet?: boolean }) {
    if (opts?.quiet) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const [data, receivingSessionDocs] = await Promise.all([
        listDocuments({ limit: 300 }),
        listReceivingSessionDocuments(),
      ])
      const realDocs = data.documents || []
      const realReceivingRefs = new Set(
        realDocs
          .filter((doc) => doc.documentType === "receiving")
          .flatMap((doc) => [doc.documentId, doc.documentNo, doc.externalRef].filter(Boolean) as string[])
      )
      const virtualReceivingDocs = receivingSessionDocs.filter((doc) => {
        const sourceDocumentId = doc.payloadJson?.sourceDocumentId
        return typeof sourceDocumentId !== "string" || !realReceivingRefs.has(sourceDocumentId)
      })
      setDocuments([...realDocs, ...virtualReceivingDocs])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить документы")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void loadDocuments()
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("new") !== "1") return
    setOpenCreateFromQuery(true)
    router.replace("/documents", { scroll: false })
  }, [router])

  async function onRefreshAllReceivingByTemplate() {
    if (
      !window.confirm(
        "Обновить ТОРГ-1 у всех документов приёмки по текущему шаблону из Настроек? Поля шаблона и таблица товара будут пересчитаны."
      )
    ) {
      return
    }
    setBulkRefreshBusy(true)
    setBulkRefreshMsg(null)
    setBulkRefreshError(null)
    try {
      const res = await refreshReceivingTorg1Documents({ mode: "template" })
      if (res.errors.length > 0) {
        const details = res.errors
          .slice(0, 5)
          .map((item) => `${item.id}: ${item.message}`)
          .join("; ")
        setBulkRefreshError(
          `Обновлено ${res.totalUpdated}, ошибок ${res.errors.length}. ${details}`
        )
      } else {
        setBulkRefreshMsg(`Готово без ошибок: обновлено ${res.totalUpdated}`)
      }
      setBulkRefreshVersion((value) => value + 1)
      window.setTimeout(() => setBulkRefreshMsg(null), 8000)
    } catch (e) {
      setBulkRefreshError(
        e instanceof Error ? e.message : "Не удалось обновить документы приёмки"
      )
    } finally {
      setBulkRefreshBusy(false)
    }
  }

  const filteredDocuments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return documents
    return documents.filter((doc) =>
      [
        doc.documentId,
        doc.documentNo,
        doc.documentType,
        documentTypeLabelRU(doc.documentType),
        doc.documentStatus,
        documentStatusLabelRU(doc.documentStatus),
        doc.externalRef,
        doc.comment,
        doc.sourceLocationCode,
        doc.targetLocationCode,
        doc.sourceWarehouseCode,
        doc.targetWarehouseCode,
      ].some((v) => (v || "").toLowerCase().includes(q))
    )
  }, [documents, searchQuery])

  const folders = useMemo(() => buildFolders(filteredDocuments), [filteredDocuments])
  const treeElements = useMemo(() => buildDocumentTree(filteredDocuments), [filteredDocuments])
  const treeExpandedIds = useMemo(() => collectDefaultExpandedIds(treeElements), [treeElements])
  const treeSelectedId = selectedDocId ? treeDocId(selectedDocId) : undefined

  useEffect(() => {
    if (folders.length === 0) {
      setSelectedFolderKey(null)
      setSelectedDocId(null)
    }
  }, [folders])

  const selectedDoc = useMemo(
    () => filteredDocuments.find((doc) => doc.documentId === selectedDocId) ?? null,
    [filteredDocuments, selectedDocId]
  )

  function handleTreeSelect(id: string) {
    if (id.startsWith("doc:")) {
      const documentId = id.slice("doc:".length)
      const doc = filteredDocuments.find((d) => d.documentId === documentId)
      setSelectedDocId(documentId)
      if (doc) {
        setSelectedFolderKey(`${doc.documentType || "unknown"}:${formatDateKey(doc.createdAt)}`)
      }
      return
    }
    if (id.startsWith("folder:")) {
      const folderKey = id.slice("folder:".length)
      setSelectedFolderKey(folderKey)
      const folder = folders.find((f) => f.key === folderKey)
      if (folder?.docs[0]) setSelectedDocId(folder.docs[0].documentId)
    }
  }

  useEffect(() => {
    if (
      !selectedDoc?.documentId ||
      selectedDoc.documentId.startsWith("code-list:") ||
      isReceivingSessionDoc(selectedDoc)
    ) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    void getWmsDocumentDetail(selectedDoc.documentId)
      .then((res) => {
        if (!cancelled) setDetail(res)
      })
      .catch((e) => {
        if (!cancelled) {
          setDetail(null)
          setDetailError(e instanceof Error ? e.message : "Не удалось загрузить состав документа")
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedDoc?.documentId])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-foreground">Документы</h1>
        <div className="flex flex-wrap items-center gap-2">
          <IncomingOrderImportDialog onImported={() => void loadDocuments({ quiet: true })} />
          <CreateDocumentDialog
            triggerLabel="Новый документ"
            triggerClassName="rounded-xl bg-primary text-primary-foreground"
            onCreated={() => void loadDocuments({ quiet: true })}
            initialOpen={openCreateFromQuery}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => void onRefreshAllReceivingByTemplate()}
            disabled={bulkRefreshBusy || loading}
            title="Пересобрать ТОРГ-1 у всех приёмок по шаблону из Настроек"
          >
            <RefreshCw className={cn("mr-1.5 h-4 w-4", bulkRefreshBusy && "animate-spin")} />
            Обновить приёмки
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => void loadDocuments({ quiet: true })}
            disabled={refreshing || loading}
          >
            <RefreshCw className={cn("mr-1.5 h-4 w-4", refreshing && "animate-spin")} />
            Обновить
          </Button>
        </div>
      </div>

      {bulkRefreshMsg ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-900">
          {bulkRefreshMsg}
        </div>
      ) : null}
      {bulkRefreshError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {bulkRefreshError}
        </div>
      ) : null}

      <div className="relative max-w-2xl">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Поиск: номер, тип, статус, ячейка, комментарий..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="rounded-xl bg-card pl-10 shadow-sm"
        />
      </div>

      {error ? (
        <WmsErrorState
          title="Не удалось загрузить документы WMS"
          message="Проверьте подключение к серверу и попробуйте ещё раз."
          onRetry={() => void loadDocuments()}
        />
      ) : null}

      <div className="grid min-h-[560px] gap-4 lg:grid-cols-[minmax(320px,480px)_minmax(0,1fr)]">
        <section className="flex min-h-[560px] flex-col">
          <div className="min-h-0 flex-1">
            {loading ? (
              <WmsTableSkeleton rows={8} columns={1} className="py-2" />
            ) : treeElements[0]?.children?.length ? (
              <div className="bg-background relative flex h-[min(68vh,720px)] w-full flex-col overflow-hidden rounded-lg border">
                <Tree
                  className="bg-background overflow-hidden rounded-md p-2"
                  elements={treeElements}
                  sort="none"
                  initialSelectedId={treeSelectedId ?? DOC_TREE_ROOT_ID}
                  selectedId={treeSelectedId}
                  initialExpandedItems={treeExpandedIds}
                  onSelect={handleTreeSelect}
                />
              </div>
            ) : (
              <div className="p-3">
                <WmsEmptyState
                  title="Записей пока нет"
                  description={
                    searchQuery.trim()
                      ? "Попробуйте изменить фильтры или очистить поиск."
                      : "Документы появятся после создания приёмки, выдачи или других операций WMS."
                  }
                />
              </div>
            )}
          </div>
        </section>

        <DocumentPreview
          key={`${selectedDoc?.documentId ?? "none"}:${bulkRefreshVersion}`}
          doc={selectedDoc}
          detail={detail}
          detailLoading={detailLoading}
          detailError={detailError}
          onOpen={() => setDetailOpen(true)}
        />
      </div>

      <DocumentDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        doc={selectedDoc}
        detail={detail}
        detailLoading={detailLoading}
        detailError={detailError}
      />
    </div>
  )
}

function DocumentPreview({
  doc,
  detail,
  detailLoading,
  detailError,
  onOpen,
}: {
  doc: WmsDocumentRow | null
  detail: WmsDocumentDetailResponse | null
  detailLoading: boolean
  detailError: string | null
  onOpen: () => void
}) {
  if (!doc) {
    return (
      <aside className="rounded-2xl border border-border/70 bg-card p-5 text-sm text-muted-foreground shadow-sm">
        Выберите документ для просмотра состава.
      </aside>
    )
  }

  if (doc.documentType === "receiving" || isReceivingSessionDoc(doc)) {
    return <ReceivingTorg1Panel doc={doc} />
  }

  if ((doc.documentType || "").toLowerCase() === "writeoff") {
    return <WriteoffTorg16Panel doc={doc} />
  }

  const status = statusView(doc.documentStatus)
  const StatusIcon = status.icon
  return (
    <aside className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-semibold">{docDisplayNo(doc)}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{documentTypeLabelRU(doc.documentType)}</div>
          </div>
          <Badge variant="secondary" className={cn("rounded-lg border", status.color)}>
            <StatusIcon className="mr-1 h-3 w-3" />
            {status.label}
          </Badge>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Дата</dt>
            <dd>{formatDateTimeRu(doc.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Позиций</dt>
            <dd>{doc.lineCount}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">Что везти и куда</dt>
            <dd className="font-medium">{routeText(doc)}</dd>
          </div>
          {doc.lineName ? (
            <div>
              <dt className="text-xs text-muted-foreground">Линия</dt>
              <dd>{doc.lineName}</dd>
            </div>
          ) : null}
          {doc.operatorName ? (
            <div>
              <dt className="text-xs text-muted-foreground">Оператор</dt>
              <dd>{doc.operatorName}</dd>
            </div>
          ) : null}
          {doc.comment ? (
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Комментарий</dt>
              <dd>{doc.comment}</dd>
            </div>
          ) : null}
          {doc.externalRef ? (
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Внешняя ссылка</dt>
              <dd>{doc.externalRef}</dd>
            </div>
          ) : null}
        </dl>

        <div className="flex flex-wrap gap-2">
          {isReceivingSessionDoc(doc) ? (
            <Button type="button" size="sm" className="rounded-xl" asChild>
              <Link href={docRoute(doc)}>Открыть сессию</Link>
            </Button>
          ) : (
            <Button type="button" size="sm" className="rounded-xl" onClick={onOpen}>
              Просмотр позиций
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" className="rounded-xl" asChild>
            <Link href={docRoute(doc)}>
              <Printer className="mr-1.5 h-4 w-4" />
              {isReceivingSessionDoc(doc) ? "Сессия" : "Печать"}
            </Link>
          </Button>
          {isReceivingSessionDoc(doc) ? null : (
            <Button type="button" variant="outline" size="sm" className="rounded-xl" asChild>
              <Link href={`/documents/${encodeURIComponent(doc.documentId)}`}>
                <ExternalLink className="mr-1.5 h-4 w-4" />
                Карточка
              </Link>
            </Button>
          )}
        </div>

        <div className="rounded-xl border border-border/70 bg-muted/20">
          <div className="border-b border-border px-3 py-2 text-sm font-semibold">Состав</div>
          {detailLoading ? (
            <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загрузка строк...
            </div>
          ) : detailError ? (
            <div className="p-3 text-sm text-destructive">{detailError}</div>
          ) : detail?.lines?.length ? (
            <div className="max-h-80 divide-y divide-border overflow-y-auto">
              {detail.lines.slice(0, 8).map((line) => {
                const qty = line.requestedQty || line.confirmedQty
                const uom = line.requestedUomCode || "шт"
                const route = routeText(doc)
                return (
                <div key={line.documentLineId} className="px-3 py-2 text-sm">
                  <div className="line-clamp-2 font-medium">{line.itemName || line.itemCode}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {line.itemCode} · {qty} {uom}
                    {line.lotCode ? ` · партия ${line.lotCode}` : ""}
                  </div>
                  {route && route !== "Маршрут не задан" ? (
                    <div className="mt-1 text-xs text-emerald-800">
                      Переместить {qty} {uom} по маршруту {route}
                    </div>
                  ) : null}
                </div>
                )
              })}
              {detail.lines.length > 8 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">Ещё {detail.lines.length - 8} строк в полном просмотре</div>
              ) : null}
            </div>
          ) : isReceivingSessionDoc(doc) ? (
            <div className="p-3 text-sm text-muted-foreground">
              Это сессия приёмки с ТСД. Откройте её, чтобы посмотреть сканы и оприходование.
            </div>
          ) : (
            <div className="p-3 text-sm text-muted-foreground">Строки не загружены или документ виртуальный.</div>
          )}
        </div>
      </div>
    </aside>
  )
}

function DocumentDetailDialog({
  open,
  onOpenChange,
  doc,
  detail,
  detailLoading,
  detailError,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  doc: WmsDocumentRow | null
  detail: WmsDocumentDetailResponse | null
  detailLoading: boolean
  detailError: string | null
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{doc ? docDisplayNo(doc) : "Документ"}</DialogTitle>
          <DialogDescription>
            {doc ? `${documentTypeLabelRU(doc.documentType)} · ${formatDateTimeRu(doc.createdAt)} · ${routeText(doc)}` : "Состав документа"}
          </DialogDescription>
        </DialogHeader>

        {detailLoading ? (
          <div className="flex items-center gap-2 rounded-xl border p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка состава...
          </div>
        ) : detailError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{detailError}</div>
        ) : !detail?.lines?.length ? (
          <div className="rounded-xl border p-4 text-sm text-muted-foreground">В документе нет строк для просмотра.</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="grid grid-cols-12 gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground">
              <div className="col-span-1">№</div>
              <div className="col-span-5">Номенклатура</div>
              <div className="col-span-2">Количество</div>
              <div className="col-span-2">Партия</div>
              <div className="col-span-2">Ячейка</div>
            </div>
            <div className="divide-y divide-border">
              {detail.lines.map((line) => (
                <div key={line.documentLineId} className="grid grid-cols-12 gap-3 px-3 py-2 text-sm">
                  <div className="col-span-1 text-muted-foreground">{line.lineNo}</div>
                  <div className="col-span-5">
                    <div className="font-medium">{line.itemName || line.itemCode}</div>
                    <div className="font-mono text-xs text-muted-foreground">{line.itemCode}</div>
                  </div>
                  <div className="col-span-2">
                    {line.requestedQty || line.confirmedQty} {line.requestedUomCode || "шт"}
                  </div>
                  <div className="col-span-2 font-mono text-xs text-muted-foreground">{line.lotCode || "—"}</div>
                  <div className="col-span-2 text-xs text-muted-foreground">
                    {line.sourceLocationCode ? `${line.sourceLocationCode} → ` : ""}
                    {line.targetLocationCode || "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          {doc ? (
            <>
              <Button type="button" variant="outline" className="rounded-xl" asChild>
                <Link href={docRoute(doc)}>
                  {isReceivingSessionDoc(doc) ? "Открыть сессию приёмки" : "Распечатать документ"}
                </Link>
              </Button>
              {isReceivingSessionDoc(doc) ? null : (
                <Button type="button" className="rounded-xl" asChild>
                  <Link href={`/documents/${encodeURIComponent(doc.documentId)}`}>Открыть карточку</Link>
                </Button>
              )}
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
