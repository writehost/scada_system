"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowDownToLine,
  Factory,
  Layers,
  MinusCircle,
  Plus,
  RefreshCw,
  Search,
  Sticker,
  Undo2,
} from "lucide-react"
import { WorkshopProductPartsScheme } from "@/components/wms/workshop-product-parts-scheme"
import { WorkshopCellFillDialog } from "@/components/wms/workshop-cell-fill-dialog"
import {
  WorkshopWaitingConsumeDialog,
  type WorkshopLineOption,
} from "@/components/wms/workshop-waiting-consume-dialog"
import { WorkshopWaitingWriteoffDialog } from "@/components/wms/workshop-waiting-writeoff-dialog"
import { WorkshopWaitingReturnDialog } from "@/components/wms/workshop-waiting-return-dialog"
import {
  WaitingCellPlanHint,
  WorkshopPlansPanel,
} from "@/components/wms/workshop-plans-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { mapWmsError } from "@/lib/wms-error-messages"
import {
  getWorkshopStockOverview,
  listDirectoryProductionLines,
  listDirectoryRacks,
  listDirectoryWarehouses,
  listLocations,
  listProductionPlans,
  type ProductionPlanRow,
  type RackDirectoryRow,
  type WmsLocationRow,
  type WorkshopStockRow,
} from "@/lib/wms-api"
import {
  buildWorkshopQtyByItem,
  findPlanContextForWaitingCell,
} from "@/lib/wms/workshop-plan-context"
import { isWorkshopDirectoryRow } from "@/lib/wms/workshop-directory"
import {
  compareSequentialCellCodes,
  isWaitingCellEffectivelyEmpty,
  locationCodeMatchesQuery,
} from "@/lib/wms/workshop-waiting-cell"
import {
  WmsEmptyState,
  WmsErrorState,
  WmsTableSkeleton,
} from "@/components/wms/wms-shared"
import { WorkshopCodesPanel } from "@/components/wms/workshop-codes-panel"
import { WaitingCellsCreateDialog } from "@/components/wms/waiting-cells-create-dialog"
import { WorkshopRackCreateDialog } from "@/components/wms/workshop-rack-create-dialog"
import { RackBarcode } from "@/components/wms/rack-barcode"
import { isCalendarExpiryPast } from "@/lib/wms/expiry-sticker"

type StockFilter = "stickers" | "all"
type WaitingFilter = "all" | "occupied" | "empty"
type MainTab = "cells" | "racks" | "stock"

type LineGroup = {
  key: string
  lineLabel: string
  locationCode: string
  displayName: string
  items: WorkshopStockRow[]
  totalInProduction: number
  stickerInProduction: number
}

function fmtQty(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value)
}

function fmtExpiryDate(iso: string | null | undefined) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString("ru-RU")
}

function locationOnHandQty(loc: WmsLocationRow) {
  return (loc.inProductionQty ?? 0) + (loc.availableQty ?? 0)
}

function groupStockRows(rows: WorkshopStockRow[]): LineGroup[] {
  const map = new Map<string, LineGroup>()
  for (const row of rows) {
    const key = row.locationCode
    const existing = map.get(key)
    if (existing) {
      existing.items.push(row)
      existing.totalInProduction += row.inProductionQty
      if (row.isSticker) existing.stickerInProduction += row.inProductionQty
    } else {
      map.set(key, {
        key,
        lineLabel: row.lineLabel,
        locationCode: row.locationCode,
        displayName: row.displayName,
        items: [row],
        totalInProduction: row.inProductionQty,
        stickerInProduction: row.isSticker ? row.inProductionQty : 0,
      })
    }
  }
  return Array.from(map.values()).sort(
    (a, b) =>
      b.stickerInProduction - a.stickerInProduction || b.totalInProduction - a.totalInProduction
  )
}

