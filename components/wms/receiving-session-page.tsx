"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowLeft,
  Box,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileSpreadsheet,
  Hash,
  MapPin,
  MoreHorizontal,
  PackageCheck,
  RefreshCw,
  Search,
  Smartphone,
  Trash2,
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
import { ReceivingCreateOrderDialog } from "@/components/wms/receiving-create-order-dialog"
import {
  ReceivingScanEventsTable,
  type ReceivingScanEventRow,
} from "@/components/wms/receiving-scan-events-table"
import {
  isReceivingScanAllowed,
  isReceivingScanBlocked,
  setReceivingScanHintContext,
} from "@/components/wms/receiving-scan-hint"
import {
  fmtReceivingQty,
  fmtReceivingTs,
  normalizeReceivingDocId,
  stockPostedLabel,
  stockPostedTone,
  tsdSessionLabel,
  tsdSessionTone,
} from "@/components/wms/receiving-tsd-session"
import {
  deleteReceivingScanEvent,
  getSiteCode,
  postReceivingFinalize,
  saveReceivingInbound,
  updateReceivingScanEventQty,
  type ReceivingInboundOrderDto,
} from "@/lib/wms-api"
import {
  dismissEmptyReceivingSession,
  getWmsClientErrorDetails,
  getWmsClientErrorMeta,
} from "@/lib/receiving-client"
import { StorageRecommendationsPanel } from "@/components/wms/storage-recommendations-panel"
import { WmsStickyAlert } from "@/components/wms/wms-sticky-alert"
import { mapWmsError } from "@/lib/wms-error-messages"
import { ReceivingMissingCellOffer } from "@/components/wms/receiving-missing-cell-offer"
import {
  parseReceivingMissingCellDetails,
  type ReceivingMissingCellDetails,
} from "@/lib/receiving-missing-cell"
import {
  cacheReceivingSiteRules,
  getReceivingTargetLocationCode,
  setReceivingTargetLocationCode,
  siteAutoPostStock,
} from "@/lib/receiving-settings"
import type { ReceivingSiteRules } from "@/lib/receiving-scan-policy"
import { cn } from "@/lib/utils"

type ScanFilter = "all" | "ok" | "problems"

const SCAN_PAGE = 200
const POLL_MS = 6000

type SessionLine = {
  itemCode: string
  itemName: string | null
  qty: number
  scanCount: number
  okCount: number
  blockedCount: number
  expiredCount: number
  firstEmissionAtIso: string | null
  lastEmissionAtIso: string | null
  expectedQty?: number
  varianceQty?: number
  targetLocationCode?: string
  expectedLotCode?: string
  splits?: Array<{ locationCode: string; qty: number; lpnCode: string; lpnKind: "" | "pallet" | "box" }>
}

type LineDest = {
  id: string
  locationCode: string
  qty: string
  lpnCode: string
  lpnKind: "" | "pallet" | "box"
}

function newDest(partial?: Partial<LineDest>): LineDest {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    locationCode: "",
    qty: "",
    lpnCode: "",
    lpnKind: "",
    ...partial,
  }
}

/** Сводка сессии считается на сервере: карточка не зависит от того, сколько сканов подгружено в таблицу. */
type SessionSummary = {
  documentId: string
  status: string
  known: boolean
  deviceUid: string | null
  devices: string[]
  productGroup: string | null
  openedAtIso: string | null
  updatedAtIso: string | null
  scanCount: number
  scanTotal: number
  totalQty: number
  okCount: number
  blockedCount: number
  expiredCount: number
  lines: SessionLine[]
  postedLineCount: number
  pendingLineCount: number
  postedQty: number
  stockPosted: boolean
  stockPartiallyPosted: boolean
  stockPostedAtIso: string | null
  stockLocationCode: string | null
  stockDismissedEmpty: boolean
  inbound?: ReceivingInboundOrderDto | null
}

type OperatorFeed = {
  scanEvents: ReceivingScanEventRow[]
  scanEventsTotal?: number
  session?: SessionSummary | null
  receivingRules?: ReceivingSiteRules
  generatedAt: string
}

function fmtDevice(uid: string | null | undefined) {
  const v = uid?.trim()
  if (!v) return "—"
  return v.toLowerCase() === "web-operator" ? "Веб-оператор" : v
}

function fmtEmissionRange(from: string | null, to: string | null) {
  const fmt = (v: string | null) => {
    if (!v) return null
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return null
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" })
  }
  const a = fmt(from)
  const b = fmt(to)
  if (!a && !b) return "—"
  if (a && b && a !== b) return `${a} — ${b}`
  return a ?? b ?? "—"
}

