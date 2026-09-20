"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  PackagePlus,
  RefreshCcw,
  RefreshCw,
  Search,
  ShieldAlert,
  Tags,
  Truck,
  XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import {
  fetchFgPlanInventory,
  getFgWarehouseMarkingCodeChildren,
  getFgWarehouseNomenclatureTree,
  getFgWarehouseSummary,
  listFgVekasLots,
  listFgWarehouseExpiry,
  listFgWarehouseNomenclature,
  listFgWarehousePallets,
  lookupFgPlanPalletInCz,
  postFgPlanInventoryToWarehouse,
  type FgPlanInventorySlot,
  type FgPlanStockPreview,
  type FgVekasLotDetail,
} from "@/lib/wms-api"
import type { FgPlanPalletCzSummary } from "@/lib/wms/fg-plan-pallet-cz"
import {
  fgKindLabel,
  fmtFgDate,
  fmtFgPlaced,
  formatFgPlanRows,
  fmtFgQty,
  type FgExpiryBucket,
  type FgMarkingNode,
  type FgNomenclatureRow,
  type FgPalletRow,
  type FgSummaryStats,
} from "@/lib/wms/finished-goods-types"
import { canonicalPlanRowId, planRowZone } from "@/lib/wms/fg-plan-location-codes"
import { blocksFromBottles, ruBlocksWord } from "@/lib/wms/fg-plan-pack"
import { FinishedGoodsRowsPanel } from "@/components/wms/finished-goods-rows-panel"
import { FgResortPanel } from "@/components/wms/fg-resort-panel"
import { FgShipRulesPanel } from "@/components/wms/fg-ship-rules-panel"
import { FgSendToResortDialog, type FgResortTarget } from "@/components/wms/fg-send-to-resort-dialog"
import { FgSkuProfileBadge, FgStatusBadges } from "@/components/wms/fg-status-badges"
import { DEFAULT_FSN_DAYS, FSN_PERIODS, type FsnClass, type FsnPeriodDays } from "@/lib/wms/fsn"
import { ABC_CLASSES, XYZ_CLASSES, type AbcClass, type XyzClass } from "@/lib/wms/sku-demand"
import { WmsEmptyState, WmsErrorState, WmsTableSkeleton } from "@/components/wms/wms-shared"
import {
  DraggableColumnHead,
  TableColumnsButton,
  useTableColumnLayout,
} from "@/components/wms/table-columns"
import { useToast } from "@/hooks/use-toast"
import { formatPlantBatch, plantLinesFromBatches } from "@/lib/wms/fg-plan-stock-helpers"

type PalletBulkOp = "quarantine" | "remove-from-row" | "move-row" | "relabel"

const PALLET_BULK_OP_LABELS: Record<PalletBulkOp, string> = {
  quarantine: "Поставить в карантин",
  "remove-from-row": "Изъять из ряда",
  "move-row": "Переместить в другой ряд",
  relabel: "Перемаркировка",
}

function palletMatchesQuery(node: FgMarkingNode, queryNorm: string): boolean {
  if (!queryNorm) return true
  const hay = [
    node.code,
    node.serialNumber,
    node.rowLabel ?? "",
    node.locationCode ?? "",
    fgKindLabel(node.kind),
  ]
    .join(" ")
    .toLowerCase()
  return hay.includes(queryNorm)
}

function filterPalletTree(tree: FgMarkingNode[], query: string): FgMarkingNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return tree
  return tree.filter((node) => node.kind === "pallet" && palletMatchesQuery(node, q))
}

function ruDaysWord(n: number) {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return "дней"
  if (b === 1) return "день"
  if (b >= 2 && b <= 4) return "дня"
  return "дней"
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const end = new Date(iso)
  end.setHours(0, 0, 0, 0)
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return Math.round((end.getTime() - start.getTime()) / 86400000)
}

function ExpiryBadge({ iso }: { iso: string | null }) {
  const d = iso ? daysUntil(iso) : null
  if (d == null) return <span className="text-muted-foreground">—</span>
  if (d < 0) {
    return <span className="font-medium text-destructive">просрочено · {fmtFgDate(iso!)}</span>
  }
  if (d <= 7) {
    return (
      <span className="font-medium text-destructive">
        {d} {ruDaysWord(d)} · {fmtFgDate(iso!)}
      </span>
    )
  }
  if (d <= 30) {
    return (
      <span className="font-medium text-sky-700 dark:text-sky-300">
        {d} {ruDaysWord(d)} · {fmtFgDate(iso!)}
      </span>
    )
  }
  return (
    <span>
      {d} {ruDaysWord(d)} · {fmtFgDate(iso!)}
    </span>
  )
}