export function WorkshopWarehousePage() {
  const [filter, setFilter] = useState<StockFilter>("stickers")
  const [waitingFilter, setWaitingFilter] = useState<WaitingFilter>("all")
  const [mainTab, setMainTab] = useState<MainTab>("cells")
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stockRows, setStockRows] = useState<WorkshopStockRow[]>([])
  const [waitingCells, setWaitingCells] = useState<WmsLocationRow[]>([])
  const [workshopRacks, setWorkshopRacks] = useState<RackDirectoryRow[]>([])
  const [waitingCreateOpen, setWaitingCreateOpen] = useState(false)
  const [rackCreateOpen, setRackCreateOpen] = useState(false)
  const [fillCell, setFillCell] = useState<WmsLocationRow | null>(null)
  const [fillOpen, setFillOpen] = useState(false)
  const [consumeCell, setConsumeCell] = useState<WmsLocationRow | null>(null)
  const [consumeOpen, setConsumeOpen] = useState(false)
  const [writeoffCell, setWriteoffCell] = useState<WmsLocationRow | null>(null)
  const [writeoffOpen, setWriteoffOpen] = useState(false)
  const [returnCell, setReturnCell] = useState<WmsLocationRow | null>(null)
  const [returnOpen, setReturnOpen] = useState(false)
  const [activePlans, setActivePlans] = useState<ProductionPlanRow[]>([])
  const [productionLines, setProductionLines] = useState<WorkshopLineOption[]>([])
  const [summary, setSummary] = useState({
    locationCount: 0,
    stickerInProduction: 0,
    totalMarkingCodes: 0,
    lowStockCells: 0,
  })

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const item = (sp.get("item") || sp.get("q") || "").trim()
    if (item) setQuery(item)
  }, [])

  const stickersOnly = filter === "stickers"

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const [stock, locations, racksRes, whRes] = await Promise.all([
          getWorkshopStockOverview({ stickersOnly }),
          // lite: без подзапросов сроков на каждую ячейку и без UPDATE handoff.
          // Один проход; номенклатуру в пилюле берём из остатков цеха.
          listLocations({ workshopOnly: true, limit: 500, lite: true }),
          listDirectoryRacks({ includeCells: true }),
          listDirectoryWarehouses(),
        ])
        setStockRows(stock.rows)
        setSummary({
          locationCount: stock.summary.locationCount,
          stickerInProduction: stock.summary.stickerInProduction,
          totalMarkingCodes: stock.summary.totalMarkingCodes ?? 0,
          lowStockCells: stock.summary.lowStockCells,
        })
        const workshopWh = new Set(
          (whRes.warehouses ?? [])
            .filter(isWorkshopDirectoryRow)
            .map((w) => w.code?.trim().toUpperCase())
            .filter(Boolean)
        )
        const itemByLoc = new Map<string, { itemCode: string; itemName: string; qty: number }>()
        for (const row of stock.rows) {
          const code = (row.locationCode ?? "").trim().toUpperCase()
          if (!code) continue
          const qty = (row.inProductionQty ?? 0) + (row.availableQty ?? 0)
          const prev = itemByLoc.get(code)
          if (!prev || qty > prev.qty) {
            itemByLoc.set(code, { itemCode: row.itemCode, itemName: row.itemName, qty })
          }
        }
        const byCode = new Map<string, WmsLocationRow>()
        const consider = (raw: WmsLocationRow) => {
          const code = (raw.locationCode ?? "").trim().toUpperCase()
          if (!code) return
          const hit = itemByLoc.get(code)
          const loc = hit
            ? { ...raw, occupiedItemCode: hit.itemCode, occupiedItemName: hit.itemName }
            : raw
          const isWaiting =
            loc.isWaitingPoint === true || loc.slotProfile?.storagePurpose === "WAITING"
          const wh = (loc.warehouseCode ?? "").trim().toUpperCase()
          const inWorkshopWh = !wh || workshopWh.size === 0 || workshopWh.has(wh)
          const occupied = !isWaitingCellEffectivelyEmpty(loc)
          if (!isWaiting && !(inWorkshopWh && occupied)) return
          const prev = byCode.get(code)
          if (!prev || occupied) byCode.set(code, loc)
        }
        for (const loc of locations.locations ?? []) consider(loc)
        setWaitingCells(
          Array.from(byCode.values()).sort((a, b) =>
            compareSequentialCellCodes(a.locationCode ?? "", b.locationCode ?? "")
          )
        )
        setWorkshopRacks(
          (racksRes.racks ?? []).filter(
            (rack) =>
              rack.isActive &&
              (!rack.warehouseCode || workshopWh.has(rack.warehouseCode.trim().toUpperCase()))
          )
        )
      } catch (e) {
        setError(mapWmsError(e))
      } finally {
        setLoading(false)
        setRefreshing(false)
      }

      try {
        const planTo = new Date()
        planTo.setDate(planTo.getDate() + 45)
        const planFrom = new Date()
        planFrom.setDate(planFrom.getDate() - 14)
        const [plansRes, linesRes] = await Promise.all([
          listProductionPlans({
            from: planFrom.toISOString().slice(0, 10),
            to: planTo.toISOString().slice(0, 10),
            includeMaterials: true,
          }).catch(() => ({ plans: [] as ProductionPlanRow[] })),
          listDirectoryProductionLines({ activeOnly: true }).catch(() => ({ lines: [] })),
        ])
        setActivePlans(plansRes.plans ?? [])
        setProductionLines(
          (linesRes.lines ?? []).map((line) => ({
            lineLabel: line.displayName || line.code,
            lineCode: line.code,
          }))
        )
      } catch {
        /* планы не блокируют сетку ячеек */
      }
    },
    [stickersOnly]
  )

  useEffect(() => {
    void load()
  }, [load])

  const lineGroups = useMemo(() => groupStockRows(stockRows), [stockRows])
  const workshopQtyByItem = useMemo(() => buildWorkshopQtyByItem(stockRows), [stockRows])

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return lineGroups
    return lineGroups.filter((line) => {
      if (locationCodeMatchesQuery(line.locationCode, q)) return true
      if (line.displayName.toLowerCase().includes(q)) return true
      if (line.lineLabel.toLowerCase().includes(q)) return true
      return line.items.some(
        (item) =>
          item.itemCode.toLowerCase().includes(q) || item.itemName.toLowerCase().includes(q)
      )
    })
  }, [lineGroups, query])

  const filteredRacks = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return workshopRacks
    return workshopRacks.filter((rack) => {
      if (rack.code.toLowerCase().includes(q)) return true
      if (rack.name.toLowerCase().includes(q)) return true
      return (rack.cells ?? []).some((c) => locationCodeMatchesQuery(c.locationCode, q))
    })
  }, [workshopRacks, query])

  const filteredWaiting = useMemo(() => {
    const q = query.trim().toLowerCase()
    return waitingCells.filter((loc) => {
      if (waitingFilter === "occupied" && isWaitingCellEffectivelyEmpty(loc)) return false
      if (waitingFilter === "empty" && !isWaitingCellEffectivelyEmpty(loc)) return false
      if (!q) return true
      const name = (loc.displayName ?? "").toLowerCase()
      const occupied = (loc.occupiedItemName ?? loc.occupiedItemCode ?? "").toLowerCase()
      return (
        locationCodeMatchesQuery(loc.locationCode ?? "", q) ||
        name.includes(q) ||
        occupied.includes(q)
      )
    })
  }, [waitingCells, query, waitingFilter])

  const waitingCounts = useMemo(() => {
    const occupied = waitingCells.filter((loc) => !isWaitingCellEffectivelyEmpty(loc)).length
    return {
      all: waitingCells.length,
      occupied,
      empty: waitingCells.length - occupied,
    }
  }, [waitingCells])

  const workshopLineOptions = useMemo((): WorkshopLineOption[] => {
    if (productionLines.length > 0) return productionLines
    // fallback, если справочник ещё недоступен
    const map = new Map<string, WorkshopLineOption>()
    for (const row of stockRows) {
      const label = row.lineLabel?.trim()
      if (!label) continue
      if (!map.has(label)) {
        map.set(label, { lineLabel: label, lineCode: label, locationCode: row.locationCode })
      }
    }
    return Array.from(map.values())
  }, [productionLines, stockRows])

  function openCellFill(loc: WmsLocationRow) {
    if (isCalendarExpiryPast(loc.nearestExpiryAt)) return
    setFillCell(loc)
    setFillOpen(true)
  }

  function openCellConsume(loc: WmsLocationRow) {
    if (isCalendarExpiryPast(loc.nearestExpiryAt)) return
    setConsumeCell(loc)
    setConsumeOpen(true)
  }

  function openCellWriteoff(loc: WmsLocationRow) {
    setWriteoffCell(loc)
    setWriteoffOpen(true)
  }

  function openCellReturn(loc: WmsLocationRow) {
    if (isCalendarExpiryPast(loc.nearestExpiryAt)) return
    setReturnCell(loc)
    setReturnOpen(true)
  }

  return (
    <div>
      {error ? (
        <WmsErrorState
          className="mb-4"
          title="Не удалось загрузить цех"
          message={error}
          onRetry={() => void load()}
        />
      ) : null}

      <section className="wms-panel overflow-hidden">
        <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as MainTab)} className="gap-0">
          <div className="flex flex-col gap-3 border-b border-border bg-muted/20 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="mr-1 text-base font-semibold tracking-tight text-foreground">Цех</h1>
              <span className="hidden h-4 w-px bg-border sm:block" aria-hidden />
              <TabsList className="h-auto flex-wrap justify-start gap-0.5 rounded-lg bg-transparent p-0">
                <TabsTrigger
                  value="cells"
                  className="rounded-md px-3 py-1.5 text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none"
                >
                  Ячейки
                </TabsTrigger>
                <TabsTrigger
                  value="racks"
                  className="rounded-md px-3 py-1.5 text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none"
                >
                  Стеллажи
                </TabsTrigger>
                <TabsTrigger
                  value="stock"
                  className="rounded-md px-3 py-1.5 text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none"
                >
                  Остатки
                </TabsTrigger>
              </TabsList>
              <span className="hidden h-4 w-px bg-border sm:block" aria-hidden />
              <div className="flex gap-0.5">
                <Button
                  type="button"
                  variant={filter === "stickers" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 rounded-md px-2.5 text-xs"
                  onClick={() => setFilter("stickers")}
                >
                  Стикеры
                </Button>
                <Button
                  type="button"
                  variant={filter === "all" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 rounded-md px-2.5 text-xs"
                  onClick={() => setFilter("all")}
                >
                  Все материалы
                </Button>
              </div>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
              <div className="relative min-w-[12rem] flex-1 lg:w-64 lg:flex-none">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Поиск…"
                  className="h-9 rounded-lg bg-card pl-9 shadow-sm"
                />
              </div>
              <span className="tabular-nums text-xs text-muted-foreground">
                {loading
                  ? "…"
                  : `${waitingCounts.occupied} зан. · ${waitingCounts.empty} пуст. · ${fmtQty(summary.stickerInProduction)} стик.`}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() => setRackCreateOpen(true)}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Стеллаж
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() => setWaitingCreateOpen(true)}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Точки
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 rounded-lg"
                onClick={() => void load(true)}
                disabled={refreshing || loading}
              >
                <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", (refreshing || loading) && "animate-spin")} />
                Обновить
              </Button>
            </div>
          </div>

          <TabsContent value="cells" className="mt-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
              {(
                [
                  ["all", `Все ${waitingCounts.all}`],
                  ["occupied", `Занятые ${waitingCounts.occupied}`],
                  ["empty", `Пустые ${waitingCounts.empty}`],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  variant={waitingFilter === value ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 rounded-md px-2.5 text-xs"
                  onClick={() => setWaitingFilter(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <div className="max-h-[min(82vh,960px)] overflow-auto">
              {loading ? (
                <WmsTableSkeleton rows={10} columns={7} />
              ) : filteredWaiting.length === 0 ? (
                <WmsEmptyState
                  title={waitingCells.length === 0 ? "Нет точек ожидания" : "Ничего не найдено"}
                  description={
                    waitingCells.length === 0
                      ? "Создайте точки ожидания кнопкой «Точки»."
                      : "Измените поиск или фильтр."
                  }
                  action={
                    waitingCells.length === 0 ? (
                      <Button variant="outline" className="rounded-lg" onClick={() => setWaitingCreateOpen(true)}>
                        Создать точки
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <table className="wms-ag-grid">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="w-[5.5rem]">Ячейка</th>
                      <th className="min-w-[6rem]">Статус</th>
                      <th className="min-w-[6rem]">Линия</th>
                      <th className="min-w-[14rem]">Номенклатура</th>
                      <th className="text-right">Остаток</th>
                      <th className="min-w-[7rem]">Годен до</th>
                      <th className="w-[9.5rem] text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredWaiting.map((loc) => {
                      const code = loc.locationCode ?? ""
                      const empty = isWaitingCellEffectivelyEmpty(loc)
                      const onHand = locationOnHandQty(loc)
                      const expiryLabel = fmtExpiryDate(loc.nearestExpiryAt)
                      const expired = !empty && isCalendarExpiryPast(loc.nearestExpiryAt)
                      const handoff = empty ? null : (loc.waitingHandoff ?? null)
                      const handedToProduction =
                        !empty && (loc.isHandedToProduction === true || handoff != null)
                      const itemLabel = loc.occupiedItemName || loc.occupiedItemCode || "—"
                      const lineLabel =
                        handoff?.lineCode ||
                        (!empty &&
                        !(
                          loc.isWaitingPoint === true ||
                          loc.slotProfile?.storagePurpose === "WAITING"
                        )
                          ? "в цеху"
                          : "—")
                      const planContext = findPlanContextForWaitingCell({
                        cellItemCode: loc.occupiedItemCode,
                        handoffLineCode: handoff?.lineCode,
                        handoffPlanCode: handoff?.planCode,
                        inCellQty: onHand,
                        plans: activePlans,
                        workshopQtyByItem,
                      })
                      return (
                        <tr
                          key={code}
                          className={cn(
                            "wms-ag-row",
                            expired && "bg-destructive/5",
                            !empty && !expired && "bg-primary/10",
                            handedToProduction && !expired && "bg-primary/[0.03]"
                          )}
                        >
                          <td>
                            <Link
                              href={`/cells?locationCode=${encodeURIComponent(code)}`}
                              className="font-mono text-xs font-semibold hover:underline"
                            >
                              {code}
                            </Link>
                          </td>
                          <td className="text-xs">
                            {expired ? (
                              <Badge variant="destructive" className="rounded-md text-[10px]">
                                Просрочено
                              </Badge>
                            ) : empty ? (
                              <span className="text-muted-foreground">Пусто</span>
                            ) : handedToProduction ? (
                              <Badge variant="secondary" className="rounded-md text-[10px]">
                                В пр-ве
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="rounded-md text-[10px]">
                                Занято
                              </Badge>
                            )}
                          </td>
                          <td className="font-mono text-xs text-muted-foreground">{lineLabel}</td>
                          <td>
                            {empty ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium leading-snug">{itemLabel}</p>
                                {loc.occupiedItemCode && loc.occupiedItemName ? (
                                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                                    {loc.occupiedItemCode}
                                  </p>
                                ) : null}
                                {planContext ? (
                                  <div className="mt-1">
                                    <WaitingCellPlanHint
                                      planProductName={
                                        handoff?.planProductName ||
                                        planContext.plan.itemName ||
                                        planContext.plan.code
                                      }
                                      planCode={planContext.plan.code}
                                      inCellQty={planContext.inCellQty}
                                      workshopQty={planContext.workshopQty}
                                      needFromWarehouse={planContext.needFromWarehouse}
                                      materialShortage={planContext.material.shortageQty}
                                      inProduction={planContext.plan.status === "in_progress"}
                                    />
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </td>
                          <td className="wms-ag-cell-num font-semibold">
                            {empty ? "—" : fmtQty(onHand)}
                          </td>
                          <td
                            className={cn(
                              "text-xs tabular-nums",
                              expired ? "font-medium text-destructive" : "text-muted-foreground"
                            )}
                          >
                            {expiryLabel ?? "—"}
                          </td>
                          <td>
                            <div className="flex justify-end gap-0.5">
                              {!empty && expired ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive"
                                  title="Списать просроченный остаток"
                                  onClick={() => openCellWriteoff(loc)}
                                >
                                  <MinusCircle className="h-3.5 w-3.5" />
                                </Button>
                              ) : null}
                              {!empty && !expired ? (
                                <>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    title="Передать на линию"
                                    onClick={() => openCellConsume(loc)}
                                  >
                                    <ArrowDownToLine className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    title="Списание"
                                    onClick={() => openCellWriteoff(loc)}
                                  >
                                    <MinusCircle className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    title="Вернуть на склад"
                                    onClick={() => openCellReturn(loc)}
                                  >
                                    <Undo2 className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    title="Добавить"
                                    onClick={() => openCellFill(loc)}
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              ) : null}
                              {empty ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  title="Заполнить"
                                  onClick={() => openCellFill(loc)}
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </TabsContent>

          <TabsContent value="racks" className="mt-0">
            <div className="max-h-[min(82vh,960px)] overflow-auto">
              {loading ? (
                <WmsTableSkeleton rows={6} columns={4} />
              ) : filteredRacks.length === 0 ? (
                <WmsEmptyState
                  title="Нет стеллажей"
                  description="Создайте стеллаж — ячейки сразу попадут внутрь."
                  action={
                    <Button variant="outline" className="rounded-lg" onClick={() => setRackCreateOpen(true)}>
                      + Стеллаж
                    </Button>
                  }
                />
              ) : (
                <table className="wms-ag-grid">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="min-w-[10rem]">Стеллаж</th>
                      <th>Код</th>
                      <th className="text-right">Ячеек</th>
                      <th className="min-w-[12rem]">Ячейки</th>
                      <th className="w-28 text-right">QR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRacks.map((rack) => {
                      const cellCodes = (rack.cells ?? []).map((c) => c.locationCode)
                      return (
                        <tr key={rack.code} className="wms-ag-row">
                          <td>
                            <div className="flex items-center gap-2">
                              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="font-medium">{rack.name}</span>
                            </div>
                          </td>
                          <td className="font-mono text-xs text-muted-foreground">{rack.code}</td>
                          <td className="wms-ag-cell-num">{rack.cellCount}</td>
                          <td className="truncate font-mono text-[11px] text-muted-foreground">
                            {cellCodes.slice(0, 10).join(", ")}
                            {cellCodes.length > 10 ? ` … +${cellCodes.length - 10}` : ""}
                          </td>
                          <td className="text-right">
                            <RackBarcode rackCode={rack.code} rackName={rack.name} cellCodes={cellCodes} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </TabsContent>

          <TabsContent value="stock" className="mt-0">
            <div className="max-h-[min(82vh,960px)] overflow-auto">
              {loading ? (
                <WmsTableSkeleton rows={8} columns={5} />
              ) : filteredGroups.length === 0 ? (
                <WmsEmptyState
                  title="В цеху нет остатков"
                  description="Остатки появятся после списания с линии или перемещения материалов в цех."
                />
              ) : (
                <table className="wms-ag-grid">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="min-w-[8rem]">Линия / ячейка</th>
                      <th className="min-w-[14rem]">Номенклатура</th>
                      <th className="text-right">В цеху</th>
                      <th className="text-right">Коды ЧЗ</th>
                      <th className="w-28" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredGroups.flatMap((line) =>
                      line.items.map((item, idx) => (
                        <tr key={`${line.key}:${item.itemCode}`} className="wms-ag-row">
                          <td>
                            {idx === 0 ? (
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <Factory className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                  <Link
                                    href={`/cells?locationCode=${encodeURIComponent(line.locationCode)}`}
                                    className="font-medium hover:underline"
                                  >
                                    {line.lineLabel}
                                  </Link>
                                  {line.stickerInProduction > 0 ? (
                                    <Badge variant="secondary" className="rounded-md text-[10px]">
                                      <Sticker className="mr-0.5 h-3 w-3" />
                                      {fmtQty(line.stickerInProduction)}
                                    </Badge>
                                  ) : null}
                                </div>
                                <p className="font-mono text-[11px] text-muted-foreground">
                                  {line.locationCode}
                                </p>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">↳</span>
                            )}
                          </td>
                          <td>
                            <p className="truncate text-sm font-medium">{item.itemName}</p>
                            <p className="truncate font-mono text-[11px] text-muted-foreground">
                              {item.itemCode}
                            </p>
                          </td>
                          <td className="wms-ag-cell-num font-semibold">
                            {fmtQty(item.inProductionQty)}
                          </td>
                          <td className="wms-ag-cell-num text-muted-foreground">
                            {(item.markingCodesCount ?? 0) > 0
                              ? fmtQty(item.markingCodesCount ?? 0)
                              : "—"}
                          </td>
                          <td className="text-right">
                            {idx === 0 ? (
                              <WorkshopCodesPanel
                                compact
                                locationCode={line.locationCode}
                                title={`Коды · ${line.lineLabel}`}
                              />
                            ) : null}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </section>

      {!loading && !error ? (
        <div className="mt-4 space-y-4">
          <WorkshopPlansPanel plans={activePlans} />
          <WorkshopProductPartsScheme />
        </div>
      ) : null}

      <WorkshopCellFillDialog
        open={fillOpen}
        onOpenChange={setFillOpen}
        location={fillCell}
        onFilled={() => void load(true)}
      />

      <WorkshopWaitingConsumeDialog
        open={consumeOpen}
        onOpenChange={setConsumeOpen}
        location={consumeCell}
        lineOptions={workshopLineOptions}
        activePlans={activePlans}
        onConfirmed={(payload) => {
          setWaitingCells((prev) =>
            prev.map((loc) =>
              (loc.locationCode ?? "") === payload.locationCode
                ? {
                    ...loc,
                    waitingHandoff: payload.waitingHandoff,
                    isHandedToProduction: true,
                  }
                : loc
            )
          )
          void load(true)
        }}
      />

      <WorkshopWaitingWriteoffDialog
        open={writeoffOpen}
        onOpenChange={setWriteoffOpen}
        location={writeoffCell}
        onDone={() => void load(true)}
      />

      <WorkshopWaitingReturnDialog
        open={returnOpen}
        onOpenChange={setReturnOpen}
        location={returnCell}
        onDone={() => void load(true)}
      />

      <WaitingCellsCreateDialog
        open={waitingCreateOpen}
        onOpenChange={setWaitingCreateOpen}
        onCreated={() => void load(true)}
      />

      <WorkshopRackCreateDialog
        open={rackCreateOpen}
        onOpenChange={setRackCreateOpen}
        onCreated={() => void load(true)}
      />
    </div>
  )
}
