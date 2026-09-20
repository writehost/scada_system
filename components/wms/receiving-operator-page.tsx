"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderTree,
  MoreHorizontal,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
  XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { MarkingCodeHover } from "@/components/wms/marking-code-hover"
import {
  ReceivingScanEventsTable,
  type ReceivingScanEventRow,
} from "@/components/wms/receiving-scan-events-table"
import { ReceivingSessionItemNames } from "@/components/wms/receiving-item-name"
import {
  isReceivingScanAllowed,
  isReceivingScanBlocked,
  ReceivingSessionScanIcons,
  setReceivingScanHintContext,
} from "@/components/wms/receiving-scan-hint"
import {
  fmtReceivingQty,
  fmtReceivingTs,
  fmtReceivingTsParts,
  isTsdSessionOpen,
  isTsdSessionStale,
  normalizeReceivingDocId,
  tsdSessionLabel,
  stockPostedLabel,
  stockPostedTone,
  tsdSessionTone,
} from "@/components/wms/receiving-tsd-session"
import { ReceivingSettingsPanel } from "@/components/wms/receiving-settings-panel"
import { ReceivingManualDocumentDialog } from "@/components/wms/receiving-manual-document-dialog"
import { QuickReceivingDesk } from "@/components/wms/quick-receiving-desk"
import { ReceivingNomenclatureGroupDialog } from "@/components/wms/receiving-nomenclature-group-dialog"
import {
  deleteReceivingScanEvent,
  getReceivingSiteRules,
  getSiteCode,
  listItems,
  loadOperatorPickerGroups,
  postReceivingFinalize,
  resolveMissingNomenclature,
  type WmsItemListRow,
} from "@/lib/wms-api"
import {
  dismissEmptyReceivingSession,
  getWmsClientErrorDetails,
  getWmsClientErrorMeta,
} from "@/lib/receiving-client"
import { ReceivingMissingCellOffer } from "@/components/wms/receiving-missing-cell-offer"
import {
  parseReceivingMissingCellDetails,
  type ReceivingMissingCellDetails,
} from "@/lib/receiving-missing-cell"
import {
  cacheReceivingSiteRules,
  getReceivingAutoPostStock,
  getReceivingTargetLocationCode,
} from "@/lib/receiving-settings"
import {
  itemBelongsToOperatorGroup,
  operatorGroupListItemsParams,
  operatorGroupPickerSectionTitle,
  receivingScanMatchesOperatorGroup,
  type OperatorNomenclatureGroup,
  type OperatorPickerGroupsSource,
} from "@/lib/nomenclature-group-catalog"
import { RECEIVING_PRODUCT_GROUPS, receivingGroupTitle } from "@/lib/receiving-product-groups"
import { WmsStickyAlert } from "@/components/wms/wms-sticky-alert"
import { WmsEmptyState, WmsTableSkeleton } from "@/components/wms/wms-shared"
import { appendWmsErrorLine, mapWmsError, prunePostedDocErrors } from "@/lib/wms-error-messages"
import { cn } from "@/lib/utils"

type MissingNomenclatureRow = {
  id: string
  createdAt: string
  deviceUid: string | null
  code: string
  note: string
  comment: string | null
  resolvedAction?: string | null
  resolvedItemCode?: string | null
}

type TsdSessionRow = {
  documentId: string
  status: string
  lineCount: number | null
  updatedAtIso: string | null
  deviceUid: string | null
  productGroup?: string | null
  itemName?: string | null
  itemCode?: string | null
  totalQty?: number | null
  scanCount?: number | null
  allowedCount?: number | null
  blockedCount?: number | null
  stockPosted?: boolean
  stockPartiallyPosted?: boolean
  stockPostedAtIso?: string | null
  stockLocationCode?: string | null
  stockPostedQty?: number | null
  stockDismissedEmpty?: boolean
  stockPendingLineCount?: number
}

type OperatorFeed = {
  scanEvents: ReceivingScanEventRow[]
  missingNomenclature: MissingNomenclatureRow[]
  tsdSessions?: TsdSessionRow[]
  receivingRules?: import("@/lib/receiving-scan-policy").ReceivingSiteRules
  generatedAt: string
}

type SessionFilter = "open" | "closed" | "unposted" | "all"

type DocScanAgg = {
  lineCount: number
  totalQty: number
  blockedCount: number
  allowedCount: number
  scans: ReceivingScanEventRow[]
}

type EnrichedSession = TsdSessionRow & {
  totalQty: number
  blockedCount: number
  allowedCount: number
  scans: ReceivingScanEventRow[]
}

const SESSIONS_PAGE_SIZE = 25
/** Лента кэшируется на сервере, но опрос раз в 2.5 с всё равно гонял по сети всю выдачу. */
const FEED_POLL_MS = 6000

function sessionMatchesSearch(session: EnrichedSession, query: string) {
  const q = query.trim().toUpperCase()
  if (!q) return true
  if (session.documentId.includes(q)) return true
  if ((session.itemName || "").toUpperCase().includes(q)) return true
  if ((session.itemCode || "").toUpperCase().includes(q)) return true
  return session.scans.some((r) => {
    const name = r.itemName?.trim().toUpperCase() ?? ""
    const code = r.itemCode?.trim().toUpperCase() ?? ""
    return name.includes(q) || code.includes(q)
  })
}