function MarkingHierarchyRow({
  itemCode,
  node,
  depth = 0,
  selectable = false,
  selected = false,
  onSelectedChange,
}: {
  itemCode: string
  node: FgMarkingNode
  depth?: number
  selectable?: boolean
  selected?: boolean
  onSelectedChange?: (id: string, checked: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [children, setChildren] = useState<FgMarkingNode[]>(node.children ?? [])
  const [loaded, setLoaded] = useState((node.children?.length ?? 0) > 0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const canExpand = (node.childCount ?? 0) > 0 || (node.children?.length ?? 0) > 0

  async function toggle() {
    if (!canExpand) return
    if (!open && !loaded) {
      setLoading(true)
      setLoadError(null)
      try {
        const data = await getFgWarehouseMarkingCodeChildren(itemCode, node.id)
        setChildren(data.children)
        setLoaded(true)
        if ((data.children?.length ?? 0) === 0) {
          setLoadError("Вложения не найдены")
        }
      } catch (e) {
        setChildren([])
        setLoadError(e instanceof Error ? e.message : "Ошибка загрузки вложений")
      } finally {
        setLoading(false)
      }
    }
    setOpen((v) => !v)
  }

  return (
    <>
      <tr
        className={cn(
          "wms-ag-row border-b border-border/70",
          canExpand && "cursor-pointer hover:bg-muted/40",
          selected && "bg-primary/5"
        )}
        onClick={() => void toggle()}
      >
        <td
          className="wms-ag-cell w-10 text-center"
          onClick={(e) => e.stopPropagation()}
        >
          {selectable && depth === 0 && node.kind === "pallet" ? (
            <Checkbox
              checked={selected}
              onCheckedChange={(v) => onSelectedChange?.(node.id, v === true)}
              aria-label={`Выбрать палету ${node.serialNumber}`}
            />
          ) : null}
        </td>
        <td className="wms-ag-cell w-[110px] whitespace-nowrap">
          <span className="inline-flex items-center gap-1.5" style={{ paddingLeft: depth * 18 }}>
            <span className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground">
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : canExpand ? (
                open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <span className="inline-block h-1 w-1 rounded-full bg-border" />
              )}
            </span>
            <span className="text-xs font-medium">{fgKindLabel(node.kind)}</span>
            {node.tags.includes("resort") ? (
              <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800 dark:text-violet-200">
                на переборе
              </span>
            ) : null}
          </span>
        </td>
        <td className="wms-ag-cell font-mono text-[11px]">
          <span className="break-all">{node.code}</span>
        </td>
        <td className="wms-ag-cell font-mono text-xs tabular-nums">{node.serialNumber}</td>
        <td className="wms-ag-cell text-xs text-muted-foreground">
          {node.rowLabel || node.locationCode || "—"}
        </td>
        <td className="wms-ag-cell text-right tabular-nums text-xs">
          {node.kind === "pallet"
            ? `${fmtFgQty(node.blocksCount ?? node.childCount ?? 0)} бл. · ${fmtFgQty(node.bottlesCount ?? 0)} бут.`
            : node.kind === "block"
              ? fmtFgQty(node.childCount ?? 0)
              : "—"}
        </td>
      </tr>
      {open
        ? children.map((child) => (
            <MarkingHierarchyRow key={child.id} itemCode={itemCode} node={child} depth={depth + 1} />
          ))
        : null}
      {open && loadError && children.length === 0 ? (
        <tr className="wms-ag-row border-b border-border/70">
          <td colSpan={6} className="wms-ag-cell text-xs text-destructive" style={{ paddingLeft: (depth + 1) * 18 + 24 }}>
            {loadError}
          </td>
        </tr>
      ) : null}
    </>
  )
}

function gtinKey(raw: string | null | undefined): string {
  return String(raw || "").replace(/\D/g, "").replace(/^0+/, "")
}

function hasPlaced(row: Pick<FgNomenclatureRow, "placedPallets" | "placedBlocks" | "placedBottles">): boolean {
  return (row.placedPallets ?? 0) > 0 || (row.placedBlocks ?? 0) > 0 || (row.placedBottles ?? 0) > 0
}

function placementLabel(row: FgNomenclatureRow): string | null {
  if (row.placement === "unplaced") return "не размещена"
  if (row.placement === "partial") return "размещена частично"
  return null
}

function planCellsLabel(row: FgNomenclatureRow): string {
  return formatFgPlanRows(row.planRows)
}

function planZonesLabel(row: FgNomenclatureRow): string {
  const zones = [...new Set((row.planRows ?? []).map((item) => item.zone).filter(Boolean))]
  return zones.length ? zones.join(", ") : "—"
}

function slotPlanMeta(address: string) {
  const planRowId = canonicalPlanRowId(address)
  return {
    planRowId: planRowId || address,
    zone: planRowZone(address) || "—",
    cell: planRowId || "—",
  }
}

function PlanCodesPanel({ row }: { row: FgNomenclatureRow }) {
  const [lots, setLots] = useState<FgVekasLotDetail[]>([])
  const [lotsLoading, setLotsLoading] = useState(true)
  const [lotsError, setLotsError] = useState<string | null>(null)
  const [openBatch, setOpenBatch] = useState<string | null>(null)
  const openedDefault = useRef(false)
  const [query, setQuery] = useState("")
  const [slots, setSlots] = useState<FgPlanInventorySlot[]>([])
  const [planLoading, setPlanLoading] = useState(true)
  const [planError, setPlanError] = useState<string | null>(null)
  const [openSscc, setOpenSscc] = useState<string | null>(null)
  const [codes, setCodes] = useState<FgPlanPalletCzSummary | null>(null)
  const [codesLoading, setCodesLoading] = useState(false)
  const [codesError, setCodesError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLotsLoading(true)
    setLotsError(null)
    void listFgVekasLots({ itemCode: row.itemCode, gtin: row.gtin })
      .then((data) => {
        if (!cancelled) setLots(data.lots ?? [])
      })
      .catch((e) => {
        if (!cancelled) setLotsError(e instanceof Error ? e.message : "Не удалось загрузить партии")
      })
      .finally(() => {
        if (!cancelled) setLotsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [row.gtin, row.itemCode])

  useEffect(() => {
    let cancelled = false
    setPlanLoading(true)
    setPlanError(null)
    void fetchFgPlanInventory()
      .then((snap) => {
        if (cancelled) return
        const want = [gtinKey(row.gtin), gtinKey(row.itemCode)].filter(Boolean)
        const matched = Object.values(snap.inventory || {}).filter((slot) => {
          if (slot.status !== "occupied" || !slot.palletId) return false
          const got = gtinKey(slot.gtin)
          return Boolean(got && want.includes(got)) || slot.stockPostedItemCode === row.itemCode
        })
        setSlots(matched)
      })
      .catch((e) => {
        if (!cancelled) setPlanError(e instanceof Error ? e.message : "Не удалось загрузить палеты с плана")
      })
      .finally(() => {
        if (!cancelled) setPlanLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [row.gtin, row.itemCode])

  useEffect(() => {
    if (!openSscc) {
      setCodes(null)
      setCodesError(null)
      return
    }
    const slot = slots.find((item) => item.palletId === openSscc)
    let cancelled = false
    setCodesLoading(true)
    setCodesError(null)
    void lookupFgPlanPalletInCz({
      sscc: openSscc,
      planGtin: slot?.gtin || row.gtin,
      planBottles: slot?.quantity,
    })
      .then((next) => {
        if (!cancelled) setCodes(next)
      })
      .catch((e) => {
        if (!cancelled) setCodesError(e instanceof Error ? e.message : "ЧЗ не ответил")
      })
      .finally(() => {
        if (!cancelled) setCodesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [openSscc, row.gtin, slots])

  const q = query.trim().toLowerCase()
  const filteredLots = useMemo(() => {
    if (!q) return lots
    return lots.filter((lot) => {
      if (lot.batchNumber.toLowerCase().includes(q)) return true
      if ((lot.productionDate || "").includes(q)) return true
      return lot.palletCodes.some((code) => code.toLowerCase().includes(q))
    })
  }, [lots, q])

  useEffect(() => {
    if (openedDefault.current || filteredLots.length === 0) return
    openedDefault.current = true
    setOpenBatch(`${filteredLots[0].vekasServer}:${filteredLots[0].batchNumber}:0`)
  }, [filteredLots])

  if (lotsLoading && planLoading) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Загружаю партии и коды палет…
      </p>
    )
  }
  if (lotsError && lots.length === 0 && slots.length === 0) {
    return <p className="py-6 text-sm text-destructive">{lotsError}</p>
  }
  if (!lotsLoading && lots.length === 0 && !planLoading && slots.length === 0) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        Партий и кодов палет нет: Векас ещё не записал выпуск, на 2D-плане SSCC тоже нет.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {lots.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">
              Партии Векас · {filteredLots.length} из {lots.length}
            </p>
            <div className="relative min-w-[12rem] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Партия или код палеты…"
                className="h-8 rounded-lg bg-card pl-8 text-sm"
              />
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="wms-ag-grid min-w-[720px]">
              <thead>
                <tr>
                  <th className="wms-ag-header w-8" />
                  <th className="wms-ag-header">Партия</th>
                  <th className="wms-ag-header">Дата</th>
                  <th className="wms-ag-header text-right">Палеты</th>
                  <th className="wms-ag-header text-right">Блоки</th>
                  <th className="wms-ag-header text-right">Бутылки</th>
                </tr>
              </thead>
              <tbody>
                {filteredLots.map((lot, idx) => {
                  const key = `${lot.vekasServer}:${lot.batchNumber}:${idx}`
                  const open = openBatch === key
                  const codes = q
                    ? lot.palletCodes.filter((code) => code.toLowerCase().includes(q) || lot.batchNumber.toLowerCase().includes(q))
                    : lot.palletCodes
                  const qtyByCode = new Map(lot.palletQty.map((row) => [row.palletId, row.quantity]))
                  return (
                    <Fragment key={key}>
                      <tr
                        className="wms-ag-row cursor-pointer"
                        onClick={() => setOpenBatch(open ? null : key)}
                      >
                        <td className="wms-ag-cell w-8 text-muted-foreground">
                          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </td>
                        <td className="wms-ag-cell font-mono text-xs font-medium">{formatPlantBatch(lot.batchNumber)}</td>
                        <td className="wms-ag-cell text-xs">{lot.productionDate ? fmtFgDate(`${lot.productionDate}T00:00:00.000Z`) : "—"}</td>
                        <td className="wms-ag-cell-num">{fmtFgQty(lot.palletCount || lot.palletCodes.length)}</td>
                        <td className="wms-ag-cell-num">{fmtFgQty(lot.blocks)}</td>
                        <td className="wms-ag-cell-num">{fmtFgQty(lot.bottles)}</td>
                      </tr>
                      {open ? (
                        <tr key={`${key}-codes`} className="wms-ag-row bg-muted/40">
                          <td className="wms-ag-cell" colSpan={6}>
                            {codes.length === 0 ? (
                              <p className="py-2 text-xs text-muted-foreground">У этой партии нет кодов палет — только счёт бутылок/блоков.</p>
                            ) : (
                              <div className="max-h-72 overflow-y-auto py-1">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-muted-foreground">
                                      <th className="py-1 pr-3 text-left font-medium">Код палеты</th>
                                      <th className="py-1 text-right font-medium">Бутылки</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {codes.map((code) => (
                                      <tr key={code} className="border-t border-border/60">
                                        <td className="py-1 pr-3 font-mono">{code}</td>
                                        <td className="py-1 text-right tabular-nums">
                                          {qtyByCode.get(code) != null ? fmtFgQty(qtyByCode.get(code) || 0) : "—"}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : lotsLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Партии Векас…
        </p>
      ) : null}

      {planError ? <p className="text-sm text-destructive">{planError}</p> : null}
      {slots.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">
            {slots.length} палет на 2D-плане. Нажмите SSCC — Честный знак покажет блоки.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="wms-ag-grid min-w-[860px]">
              <thead>
                <tr>
                  <th className="wms-ag-header">Ряд</th>
                  <th className="wms-ag-header">Зона</th>
                  <th className="wms-ag-header">Слот</th>
                  <th className="wms-ag-header">SSCC</th>
                  <th className="wms-ag-header">Партия</th>
                  <th className="wms-ag-header text-right">Блоки</th>
                  <th className="wms-ag-header text-right">Бутылки</th>
                </tr>
              </thead>
              <tbody>
                {slots.map((slot) => {
                  const meta = slotPlanMeta(slot.address)
                  const bottles = Number(slot.quantity) || 0
                  const blocks = blocksFromBottles(bottles)
                  return (
                    <tr
                      key={slot.address}
                      className={cn("wms-ag-row cursor-pointer", openSscc === slot.palletId && "bg-muted")}
                      onClick={() => setOpenSscc(slot.palletId || null)}
                    >
                      <td className="wms-ag-cell font-mono text-xs">{meta.planRowId}</td>
                      <td className="wms-ag-cell font-mono text-xs">{meta.zone}</td>
                      <td className="wms-ag-cell font-mono text-xs">{slot.address}</td>
                      <td className="wms-ag-cell font-mono text-xs">{slot.palletId}</td>
                      <td className="wms-ag-cell">{slot.batch ? formatPlantBatch(slot.batch) : "—"}</td>
                      <td className="wms-ag-cell-num">{fmtFgQty(blocks)}</td>
                      <td className="wms-ag-cell-num">{fmtFgQty(bottles)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {openSscc ? (
            <div className="rounded-xl border p-3">
              {codesLoading ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Коды из ЧЗ…
                </p>
              ) : null}
              {codesError ? <p className="text-sm text-destructive">{codesError}</p> : null}
              {codes ? (
                <div className="space-y-2 text-sm">
                  <p className="font-medium">{codes.productName || "Состав палеты"}</p>
                  <p>
                    {fmtFgQty(codes.blocks)} {ruBlocksWord(codes.blocks)} · {fmtFgQty(codes.bottles)} бут. · {codes.statusLabel}
                  </p>
                  <div className="max-h-64 overflow-y-auto rounded-lg bg-muted/50 p-2 font-mono text-[11px] leading-5">
                    {codes.children.map((code) => (
                      <div key={code}>{code}</div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function DetailModal({
  row,
  open,
  onOpenChange,
  onResortSent,
}: {
  row: FgNomenclatureRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onResortSent?: () => void
}) {
  const { toast } = useToast()
  const [tree, setTree] = useState<FgMarkingNode[]>([])
  const [treeLoading, setTreeLoading] = useState(false)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [treeQuery, setTreeQuery] = useState("")
  const [selectedPalletIds, setSelectedPalletIds] = useState<Set<string>>(() => new Set())
  const [resortOpen, setResortOpen] = useState(false)

  useEffect(() => {
    if (!open || !row) {
      setTree([])
      setTreeError(null)
      setTreeQuery("")
      setSelectedPalletIds(new Set())
      return
    }
    let cancelled = false
    setTreeLoading(true)
    setTreeError(null)
    getFgWarehouseNomenclatureTree(row.itemCode)
      .then((data) => {
        if (!cancelled) setTree(data.tree)
      })
      .catch((e) => {
        if (!cancelled) {
          setTree([])
          setTreeError(e instanceof Error ? e.message : "Не удалось загрузить иерархию")
        }
      })
      .finally(() => {
        if (!cancelled) setTreeLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, row])

  const filteredTree = useMemo(() => filterPalletTree(tree, treeQuery), [tree, treeQuery])
  const visiblePalletIds = useMemo(
    () => filteredTree.filter((n) => n.kind === "pallet").map((n) => n.id),
    [filteredTree]
  )
  const selectedCount = selectedPalletIds.size
  const allVisibleSelected =
    visiblePalletIds.length > 0 && visiblePalletIds.every((id) => selectedPalletIds.has(id))

  function setPalletSelected(id: string, checked: boolean) {
    setSelectedPalletIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleSelectAllVisible(checked: boolean) {
    setSelectedPalletIds((prev) => {
      const next = new Set(prev)
      for (const id of visiblePalletIds) {
        if (checked) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  function runBulkOp(op: PalletBulkOp) {
    const ids = [...selectedPalletIds]
    if (ids.length === 0) return
    toast({
      title: "Операция в разработке",
      description: `${PALLET_BULK_OP_LABELS[op]} — выбрано палет: ${ids.length}. API подключим позже.`,
    })
  }

  if (!row) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] w-screen max-h-none max-w-none translate-x-0 translate-y-0 top-0 left-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 text-left">
          <DialogTitle className="leading-snug">{row.name}</DialogTitle>
          <DialogDescription>
            {row.itemCode} · GTIN {row.gtin}
            {row.productGroup ? ` · ${row.productGroup}` : ""}
            {row.skuProfile ? ` · ${row.skuProfile}` : ""} · только просмотр
          </DialogDescription>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {row.skuProfile ? (
              <Badge variant="outline" className="rounded-md">
                {row.skuProfile}
                {row.fsnMoves != null ? ` · ${row.fsnMoves} движ.` : ""}
                {row.coi != null ? ` · COI ${row.coi}` : ""}
              </Badge>
            ) : null}
            {row.reslotHint ? (
              <Badge className="rounded-md bg-amber-700 hover:bg-amber-700">
                Re-slot {row.reslotHint.fromRow}
                {row.reslotHint.expectedCutPct != null ? ` · −${row.reslotHint.expectedCutPct}% пути` : ""}
              </Badge>
            ) : null}
            {row.crossDock ? (
              <Badge className="rounded-md bg-sky-800 hover:bg-sky-800">
                Cross-dock → {row.crossDock.dockCode}
              </Badge>
            ) : null}
            <Badge variant="secondary" className="rounded-md tabular-nums">
              Палеты: {fmtFgQty(row.pallets)}
            </Badge>
            {hasPlaced(row) ? (
              <Badge className="rounded-md tabular-nums bg-emerald-700 hover:bg-emerald-700">
                Размещено: {fmtFgPlaced(row.placedPallets ?? 0, row.placedBlocks ?? 0, row.placedBottles ?? 0)}
              </Badge>
            ) : null}
            {placementLabel(row) ? (
              <Badge className="rounded-md bg-amber-700 hover:bg-amber-700">
                {placementLabel(row)}
                {(row.unplacedBottles ?? 0) > 0 ? ` · ${fmtFgQty(row.unplacedBottles ?? 0)} бут.` : ""}
              </Badge>
            ) : null}
            {planCellsLabel(row) !== "—" ? (
              <Badge variant="outline" className="rounded-md">
                {planCellsLabel(row)} · зона {planZonesLabel(row)}
              </Badge>
            ) : null}
            <Badge variant="secondary" className="rounded-md tabular-nums">
              Блоки: {fmtFgQty(row.blocks)}
            </Badge>
            <Badge variant="secondary" className="rounded-md tabular-nums">
              Бутылки: {fmtFgQty(row.bottles)}
            </Badge>
            <Badge variant="outline" className="rounded-md tabular-nums">
              Кодов: {fmtFgQty(row.markingCodesCount)}
            </Badge>
            {(row.productionLineName || row.productionLineCode || plantLinesFromBatches(row.lotCodes ?? []).name) ? (
              <Badge variant="outline" className="rounded-md">
                Линия: {row.productionLineName || row.productionLineCode || plantLinesFromBatches(row.lotCodes ?? []).name}
              </Badge>
            ) : null}
            {(row.lotCodes ?? []).length > 0 ? (
              <Badge variant="outline" className="rounded-md">
                Партий: {(row.lotCodes ?? []).length}
              </Badge>
            ) : null}
          </div>
          {row.reslotHint ? (
            <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
              {row.reslotHint.reason}
              {row.reslotHint.expectedCutPct != null
                ? ` Ожидаемое сокращение маршрута ≈ ${row.reslotHint.expectedCutPct}%.`
                : ""}{" "}
              <Link href="/help#slotting" className="underline underline-offset-2">
                Что такое re-slotting
              </Link>
            </p>
          ) : null}
          {row.crossDock ? (
            <p className="mt-2 text-xs text-sky-900 dark:text-sky-200">
              {row.crossDock.reason}{" "}
              <Link href="/help#cross-dock" className="underline underline-offset-2">
                Cross-dock
              </Link>
            </p>
          ) : null}
        </DialogHeader>

        {!treeLoading && !treeError && tree.length > 0 ? (
        <div className="shrink-0 space-y-3 border-b border-border px-5 py-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Поиск: код палеты, серийник, ряд…"
                value={treeQuery}
                onChange={(e) => setTreeQuery(e.target.value)}
                className="h-9 rounded-lg bg-card pl-9"
              />
            </div>
            {treeQuery.trim() ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 rounded-lg"
                onClick={() => setTreeQuery("")}
              >
                Сбросить
              </Button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {filteredTree.length} из {tree.length} палет
              {selectedCount > 0 ? ` · выбрано ${selectedCount}` : ""}
            </span>
            {selectedCount > 0 ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 rounded-lg text-xs"
                  onClick={() => setResortOpen(true)}
                >
                  <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                  На перебор
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-8 rounded-lg text-xs"
                  onClick={() => runBulkOp("quarantine")}
                >
                  <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
                  В карантин
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg text-xs"
                  onClick={() => runBulkOp("remove-from-row")}
                >
                  <XCircle className="mr-1.5 h-3.5 w-3.5" />
                  Изъять из ряда
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg text-xs"
                  onClick={() => runBulkOp("move-row")}
                >
                  <Truck className="mr-1.5 h-3.5 w-3.5" />
                  В другой ряд
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg text-xs"
                  onClick={() => runBulkOp("relabel")}
                >
                  <Tags className="mr-1.5 h-3.5 w-3.5" />
                  Перемаркировка
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 rounded-lg text-xs"
                  onClick={() => setSelectedPalletIds(new Set())}
                >
                  Снять выбор
                </Button>
              </>
            ) : null}
          </div>
        </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <PlanCodesPanel row={row} />
          {treeLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загрузка иерархии…
            </div>
          ) : treeError ? (
            <p className="py-6 text-sm text-destructive">{treeError}</p>
          ) : tree.length === 0 ? null : filteredTree.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              По запросу палеты не найдены. Измените поиск или сбросьте фильтр.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-lg border border-border">
              <table className="wms-ag-grid min-w-[920px]">
                <thead>
                  <tr>
                    <th className="wms-ag-header w-10 text-center">
                      <Checkbox
                        checked={allVisibleSelected}
                        onCheckedChange={(v) => toggleSelectAllVisible(v === true)}
                        aria-label="Выбрать все палеты на экране"
                        disabled={visiblePalletIds.length === 0}
                      />
                    </th>
                    <th className="wms-ag-header">Уровень</th>
                    <th className="wms-ag-header">Код</th>
                    <th className="wms-ag-header">Серийник</th>
                    <th className="wms-ag-header">Ряд</th>
                    <th className="wms-ag-header text-right">Вложения</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTree.map((node) => (
                    <MarkingHierarchyRow
                      key={node.id}
                      itemCode={row.itemCode}
                      node={node}
                      selectable
                      selected={selectedPalletIds.has(node.id)}
                      onSelectedChange={setPalletSelected}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <FgSendToResortDialog
          open={resortOpen}
          onOpenChange={setResortOpen}
          pallets={filteredTree
            .filter((node) => selectedPalletIds.has(node.id))
            .map((node) => ({
              palletId: node.id,
              palletCode: node.code || node.serialNumber,
              itemName: row.name,
              locationCode: node.rowLabel || node.locationCode,
            }))}
          onSent={() => {
            setSelectedPalletIds(new Set())
            if (row) {
              getFgWarehouseNomenclatureTree(row.itemCode)
                .then((data) => setTree(data.tree))
                .catch(() => undefined)
            }
            onResortSent?.()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function FgCrossDockBoard({ rows }: { rows: FgNomenclatureRow[] }) {
  const hints = rows.filter((row) => row.crossDock)
  return (
    <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
      <h3 className="text-base font-semibold">Cross-dock</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Если SKU уже есть в открытой отгрузке на ближайшие 36 часов, его не кладут в ряд — сразу на рампу.
      </p>
      {hints.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Сейчас нет пересечения прихода и отгрузки. Появится, когда будет открытое задание ship/pick на ту же
          номенклатуру.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {hints.map((row) => (
            <li key={row.itemCode} className="rounded-lg border bg-card px-3 py-2 text-sm">
              <div className="font-medium">{row.name}</div>
              <p className="text-xs text-muted-foreground">{row.crossDock?.reason}</p>
            </li>
          ))}
        </ul>
      )}
      <Link href="/help#cross-dock" className="mt-3 inline-block text-xs text-primary underline-offset-2 hover:underline">
        Как это работает
      </Link>
    </div>
  )
}

const EMPTY_STATS: FgSummaryStats = {
  nomenclatureCount: 0,
  bottles: 0,
  blocks: 0,
  pallets: 0,
  placedBottles: 0,
  placedBlocks: 0,
  placedPallets: 0,
  unplacedBottles: 0,
  unplacedPallets: 0,
  markingCodesCount: 0,
  expiryCritical: 0,
  expiryWarning: 0,
  exportBottles: 0,
}

const FG_NOM_COLUMNS = [
  { id: "name", label: "Номенклатура", locked: true },
  { id: "profile", label: "Профиль" },
  { id: "gtin", label: "GTIN" },
  { id: "batch", label: "Партия" },
  { id: "line", label: "Линия" },
  { id: "placed", label: "Размещено" },
  { id: "bottles", label: "Бутылки" },
  { id: "planCell", label: "Ряд" },
  { id: "planZone", label: "Зона" },
  { id: "produced", label: "Дата пр-ва" },
  { id: "expiry", label: "Срок годности" },
  { id: "statuses", label: "Статусы" },
] as const

const STICKY_NAME_HEAD =
  "wms-ag-sticky-name min-w-[14rem] w-[18rem] max-w-[22rem]"
const STICKY_NAME_CELL =
  "wms-ag-sticky-name min-w-[14rem] w-[18rem] max-w-[22rem]"

const FG_PALLET_COLUMNS = [
  { id: "palletCode", label: "Код палеты" },
  { id: "itemName", label: "Номенклатура" },
  { id: "location", label: "Ячейка / ряд" },
  { id: "blocks", label: "Блоки" },
  { id: "bottles", label: "Бутылки" },
  { id: "produced", label: "Производство" },
  { id: "expiry", label: "Срок годности" },
  { id: "statuses", label: "Статусы" },
  { id: "actions", label: "Действия", locked: true },
] as const

export function FinishedGoodsWarehousePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<FgSummaryStats>(EMPTY_STATS)
  const [allRows, setAllRows] = useState<FgNomenclatureRow[]>([])
  const [allPallets, setAllPallets] = useState<FgPalletRow[]>([])
  const [expiryBuckets, setExpiryBuckets] = useState<FgExpiryBucket[]>([])

  const [filter, setFilter] = useState("")
  const [detailRow, setDetailRow] = useState<FgNomenclatureRow | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [resortTick, setResortTick] = useState(0)
  const [palletResort, setPalletResort] = useState<FgResortTarget[]>([])
  const [palletResortOpen, setPalletResortOpen] = useState(false)
  const [planStock, setPlanStock] = useState<FgPlanStockPreview | null>(null)
  const [postingPlan, setPostingPlan] = useState(false)
  const [postPlanMsg, setPostPlanMsg] = useState<string | null>(null)
  const [postPlanErr, setPostPlanErr] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState("nomenclature")
  const [fsnDays, setFsnDays] = useState<FsnPeriodDays>(DEFAULT_FSN_DAYS)
  const [fsnFilter, setFsnFilter] = useState<"all" | FsnClass>("all")
  const [abcFilter, setAbcFilter] = useState<"all" | AbcClass>("all")
  const [xyzFilter, setXyzFilter] = useState<"all" | XyzClass>("all")
  const [opsFilter, setOpsFilter] = useState<"all" | "min" | "dead" | "aging" | "obsolete">("all")
  const nomCols = useTableColumnLayout("fg-nomenclature-v6", FG_NOM_COLUMNS)
  const palletCols = useTableColumnLayout("fg-pallets", FG_PALLET_COLUMNS)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Критический путь: summary + nomenclature. Expiry/plan/pallets — фоном, чтобы таблица открывалась быстрее.
      const [summaryRes, nomRes] = await Promise.all([
        getFgWarehouseSummary(),
        listFgWarehouseNomenclature({ fsnDays }),
      ])
      setStats(summaryRes.summary)
      setAllRows(nomRes.rows)
      setLoading(false)

      void listFgWarehouseExpiry()
        .then((expiryRes) => setExpiryBuckets(expiryRes.buckets))
        .catch(() => undefined)
      void fetchFgPlanInventory()
        .then((planRes) => setPlanStock(planRes?.stock ?? null))
        .catch(() => undefined)
      void listFgWarehousePallets()
        .then((palletsRes) => setAllPallets(palletsRes.pallets))
        .catch(() => undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки")
      setLoading(false)
    }
  }, [fsnDays])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const filterNorm = filter.trim().toLowerCase()
  const filteredRows = useMemo(() => {
    return allRows.filter((r) => {
      if (fsnFilter !== "all" && r.fsn !== fsnFilter) return false
      if (abcFilter !== "all" && r.abc !== abcFilter) return false
      if (xyzFilter !== "all" && r.xyz !== xyzFilter) return false
      if (opsFilter === "min" && r.policyState !== "below_min" && r.policyState !== "safety" && r.policyState !== "reorder") {
        return false
      }
      if (opsFilter === "dead" && !r.deadStock) return false
      if (opsFilter === "aging" && r.agingBand !== "old" && r.agingBand !== "stale") return false
      if (opsFilter === "obsolete" && r.obsolescence !== "high" && r.obsolescence !== "watch") return false
      if (!filterNorm) return true
      return (
        r.name.toLowerCase().includes(filterNorm) ||
        r.itemCode.toLowerCase().includes(filterNorm) ||
        (r.skuProfile ?? "").toLowerCase().includes(filterNorm) ||
        (r.abcxyz ?? "").toLowerCase().includes(filterNorm) ||
        (r.crossDock?.dockCode ?? "").toLowerCase().includes(filterNorm) ||
        (r.crossDock && "cross-dock".includes(filterNorm)) ||
        r.gtin.includes(filterNorm) ||
        r.productGroup.toLowerCase().includes(filterNorm) ||
        (r.productionLineName ?? "").toLowerCase().includes(filterNorm) ||
        (r.productionLineCode ?? "").toLowerCase().includes(filterNorm) ||
        (r.lotCodes ?? []).some((lot) => lot.toLowerCase().includes(filterNorm) || formatPlantBatch(lot).toLowerCase().includes(filterNorm)) ||
        (r.planRows ?? []).some(
          (loc) =>
            loc.planRowId.toLowerCase().includes(filterNorm) ||
            loc.locationCode.toLowerCase().includes(filterNorm) ||
            loc.zone.toLowerCase().includes(filterNorm)
        )
      )
    })
  }, [allRows, filterNorm, fsnFilter, abcFilter, xyzFilter, opsFilter])

  const filteredPallets = useMemo(() => {
    if (!filterNorm) return allPallets
    return allPallets.filter(
      (p) =>
        p.itemName.toLowerCase().includes(filterNorm) ||
        p.palletCode.toLowerCase().includes(filterNorm) ||
        p.locationCode.toLowerCase().includes(filterNorm)
    )
  }, [allPallets, filterNorm])

  const unplacedTotals = useMemo(() => {
    return allRows.reduce(
      (acc, row) => {
        acc.bottles += row.unplacedBottles ?? 0
        acc.pallets += row.unplacedPallets ?? 0
        acc.skus += (row.placement === "unplaced" || row.placement === "partial") ? 1 : 0
        return acc
      },
      { bottles: 0, pallets: 0, skus: 0 }
    )
  }, [allRows])

  function openDetail(row: FgNomenclatureRow) {
    setDetailRow(row)
    setDetailOpen(true)
  }

  async function postPlanToWarehouse() {
    setPostingPlan(true)
    setPostPlanErr(null)
    setPostPlanMsg(null)
    try {
      const result = await postFgPlanInventoryToWarehouse()
      setPlanStock(result.preview)
      if (result.posted > 0) {
        setPostPlanMsg(
          `С плана на склад: ${result.pallets} пал. / ${result.bottles} бут.`
        )
      } else if (result.failed > 0) {
        const first = result.lines.find((line) => line.reason)
        setPostPlanErr(first?.reason || "Не удалось оприходовать продукцию с плана")
      } else {
        setPostPlanMsg("Вся продукция с плана уже на складе")
      }
      await loadData()
    } catch (e) {
      setPostPlanErr(e instanceof Error ? e.message : "Не удалось добавить продукцию с плана")
    } finally {
      setPostingPlan(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      {error ? (
        <WmsErrorState
          className="mx-3 mt-2 shrink-0"
          title="Не удалось загрузить склад ГП"
          message={error}
          onRetry={() => void loadData()}
        />
      ) : null}

      {(planStock && planStock.pendingSlots > 0) || unplacedTotals.skus > 0 || postPlanMsg || postPlanErr ? (
        <div
          className={cn(
            "mx-3 mt-2 flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5",
            postPlanErr
              ? "border-destructive/40 bg-destructive/5"
              : unplacedTotals.skus > 0
                ? "border-amber-500/40 bg-amber-500/5"
                : "border-emerald-500/40 bg-emerald-500/5"
          )}
        >
          <p className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
            {postPlanErr
              ? postPlanErr
              : postPlanMsg
                ? postPlanMsg
                : unplacedTotals.skus > 0
                  ? `Не вся продукция размещена на складе: ${unplacedTotals.skus} SKU · ${unplacedTotals.pallets} пал. · ${unplacedTotals.bottles} бут. без адреса`
                : `На плане ещё не на складе: ${planStock?.pendingPallets ?? 0} пал. / ${planStock?.pendingBottles ?? 0} бут.`}
          </p>
          {(planStock?.pendingSlots ?? 0) > 0 ? (
            <Button
              size="sm"
              className="h-7 shrink-0 rounded-md px-2 text-xs"
              disabled={postingPlan}
              onClick={() => void postPlanToWarehouse()}
            >
              {postingPlan ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <PackagePlus className="mr-1 h-3.5 w-3.5" />
              )}
              На склад
            </Button>
          ) : null}
        </div>
      ) : null}

      <section className="min-h-0 flex-1 overflow-hidden">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-0"
        >
          <div className="flex h-10 shrink-0 items-center gap-1.5 overflow-hidden border-b border-border bg-muted/20 px-3">
            <h1 className="shrink-0 text-sm font-semibold tracking-tight text-foreground">
              Склад ГП
            </h1>
            {activeTab === "nomenclature" && !loading ? (
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {filteredRows.length} поз.
              </span>
            ) : null}
            <TabsList className="h-8 w-auto justify-start gap-0.5 rounded-lg bg-transparent p-0">
              <TabsTrigger
                value="nomenclature"
                className="h-7 rounded-md px-2.5 text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none"
              >
                Номенклатура
              </TabsTrigger>
              <TabsTrigger
                value="pallets"
                className="h-7 rounded-md px-2.5 text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none"
              >
                Палеты
              </TabsTrigger>
              <TabsTrigger
                value="expiry"
                className="h-7 rounded-md px-2.5 text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none"
              >
                Сроки
              </TabsTrigger>
              <TabsTrigger
                value="ship"
                className="h-7 rounded-md px-2.5 text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none"
              >
                Отгрузка
              </TabsTrigger>
              <TabsTrigger
                value="rows"
                className="h-7 rounded-md px-2.5 text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none"
              >
                Ряды
              </TabsTrigger>
              <TabsTrigger
                value="resort"
                className="h-7 rounded-md px-2.5 text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none"
              >
                Перебор
              </TabsTrigger>
            </TabsList>
            <div className="relative min-w-0 max-w-xs flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Поиск…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="h-8 rounded-md bg-card pl-8 text-sm shadow-none"
              />
            </div>
            {activeTab === "nomenclature" ? (
              <div className="flex shrink-0 items-center gap-1">
                <select
                  className="h-8 rounded-md border bg-background px-1.5 text-xs"
                  value={fsnDays}
                  title="Период спроса"
                  onChange={(e) => setFsnDays(Number(e.target.value) as FsnPeriodDays)}
                >
                  {FSN_PERIODS.map((d) => (
                    <option key={d} value={d}>
                      {d} дн.
                    </option>
                  ))}
                </select>
                <select
                  className="h-8 rounded-md border bg-background px-1.5 text-xs"
                  value={abcFilter}
                  title="ABC"
                  onChange={(e) => setAbcFilter(e.target.value as "all" | AbcClass)}
                >
                  <option value="all">ABC</option>
                  {ABC_CLASSES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
                <select
                  className="h-8 rounded-md border bg-background px-1.5 text-xs"
                  value={xyzFilter}
                  title="XYZ"
                  onChange={(e) => setXyzFilter(e.target.value as "all" | XyzClass)}
                >
                  <option value="all">XYZ</option>
                  {XYZ_CLASSES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
                <select
                  className="h-8 rounded-md border bg-background px-1.5 text-xs"
                  value={fsnFilter}
                  title="FSN"
                  onChange={(e) => setFsnFilter(e.target.value as "all" | FsnClass)}
                >
                  <option value="all">FSN</option>
                  <option value="F">F</option>
                  <option value="S">S</option>
                  <option value="N">N</option>
                </select>
                <select
                  className="h-8 rounded-md border bg-background px-1.5 text-xs"
                  value={opsFilter}
                  title="Политика запаса"
                  onChange={(e) =>
                    setOpsFilter(e.target.value as "all" | "min" | "dead" | "aging" | "obsolete")
                  }
                >
                  <option value="all">Методы</option>
                  <option value="min">Min / max</option>
                  <option value="dead">Dead stock</option>
                  <option value="aging">Возраст</option>
                  <option value="obsolete">Устаревание</option>
                </select>
              </div>
            ) : null}
            <select
              className="h-8 rounded-md border bg-background px-1.5 text-xs"
              defaultValue=""
              title="Ещё"
              onChange={(e) => {
                const href = e.target.value
                e.currentTarget.value = ""
                if (href) router.push(href)
              }}
            >
              <option value="">Ещё</option>
              <option value="/virtual-warehouse/fg">План ГП</option>
              <option value="/warehouse-stock/finished-goods/apriltags">AprilTag — печать</option>
              <option value="/warehouse-stock/finished-goods/fleet">Кары / interleaving</option>
              <option value="/warehouse-stock/finished-goods/vekas">Партии Vekas</option>
              <option value="/warehouse-stock/finished-goods/import">Импорт ЧЗ</option>
              <option value="/help#wms-terms">Словарь терминов</option>
              <option value="/help#cross-dock">Cross-dock</option>
              <option value="/warehouse-stock/ops">Очередь методов</option>
              <option value="/help#warehouse-ops">Методы ГП и материалов</option>
            </select>
            {(planStock?.pendingSlots ?? 0) > 0 ? (
              <Button
                size="sm"
                className="h-8 shrink-0 rounded-md px-2 text-xs"
                disabled={postingPlan || loading}
                onClick={() => void postPlanToWarehouse()}
              >
                {postingPlan ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PackagePlus className="mr-1 h-3.5 w-3.5" />
                )}
                С плана
              </Button>
            ) : null}
            {activeTab === "nomenclature" ? (
              <TableColumnsButton
                columns={[...FG_NOM_COLUMNS]}
                order={nomCols.order}
                hidden={nomCols.hidden}
                setHidden={nomCols.setHidden}
                reorder={nomCols.reorder}
                reset={nomCols.reset}
              />
            ) : null}
            {activeTab === "pallets" ? (
              <TableColumnsButton
                columns={[...FG_PALLET_COLUMNS]}
                order={palletCols.order}
                hidden={palletCols.hidden}
                setHidden={palletCols.setHidden}
                reorder={palletCols.reorder}
                reset={palletCols.reset}
              />
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0 rounded-md px-2"
              onClick={() => void loadData()}
              disabled={loading}
              title="Обновить"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              <span className="sr-only">Обновить</span>
            </Button>
          </div>

          <TabsContent
            value="nomenclature"
            className="mt-0 min-h-0 overflow-auto overscroll-contain data-[state=active]:block data-[state=inactive]:hidden"
          >
            <div className="min-h-0">
              {loading ? (
                <WmsTableSkeleton rows={8} columns={6} />
              ) : (
                <table className="wms-ag-grid wms-ag-grid--compact wms-ag-grid--fit w-full border-separate border-spacing-0 [&_tbody_td]:!py-1.5 [&_thead_th]:!py-1.5">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      {nomCols.visible.map((id) => (
                        <DraggableColumnHead
                          key={id}
                          id={id}
                          locked={id === "name"}
                          className={cn(
                            id === "name" && STICKY_NAME_HEAD,
                            id === "batch" && "min-w-[10rem]",
                            id === "line" && "min-w-[6rem]",
                            id === "produced" && "min-w-[7rem]",
                            id === "expiry" && "min-w-[8rem]",
                            id === "statuses" && "min-w-[6rem]",
                            (id === "bottles" || id === "placed") && "text-right"
                          )}
                          onReorder={nomCols.reorder}
                        >
                          {FG_NOM_COLUMNS.find((c) => c.id === id)?.label}
                        </DraggableColumnHead>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={Math.max(1, nomCols.visible.length)} className="!border-0 p-0">
                          <WmsEmptyState
                            title={filterNorm ? "Ничего не найдено" : "Нет номенклатуры на складе"}
                            description={
                              filterNorm
                                ? "Измените поиск или сбросьте фильтр."
                                : (planStock?.pendingSlots ?? 0) > 0
                                  ? "На 2D-плане уже есть палеты, но остаток склада ещё пуст. Добавьте продукцию с плана."
                                  : "Остатки появятся после приёмки или оприходования с 2D-плана ГП."
                            }
                            action={
                              !filterNorm ? (
                                (planStock?.pendingSlots ?? 0) > 0 ? (
                                  <Button
                                    className="rounded-xl"
                                    disabled={postingPlan}
                                    onClick={() => void postPlanToWarehouse()}
                                  >
                                    {postingPlan ? (
                                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <PackagePlus className="mr-1.5 h-3.5 w-3.5" />
                                    )}
                                    Добавить с плана
                                  </Button>
                                ) : (
                                  <Button asChild variant="outline" className="rounded-xl">
                                    <Link href="/virtual-warehouse/fg">План ГП</Link>
                                  </Button>
                                )
                              ) : undefined
                            }
                          />
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map((row) => (
                        <tr
                          key={row.itemCode}
                          className="wms-ag-row group cursor-pointer"
                          title="Открыть коды ЧЗ"
                          onClick={() => openDetail(row)}
                        >
                          {nomCols.visible.map((id) => (
                            <td
                              key={id}
                              className={cn(
                                id === "name" && STICKY_NAME_CELL,
                                id === "gtin" && "font-mono text-xs text-muted-foreground",
                                id === "line" && "text-xs",
                                (id === "produced" || id === "expiry") && "text-xs",
                                id === "placed" && "wms-ag-cell-num font-semibold text-emerald-800 dark:text-emerald-300",
                                id === "bottles" && "wms-ag-cell-num font-semibold",
                                (id === "planCell" || id === "planZone") && "font-mono text-xs"
                              )}
                            >
                              {id === "name" ? (
                                <div className="min-w-0">
                                  <p className="whitespace-normal break-words font-medium leading-snug text-foreground">
                                    {row.name}
                                  </p>
                                  {row.productGroup ? (
                                    <p className="mt-0.5 text-[11px] text-muted-foreground">{row.productGroup}</p>
                                  ) : null}
                                </div>
                              ) : null}
                              {id === "profile" ? (
                                <div className="flex flex-col gap-0.5">
                                  <FgSkuProfileBadge row={row} compact />
                                  {row.reslotHint ? (
                                    <span className="text-[10px] leading-tight text-amber-800 dark:text-amber-200">
                                      re-slot {row.reslotHint.fromRow}
                                    </span>
                                  ) : null}
                                  {row.crossDock ? (
                                    <span className="text-[10px] leading-tight text-sky-800 dark:text-sky-200">
                                      dock {row.crossDock.dockCode}
                                    </span>
                                  ) : null}
                                  {row.policyShort ? (
                                    <span className="text-[10px] leading-tight text-muted-foreground" title={row.opsHint || undefined}>
                                      {row.policyShort}
                                    </span>
                                  ) : null}
                                </div>
                              ) : null}
                              {id === "gtin" ? row.gtin : null}
                              {id === "batch" ? (
                                (row.lotCodes ?? []).length > 0 ? (
                                  <span className="text-xs font-medium">
                                    {formatPlantBatch((row.lotCodes ?? [])[0])}
                                    {(row.lotCodes ?? []).length > 1
                                      ? ` +${(row.lotCodes ?? []).length - 1}`
                                      : ""}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )
                              ) : null}
                              {id === "line" ? (
                                (() => {
                                  const fromLots = plantLinesFromBatches(row.lotCodes ?? [])
                                  const lineLabel =
                                    row.productionLineName ||
                                    row.productionLineCode ||
                                    fromLots.name ||
                                    fromLots.code
                                  return lineLabel ? (
                                    <span className="font-medium">{lineLabel}</span>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )
                                })()
                              ) : null}
                              {id === "placed" ? (
                                hasPlaced(row) || row.placement === "unplaced" || row.placement === "partial" ? (
                                  <span className="whitespace-nowrap text-xs">
                                    {hasPlaced(row)
                                      ? `${fmtFgQty(row.placedPallets ?? 0)} пал. · ${fmtFgQty(row.placedBlocks ?? 0)} бл. · ${fmtFgQty(row.placedBottles ?? 0)} бут.`
                                      : "0 пал. · 0 бл. · 0 бут."}
                                    {placementLabel(row) ? (
                                      <span className="ml-1 text-amber-800 dark:text-amber-200">
                                        · {placementLabel(row)}
                                      </span>
                                    ) : null}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )
                              ) : null}
                              {id === "bottles" ? fmtFgQty(row.bottles) : null}
                              {id === "planCell" ? planCellsLabel(row) : null}
                              {id === "planZone" ? planZonesLabel(row) : null}
                              {id === "produced" ? (row.oldestProductionAt ? fmtFgDate(row.oldestProductionAt) : "—") : null}
                              {id === "expiry" ? <ExpiryBadge iso={row.nearestExpiryAt} /> : null}
                              {id === "statuses" ? <FgStatusBadges statuses={row.statuses} /> : null}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </TabsContent>

          <TabsContent
            value="pallets"
            className="mt-0 min-h-0 overflow-auto overscroll-contain data-[state=active]:block data-[state=inactive]:hidden"
          >
            <div className="min-h-0">
              {loading ? (
                <WmsTableSkeleton rows={8} columns={5} />
              ) : (
                <table className="wms-ag-grid wms-ag-grid--compact">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      {palletCols.visible.map((id) => (
                        <DraggableColumnHead
                          key={id}
                          id={id}
                          locked={id === "actions"}
                          className={cn(
                            id === "itemName" && "min-w-[12rem]",
                            (id === "blocks" || id === "bottles") && "text-right",
                            id === "actions" && "w-28"
                          )}
                          onReorder={palletCols.reorder}
                        >
                          {id === "actions" ? null : FG_PALLET_COLUMNS.find((c) => c.id === id)?.label}
                        </DraggableColumnHead>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPallets.length === 0 ? (
                      <tr>
                        <td colSpan={Math.max(1, palletCols.visible.length)} className="!border-0 p-0">
                          <WmsEmptyState
                            title={filterNorm ? "Палеты не найдены" : "Нет палет на складе"}
                            description={
                              filterNorm
                                ? "Измените поиск или переключите вкладку."
                                : "Палеты с кодами маркировки появятся после размещения готовой продукции и оприходования с плана ГП."
                            }
                          />
                        </td>
                      </tr>
                    ) : (
                      filteredPallets.map((p) => (
                        <tr key={p.palletCode} className="wms-ag-row">
                          {palletCols.visible.map((id) => (
                            <td
                              key={id}
                              className={cn(
                                id === "palletCode" && "font-mono text-xs",
                                id === "location" && "text-xs",
                                (id === "produced" || id === "expiry") && "text-xs",
                                (id === "blocks" || id === "bottles") && "wms-ag-cell-num"
                              )}
                            >
                              {id === "palletCode" ? p.palletCode.slice(-12) : null}
                              {id === "itemName" ? p.itemName : null}
                              {id === "location" ? (
                                <>
                                  <p>{p.locationCode}</p>
                                  <p className="text-muted-foreground">{p.rowLabel}</p>
                                </>
                              ) : null}
                              {id === "blocks" ? p.blocks : null}
                              {id === "bottles" ? p.bottles : null}
                              {id === "produced" ? fmtFgDate(p.producedAt) : null}
                              {id === "expiry" ? <ExpiryBadge iso={p.expiresAt} /> : null}
                              {id === "statuses" ? <FgStatusBadges statuses={p.statuses} /> : null}
                              {id === "actions" ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 rounded-md px-2 text-xs"
                                  disabled={p.statuses.onResort}
                                  onClick={() => {
                                    setPalletResort([
                                      {
                                        palletId: p.palletId,
                                        palletCode: p.palletCode,
                                        itemName: p.itemName,
                                        locationCode: p.rowLabel || p.locationCode,
                                      },
                                    ])
                                    setPalletResortOpen(true)
                                  }}
                                >
                                  {p.statuses.onResort ? "На переборе" : "На перебор"}
                                </Button>
                              ) : null}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </TabsContent>

          <TabsContent
            value="expiry"
            className="mt-0 min-h-0 overflow-auto overscroll-contain p-0 data-[state=active]:block data-[state=inactive]:hidden"
          >
            {loading ? (
              <WmsTableSkeleton rows={4} columns={3} />
            ) : (
              <div className="min-h-0">
                <table className="wms-ag-grid min-w-[640px]">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th>Зона</th>
                      <th>Номенклатура</th>
                      <th className="text-right">Бутылки</th>
                      <th>Срок</th>
                      <th className="text-right">Дней</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expiryBuckets.every((b) => b.items.length === 0) ? (
                      <tr>
                        <td colSpan={5} className="!border-0 p-0">
                          <WmsEmptyState
                            title="Нет данных по срокам"
                            description="Позиции со сроком годности появятся после приёмки."
                          />
                        </td>
                      </tr>
                    ) : (
                      expiryBuckets.flatMap((bucket) =>
                        bucket.items.map((item) => (
                          <tr
                            key={`${bucket.key}-${item.itemCode}`}
                            className={cn(
                              "wms-ag-row",
                              (bucket.key === "critical" || bucket.key === "expired") &&
                                "wms-ag-row--critical",
                              bucket.key === "warning" && "wms-ag-row--warn"
                            )}
                          >
                            <td className="text-xs font-medium">{bucket.label}</td>
                            <td>{item.name}</td>
                            <td className="wms-ag-cell-num font-semibold">{fmtFgQty(item.bottles)}</td>
                            <td className="text-xs">{fmtFgDate(item.nearestExpiryAt)}</td>
                            <td className="wms-ag-cell-num text-xs">
                              {item.daysLeft} {ruDaysWord(item.daysLeft)}
                            </td>
                          </tr>
                        ))
                      )
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          <TabsContent
            value="ship"
            className="mt-0 min-h-0 overflow-auto overscroll-contain p-4 data-[state=active]:block data-[state=inactive]:hidden"
          >
            <div className="space-y-6">
              <FgCrossDockBoard rows={allRows} />
              <FgShipRulesPanel />
            </div>
          </TabsContent>

          <TabsContent
            value="rows"
            className="mt-0 min-h-0 overflow-auto overscroll-contain data-[state=active]:block data-[state=inactive]:hidden"
          >
            <FinishedGoodsRowsPanel />
          </TabsContent>

          <TabsContent
            value="resort"
            className="mt-0 min-h-0 overflow-auto overscroll-contain data-[state=active]:block data-[state=inactive]:hidden"
          >
            <FgResortPanel refreshKey={resortTick} />
          </TabsContent>
        </Tabs>
      </section>

      <DetailModal
        row={detailRow}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onResortSent={() => {
          setResortTick((n) => n + 1)
          void loadData()
        }}
      />
      <FgSendToResortDialog
        open={palletResortOpen}
        onOpenChange={setPalletResortOpen}
        pallets={palletResort}
        onSent={() => {
          setPalletResort([])
          setResortTick((n) => n + 1)
          void loadData()
        }}
      />
    </div>
  )
}
