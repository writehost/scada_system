"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowDownRight,
  Factory,
  Package,
  RefreshCw,
  ScanBarcode,
  Sticker,
  TrendingDown,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import {
  consumeProductionLineStock,
  getWorkshopStockOverview,
  listProductionConsumptions,
  postPosIssue,
  type ProductionConsumptionFeedRow,
  type WorkshopStockRow,
} from "@/lib/wms-api"
import {
  WmsEmptyState,
  WmsErrorState,
  WmsLoadingState,
  WmsPageShell,
  WmsTableSkeleton,
} from "@/components/wms/wms-shared"
import { mapWmsError } from "@/lib/wms-error-messages"
import { useToast } from "@/hooks/use-toast"
import { WorkshopCodesPanel } from "@/components/wms/workshop-codes-panel"

type StockFilter = "stickers" | "all"
type LineGroup = {
  key: string
  lineLabel: string
  locationCode: string
  displayName: string
  items: WorkshopStockRow[]
  totalInProduction: number
  stickerInProduction: number
}

const LOW_STICKER_THRESHOLD = 500
const REFRESH_MS = 10_000

function fmtQty(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value)
}

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  } catch {
    return "—"
  }
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
  return Array.from(map.values()).sort((a, b) => b.stickerInProduction - a.stickerInProduction || b.totalInProduction - a.totalInProduction)
}

function ConsumptionFeedItem({ row }: { row: ProductionConsumptionFeedRow }) {
  return (
    <div className="border-border/60 flex gap-3 border-b px-4 py-3 last:border-b-0">
      <div className="bg-destructive/10 text-destructive mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
        <ArrowDownRight className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{row.itemName}</span>
          {row.isSticker ? (
            <Badge variant="secondary" className="rounded-md text-[10px] uppercase">
              стикеры
            </Badge>
          ) : null}
          <span className="text-muted-foreground text-xs">{fmtTime(row.createdAt)}</span>
        </div>
        <p className="text-muted-foreground mt-0.5 text-sm">
          −{fmtQty(row.qty)} шт · {row.lineCode || row.displayName || row.locationCode}
        </p>
        <p className="text-muted-foreground truncate text-xs">
          {row.itemCode}
          {row.mode === "datamatrix" ? " · DataMatrix" : ""}
          {row.sourceSystem ? ` · ${row.sourceSystem}` : ""}
        </p>
      </div>
    </div>
  )
}