function StatTile({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string
  value: string
  hint?: string | null
  icon?: ReactNode
  tone?: "default" | "ok" | "warn" | "danger" | "muted"
}) {
  const tones: Record<string, string> = {
    default: "border-border/60 bg-card",
    ok: "border-emerald-500/25 bg-emerald-500/5",
    warn: "border-amber-500/25 bg-amber-500/5",
    danger: "border-destructive/25 bg-destructive/5",
    muted: "border-border/50 bg-muted/40",
  }
  return (
    <div className={cn("rounded-xl border px-3 py-2.5", tones[tone])}>
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </p>
      <p
        className="mt-1 line-clamp-2 break-words text-base font-semibold leading-tight text-foreground sm:text-lg"
        title={value}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground" title={hint}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

function SessionLinesTable({
  lines,
  loading,
  lineDests,
  onLineDests,
  expectedByItem,
  onExpectedQty,
}: {
  lines: SessionLine[]
  loading: boolean
  lineDests: Record<string, LineDest[]>
  onLineDests: (itemCode: string, dests: LineDest[]) => void
  expectedByItem: Record<string, number>
  onExpectedQty: (itemCode: string, qty: number) => void
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded-lg bg-muted/60" />
        ))}
      </div>
    )
  }
  if (lines.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        Позиций пока нет — как только ТСД пришлёт первый скан, он появится здесь.
      </p>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="wms-ag-grid min-w-[720px]">
        <thead>
          <tr>
            <th>Номенклатура</th>
            <th className="w-[130px]">Код</th>
            <th className="w-[80px] text-right">Ждали</th>
            <th className="w-[80px] text-right">Пришло</th>
            <th className="w-[80px] text-right">Δ</th>
            <th className="w-[280px]">Куда (ячейка / палета / короб)</th>
            <th className="w-[120px]">Качество</th>
            <th className="w-[130px]">Дата эмиссии</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.itemCode}>
              <td className="max-w-[320px]">
                <span className="line-clamp-2 text-sm text-foreground">
                  {line.itemName || "Без наименования"}
                </span>
              </td>
              <td>
                {line.itemCode && line.itemCode !== "—" ? (
                  <Link
                    href={`/nomenclature/${encodeURIComponent(line.itemCode)}`}
                    prefetch={false}
                    className="font-mono text-xs text-primary hover:underline"
                  >
                    {line.itemCode}
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">не определён</span>
                )}
              </td>
              <td className="text-right">
                <Input
                  type="number"
                  min={0}
                  value={expectedByItem[line.itemCode] ?? line.expectedQty ?? ""}
                  onChange={(e) => onExpectedQty(line.itemCode, Number(e.target.value) || 0)}
                  className="h-8 w-[72px] rounded-md px-1.5 text-right text-xs"
                  aria-label={`Ожидали ${line.itemCode}`}
                />
              </td>
              <td className="text-right font-semibold">{fmtReceivingQty(line.qty)}</td>
              <td
                className={cn(
                  "text-right text-xs font-medium",
                  (expectedByItem[line.itemCode] ?? line.expectedQty ?? 0) > 0 &&
                    line.qty - (expectedByItem[line.itemCode] ?? line.expectedQty ?? 0) !== 0
                    ? "text-amber-800"
                    : "text-muted-foreground"
                )}
              >
                {(expectedByItem[line.itemCode] ?? line.expectedQty ?? 0) > 0
                  ? fmtReceivingQty(line.qty - (expectedByItem[line.itemCode] ?? line.expectedQty ?? 0))
                  : "—"}
              </td>
              <td>
                <div className="space-y-1.5">
                  {(lineDests[line.itemCode] ?? [newDest({ locationCode: line.targetLocationCode ?? "" })]).map(
                    (dest, idx, all) => (
                      <div key={dest.id} className="flex flex-wrap items-center gap-1">
                        <Input
                          type="number"
                          min={0}
                          value={dest.qty}
                          onChange={(e) =>
                            onLineDests(
                              line.itemCode,
                              all.map((d) => (d.id === dest.id ? { ...d, qty: e.target.value } : d))
                            )
                          }
                          placeholder={all.length > 1 ? "шт" : "все"}
                          className="h-7 w-14 rounded-md px-1 text-right text-[11px]"
                          aria-label={`Количество в точку ${idx + 1}`}
                        />
                        <Input
                          value={dest.locationCode}
                          onChange={(e) =>
                            onLineDests(
                              line.itemCode,
                              all.map((d) =>
                                d.id === dest.id ? { ...d, locationCode: e.target.value } : d
                              )
                            )
                          }
                          placeholder="ячейка"
                          className="h-7 w-[88px] rounded-md font-mono text-[11px]"
                        />
                        <Input
                          value={dest.lpnCode}
                          onChange={(e) =>
                            onLineDests(
                              line.itemCode,
                              all.map((d) => (d.id === dest.id ? { ...d, lpnCode: e.target.value } : d))
                            )
                          }
                          placeholder="палета/короб"
                          className="h-7 w-[92px] rounded-md font-mono text-[11px]"
                        />
                        <select
                          value={dest.lpnKind}
                          onChange={(e) =>
                            onLineDests(
                              line.itemCode,
                              all.map((d) =>
                                d.id === dest.id
                                  ? { ...d, lpnKind: e.target.value as LineDest["lpnKind"] }
                                  : d
                              )
                            )
                          }
                          className="h-7 rounded-md border border-input bg-background px-1 text-[11px]"
                        >
                          <option value="">тип</option>
                          <option value="pallet">палета</option>
                          <option value="box">короб</option>
                        </select>
                        {all.length > 1 ? (
                          <button
                            type="button"
                            className="text-[11px] text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              onLineDests(
                                line.itemCode,
                                all.filter((d) => d.id !== dest.id)
                              )
                            }
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                    )
                  )}
                  <button
                    type="button"
                    className="text-[11px] text-primary hover:underline"
                    onClick={() =>
                      onLineDests(line.itemCode, [
                        ...(lineDests[line.itemCode] ?? [
                          newDest({ locationCode: line.targetLocationCode ?? "" }),
                        ]),
                        newDest(),
                      ])
                    }
                  >
                    + часть в другую ячейку
                  </button>
                </div>
              </td>
              <td>
                <div className="flex flex-wrap gap-1">
                  {line.okCount > 0 ? (
                    <Badge className="rounded-md bg-emerald-500/15 px-1.5 py-0 text-[11px] text-emerald-800">
                      ок {line.okCount}
                    </Badge>
                  ) : null}
                  {line.blockedCount > 0 ? (
                    <Badge className="rounded-md bg-orange-500/15 px-1.5 py-0 text-[11px] text-orange-800">
                      проблем {line.blockedCount}
                    </Badge>
                  ) : null}
                  {line.expiredCount > 0 ? (
                    <Badge className="rounded-md bg-destructive/15 px-1.5 py-0 text-[11px] text-destructive">
                      просроч. {line.expiredCount}
                    </Badge>
                  ) : null}
                </div>
              </td>
              <td className="text-xs text-muted-foreground">
                {fmtEmissionRange(line.firstEmissionAtIso, line.lastEmissionAtIso)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ReceivingSessionPage({ docId }: { docId: string }) {
  const [data, setData] = useState<OperatorFeed | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [deletingScanId, setDeletingScanId] = useState<string | null>(null)
  const [savingQtyId, setSavingQtyId] = useState<string | null>(null)
  const [createOrderOpen, setCreateOrderOpen] = useState(false)
  const [orderScanRows, setOrderScanRows] = useState<ReceivingScanEventRow[]>([])
  const [scanFilter, setScanFilter] = useState<ScanFilter>("all")
  const [scanQuery, setScanQuery] = useState("")
  const [scanLimit, setScanLimit] = useState(SCAN_PAGE)
  const [closing, setClosing] = useState(false)
  const [targetLocationCode, setTargetLocationCode] = useState("")
  const [cellPickerOpen, setCellPickerOpen] = useState(false)
  const [missingCell, setMissingCell] = useState<ReceivingMissingCellDetails | null>(null)
  const [supplier, setSupplier] = useState("")
  const [expectedBatch, setExpectedBatch] = useState("")
  const [inboundComment, setInboundComment] = useState("")
  const [lineDests, setLineDests] = useState<Record<string, LineDest[]>>({})
  const [expectedByItem, setExpectedByItem] = useState<Record<string, number>>({})
  const [confirmExpired, setConfirmExpired] = useState(false)
  const [savingInbound, setSavingInbound] = useState(false)
  const inboundSeeded = useRef(false)

  const normDocId = normalizeReceivingDocId(docId)
  const inFlight = useRef(false)
  const emissionsAsked = useRef(false)

  useEffect(() => {
    inboundSeeded.current = false
    setSupplier("")
    setExpectedBatch("")
    setInboundComment("")
    setLineDests({})
    setExpectedByItem({})
    setConfirmExpired(false)
  }, [normDocId])

  useEffect(() => {
    setTargetLocationCode(getReceivingTargetLocationCode())
  }, [])

  const loadFeed = useCallback(
    async (silent = false) => {
      if (inFlight.current) return
      inFlight.current = true
      if (!silent) {
        setRefreshing(true)
        setError(null)
      }
      try {
        const qp = new URLSearchParams()
        qp.set("siteCode", getSiteCode())
        qp.set("limit", "50")
        qp.set("documentId", normDocId)
        qp.set("scanLimit", String(scanLimit))
        const r = await fetch(`/api/wms/receiving/operator-feed?${qp.toString()}`, {
          cache: "no-store",
        })
        const json = await r.json()
        if (!r.ok) throw new Error(json?.error || "Не удалось загрузить сессию")
        setData(json)
        if (json.receivingRules) {
          cacheReceivingSiteRules(json.receivingRules)
          setReceivingScanHintContext(json.receivingRules, json.session?.productGroup ?? null)
        }
        if (json.session?.inbound && !inboundSeeded.current) {
          inboundSeeded.current = true
          setSupplier(json.session.inbound.supplier ?? "")
          setExpectedBatch(json.session.inbound.expectedBatch ?? "")
          setInboundComment(json.session.inbound.comment ?? "")
          const dests: Record<string, LineDest[]> = {}
          const expected: Record<string, number> = {}
          for (const line of json.session.inbound.lines ?? []) {
            if (line.expectedQty) expected[line.itemCode] = line.expectedQty
            if ((line.splits ?? []).length > 0) {
              dests[line.itemCode] = line.splits!.map((s) =>
                newDest({
                  locationCode: s.locationCode,
                  qty: s.qty ? String(s.qty) : "",
                  lpnCode: s.lpnCode,
                  lpnKind: s.lpnKind,
                })
              )
            } else if (line.targetLocationCode) {
              dests[line.itemCode] = [newDest({ locationCode: line.targetLocationCode })]
            }
          }
          setLineDests((prev) => ({ ...dests, ...prev }))
          setExpectedByItem((prev) => ({ ...expected, ...prev }))
        }
        if (!silent) setError(null)
      } catch (e) {
        const msg = mapWmsError(e)
        if (silent) setError((prev) => prev ?? msg)
        else setError(msg)
      } finally {
        inFlight.current = false
        setLoading(false)
        if (!silent) setRefreshing(false)
      }
    },
    [normDocId, scanLimit]
  )

  useEffect(() => {
    void loadFeed()
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void loadFeed(true)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [loadFeed])

  const session = data?.session ?? null
  const rows = useMemo(() => data?.scanEvents ?? [], [data])
  const scanTotal = data?.scanEventsTotal ?? rows.length

  /** Даты эмиссии дозаполняем один раз на открытие карточки, а не на каждом опросе. */
  useEffect(() => {
    if (emissionsAsked.current || rows.length === 0) return
    if (!rows.some((r) => !r.emissionAtIso)) return
    emissionsAsked.current = true
    void fetch("/api/wms/receiving/resolve-emissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteCode: getSiteCode(), documentId: normDocId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.resolved > 0) void loadFeed(true)
      })
      .catch(() => undefined)
  }, [rows, normDocId, loadFeed])

  const filteredRows = useMemo(() => {
    const q = scanQuery.trim().toLowerCase()
    let list = rows
    if (scanFilter === "ok") list = list.filter((r) => isReceivingScanAllowed(r))
    if (scanFilter === "problems") list = list.filter((r) => isReceivingScanBlocked(r))
    if (q) {
      list = list.filter(
        (r) =>
          r.code.toLowerCase().includes(q) ||
          (r.itemCode ?? "").toLowerCase().includes(q) ||
          (r.itemName ?? "").toLowerCase().includes(q)
      )
    }
    return list
  }, [rows, scanFilter, scanQuery])

  const totals = useMemo(
    () => ({
      lines: session?.lines.length ?? 0,
      scans: session?.scanCount ?? rows.length,
      qty: session?.totalQty ?? 0,
      ok: session?.okCount ?? 0,
      blocked: session?.blockedCount ?? 0,
      expired: session?.expiredCount ?? 0,
    }),
    [session, rows.length]
  )

  const status = session?.status ?? "unknown"
  const isClosed = status.trim().toLowerCase() === "closed"
  const isReadOnly = isClosed
  const stockFullyPosted = Boolean(session?.stockPosted)
  const stockPartiallyPosted = Boolean(session?.stockPartiallyPosted)
  const stockDismissedEmpty = Boolean(session?.stockDismissedEmpty)
  const isEmptySession = !loading && data !== null && totals.scans === 0
  const canDismissEmpty = isClosed && !stockFullyPosted && !stockPartiallyPosted && isEmptySession
  const canPostStock = totals.ok > 0 && !stockDismissedEmpty && !stockFullyPosted
  const deviceUid = session?.deviceUid ?? rows.find((r) => r.deviceUid)?.deviceUid ?? "web-operator"

  const dominantLine = session?.lines.find((l) => l.okCount > 0 && l.itemCode !== "—") ?? null

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

  async function dismissEmptyOnServer() {
    try {
      setClosing(true)
      setError(null)
      await dismissEmptyReceivingSession({ documentId: normDocId, deviceUid })
      setSuccess("Пустая сессия снята с учёта.")
      await loadFeed(true)
    } catch (e) {
      setError(mapWmsError(e))
    } finally {
      setClosing(false)
    }
  }

  function finalizeExtras() {
    const loc = targetLocationCode.trim() || getReceivingTargetLocationCode().trim()
    return {
      ...(loc ? { targetLocationCode: loc } : {}),
      confirmExpired,
      lineTargets: Object.entries(lineDests).flatMap(([itemCode, dests]) =>
        dests
          .map((dest) => ({
            itemCode,
            locationCode: dest.locationCode.trim(),
            qty: Number(dest.qty) || undefined,
            lpnCode: dest.lpnCode.trim() || undefined,
            lpnKind: dest.lpnKind || undefined,
          }))
          .filter((row) => row.itemCode && row.locationCode)
      ),
    }
  }

  async function persistInbound() {
    setSavingInbound(true)
    try {
      await saveReceivingInbound({
        documentId: normDocId,
        supplier,
        expectedBatch,
        comment: inboundComment,
        lines: (session?.lines ?? []).map((line) => ({
          itemCode: line.itemCode,
          itemName: line.itemName ?? "",
          expectedQty: expectedByItem[line.itemCode] ?? line.expectedQty ?? 0,
          lotCode: expectedBatch || line.expectedLotCode || "",
          targetLocationCode: (lineDests[line.itemCode] ?? [])[0]?.locationCode ?? line.targetLocationCode ?? "",
          splits: (lineDests[line.itemCode] ?? [])
            .filter((d) => d.locationCode.trim())
            .map((d) => ({
              locationCode: d.locationCode.trim(),
              qty: Number(d.qty) || 0,
              lpnCode: d.lpnCode.trim(),
              lpnKind: d.lpnKind,
            })),
        })),
      })
    } finally {
      setSavingInbound(false)
    }
  }

  async function postStockOnly() {
    try {
      setClosing(true)
      setError(null)
      await persistInbound().catch(() => undefined)
      const body = await postReceivingFinalize({
        documentId: normDocId,
        deviceUid,
        ...finalizeExtras(),
      })
      setSuccess(
        [`Проведено в ячейку ${body.locationCode ?? "—"}`, body.postingNote]
          .filter(Boolean)
          .join(" · ")
      )
      setMissingCell(null)
      await loadFeed(true)
    } catch (e) {
      setError(mapWmsError(e))
      const { code } = getWmsClientErrorMeta(e)
      const cell = parseReceivingMissingCellDetails(getWmsClientErrorDetails(e))
      if (code === "receiving_storage_cell_missing" && cell) setMissingCell(cell)
    } finally {
      setClosing(false)
    }
  }

  async function markSessionClosed() {
    const statusRes = await fetch("/api/wms/receiving/session-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteCode: getSiteCode(),
        documentId: normDocId,
        status: "closed",
        lineCount: totals.lines,
        deviceUid,
      }),
    })
    const statusJson = await statusRes.json()
    if (!statusRes.ok) throw new Error(statusJson?.error || "Не удалось закрыть сессию")
  }

  async function closeSessionOnServer() {
    if (isClosed) return
    try {
      setClosing(true)
      setError(null)
      await markSessionClosed()
      setSuccess(
        totals.ok > 0
          ? "Сессия закрыта. Остаток на складе появится только после «Провести на остаток»."
          : "Сессия закрыта."
      )
      await loadFeed(true)
    } catch (e) {
      setError(mapWmsError(e))
    } finally {
      setClosing(false)
    }
  }

  async function closeAndPostStock() {
    if (!isClosed) {
      try {
        setClosing(true)
        setError(null)
        await markSessionClosed()
      } catch (e) {
        setError(mapWmsError(e))
        setClosing(false)
        return
      }
    }
    await postStockOnly()
  }

  async function saveScanQty(row: ReceivingScanEventRow, qty: number) {
    try {
      setSavingQtyId(row.id)
      setError(null)
      await updateReceivingScanEventQty(row.id, qty)
      await loadFeed()
    } catch (e) {
      setError(mapWmsError(e))
    } finally {
      setSavingQtyId(null)
    }
  }

  /** Ордер строится по всем сканам документа, а в таблице их может быть подгружена только часть. */
  async function openOrderDialog() {
    setOrderScanRows(rows)
    setCreateOrderOpen(true)
    if (scanTotal <= rows.length) return
    const all: ReceivingScanEventRow[] = []
    for (let offset = 0; offset < scanTotal && offset < 10000; offset += 1000) {
      const qp = new URLSearchParams({
        siteCode: getSiteCode(),
        limit: "1",
        documentId: normDocId,
        scanLimit: "1000",
        scanOffset: String(offset),
      })
      const r = await fetch(`/api/wms/receiving/operator-feed?${qp.toString()}`, { cache: "no-store" })
      if (!r.ok) break
      const json = (await r.json()) as OperatorFeed
      all.push(...(json.scanEvents ?? []))
      if ((json.scanEvents ?? []).length < 1000) break
    }
    if (all.length > 0) setOrderScanRows(all)
  }

  const postedSummary = session
    ? session.stockDismissedEmpty
      ? "снято с учёта"
      : session.stockPosted
        ? `${fmtReceivingQty(session.postedQty)} шт.`
        : session.stockPartiallyPosted
          ? `${fmtReceivingQty(session.postedQty)} из ${fmtReceivingQty(session.totalQty)} шт.`
          : "нет"
    : "—"

  return (
    <div className="space-y-3">
      <div className="wms-panel sticky top-0 z-20 rounded-2xl px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <Button asChild variant="ghost" size="sm" className="-ml-1 h-8 shrink-0 rounded-lg px-2">
            <Link href="/receiving" prefetch={false} title="К списку приёмки">
              <ArrowLeft className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">К приёмке</span>
            </Link>
          </Button>
          <h1
            className="min-w-0 shrink truncate font-mono text-base font-bold text-foreground sm:text-lg"
            title={normDocId}
          >
            {normDocId}
          </h1>
          <div className="flex flex-wrap items-center gap-1.5">
            {loading && !data ? (
              <Badge className="rounded-lg bg-muted text-muted-foreground">Загружаем…</Badge>
            ) : (
              <>
                <Badge className={cn("whitespace-nowrap rounded-lg", tsdSessionTone(status, totals.scans))}>
                  {tsdSessionLabel(status, totals.scans, totals.scans)}
                </Badge>
                <Badge
                  className={cn(
                    "whitespace-nowrap rounded-lg",
                    stockPostedTone(stockFullyPosted, stockDismissedEmpty, stockPartiallyPosted)
                  )}
                >
                  {stockPostedLabel(stockFullyPosted, stockDismissedEmpty, stockPartiallyPosted)}
                </Badge>
              </>
            )}
          </div>
          <div className="order-last flex w-full flex-wrap items-center gap-1.5 sm:order-none sm:ml-auto sm:w-auto sm:flex-nowrap sm:justify-end">
            {siteAutoPostStock() ? (
              <Badge className="rounded-lg bg-emerald-500/15 text-emerald-800">
                автопроводка площадки
              </Badge>
            ) : (
              <Badge className="rounded-lg bg-muted text-muted-foreground">без автопроводки</Badge>
            )}
            {!isClosed ? (
              <Button
                size="sm"
                variant="outline"
                className="h-8 rounded-lg"
                disabled={closing}
                onClick={() => void closeSessionOnServer()}
              >
                <XCircle className="mr-1.5 h-4 w-4" />
                {closing ? "Закрываем…" : "Закрыть сессию"}
              </Button>
            ) : null}
            {canPostStock ? (
              <Button
                size="sm"
                className="h-8 rounded-lg"
                disabled={closing}
                onClick={() => void postStockOnly()}
              >
                <PackageCheck className="mr-1.5 h-4 w-4" />
                {closing
                  ? "Проводим…"
                  : stockPartiallyPosted
                    ? "Допровести на остаток"
                    : "Провести на остаток"}
              </Button>
            ) : null}
            {canDismissEmpty ? (
              <Button
                size="sm"
                variant="outline"
                className="h-8 rounded-lg"
                disabled={closing}
                onClick={() => void dismissEmptyOnServer()}
              >
                {closing ? "Убираем…" : "Убрать из списка"}
              </Button>
            ) : null}
            {!isClosed && isEmptySession ? (
              <Button
                size="sm"
                variant="outline"
                className="h-8 rounded-lg"
                disabled={closing}
                onClick={() => void closeSessionOnServer()}
              >
                {closing ? "Закрываем…" : "Закрыть пустую сессию"}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={() => void loadFeed()}
              disabled={refreshing}
              aria-label="Обновить"
              title="Обновить"
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-lg"
                  aria-label="Дополнительные действия"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem
                  disabled={isClosed || closing}
                  onSelect={() => void closeSessionOnServer()}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  {isEmptySession ? "Закрыть пустую сессию" : "Закрыть сессию"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canPostStock || closing || isClosed}
                  onSelect={() => void closeAndPostStock()}
                >
                  <PackageCheck className="mr-2 h-4 w-4" />
                  Закрыть и сразу провести
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canPostStock || closing}
                  onSelect={() => void postStockOnly()}
                >
                  <PackageCheck className="mr-2 h-4 w-4" />
                  {stockPartiallyPosted ? "Допровести на остаток" : "Провести на остаток"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canDismissEmpty || closing}
                  onSelect={() => void dismissEmptyOnServer()}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Убрать из списка
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={totals.scans === 0} onSelect={() => void openOrderDialog()}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Приходный ордер (Excel)…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Smartphone className="h-3.5 w-3.5" />
            {fmtDevice(deviceUid)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            открыта {fmtReceivingTs(session?.openedAtIso)}
          </span>
          {session?.updatedAtIso ? <span>обновлена {fmtReceivingTs(session.updatedAtIso)}</span> : null}
          {session?.stockLocationCode ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              ячейка <span className="font-mono text-foreground">{session.stockLocationCode}</span>
            </span>
          ) : null}
          {session?.stockPostedAtIso ? (
            <span>проведено {fmtReceivingTs(session.stockPostedAtIso)}</span>
          ) : null}
        </p>
      </div>

      {error ? (
        <WmsStickyAlert
          message={error}
          onDismiss={() => {
            setError(null)
            setMissingCell(null)
          }}
        />
      ) : null}
      {missingCell ? (
        <ReceivingMissingCellOffer
          documentId={normDocId}
          details={missingCell}
          onCreated={() => void postStockOnly()}
        />
      ) : null}
      {success ? (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{success}</span>
          <button
            type="button"
            className="text-emerald-900/60 hover:text-emerald-900"
            onClick={() => setSuccess(null)}
            aria-label="Скрыть"
          >
            <XCircle className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Позиции"
          value={loading && !data ? "…" : String(totals.lines)}
          hint={`${totals.scans} ${totals.scans === 1 ? "скан" : "сканов"}`}
          icon={<Box className="h-3.5 w-3.5" />}
        />
        <StatTile
          label="Количество"
          value={loading && !data ? "…" : `${fmtReceivingQty(totals.qty)} шт.`}
          hint={
            session && session.pendingLineCount > 0
              ? `без остатка: ${session.pendingLineCount} поз.`
              : null
          }
          icon={<Hash className="h-3.5 w-3.5" />}
        />
        <StatTile
          label="Принято"
          value={loading && !data ? "…" : String(totals.ok)}
          hint="коды приняты ЧЗ"
          tone={totals.ok > 0 ? "ok" : "muted"}
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
        />
        <StatTile
          label="С проблемами"
          value={loading && !data ? "…" : String(totals.blocked)}
          hint={totals.blocked > 0 ? "не пойдут на остаток" : "все коды в порядке"}
          tone={totals.blocked > 0 ? "warn" : "muted"}
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
        />
        <StatTile
          label="Просрочено"
          value={loading && !data ? "…" : String(totals.expired)}
          hint={totals.expired > 0 ? "срок годности вышел" : "просроченных нет"}
          tone={totals.expired > 0 ? "danger" : "muted"}
          icon={<CalendarClock className="h-3.5 w-3.5" />}
        />
        <StatTile
          label="На остатке"
          value={loading && !data ? "…" : postedSummary}
          hint={session?.stockLocationCode ? `ячейка ${session.stockLocationCode}` : null}
          tone={stockFullyPosted ? "ok" : stockPartiallyPosted ? "warn" : "muted"}
          icon={<PackageCheck className="h-3.5 w-3.5" />}
        />
      </div>

      {!loading && data !== null && session && !session.known ? (
        <div className="rounded-xl border border-border/60 bg-muted/40 p-4 text-sm text-muted-foreground">
          Документ <span className="font-mono text-foreground">{normDocId}</span> не найден в приёмке: сканов
          и статусов ТСД по нему нет. Проверьте номер документа или вернитесь{" "}
          <Link href="/receiving" prefetch={false} className="text-primary hover:underline">
            к списку приёмки
          </Link>
          .
        </div>
      ) : null}

      {!isClosed && isEmptySession && session?.known ? (
        <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 text-sm text-orange-900">
          Сессия открыта, но сканов ещё нет. Если ТСД её больше не использует — закройте сессию, чтобы она
          не висела в списке «В работе».
        </div>
      ) : null}

      {isClosed && !stockFullyPosted && !stockDismissedEmpty && totals.ok > 0 ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-900">
          <strong>Сессия закрыта, но товара на складе ещё нет.</strong> «Закрыть» только заканчивает работу
          ТСД. Чтобы количество попало в ячейку, нажмите
          «{stockPartiallyPosted ? "Допровести" : "Провести на остаток"}».
        </div>
      ) : null}

      {totals.expired > 0 ? (
        <label className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-950">
          <input
            type="checkbox"
            className="mt-1"
            checked={confirmExpired}
            onChange={(e) => setConfirmExpired(e.target.checked)}
          />
          <span>
            Принять просроченные коды при проводке (если правило площадки — «с подтверждением»). Сейчас
            просрочено: {totals.expired}.
          </span>
        </label>
      ) : null}

      <div className="wms-panel space-y-3 rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Заказ на приход</h2>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg"
            disabled={savingInbound}
            onClick={() => void persistInbound().then(() => setSuccess("Заказ на приход сохранён"))}
          >
            {savingInbound ? "Сохраняем…" : "Сохранить заказ"}
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Поставщик</label>
            <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} className="h-9 rounded-lg" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Ожидаемая партия</label>
            <Input
              value={expectedBatch}
              onChange={(e) => setExpectedBatch(e.target.value)}
              className="h-9 rounded-lg"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Комментарий</label>
            <Input
              value={inboundComment}
              onChange={(e) => setInboundComment(e.target.value)}
              className="h-9 rounded-lg"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          ТОРГ-1 — печать. Здесь план: ждали / пришло / расхождение. На строке можно разбить
          приход: часть в одну ячейку, часть в другую, с палетой или коробом.
        </p>
      </div>

      {canPostStock && dominantLine ? (
        <div className="wms-panel rounded-2xl p-3">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            onClick={() => setCellPickerOpen((v) => !v)}
          >
            <span className="text-sm text-foreground">
              Ячейка проведения:{" "}
              <span className="font-mono">{targetLocationCode.trim() || "не выбрана"}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {dominantLine.itemCode} · {fmtReceivingQty(dominantLine.qty)} шт.
              </span>
            </span>
            <ChevronDown
              className={cn("h-4 w-4 shrink-0 transition-transform", cellPickerOpen && "rotate-180")}
            />
          </button>
          {cellPickerOpen ? (
            <div className="mt-3">
              <StorageRecommendationsPanel
                itemCode={dominantLine.itemCode}
                qty={dominantLine.qty}
                preferReceiving={false}
                selectedLocationCode={targetLocationCode.trim() || undefined}
                onPickLocation={(code) => {
                  setTargetLocationCode(code)
                  setReceivingTargetLocationCode(code)
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="wms-panel overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-foreground">Что в сессии</h2>
          <span className="text-xs text-muted-foreground">
            {totals.lines} поз. · {fmtReceivingQty(totals.qty)} шт.
          </span>
        </div>
        <SessionLinesTable
          lines={session?.lines ?? []}
          loading={loading && !data}
          lineDests={lineDests}
          onLineDests={(itemCode, dests) =>
            setLineDests((prev) => ({ ...prev, [itemCode]: dests }))
          }
          expectedByItem={expectedByItem}
          onExpectedQty={(itemCode, qty) =>
            setExpectedByItem((prev) => ({ ...prev, [itemCode]: qty }))
          }
        />
      </div>

      <div className="wms-panel overflow-hidden rounded-2xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-3 py-2.5">
          <h2 className="mr-1 text-sm font-semibold text-foreground">Сканы</h2>
          <div className="flex rounded-lg border border-border/60 bg-muted/40 p-0.5">
            {(
              [
                ["all", "Все", totals.scans],
                ["ok", "Успешные", totals.ok],
                ["problems", "Проблемные", totals.blocked],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                onClick={() => setScanFilter(key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  scanFilter === key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
                {count > 0 ? ` ${count}` : ""}
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={scanQuery}
              onChange={(e) => setScanQuery(e.target.value)}
              placeholder="Код, GTIN или номенклатура"
              className="h-8 rounded-lg pl-8 text-xs"
            />
          </div>
        </div>

        <ReceivingScanEventsTable
          bare
          rows={filteredRows}
          loading={loading && !data}
          emptyText={
            totals.scans === 0
              ? "В этой сессии пока нет сканов"
              : scanQuery.trim()
                ? "По запросу ничего не нашлось"
                : "Нет сканов по выбранному фильтру"
          }
          hideDocumentColumn
          editableQty={!isReadOnly}
          onQtySave={!isReadOnly ? (row, qty) => saveScanQty(row, qty) : undefined}
          savingQtyId={savingQtyId}
          onDelete={!isReadOnly ? (row) => void removeScan(row) : undefined}
          deletingId={deletingScanId}
        />

        {rows.length < scanTotal ? (
          <div className="flex items-center justify-between gap-2 border-t border-border/50 px-4 py-2.5">
            <span className="text-xs text-muted-foreground">
              Показано {rows.length} из {scanTotal}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              disabled={refreshing || scanLimit >= 1000}
              onClick={() => setScanLimit((v) => Math.min(v + SCAN_PAGE, 1000))}
            >
              {scanLimit >= 1000 ? "Полный список — в приходном ордере" : "Показать ещё"}
            </Button>
          </div>
        ) : null}
      </div>

      <ReceivingCreateOrderDialog
        open={createOrderOpen}
        onOpenChange={setCreateOrderOpen}
        sessionDocId={docId}
        scanRows={orderScanRows}
        onCreated={() => void loadFeed()}
      />
    </div>
  )
}