export function ReceivingOperatorPage() {
  const router = useRouter()
  const [data, setData] = useState<OperatorFeed | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [draftComments, setDraftComments] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [deletingScanId, setDeletingScanId] = useState<string | null>(null)
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("open")
  const [problemsOnly, setProblemsOnly] = useState(false)
  const [docSearch, setDocSearch] = useState("")
  const [sessionsPage, setSessionsPage] = useState(0)
  const [postingDocId, setPostingDocId] = useState<string | null>(null)
  const [closingDocId, setClosingDocId] = useState<string | null>(null)
  const [dismissingDocId, setDismissingDocId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window === "undefined") return "sessions"
    return new URLSearchParams(window.location.search).get("tab") === "quick" ? "quick" : "sessions"
  })
  const [highlightRecvSettings, setHighlightRecvSettings] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [manualDocumentOpen, setManualDocumentOpen] = useState(false)
  const manualDocumentOpenRef = useRef(false)
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [nomenclatureGroups, setNomenclatureGroups] = useState<OperatorNomenclatureGroup[]>([])
  const [groupPickerSource, setGroupPickerSource] = useState<OperatorPickerGroupsSource>("item-groups")
  const [productGroup, setProductGroup] = useState<string>("stickers")
  const [itemByCode, setItemByCode] = useState<Map<string, WmsItemListRow>>(new Map())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bindCodes, setBindCodes] = useState<Record<string, string>>({})
  const [missingActionId, setMissingActionId] = useState<string | null>(null)

  const productGroupLabel = useMemo(() => {
    const g = nomenclatureGroups.find((x) => x.code === productGroup)
    return g?.name ?? receivingGroupTitle(productGroup)
  }, [nomenclatureGroups, productGroup])

  useEffect(() => {
    void getReceivingSiteRules()
      .then((res) => {
        cacheReceivingSiteRules(res.rules)
        setReceivingScanHintContext(res.rules, productGroup)
      })
      .catch(() => undefined)
    void loadOperatorPickerGroups()
      .then(({ groups: list, source }) => {
        setGroupPickerSource(source)
        if (list.length > 0) {
          setNomenclatureGroups(list)
          setProductGroup((prev) =>
            list.some((g) => g.code === prev) ? prev : list[0]!.code
          )
        }
      })
      .catch(() => {
        const fallback: OperatorNomenclatureGroup[] = RECEIVING_PRODUCT_GROUPS.filter((g) => g.enabled).map(
          (g) => ({
            code: g.key,
            name: g.title,
            description: g.subtitle,
            itemCount: 0,
            withStockCount: 0,
            sortOrder: 0,
          })
        )
        setGroupPickerSource("legacy")
        setNomenclatureGroups(fallback)
      })
  }, [])
  const autoPostAttemptsRef = useRef(new Set<string>())
  const [missingCellByDoc, setMissingCellByDoc] = useState<
    Map<string, ReceivingMissingCellDetails>
  >(new Map())

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const groupRow =
          nomenclatureGroups.find((g) => g.code === productGroup) ?? {
            code: productGroup,
            name: receivingGroupTitle(productGroup),
          }
        const rows = await listItems({
          ...operatorGroupListItemsParams(groupRow),
          limit: 800,
        })
        if (cancelled) return
        const map = new Map<string, WmsItemListRow>()
        for (const row of rows.items ?? []) {
          const code = row.itemCode?.trim()
          if (code) map.set(code, row)
        }
        setItemByCode(map)
      } catch {
        if (!cancelled) setItemByCode(new Map())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [productGroup, nomenclatureGroups])

  function scanMatchesGroup(scan: ReceivingScanEventRow): boolean {
    const code = scan.itemCode?.trim()
    if (!code) return false
    const row = itemByCode.get(code)
    const group =
      nomenclatureGroups.find((g) => g.code === productGroup) ?? {
        code: productGroup,
        name: productGroupLabel,
      }
    return receivingScanMatchesOperatorGroup(
      {
        itemCode: code,
        productGroup: row?.productGroup ?? null,
        itemGroupCode: row?.itemGroupCode ?? null,
        packagingProfile: row?.packagingProfile ?? null,
        isMarked: row?.isMarked ?? null,
      },
      group,
      scan
    )
  }

  function isClosedUnposted(session: EnrichedSession): boolean {
    if (session.stockDismissedEmpty) return false
    return (
      session.status.trim().toLowerCase() === "closed" &&
      (!session.stockPosted || Boolean(session.stockPartiallyPosted))
    )
  }

  function receivingFinalizePayload(docId: string) {
    const targetLocationCode = getReceivingTargetLocationCode().trim()
    return {
      documentId: docId,
      productGroup,
      ...(targetLocationCode ? { targetLocationCode } : {}),
    }
  }

  function sessionMatchesGroup(session: EnrichedSession): boolean {
    // Закрытые без проведения всегда показываем — иначе их не найти на вкладке «Стикеры»
    if (isClosedUnposted(session)) return true
    const pg = session.productGroup?.trim()
    if (
      pg &&
      itemBelongsToOperatorGroup(
        { productGroup: pg },
        nomenclatureGroups.find((g) => g.code === productGroup) ?? {
          code: productGroup,
          name: productGroupLabel,
        }
      )
    ) {
      return true
    }
    if ((session.lineCount ?? 0) === 0) {
      const ts = Date.parse(session.updatedAtIso || "")
      const recent = Number.isFinite(ts) && Date.now() - ts < 12 * 60 * 60 * 1000
      return recent && isTsdSessionOpen(session.status, {
        updatedAtIso: session.updatedAtIso,
        scanCount: 0,
      })
    }
    // Сканы в ленте — только последние по площадке, у старой сессии их может не быть в выдаче.
    if (session.scans.length === 0 || itemByCode.size === 0) return true
    return session.scans.some(scanMatchesGroup)
  }

  function sessionHasGroupScans(session: EnrichedSession): boolean {
    // Если справочник items ещё не подгрузился — не орём «не стикеры»
    if (itemByCode.size === 0) return true
    // Сессия явно в текущей группе (productGroup с ТСД/веба)
    const pg = session.productGroup?.trim()
    if (
      pg &&
      itemBelongsToOperatorGroup(
        { productGroup: pg },
        nomenclatureGroups.find((g) => g.code === productGroup) ?? {
          code: productGroup,
          name: productGroupLabel,
        }
      )
    ) {
      return true
    }
    // Нет сканов в ленте (старая сессия) — не ставим бейдж «не …»
    if (session.scans.length === 0) return true
    return session.scans.some(scanMatchesGroup)
  }

  async function loadFeed(silent = false) {
    if (!silent) {
      setRefreshing(true)
      setError(null)
    }
    try {
      const qp = new URLSearchParams()
      qp.set("siteCode", getSiteCode())
      qp.set("limit", "200")
      const r = await fetch(`/api/wms/receiving/operator-feed?${qp.toString()}`, {
        cache: "no-store",
      })
      const json = await r.json()
      if (!r.ok) throw new Error(json?.error || "Не удалось загрузить приёмку")
      setData(json)
      if (json.receivingRules) {
        cacheReceivingSiteRules(json.receivingRules)
        setReceivingScanHintContext(json.receivingRules, productGroup)
      }
      setError((prev) =>
        prunePostedDocErrors(
          prev,
          (json.tsdSessions ?? [])
            .filter((s: TsdSessionRow) => s.stockPosted)
            .map((s: TsdSessionRow) => s.documentId)
        )
      )
    } catch (e) {
      const msg = mapWmsError(e)
      if (silent) {
        setError((prev) => prev ?? msg)
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
      if (!silent) setRefreshing(false)
    }
  }

  useEffect(() => {
    manualDocumentOpenRef.current = manualDocumentOpen
  }, [manualDocumentOpen])

  useEffect(() => {
    setLoading(true)
    void loadFeed()
    const tick = () => {
      if (manualDocumentOpenRef.current) return
      if (document.visibilityState === "visible") void loadFeed(true)
    }
    const timer = setInterval(tick, FEED_POLL_MS)
    return () => clearInterval(timer)
  }, [])

  async function saveComment(id: string) {
    const comment = draftComments[id] ?? ""
    try {
      setSavingId(id)
      const r = await fetch(`/api/wms/receiving/missing-nomenclature/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteCode: getSiteCode(),
          comment: comment.trim() || null,
        }),
      })
      const json = await r.json()
      if (!r.ok) throw new Error(json?.error || "Не удалось сохранить комментарий")
      await loadFeed()
    } catch (e) {
      setError(mapWmsError(e))
    } finally {
      setSavingId(null)
    }
  }

  async function applyMissingAction(
    row: MissingNomenclatureRow,
    action: "bind" | "create" | "hold"
  ) {
    try {
      setMissingActionId(`${row.id}:${action}`)
      setError(null)
      const result = await resolveMissingNomenclature({
        id: row.id,
        action,
        comment: draftComments[row.id] ?? row.comment,
        itemCode: bindCodes[row.id],
      })
      setSuccess(
        action === "create"
          ? `Создана карточка ${result.itemCode ?? ""}`
          : action === "bind"
            ? `Код привязан к ${result.itemCode ?? bindCodes[row.id]}`
            : "Код отложен — вернётесь к нему позже"
      )
      await loadFeed()
    } catch (e) {
      setError(mapWmsError(e))
    } finally {
      setMissingActionId(null)
    }
  }

  async function removeScan(row: ReceivingScanEventRow) {
    try {
      setDeletingScanId(row.id)
      setError(null)
      await deleteReceivingScanEvent(row.id)
      await loadFeed()
    } catch (e) {
      setError(mapWmsError(e))
    } finally {
      setDeletingScanId(null)
    }
  }

  const scanRows = useMemo(() => data?.scanEvents ?? [], [data])

  const scanByDoc = useMemo(() => {
    const map = new Map<string, DocScanAgg>()
    for (const row of scanRows) {
      const docId = normalizeReceivingDocId(String(row.documentId ?? ""))
      if (!docId) continue
      const cur = map.get(docId) ?? {
        lineCount: 0,
        totalQty: 0,
        blockedCount: 0,
        allowedCount: 0,
        scans: [],
      }
      cur.lineCount += 1
      cur.totalQty += row.qty ?? 1
      if (isReceivingScanBlocked(row)) cur.blockedCount += 1
      if (isReceivingScanAllowed(row)) cur.allowedCount += 1
      cur.scans.push(row)
      map.set(docId, cur)
    }
    return map
  }, [scanRows])

  const sessions = useMemo((): EnrichedSession[] => {
    const list = (data?.tsdSessions ?? []).map((s) => {
      const id = normalizeReceivingDocId(s.documentId)
      const agg = scanByDoc.get(id)
      const lineCount = Math.max(agg?.lineCount ?? 0, s.scanCount ?? 0, s.lineCount ?? 0)
      const totalQty = Math.max(agg?.totalQty ?? 0, s.totalQty ?? 0, lineCount)
      return {
        ...s,
        documentId: id,
        lineCount,
        totalQty,
        blockedCount: Math.max(agg?.blockedCount ?? 0, s.blockedCount ?? 0),
        allowedCount: Math.max(agg?.allowedCount ?? 0, s.allowedCount ?? 0),
        scans: agg?.scans ?? [],
      }
    })
    return list.sort((a, b) => {
      if (a.blockedCount !== b.blockedCount) return b.blockedCount - a.blockedCount
      return Date.parse(b.updatedAtIso || "") - Date.parse(a.updatedAtIso || "")
    })
  }, [data, scanByDoc])

  /** ТСД закрыл документ — веб догоняет автопроведение, если на ТСД не успело или настройка только в вебе */
  useEffect(() => {
    if (!getReceivingAutoPostStock()) return
    for (const s of sessions) {
      if (s.status.trim().toLowerCase() !== "closed") continue
      if (s.stockPosted) continue
      if (s.allowedCount <= 0) continue
      if (postingDocId === s.documentId) continue
      const attemptKey = `${s.documentId}:${s.allowedCount}:${s.stockPartiallyPosted ? "partial" : "new"}`
      if (autoPostAttemptsRef.current.has(attemptKey)) continue
      autoPostAttemptsRef.current.add(attemptKey)
      void postReceivingFinalize(receivingFinalizePayload(s.documentId))
        .then((body) => {
          setError((prev) => prunePostedDocErrors(prev, [s.documentId]))
          const loc = body.locationCode ? ` → ${body.locationCode}` : ""
          setSuccess(
            [
              `Документ ${s.documentId} проведён на остаток${loc}`,
              body.postingNote,
              body.movementsCreated === 0 ? "Все позиции уже были на остатке." : null,
            ]
              .filter(Boolean)
              .join(" · ")
          )
          return loadFeed(true)
        })
        .catch((err) => {
          autoPostAttemptsRef.current.delete(attemptKey)
          registerPostError(s.documentId, err)
        })
    }
  }, [sessions, productGroup, postingDocId])

  useEffect(() => {
    if (!success) return
    const t = window.setTimeout(() => setSuccess(null), 8000)
    return () => window.clearTimeout(t)
  }, [success])

  useEffect(() => {
    setError((prev) =>
      prunePostedDocErrors(
        prev,
        sessions.filter((s) => s.stockPosted).map((s) => s.documentId)
      )
    )
  }, [sessions])

  const visibleSessions = useMemo(
    () => sessions.filter((s) => sessionMatchesGroup(s)),
    [sessions, productGroup, itemByCode]
  )

  const filteredSessions = useMemo(() => {
    return visibleSessions.filter((s) => {
      if (!sessionMatchesSearch(s, docSearch)) return false
      if (problemsOnly && s.blockedCount === 0) return false
      if (sessionFilter === "open")
        return isTsdSessionOpen(s.status, {
          updatedAtIso: s.updatedAtIso,
          scanCount: s.lineCount ?? 0,
        })
      if (sessionFilter === "closed") return s.status.trim().toLowerCase() === "closed"
      if (sessionFilter === "unposted") return isClosedUnposted(s)
      return true
    })
  }, [visibleSessions, sessionFilter, docSearch, problemsOnly, productGroup, itemByCode])

  const sessionsPageCount = Math.max(1, Math.ceil(filteredSessions.length / SESSIONS_PAGE_SIZE))

  const paginatedSessions = useMemo(() => {
    const safePage = Math.min(sessionsPage, sessionsPageCount - 1)
    const start = safePage * SESSIONS_PAGE_SIZE
    return filteredSessions.slice(start, start + SESSIONS_PAGE_SIZE)
  }, [filteredSessions, sessionsPage, sessionsPageCount])

  useEffect(() => {
    setSessionsPage(0)
  }, [sessionFilter, docSearch, problemsOnly])

  useEffect(() => {
    if (sessionsPage >= sessionsPageCount) {
      setSessionsPage(Math.max(0, sessionsPageCount - 1))
    }
  }, [sessionsPage, sessionsPageCount])

  const problemScans = useMemo(
    () => scanRows.filter((r) => isReceivingScanBlocked(r) && scanMatchesGroup(r)),
    [scanRows, productGroup, itemByCode]
  )

  const missing = useMemo(() => data?.missingNomenclature ?? [], [data])

  const counts = useMemo(() => {
    const open = visibleSessions.filter((s) =>
      isTsdSessionOpen(s.status, { updatedAtIso: s.updatedAtIso, scanCount: s.lineCount ?? 0 })
    ).length
    const closed = visibleSessions.filter((s) => s.status.trim().toLowerCase() === "closed").length
    const okScans = scanRows.filter((r) => isReceivingScanAllowed(r) && scanMatchesGroup(r)).length
    const withProblems = visibleSessions.filter((s) => s.blockedCount > 0).length
    const closedUnposted = visibleSessions.filter((s) => isClosedUnposted(s)).length
    return {
      open,
      closed,
      closedUnposted,
      okScans,
      withProblems,
      problems: problemScans.length + missing.length,
      sessions: visibleSessions.length,
    }
  }, [visibleSessions, scanRows, problemScans.length, missing.length, productGroup, itemByCode])

  function registerPostError(docId: string, err: unknown) {
    const msg = mapWmsError(err)
    setError((prev) => appendWmsErrorLine(prev, `[${docId}] ${msg}`))
    const { code } = getWmsClientErrorMeta(err)
    const cell = parseReceivingMissingCellDetails(getWmsClientErrorDetails(err))
    if (code === "receiving_storage_cell_missing" && cell) {
      setMissingCellByDoc((prev) => new Map(prev).set(docId, cell))
    }
    if (
      msg.includes("ячейк") ||
      msg.includes("RECV") ||
      msg.includes("targetLocation") ||
      msg.includes("профил")
    ) {
      setHighlightRecvSettings(true)
      setSettingsOpen(true)
    }
  }

  async function postSessionStock(docId: string, e?: React.MouseEvent) {
    e?.stopPropagation()
    try {
      setPostingDocId(docId)
      setError(null)
      setHighlightRecvSettings(false)
      const body = await postReceivingFinalize(receivingFinalizePayload(docId))
      setSuccess(
        [
          `Документ ${docId} проведён в ячейку ${body.locationCode ?? "—"}`,
          body.postingNote,
        ]
          .filter(Boolean)
          .join(" · ")
      )
      setMissingCellByDoc((prev) => {
        const next = new Map(prev)
        next.delete(docId)
        return next
      })
      setError((prev) => prunePostedDocErrors(prev, [docId]))
      await loadFeed()
    } catch (err) {
      registerPostError(docId, err)
    } finally {
      setPostingDocId(null)
    }
  }

  async function retryPostAfterCellCreated(docId: string) {
    setMissingCellByDoc((prev) => {
      const next = new Map(prev)
      next.delete(docId)
      return next
    })
    await postSessionStock(docId)
  }

  const attentionCount = counts.problems

  function openSession(docId: string) {
    router.push(`/receiving/session/${encodeURIComponent(docId)}`)
  }

  async function closeStaleSession(docId: string, e?: React.MouseEvent) {
    e?.stopPropagation()
    try {
      setClosingDocId(docId)
      setError(null)
      const r = await fetch("/api/wms/receiving/session-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteCode: getSiteCode(),
          documentId: docId,
          status: "closed",
          lineCount: 0,
          deviceUid: "web-operator",
        }),
      })
      const json = await r.json()
      if (!r.ok) throw new Error(json?.error || "Не удалось закрыть сессию")
      if (getReceivingAutoPostStock()) {
        try {
          const body = await postReceivingFinalize(receivingFinalizePayload(docId))
          setSuccess(
            [
              `Документ ${docId} закрыт и проведён в ${body.locationCode ?? "ячейку"}`,
              body.postingNote,
            ]
              .filter(Boolean)
              .join(" · ")
          )
        } catch (postErr) {
          setSuccess(`Документ ${docId} закрыт. Проведение: ${mapWmsError(postErr)}`)
        }
      } else {
        setSuccess(`Документ ${docId} закрыт на сервере`)
      }
      await loadFeed()
    } catch (err) {
      setError(mapWmsError(err))
    } finally {
      setClosingDocId(null)
    }
  }

  function toggleSelected(docId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(docId)) next.delete(docId)
      else next.add(docId)
      return next
    })
  }

  /** Что реально можно сделать с выделенными документами — считаем один раз для панели массовых действий. */
  const bulk = useMemo(() => {
    const rows = paginatedSessions.filter((s) => selected.has(s.documentId))
    const postable = rows.filter((s) => {
      const closed = s.status.trim().toLowerCase() === "closed"
      return closed && (!s.stockPosted || s.stockPartiallyPosted) && s.allowedCount > 0
    })
    const closable = rows.filter((s) => s.status.trim().toLowerCase() !== "closed")
    const emptyClosed = rows.filter(
      (s) =>
        s.status.trim().toLowerCase() === "closed" &&
        !s.stockPosted &&
        !s.stockDismissedEmpty &&
        (s.lineCount ?? 0) === 0
    )
    return { rows, postable, closable, emptyClosed }
  }, [paginatedSessions, selected])

  const pageAllSelected =
    paginatedSessions.length > 0 && paginatedSessions.every((s) => selected.has(s.documentId))

  function toggleSelectPage() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (pageAllSelected) {
        for (const s of paginatedSessions) next.delete(s.documentId)
      } else {
        for (const s of paginatedSessions) next.add(s.documentId)
      }
      return next
    })
  }

  async function runBulk(kind: "post" | "close" | "dismiss") {
    const docs =
      kind === "post"
        ? bulk.postable.map((s) => s.documentId)
        : kind === "close"
          ? bulk.closable.map((s) => s.documentId)
          : bulk.emptyClosed.map((s) => s.documentId)
    if (docs.length === 0) return
    setBulkRunning(true)
    setError(null)
    let done = 0
    const failed: string[] = []
    for (const docId of docs) {
      try {
        if (kind === "post") {
          await postReceivingFinalize(receivingFinalizePayload(docId))
        } else if (kind === "close") {
          const r = await fetch("/api/wms/receiving/session-status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              siteCode: getSiteCode(),
              documentId: docId,
              status: "closed",
              lineCount: 0,
              deviceUid: "web-operator",
            }),
          })
          if (!r.ok) throw new Error((await r.json())?.error || "Не удалось закрыть сессию")
        } else {
          await dismissEmptyReceivingSession({ documentId: docId })
        }
        done += 1
      } catch (err) {
        failed.push(`[${docId}] ${mapWmsError(err)}`)
      }
    }
    const labels = { post: "проведено", close: "закрыто", dismiss: "снято с учёта" }
    setSuccess(`${labels[kind]}: ${done} из ${docs.length}`)
    if (failed.length > 0) {
      setError((prev) => failed.reduce((acc, line) => appendWmsErrorLine(acc, line), prev))
    }
    setSelected(new Set())
    setBulkRunning(false)
    await loadFeed()
  }

  async function dismissEmptySession(docId: string, e?: React.MouseEvent) {
    e?.stopPropagation()
    try {
      setDismissingDocId(docId)
      setError(null)
      await dismissEmptyReceivingSession({ documentId: docId })
      setSuccess(`Документ ${docId} снят с учёта (пустая сессия)`)
      setError((prev) => prunePostedDocErrors(prev, [docId]))
      await loadFeed()
    } catch (err) {
      setError(mapWmsError(err))
    } finally {
      setDismissingDocId(null)
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="wms-panel sticky top-0 z-30 rounded-2xl px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <h1 className="text-sm font-semibold tracking-tight text-foreground">Приёмка</h1>
          <button
            type="button"
            className="rounded-md border border-border/60 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setGroupDialogOpen(true)}
            title="Выбрать группу номенклатуры"
          >
            {productGroupLabel}
          </button>

          <div className="flex max-w-full shrink-0 overflow-x-auto rounded-lg border border-border/60 bg-muted/40 p-0.5">
            {(
              [
                ["sessions", "Сессии", counts.open],
                ["quick", "Быстрая", 0],
                ["attention", "Внимание", attentionCount],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  activeTab === key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
                {count > 0 ? (
                  <Badge
                    variant={key === "attention" ? "destructive" : "secondary"}
                    className="rounded px-1 py-0 text-[10px] leading-4"
                  >
                    {count}
                  </Badge>
                ) : null}
              </button>
            ))}
          </div>

          <div className="order-last flex w-full flex-wrap items-center gap-1.5 sm:order-none sm:ml-auto sm:w-auto sm:flex-nowrap sm:justify-end">
            <Button
              variant="default"
              size="sm"
              className="h-8 shrink-0 rounded-lg"
              onClick={() => setManualDocumentOpen(true)}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Документ
            </Button>
            <ReceivingSettingsPanel
              highlightMissing={highlightRecvSettings}
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
            />
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={() => void loadFeed()}
              disabled={refreshing}
              aria-label="Обновить"
              title={refreshing ? "Обновляем…" : `Обновить · авто ${FEED_POLL_MS / 1000} с`}
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-lg"
                  aria-label="Ещё"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem asChild>
                  <Link href="/documents" prefetch={false}>
                    <FileText className="mr-2 h-4 w-4" />
                    Приходные ордера
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setGroupDialogOpen(true)}>
                  <FolderTree className="mr-2 h-4 w-4" />
                  Группа номенклатуры…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled className="text-[11px] leading-snug">
                  Клик по строке открывает сессию. ✓ — код эмитирован, ! — заблокирован.
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {activeTab === "quick" ? null : activeTab === "sessions" ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2">
            <div className="flex max-w-full overflow-x-auto rounded-lg border border-border/60 p-0.5">
              {(
                [
                  ["open", "В работе", counts.open],
                  ["closed", "Закрытые", counts.closed],
                  ["unposted", "Не проведено", counts.closedUnposted],
                  ["all", "Все", counts.sessions],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSessionFilter(key)}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    sessionFilter === key
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                    key === "unposted" && counts.closedUnposted > 0 && sessionFilter !== key
                      ? "text-orange-800"
                      : ""
                  )}
                >
                  {label}
                  {count > 0 ? ` ${count}` : ""}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setProblemsOnly((v) => !v)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                problemsOnly
                  ? "border-red-500/40 bg-red-500/10 text-red-800"
                  : "border-border/60 text-muted-foreground hover:text-foreground"
              )}
            >
              С проблемами
              {counts.withProblems > 0 ? ` ${counts.withProblems}` : ""}
            </button>
            <div className="relative ml-auto w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={docSearch}
                onChange={(e) => setDocSearch(e.target.value)}
                placeholder="Документ, номенклатура или GTIN"
                className="h-8 rounded-lg pl-8 text-xs"
              />
              {docSearch ? (
                <button
                  type="button"
                  onClick={() => setDocSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Очистить поиск"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <ReceivingNomenclatureGroupDialog
        open={groupDialogOpen}
        onOpenChange={setGroupDialogOpen}
        groups={nomenclatureGroups}
        selectedCode={productGroup}
        title={operatorGroupPickerSectionTitle(groupPickerSource)}
        onSelect={setProductGroup}
      />

      <ReceivingManualDocumentDialog
        open={manualDocumentOpen}
        onOpenChange={setManualDocumentOpen}
        onCreated={(documentId) => {
          setSuccess(`Документ приёмки ${documentId} создан и проведён на остаток`)
          void loadFeed()
        }}
      />

      {activeTab === "quick" ? <QuickReceivingDesk /> : null}

      {activeTab !== "quick" && counts.closedUnposted > 0 && sessionFilter !== "unposted" && activeTab === "sessions" ? (
        <button
          type="button"
          onClick={() => {
            setSessionFilter("unposted")
            setProblemsOnly(false)
          }}
          className="flex w-full items-center gap-2 rounded-xl border border-orange-500/35 bg-orange-500/10 px-3 py-1.5 text-left text-xs text-orange-950 transition-colors hover:bg-orange-500/15"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            {counts.closedUnposted} закрытых без проведения — остаток на склад не попал.
          </span>
          <span className="underline">Показать</span>
        </button>
      ) : null}

      {success ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-900">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span className="flex-1">{success}</span>
          <button
            type="button"
            onClick={() => setSuccess(null)}
            className="text-emerald-900/60 hover:text-emerald-900"
            aria-label="Скрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {error ? (
        <>
          <WmsStickyAlert
            message={error}
            onDismiss={() => {
              setError(null)
              setMissingCellByDoc(new Map())
            }}
          />
          {[...missingCellByDoc.entries()].map(([docId, details]) => (
            <ReceivingMissingCellOffer
              key={docId}
              documentId={docId}
              details={details}
              onCreated={() => void retryPostAfterCellCreated(docId)}
            />
          ))}
        </>
      ) : null}

      {activeTab !== "quick" ? (
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-2.5">
        <TabsContent value="sessions" className="mt-0">
          <section className="wms-panel overflow-hidden">
            {selected.size > 0 ? (
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary/5 px-3 py-2">
                <span className="text-xs font-medium text-foreground">
                  Выбрано: {selected.size}
                </span>
                <Button
                  size="sm"
                  className="h-7 rounded-md text-xs"
                  disabled={bulkRunning || bulk.postable.length === 0}
                  onClick={() => void runBulk("post")}
                >
                  {bulkRunning ? "…" : `Провести (${bulk.postable.length})`}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-md text-xs"
                  disabled={bulkRunning || bulk.closable.length === 0}
                  onClick={() => void runBulk("close")}
                >
                  {bulkRunning ? "…" : `Закрыть (${bulk.closable.length})`}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-md text-xs"
                  disabled={bulkRunning || bulk.emptyClosed.length === 0}
                  onClick={() => void runBulk("dismiss")}
                >
                  {bulkRunning ? "…" : `Убрать пустые (${bulk.emptyClosed.length})`}
                </Button>
                <button
                  type="button"
                  className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setSelected(new Set())}
                >
                  Снять выделение
                </button>
              </div>
            ) : null}

            <div className="overflow-x-auto">
              <table className="wms-ag-grid min-w-[900px]">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="w-8">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 cursor-pointer accent-primary"
                        checked={pageAllSelected}
                        onChange={toggleSelectPage}
                        aria-label="Выбрать все на странице"
                        title="Выбрать все на странице"
                      />
                    </th>
                    <th className="w-[9.5rem] whitespace-nowrap">Документ</th>
                    <th className="min-w-[11rem]">Номенклатура</th>
                    <th className="w-[8.5rem]">Статус</th>
                    <th className="w-[5.5rem]">Коды</th>
                    <th className="w-[3.5rem] text-right">Поз.</th>
                    <th className="w-[4.5rem] whitespace-nowrap text-right">Кол-во</th>
                    <th className="w-[5rem]">Обновлён</th>
                    <th className="w-[8.5rem]">Действие</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedSessions.map((s) => {
                    const isClosedSession = s.status.trim().toLowerCase() === "closed"
                    const canPost =
                      isClosedSession &&
                      (!s.stockPosted || Boolean(s.stockPartiallyPosted)) &&
                      (s.allowedCount ?? 0) > 0
                    const canDismissEmpty =
                      isClosedSession &&
                      !s.stockPosted &&
                      !s.stockDismissedEmpty &&
                      (s.lineCount ?? 0) === 0
                    const groupMatch = sessionHasGroupScans(s)
                    const stale = isTsdSessionStale(s.status, s.updatedAtIso, s.lineCount ?? 0)
                    const canCloseOnServer = !isClosedSession
                    const updatedParts = fmtReceivingTsParts(s.updatedAtIso)
                    return (
                      <tr
                        key={s.documentId}
                        role="button"
                        tabIndex={0}
                        onClick={() => openSession(s.documentId)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            openSession(s.documentId)
                          }
                        }}
                        className={cn(
                          "wms-ag-row cursor-pointer outline-none focus-visible:bg-accent/30",
                          s.blockedCount > 0 && "bg-red-500/5 hover:bg-red-500/10"
                        )}
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 cursor-pointer accent-primary"
                            checked={selected.has(s.documentId)}
                            onChange={() => toggleSelected(s.documentId)}
                            aria-label={`Выбрать ${s.documentId}`}
                          />
                        </td>
                        <td>
                          <span className="block truncate font-mono text-[13px] font-semibold text-primary">
                            {s.documentId}
                          </span>
                          <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                            {s.deviceUid?.trim()
                              ? s.deviceUid.toLowerCase() === "web-operator"
                                ? "веб"
                                : s.deviceUid.slice(0, 14)
                              : "ТСД не указан"}
                          </span>
                        </td>
                        <td>
                          <ReceivingSessionItemNames
                            scans={s.scans}
                            fallbackName={s.itemName}
                            className="line-clamp-2 text-[13px]"
                          />
                          {!groupMatch && s.scans.length > 0 ? (
                            <Badge variant="outline" className="mt-1 rounded-md text-[10px] font-normal">
                              не {productGroupLabel.toLowerCase()}
                            </Badge>
                          ) : null}
                        </td>
                        <td>
                          <div className="flex flex-col items-start gap-1">
                            <span
                              className={cn(
                                "wms-ag-status whitespace-nowrap",
                                tsdSessionTone(s.status, s.lineCount)
                              )}
                            >
                              {tsdSessionLabel(s.status, s.lineCount, s.lineCount ?? 0)}
                            </span>
                            {isClosedSession || s.stockPosted || s.stockPartiallyPosted ? (
                              <span className="flex flex-wrap items-center gap-1">
                                <span
                                  className={cn(
                                    "wms-ag-status whitespace-nowrap",
                                    stockPostedTone(s.stockPosted, s.stockDismissedEmpty, s.stockPartiallyPosted)
                                  )}
                                >
                                  {stockPostedLabel(s.stockPosted, s.stockDismissedEmpty, s.stockPartiallyPosted)}
                                </span>
                                {s.stockLocationCode ? (
                                  <span className="font-mono text-[10px] text-muted-foreground">
                                    {s.stockLocationCode}
                                  </span>
                                ) : null}
                              </span>
                            ) : null}
                            {stale ? (
                              <span className="wms-ag-status whitespace-nowrap border-orange-500/30 text-orange-800">
                                нет на ТСД?
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <ReceivingSessionScanIcons rows={s.scans} totalCount={s.lineCount ?? s.scans.length} />
                        </td>
                        <td className="wms-ag-cell-num">{s.lineCount ?? 0}</td>
                        <td className="wms-ag-cell-num font-semibold">
                          {s.totalQty > 0 ? fmtReceivingQty(s.totalQty) : "—"}
                        </td>
                        <td
                          className="whitespace-nowrap text-[11px] text-muted-foreground"
                          title={fmtReceivingTs(s.updatedAtIso)}
                        >
                          {updatedParts ? (
                            <>
                              <span className="block">{updatedParts.day}</span>
                              <span className="block tabular-nums">{updatedParts.time}</span>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            {canPost ? (
                              <Button
                                size="sm"
                                className="h-7 rounded-md"
                                disabled={postingDocId === s.documentId}
                                onClick={(e) => void postSessionStock(s.documentId, e)}
                              >
                                {postingDocId === s.documentId ? "…" : "Провести"}
                              </Button>
                            ) : canDismissEmpty ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 rounded-md text-xs"
                                disabled={dismissingDocId === s.documentId}
                                onClick={(e) => void dismissEmptySession(s.documentId, e)}
                              >
                                {dismissingDocId === s.documentId ? "…" : "Убрать"}
                              </Button>
                            ) : isClosedSession && s.stockPartiallyPosted ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 rounded-md border-amber-500/40 text-xs text-amber-900"
                                disabled={postingDocId === s.documentId}
                                onClick={(e) => void postSessionStock(s.documentId, e)}
                              >
                                {postingDocId === s.documentId ? "…" : "Допровести"}
                              </Button>
                            ) : isClosedSession && (s.stockPosted || s.stockDismissedEmpty) ? (
                              <span className="text-xs text-muted-foreground">
                                {s.stockDismissedEmpty ? "Снято" : "Готово"}
                              </span>
                            ) : canCloseOnServer ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 rounded-md text-xs"
                                disabled={closingDocId === s.documentId}
                                onClick={(e) => void closeStaleSession(s.documentId, e)}
                              >
                                {closingDocId === s.documentId ? "…" : "Закрыть"}
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="ml-auto h-7 w-7 shrink-0 rounded-md"
                                  aria-label={`Действия по ${s.documentId}`}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuItem onSelect={() => openSession(s.documentId)}>
                                  <ChevronRight className="mr-2 h-4 w-4" />
                                  Открыть сессию
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={!canPost || postingDocId === s.documentId}
                                  onSelect={() => void postSessionStock(s.documentId)}
                                >
                                  <PackageCheck className="mr-2 h-4 w-4" />
                                  {s.stockPartiallyPosted ? "Допровести на остаток" : "Провести на остаток"}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={!canCloseOnServer || closingDocId === s.documentId}
                                  onSelect={() => void closeStaleSession(s.documentId)}
                                >
                                  <XCircle className="mr-2 h-4 w-4" />
                                  Закрыть сессию
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={!canDismissEmpty || dismissingDocId === s.documentId}
                                  onSelect={() => void dismissEmptySession(s.documentId)}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Убрать пустую из списка
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {loading && !data ? (
                    <tr>
                      <td colSpan={9} className="!border-0 p-0">
                        <WmsTableSkeleton rows={10} columns={6} className="border-0" />
                      </td>
                    </tr>
                  ) : null}
                  {!loading && data !== null && filteredSessions.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="!border-0 p-0">
                        <WmsEmptyState
                          title="Нет документов приёмки"
                          description={
                            visibleSessions.length === 0
                              ? "Нет сессий с ТСД — начните приёмку на терминале."
                              : sessionFilter === "open" && counts.closedUnposted > 0
                                ? "Открытых нет. Есть закрытые без проведения — фильтр «Не проведено»."
                                : "Измените фильтр или обновите список."
                          }
                        />
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {filteredSessions.length > SESSIONS_PAGE_SIZE ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  {filteredSessions.length} док. · стр. {sessionsPage + 1} из {sessionsPageCount}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-7 w-7 rounded-md"
                    disabled={sessionsPage <= 0}
                    onClick={() => setSessionsPage((p) => Math.max(0, p - 1))}
                    aria-label="Предыдущая страница"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-7 w-7 rounded-md"
                    disabled={sessionsPage >= sessionsPageCount - 1}
                    onClick={() => setSessionsPage((p) => Math.min(sessionsPageCount - 1, p + 1))}
                    aria-label="Следующая страница"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : null}

          </section>
        </TabsContent>

        <TabsContent value="attention" className="mt-0 space-y-4">
          {problemScans.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">
                Заблокированные сканы ({problemScans.length})
              </h2>
              <ReceivingScanEventsTable
                rows={problemScans}
                loading={loading}
                variant="compact"
                hideDeviceColumn
                hideEmissionColumn
                hideCodeColumn
                onDelete={(row) => void removeScan(row)}
                deletingId={deletingScanId}
              />
            </section>
          ) : (
            <p className="rounded-xl border border-border/60 bg-card px-4 py-6 text-sm text-muted-foreground">
              Нет заблокированных сканов
            </p>
          )}

          {missing.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">
                Нет номенклатуры ({missing.length})
              </h2>
              <p className="text-xs text-muted-foreground">
                Привязать GTIN к карточке, создать новую или отложить. ТСД пишет «нет в справочнике» —
                здесь этот хвост закрывается.
              </p>
              <div className="overflow-auto rounded-xl border border-border/60">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="bg-secondary/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2.5">Время</th>
                      <th className="px-3 py-2.5">Код</th>
                      <th className="px-3 py-2.5">Привязать к</th>
                      <th className="px-3 py-2.5">Комментарий</th>
                      <th className="w-[280px]" />
                    </tr>
                  </thead>
                  <tbody>
                    {missing.map((r) => (
                      <tr key={r.id} className="border-t border-border/60">
                        <td className="px-3 py-2.5 text-muted-foreground">{fmtReceivingTs(r.createdAt)}</td>
                        <td className="px-3 py-2.5">
                          <MarkingCodeHover code={r.code} />
                          {r.resolvedAction === "hold" ? (
                            <p className="mt-1 text-[11px] text-amber-800">отложено</p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5">
                          <Input
                            value={bindCodes[r.id] ?? ""}
                            placeholder="Код карточки"
                            onChange={(e) =>
                              setBindCodes((prev) => ({ ...prev, [r.id]: e.target.value }))
                            }
                            className="h-9 rounded-lg font-mono text-xs"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <Input
                            value={draftComments[r.id] ?? r.comment ?? ""}
                            placeholder="Комментарий"
                            onChange={(e) => {
                              const v = e.target.value
                              setDraftComments((prev) => ({ ...prev, [r.id]: v }))
                            }}
                            className="h-9 rounded-lg"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1.5">
                            <Button
                              size="sm"
                              className="rounded-lg"
                              disabled={missingActionId === `${r.id}:bind` || !(bindCodes[r.id] ?? "").trim()}
                              onClick={() => void applyMissingAction(r, "bind")}
                            >
                              {missingActionId === `${r.id}:bind` ? "…" : "Привязать"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-lg"
                              disabled={missingActionId === `${r.id}:create`}
                              onClick={() => void applyMissingAction(r, "create")}
                            >
                              {missingActionId === `${r.id}:create` ? "…" : "Создать"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="rounded-lg"
                              disabled={missingActionId === `${r.id}:hold`}
                              onClick={() => void applyMissingAction(r, "hold")}
                            >
                              Отложить
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="rounded-lg"
                              disabled={savingId === r.id}
                              onClick={() => void saveComment(r.id)}
                            >
                              {savingId === r.id ? "…" : "Коммент"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {problemScans.length === 0 && missing.length === 0 ? (
            <p className="rounded-xl border border-border/60 bg-card px-4 py-6 text-sm text-muted-foreground">
              Всё в порядке — нет проблемных сканов и отложенных кодов
            </p>
          ) : null}
        </TabsContent>
      </Tabs>
      ) : null}
    </div>
  )
}
