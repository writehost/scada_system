"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import {
  listFgWarehouseRowPallets,
  listFgWarehouseRows,
  lookupFgWarehouseCode,
} from "@/lib/wms-api"
import {
  fgTagLabel,
  fmtFgDate,
  fmtFgQty,
  type FgCodeLookupHit,
  type FgMarkingTag,
  type FgRowPalletSummary,
  type FgStorageRowSummary,
} from "@/lib/wms/finished-goods-types"
import { WmsEmptyState, WmsErrorState, WmsTableSkeleton } from "@/components/wms/wms-shared"

const PAGE_SIZE = 50

function tagVariant(tag: FgMarkingTag): "default" | "secondary" | "destructive" | "outline" {
  if (tag === "export") return "default"
  if (tag === "expiry-risk" || tag === "quarantine") return "destructive"
  if (tag === "promo") return "secondary"
  return "outline"
}

function TagBadges({ tags }: { tags: FgMarkingTag[] }) {
  if (tags.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <Badge key={t} variant={tagVariant(t)} className="rounded-md text-[10px] font-normal">
          {fgTagLabel(t)}
        </Badge>
      ))}
    </div>
  )
}

function FillBar({ percent }: { percent: number }) {
  return (
    <div className="flex min-w-[5rem] items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            percent >= 90 ? "bg-destructive" : percent >= 75 ? "bg-chart-4" : "bg-primary"
          )}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
      <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{percent}%</span>
    </div>
  )
}

function PalletSheet({
  pallet,
  row,
  open,
  onOpenChange,
}: {
  pallet: FgRowPalletSummary | null
  row: FgStorageRowSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!pallet || !row) return null
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-hidden sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-left font-mono text-base">{pallet.serialNumber}</SheetTitle>
          <SheetDescription className="text-left">
            {row.label} · поз. {pallet.position} · {pallet.itemName}
          </SheetDescription>
        </SheetHeader>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-xl bg-secondary/40 p-2">
            <p className="text-muted-foreground">Кодов ЧЗ</p>
            <p className="text-lg font-bold tabular-nums">{fmtFgQty(pallet.markingCodesCount)}</p>
          </div>
          <div className="rounded-xl bg-secondary/40 p-2">
            <p className="text-muted-foreground">Блоки</p>
            <p className="text-lg font-bold tabular-nums">{pallet.blocks}</p>
          </div>
          <div className="rounded-xl bg-secondary/40 p-2">
            <p className="text-muted-foreground">Бутылки</p>
            <p className="text-lg font-bold tabular-nums">{fmtFgQty(pallet.bottles)}</p>
          </div>
        </div>
        <div className="space-y-2 rounded-xl border border-border p-3 text-sm">
          <p className="break-all font-mono text-xs text-muted-foreground">{pallet.palletCode}</p>
          <p>
            Производство: <span className="font-medium">{fmtFgDate(pallet.producedAt)}</span>
          </p>
          <p>
            Годен до: <span className="font-medium">{fmtFgDate(pallet.expiresAt)}</span>
          </p>
          <TagBadges tags={pallet.tags} />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Детализация до блоков и бутылок — по скану или поиску кода. Полное дерево на палете не
          загружается (экономия трафика при ~{fmtFgQty(pallet.markingCodesCount)} кодах).
        </p>
      </SheetContent>
    </Sheet>
  )
}