export function MarkingOperatorPage() {
  const { toast } = useToast()
  const [filter, setFilter] = useState<StockFilter>("stickers")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stockRows, setStockRows] = useState<WorkshopStockRow[]>([])
  const [stockSummary, setStockSummary] = useState({
    locationCount: 0,
    stickerInProduction: 0,
    totalMarkingCodes: 0,
    lowStockCells: 0,
  })
  const [consumptions, setConsumptions] = useState<ProductionConsumptionFeedRow[]>([])
  const [todayConsumed, setTodayConsumed] = useState(0)
  const [selectedLine, setSelectedLine] = useState<LineGroup | null>(null)
  const [issueOpen, setIssueOpen] = useState(false)
  const [issueItemCode, setIssueItemCode] = useState("")
  const [issueQty, setIssueQty] = useState("1000")
  const [issueTarget, setIssueTarget] = useState("")
  const [issueLineName, setIssueLineName] = useState("")
  const [issueBusy, setIssueBusy] = useState(false)
  const [consumeOpen, setConsumeOpen] = useState(false)
  const [consumeItemCode, setConsumeItemCode] = useState("")
  const [consumeQty, setConsumeQty] = useState("1")
  const [consumeLocation, setConsumeLocation] = useState("")
  const [consumeBusy, setConsumeBusy] = useState(false)

  const stickersOnly = filter === "stickers"

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      const [stock, feed] = await Promise.all([
        getWorkshopStockOverview({ stickersOnly }),
        listProductionConsumptions({ limit: 50, stickersOnly }),
      ])
      setStockRows(stock.rows)
      setStockSummary({
        locationCount: stock.summary.locationCount,
        stickerInProduction: stock.summary.stickerInProduction,
        totalMarkingCodes: stock.summary.totalMarkingCodes ?? 0,
        lowStockCells: stock.summary.lowStockCells,
      })
      setConsumptions(feed.consumptions)
      setTodayConsumed(feed.summary.todayQty)
    } catch (e) {
      setError(mapWmsError(e))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [stickersOnly])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const id = window.setInterval(() => void load(true), REFRESH_MS)
    return () => window.clearInterval(id)
  }, [load])

  const lineGroups = useMemo(() => groupStockRows(stockRows), [stockRows])

  function openIssueDialog(line: LineGroup, item?: WorkshopStockRow) {
    setSelectedLine(line)
    setIssueTarget(line.locationCode)
    setIssueLineName(line.lineLabel)
    setIssueItemCode(item?.itemCode ?? line.items.find((x) => x.isSticker)?.itemCode ?? line.items[0]?.itemCode ?? "")
    setIssueOpen(true)
  }

  function openConsumeDialog(line: LineGroup, item?: WorkshopStockRow) {
    setSelectedLine(line)
    setConsumeLocation(line.locationCode)
    setConsumeItemCode(item?.itemCode ?? line.items[0]?.itemCode ?? "")
    setConsumeQty("1")
    setConsumeOpen(true)
  }

  async function submitIssue() {
    const qty = Number(issueQty)
    if (!issueItemCode.trim() || !issueTarget.trim() || !(qty > 0)) {
      toast({ title: "Заполните номенклатуру, ячейку и количество", variant: "destructive" })
      return
    }
    setIssueBusy(true)
    try {
      const result = await postPosIssue({
        itemCode: issueItemCode.trim(),
        qty,
        recipientName: "Маркировщик",
        targetLocationCode: issueTarget.trim(),
        lineName: issueLineName.trim() || undefined,
      })
      toast({
        title: "Выдача оформлена",
        description: `${result.itemName}: ${fmtQty(result.issuedQty)} шт → ${result.targetLocationCode}`,
      })
      setIssueOpen(false)
      await load(true)
    } catch (e) {
      toast({ title: "Ошибка выдачи", description: mapWmsError(e), variant: "destructive" })
    } finally {
      setIssueBusy(false)
    }
  }

  async function submitConsume() {
    const qty = Number(consumeQty)
    if (!consumeLocation.trim() || !consumeItemCode.trim() || !(qty > 0)) {
      toast({ title: "Укажите ячейку, номенклатуру и количество", variant: "destructive" })
      return
    }
    setConsumeBusy(true)
    try {
      const result = await consumeProductionLineStock({
        locationCode: consumeLocation.trim(),
        itemCode: consumeItemCode.trim(),
        qty,
        lineCode: selectedLine?.lineLabel,
        operatorName: "marking-panel",
        sourceSystem: "marking-panel",
      })
      toast({
        title: result.disposition === "duplicate" ? "Уже списано" : "Списание выполнено",
        description: `${result.itemName ?? consumeItemCode}: −${fmtQty(result.qty ?? qty)} шт`,
      })
      setConsumeOpen(false)
      await load(true)
    } catch (e) {
      toast({ title: "Ошибка списания", description: mapWmsError(e), variant: "destructive" })
    } finally {
      setConsumeBusy(false)
    }
  }

  return (
    <WmsPageShell
      title="Панель маркировщика"
      description="Остатки в цеху и расход стикеров на линиях в реальном времени. Запрос выдачи со склада или ручное списание."
      actions={
        <>
          <Tabs value={filter} onValueChange={(v) => setFilter(v as StockFilter)}>
            <TabsList className="rounded-xl">
              <TabsTrigger value="stickers" className="rounded-lg">
                Стикеры
              </TabsTrigger>
              <TabsTrigger value="all" className="rounded-lg">
                Все материалы
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" className="rounded-xl" onClick={() => void load(true)} disabled={refreshing}>
            <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} />
            Обновить
          </Button>
          <Button asChild className="rounded-xl">
            <Link href="/pos-terminal" target="_blank" rel="noopener noreferrer">
              <ScanBarcode className="mr-2 h-4 w-4" />
              POS-терминал
            </Link>
          </Button>
        </>
      }
    >
      {loading ? (
        <WmsLoadingState label="Загружаю остатки цеха и расход линий..." />
      ) : error ? (
        <WmsErrorState title="Не удалось загрузить панель" message={error} onRetry={() => void load()} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="wms-metric-card">
              <p className="text-muted-foreground text-xs uppercase tracking-wide">Ячеек в цеху</p>
              <p className="mt-1 text-2xl font-semibold">{stockSummary.locationCount}</p>
            </div>
            <div className="wms-metric-card">
              <p className="text-muted-foreground text-xs uppercase tracking-wide">Стикеры в цеху</p>
              <p className="mt-1 text-2xl font-semibold">{fmtQty(stockSummary.stickerInProduction)}</p>
            </div>
            <div className="wms-metric-card">
              <p className="text-muted-foreground text-xs uppercase tracking-wide">Списано сегодня</p>
              <p className="mt-1 flex items-center gap-2 text-2xl font-semibold">
                <TrendingDown className="text-destructive h-5 w-5" />
                {fmtQty(todayConsumed)}
              </p>
            </div>
            <div className="wms-metric-card">
              <p className="text-muted-foreground text-xs uppercase tracking-wide">Кодов в цеху</p>
              <p className="mt-1 text-2xl font-semibold">{fmtQty(stockSummary.totalMarkingCodes)}</p>
            </div>
            <div className={cn("wms-metric-card", stockSummary.lowStockCells > 0 && "border-amber-500/40 bg-amber-500/5")}>
              <p className="text-muted-foreground text-xs uppercase tracking-wide">Низкий остаток</p>
              <p className="mt-1 flex items-center gap-2 text-2xl font-semibold">
                {stockSummary.lowStockCells > 0 ? (
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                ) : (
                  <Sticker className="text-muted-foreground h-5 w-5" />
                )}
                {stockSummary.lowStockCells}
              </p>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="wms-panel overflow-hidden">
              <div className="border-border/60 flex items-center justify-between border-b px-4 py-3">
                <div>
                  <h3 className="font-semibold">Остатки в цеху</h3>
                  <p className="text-muted-foreground text-sm">По ячейкам линий и производственным зонам</p>
                </div>
                <Badge variant="outline" className="rounded-lg">
                  {lineGroups.length} линий
                </Badge>
              </div>
              {lineGroups.length === 0 ? (
                <WmsEmptyState
                  title="В цеху нет остатков"
                  description="Остатки появятся после списания с линии или перемещения материалов в цех."
                />
              ) : (
                <div className="max-h-[620px] overflow-auto">
                  {lineGroups.map((line) => {
                    const low = line.stickerInProduction > 0 && line.stickerInProduction <= LOW_STICKER_THRESHOLD
                    return (
                      <div key={line.key} className="border-border/60 border-b px-4 py-4 last:border-b-0">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Factory className="text-primary h-4 w-4 shrink-0" />
                              <h4 className="font-medium">{line.lineLabel}</h4>
                              {low ? (
                                <Badge className="rounded-md bg-amber-500/15 text-amber-800 hover:bg-amber-500/15">
                                  мало стикеров
                                </Badge>
                              ) : null}
                            </div>
                            <p className="text-muted-foreground mt-1 text-sm">{line.displayName || line.locationCode}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <WorkshopCodesPanel
                              compact
                              locationCode={line.locationCode}
                              title={`Коды · ${line.lineLabel}`}
                            />
                            <Button size="sm" variant="outline" className="rounded-lg" onClick={() => openIssueDialog(line)}>
                              <Package className="mr-1.5 h-3.5 w-3.5" />
                              Запросить
                            </Button>
                            <Button size="sm" variant="ghost" className="rounded-lg" onClick={() => openConsumeDialog(line)}>
                              Списать
                            </Button>
                          </div>
                        </div>
                        <div className="mt-3 space-y-2">
                          {line.items.map((item) => (
                            <button
                              key={`${line.key}:${item.itemCode}`}
                              type="button"
                              className="hover:bg-muted/50 flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition-colors"
                              onClick={() => openIssueDialog(line, item)}
                            >
                              <div className="min-w-0">
                                <p className="truncate font-medium">{item.itemName}</p>
                                <p className="text-muted-foreground truncate text-xs">{item.itemCode}</p>
                              </div>
                              <div className="ml-3 shrink-0 text-right">
                                <p className="text-lg font-semibold tabular-nums">{fmtQty(item.inProductionQty)}</p>
                                <p className="text-muted-foreground text-[11px]">
                                  в цеху
                                  {(item.markingCodesCount ?? 0) > 0
                                    ? ` · ${fmtQty(item.markingCodesCount ?? 0)} код.`
                                    : ""}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            <section className="wms-panel overflow-hidden">
              <div className="border-border/60 flex items-center justify-between border-b px-4 py-3">
                <div>
                  <h3 className="font-semibold">Расход в реальном времени</h3>
                  <p className="text-muted-foreground text-sm">Обновление каждые {REFRESH_MS / 1000} сек</p>
                </div>
                <span className="bg-success/10 text-success rounded-full px-2 py-1 text-xs font-medium">live</span>
              </div>
              {consumptions.length === 0 ? (
                <div className="p-6">
                  <WmsTableSkeleton rows={5} columns={1} />
                  <p className="text-muted-foreground mt-4 text-center text-sm">Списаний пока нет — лента появится при расходе на линиях</p>
                </div>
              ) : (
                <div className="max-h-[620px] overflow-auto">
                  {consumptions.map((row) => (
                    <ConsumptionFeedItem key={row.consumptionId} row={row} />
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="wms-panel rounded-2xl p-4">
            <WorkshopCodesPanel title="Все коды маркировки в цеху" maxRows={100} />
          </section>
        </div>
      )}

      <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Запрос выдачи на линию</DialogTitle>
            <DialogDescription>
              POS-выдача со склада материалов в ячейку цеха. Линия: {issueLineName || "—"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="issue-item">Номенклатура</Label>
              <Input id="issue-item" value={issueItemCode} onChange={(e) => setIssueItemCode(e.target.value)} className="rounded-xl" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="issue-target">Ячейка цеха (куда)</Label>
              <Input id="issue-target" value={issueTarget} onChange={(e) => setIssueTarget(e.target.value)} className="rounded-xl" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="issue-qty">Количество</Label>
              <Input id="issue-qty" inputMode="numeric" value={issueQty} onChange={(e) => setIssueQty(e.target.value)} className="rounded-xl" />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" className="rounded-xl" onClick={() => setIssueOpen(false)}>
              Отмена
            </Button>
            <Button className="rounded-xl" disabled={issueBusy} onClick={() => void submitIssue()}>
              {issueBusy ? "Оформляю..." : "Выдать на линию"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={consumeOpen} onOpenChange={setConsumeOpen}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ручное списание</DialogTitle>
            <DialogDescription>Списание из поля «в цеху» по количеству (без DataMatrix).</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="consume-location">Ячейка</Label>
              <Input id="consume-location" value={consumeLocation} onChange={(e) => setConsumeLocation(e.target.value)} className="rounded-xl" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="consume-item">Номенклатура</Label>
              <Input id="consume-item" value={consumeItemCode} onChange={(e) => setConsumeItemCode(e.target.value)} className="rounded-xl" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="consume-qty">Количество</Label>
              <Input id="consume-qty" inputMode="numeric" value={consumeQty} onChange={(e) => setConsumeQty(e.target.value)} className="rounded-xl" />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" className="rounded-xl" onClick={() => setConsumeOpen(false)}>
              Отмена
            </Button>
            <Button className="rounded-xl" disabled={consumeBusy} onClick={() => void submitConsume()}>
              {consumeBusy ? "Списываю..." : "Списать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WmsPageShell>
  )
}