export function FinishedGoodsRowsPanel() {
  const [rowFilter, setRowFilter] = useState("")
  const [tagFilter, setTagFilter] = useState<FgMarkingTag | "all">("all")
  const [rows, setRows] = useState<FgStorageRowSummary[]>([])
  const [rowsLoading, setRowsLoading] = useState(true)
  const [rowsError, setRowsError] = useState<string | null>(null)

  const [selectedRowId, setSelectedRowId] = useState<string | null>(null)
  const [palletPage, setPalletPage] = useState(1)
  const [palletQuery, setPalletQuery] = useState("")
  const [palletPageData, setPalletPageData] = useState<{
    items: FgRowPalletSummary[]
    total: number
    page: number
    pageSize: number
    totalPages: number
  } | null>(null)
  const [palletsLoading, setPalletsLoading] = useState(false)
  const [palletsError, setPalletsError] = useState<string | null>(null)
  const [palletReloadNonce, setPalletReloadNonce] = useState(0)

  const [codeSearch, setCodeSearch] = useState("")
  const [codeHit, setCodeHit] = useState<FgCodeLookupHit | null>(null)
  const [codeSearched, setCodeSearched] = useState(false)
  const [codeLoading, setCodeLoading] = useState(false)

  const [palletDetail, setPalletDetail] = useState<FgRowPalletSummary | null>(null)
  const [palletSheetOpen, setPalletSheetOpen] = useState(false)

  const loadRows = useCallback(async () => {
    setRowsLoading(true)
    setRowsError(null)
    try {
      const data = await listFgWarehouseRows({ query: rowFilter, tag: tagFilter })
      setRows(data.rows)
    } catch (e) {
      setRowsError(e instanceof Error ? e.message : "Ошибка загрузки")
      setRows([])
    } finally {
      setRowsLoading(false)
    }
  }, [rowFilter, tagFilter])

  useEffect(() => {
    const t = setTimeout(loadRows, 250)
    return () => clearTimeout(t)
  }, [loadRows])

  const selectedRow = useMemo(
    () => rows.find((r) => r.rowId === selectedRowId) ?? null,
    [rows, selectedRowId]
  )

  useEffect(() => {
    if (selectedRowId && !rows.some((r) => r.rowId === selectedRowId)) {
      setSelectedRowId(rows[0]?.rowId ?? null)
    } else if (!selectedRowId && rows.length > 0) {
      setSelectedRowId(rows[0].rowId)
    }
  }, [rows, selectedRowId])

  useEffect(() => {
    setPalletPage(1)
  }, [selectedRowId, palletQuery])

  useEffect(() => {
    if (!selectedRowId) {
      setPalletPageData(null)
      return
    }
    let cancelled = false
    setPalletsLoading(true)
    setPalletsError(null)
    listFgWarehouseRowPallets(selectedRowId, {
      page: palletPage,
      pageSize: PAGE_SIZE,
      query: palletQuery,
    })
      .then((data) => {
        if (!cancelled) setPalletPageData(data)
      })
      .catch((e) => {
        if (!cancelled) {
          setPalletPageData(null)
          setPalletsError(e instanceof Error ? e.message : "Не удалось загрузить палеты")
        }
      })
      .finally(() => {
        if (!cancelled) setPalletsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedRowId, palletPage, palletQuery, palletReloadNonce])

  function openPallet(p: FgRowPalletSummary) {
    setPalletDetail(p)
    setPalletSheetOpen(true)
  }

  async function runCodeSearch() {
    const q = codeSearch.trim()
    if (q.replace(/\s/g, "").length < 8) {
      setCodeHit(null)
      setCodeSearched(true)
      return
    }
    setCodeLoading(true)
    try {
      const data = await lookupFgWarehouseCode(q)
      setCodeHit(data.hit)
    } catch {
      setCodeHit(null)
    } finally {
      setCodeLoading(false)
      setCodeSearched(true)
    }
  }

  const warehouseTotals = useMemo(
    () => ({
      rows: rows.length,
      pallets: rows.reduce((s, r) => s + r.palletCount, 0),
      codes: rows.reduce((s, r) => s + r.markingCodesCount, 0),
    }),
    [rows]
  )

  return (
    <div className="space-y-4 p-4">
      {!rowsLoading && rows.length > 0 ? (
        <div className="rounded-xl border border-border bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
          {warehouseTotals.rows} рядов · {fmtFgQty(warehouseTotals.pallets)} палет ·{" "}
          {fmtFgQty(warehouseTotals.codes)} кодов ЧЗ. Палеты подгружаются страницами по {PAGE_SIZE}.
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-secondary/10 p-3">
        <p className="mb-2 text-sm font-medium">Поиск по коду маркировки</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Скан или ввод кода ЧЗ…"
            value={codeSearch}
            onChange={(e) => {
              setCodeSearch(e.target.value)
              setCodeSearched(false)
            }}
            onKeyDown={(e) => e.key === "Enter" && runCodeSearch()}
            className="rounded-xl font-mono text-sm"
          />
          <Button
            type="button"
            className="shrink-0 rounded-xl"
            onClick={runCodeSearch}
            disabled={codeLoading}
          >
            {codeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Найти"}
          </Button>
        </div>
        {codeHit ? (
          <div className="mt-2 rounded-lg bg-background/80 px-3 py-2 text-sm">
            <span className="font-medium">{codeHit.rowLabel}</span>
            <span className="text-muted-foreground"> · палета </span>
            <span className="font-mono">{codeHit.palletSerial}</span>
            <span className="text-muted-foreground"> · {codeHit.itemName}</span>
            <Button
              type="button"
              variant="link"
              className="ml-2 h-auto p-0 text-xs"
              onClick={() => {
                setSelectedRowId(codeHit.rowId)
                setCodeHit(null)
                setCodeSearch("")
                setCodeSearched(false)
              }}
            >
              Открыть ряд
            </Button>
          </div>
        ) : codeSearched && codeSearch.trim().replace(/\s/g, "").length >= 8 ? (
          <p className="mt-2 text-xs text-muted-foreground">Код не найден</p>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(280px,360px)_1fr]">
        <div className="rounded-xl border border-border">
          <div className="border-b border-border p-3">
            <p className="text-sm font-semibold">Ряды склада</p>
            <div className="mt-2 flex flex-col gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Ряд, зона…"
                  value={rowFilter}
                  onChange={(e) => setRowFilter(e.target.value)}
                  className="h-9 rounded-lg pl-8 text-sm"
                />
              </div>
              <div className="flex flex-wrap gap-1">
                {(["all", "export", "expiry-risk", "quarantine"] as const).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    size="sm"
                    variant={tagFilter === t ? "default" : "outline"}
                    className="h-7 rounded-md px-2 text-[11px]"
                    onClick={() => setTagFilter(t)}
                  >
                    {t === "all" ? "Все" : fgTagLabel(t)}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <div className="max-h-[min(58vh,640px)] overflow-y-auto">
            {rowsLoading ? (
              <WmsTableSkeleton rows={6} columns={3} className="border-0" />
            ) : rowsError ? (
              <WmsErrorState
                title="Не удалось загрузить ряды"
                message={rowsError}
                onRetry={() => void loadRows()}
              />
            ) : rows.length === 0 ? (
              <WmsEmptyState
                title="Нет рядов с остатками"
                description="Ряды с готовой продукцией появятся после размещения палет на складе."
              />
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left">Ряд</th>
                    <th className="p-2 text-right">Пал.</th>
                    <th className="hidden p-2 text-right sm:table-cell">Коды</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.rowId}
                      className={cn(
                        "cursor-pointer border-t border-border/60 transition-colors hover:bg-secondary/50",
                        selectedRowId === row.rowId && "bg-primary/10 hover:bg-primary/15"
                      )}
                      onClick={() => setSelectedRowId(row.rowId)}
                    >
                      <td className="p-2">
                        <p className="font-medium">{row.label}</p>
                        <p className="text-[10px] text-muted-foreground">
                          зона {row.zone} · {row.rowCode}
                        </p>
                      </td>
                      <td className="p-2 text-right tabular-nums">{row.palletCount}</td>
                      <td className="hidden p-2 text-right tabular-nums text-xs text-muted-foreground sm:table-cell">
                        {row.markingCodesCount >= 1000
                          ? `${(row.markingCodesCount / 1000).toFixed(0)}k`
                          : fmtFgQty(row.markingCodesCount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="min-w-0 rounded-xl border border-border">
          {selectedRow ? (
            <>
              <div className="border-b border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold">{selectedRow.label}</h3>
                    <p className="text-sm text-muted-foreground">
                      {selectedRow.rowCode} · зона {selectedRow.zone} · {selectedRow.nomenclatureSkus}{" "}
                      SKU
                    </p>
                  </div>
                  <TagBadges tags={selectedRow.tags} />
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    { label: "Палеты", value: fmtFgQty(selectedRow.palletCount) },
                    { label: "Кодов ЧЗ", value: fmtFgQty(selectedRow.markingCodesCount) },
                    { label: "Бутылки", value: fmtFgQty(selectedRow.bottles) },
                    { label: "Блоки", value: fmtFgQty(selectedRow.blocks) },
                  ].map((c) => (
                    <div key={c.label} className="rounded-lg bg-secondary/30 px-3 py-2">
                      <p className="text-xs text-muted-foreground">{c.label}</p>
                      <p className="text-lg font-bold tabular-nums">{c.value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  <span>
                    Ближайший срок:{" "}
                    <span className="font-medium text-foreground">
                      {fmtFgDate(selectedRow.nearestExpiryAt)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    Заполненность ряда
                    <FillBar percent={selectedRow.fillPercent} />
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-medium">
                  Палеты
                  {palletPageData ? (
                    <span className="ml-1 font-normal text-muted-foreground">
                      ({fmtFgQty(palletPageData.total)} всего)
                    </span>
                  ) : null}
                </p>
                <div className="relative w-full sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Код палеты, номенклатура…"
                    value={palletQuery}
                    onChange={(e) => setPalletQuery(e.target.value)}
                    className="h-9 rounded-lg pl-8 text-sm"
                  />
                </div>
              </div>

              <div className="max-h-[min(50vh,520px)] overflow-auto">
                {palletsLoading ? (
                  <WmsTableSkeleton rows={6} columns={5} className="border-0" />
                ) : palletsError ? (
                  <WmsErrorState
                    title="Не удалось загрузить палеты"
                    message={palletsError}
                    onRetry={() => setPalletReloadNonce((n) => n + 1)}
                  />
                ) : (
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground">
                      <tr>
                        <th className="p-2 text-left">№</th>
                        <th className="p-2 text-left">Палета</th>
                        <th className="p-2 text-left">Номенклатура</th>
                        <th className="p-2 text-right">Кодов</th>
                        <th className="p-2 text-right">Бут.</th>
                        <th className="p-2 text-left">Срок</th>
                        <th className="p-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {!palletPageData || palletPageData.items.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-8 text-center text-sm text-muted-foreground">
                            <p className="font-medium text-foreground">
                              {palletQuery.trim() ? "Палеты не найдены" : "Список палет пуст"}
                            </p>
                            <p className="mt-1 text-xs">
                              {palletQuery.trim()
                                ? "Измените поиск по коду палеты или номенклатуре."
                                : "Палеты не найдены для выбранного ряда."}
                            </p>
                          </td>
                        </tr>
                      ) : (
                        palletPageData.items.map((p) => (
                          <tr key={p.palletId} className="border-t border-border/60 hover:bg-secondary/40">
                            <td className="p-2 tabular-nums text-muted-foreground">{p.position}</td>
                            <td className="p-2 font-mono text-xs">{p.serialNumber}</td>
                            <td className="max-w-[12rem] truncate p-2">{p.itemName}</td>
                            <td className="p-2 text-right tabular-nums">{fmtFgQty(p.markingCodesCount)}</td>
                            <td className="p-2 text-right tabular-nums">{fmtFgQty(p.bottles)}</td>
                            <td className="p-2 text-xs">{fmtFgDate(p.expiresAt)}</td>
                            <td className="p-2 text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 rounded-md px-2 text-xs"
                                onClick={() => openPallet(p)}
                              >
                                Карточка
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}
              </div>

              {palletPageData && palletPageData.totalPages > 1 ? (
                <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    Стр. {palletPageData.page} из {palletPageData.totalPages} · показано{" "}
                    {palletPageData.items.length} из {fmtFgQty(palletPageData.total)}
                  </p>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg px-2"
                      disabled={palletPageData.page <= 1}
                      onClick={() => setPalletPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg px-2"
                      disabled={palletPageData.page >= palletPageData.totalPages}
                      onClick={() => setPalletPage((p) => p + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex min-h-[280px] items-center justify-center p-8 text-sm text-muted-foreground">
              {rowsLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Загрузка…
                </>
              ) : (
                "Выберите ряд слева"
              )}
            </div>
          )}
        </div>
      </div>

      <PalletSheet
        pallet={palletDetail}
        row={selectedRow}
        open={palletSheetOpen}
        onOpenChange={setPalletSheetOpen}
      />
    </div>
  )
}
