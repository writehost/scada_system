"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { Loader2, PackagePlus, Sparkles, Truck, X } from "lucide-react"
import { FgPlanPalletCzButton, FgPlanPalletCzSheet } from "@/components/wms/fg-plan-pallet-cz-sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  allocateFgTask,
  loadPlacementShell,
  loadPlacementTasks,
  recommendFgPlace,
  type PlacementOverview,
} from "@/lib/wms/fg-placement-client"
import { canonicalPlanRowId, fgPlanLocationCode, planRowZone } from "@/lib/wms/fg-plan-location-codes"
import { blocksFromBottles, ruBlocksWord, ruPalletsWord } from "@/lib/wms/fg-plan-pack"
import type { AllocationResult, PlacementCandidate } from "@/lib/wms/fg-placement-types"
import {
  applyPlanHighlight,
  clearPlanHighlight,
  mountPlanChrome,
  selectedPlanRowId,
  setPlanLegend,
  setPlanRowChip,
  setPlanTaskChip,
} from "@/lib/wms/fg-plan-highlight"
import { FgPlacementRowSheet } from "@/components/wms/fg-placement-row-sheet"
import { FgPlacementRulesDialog } from "@/components/wms/fg-placement-rules-dialog"
import { formatPlantBatch, parsePlantBatch } from "@/lib/wms/fg-plan-stock-helpers"
import {
  createOperationalTaskBatch,
  fetchFgPlanInventory,
  postFgPlanInventoryToWarehouse,
  type FgPlanInventorySlot,
  type FgPlanStockPreview,
} from "@/lib/wms-api"

function occupiedSlotsForRow(
  inventory: Record<string, FgPlanInventorySlot>,
  rowId: string | null
): FgPlanInventorySlot[] {
  const id = canonicalPlanRowId(rowId)
  if (!id) return []
  return Object.values(inventory)
    .filter((slot) => slot.status === "occupied" && canonicalPlanRowId(slot.address) === id)
    .sort((a, b) => String(a.address).localeCompare(String(b.address), "en"))
}

function rowHumanLabel(planRowId: string): string {
  const m = planRowId.match(/^([A-ZА-ЯЁ]+)-(\d+)$/i)
  if (m) return `ряд ${Number(m[2])} · зона ${m[1].toUpperCase()}`
  return planRowId
}

export function FgPlanPlacementOverlay({
  iframeRef,
}: {
  iframeRef: RefObject<HTMLIFrameElement | null>
}) {
  const [overview, setOverview] = useState<PlacementOverview | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sku, setSku] = useState("Шмаковка")
  const [qty, setQty] = useState("3")
  const [recommend, setRecommend] = useState<{
    recommended: PlacementCandidate | null
    alternatives: PlacementCandidate[]
    itemName?: string
  } | null>(null)
  const [allocation, setAllocation] = useState<AllocationResult | null>(null)
  const [rowId, setRowId] = useState<string | null>(null)
  const [rowCardOpen, setRowCardOpen] = useState(false)
  const [rowOpen, setRowOpen] = useState(false)
  const [pickRow, setPickRow] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [inventory, setInventory] = useState<Record<string, FgPlanInventorySlot>>({})
  const [planStock, setPlanStock] = useState<FgPlanStockPreview | null>(null)
  const [shipBusy, setShipBusy] = useState(false)
  const [shipMsg, setShipMsg] = useState<string | null>(null)
  const [shipErr, setShipErr] = useState<string | null>(null)
  const [stockBusy, setStockBusy] = useState(false)
  const [stockMsg, setStockMsg] = useState<string | null>(null)
  const [stockErr, setStockErr] = useState<string | null>(null)
  const [czOpen, setCzOpen] = useState(false)
  const [czSlots, setCzSlots] = useState<FgPlanInventorySlot[]>([])
  const rowIdRef = useRef<string | null>(null)
  const rowCardOpenRef = useRef(false)
  const pickRowRef = useRef(false)
  const closeRowCardRef = useRef<() => void>(() => undefined)
  rowIdRef.current = rowId
  rowCardOpenRef.current = rowCardOpen
  pickRowRef.current = pickRow

  const rowSlots = useMemo(() => occupiedSlotsForRow(inventory, rowId), [inventory, rowId])
  const rowPlanId = canonicalPlanRowId(rowId)
  const rowZone = rowPlanId ? planRowZone(rowPlanId) : ""
  const rowCell = rowPlanId || ""
  const rowBottles = useMemo(
    () => rowSlots.reduce((sum, slot) => sum + (Number(slot.quantity) || 0), 0),
    [rowSlots]
  )
  const rowBlocks = useMemo(
    () => rowSlots.reduce((sum, slot) => sum + blocksFromBottles(Number(slot.quantity) || 0), 0),
    [rowSlots]
  )
  const rowBatches = useMemo(() => {
    const counts = new Map<string, number>()
    for (const slot of rowSlots) {
      const lot = parsePlantBatch(slot.batch).lotCode || "без партии"
      counts.set(lot, (counts.get(lot) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [rowSlots])
  const rowPending = useMemo(
    () =>
      rowSlots.filter((slot) => {
        const gtin = String(slot.gtin || "").replace(/\D/g, "")
        if (gtin.length < 13) return false
        return !(Number(slot.stockPostedQty) > 0)
      }),
    [rowSlots]
  )

  const reload = useCallback(async () => {
    try {
      setOverview(await loadPlacementShell())
    } catch {
      /* toolbar still works */
    }
    try {
      const snap = await fetchFgPlanInventory()
      setInventory(snap.inventory ?? {})
      setPlanStock(snap.stock ?? null)
    } catch {
      /* plan inventory is optional for placement chrome */
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const paintTask = useCallback(
    (alloc: AllocationResult) => {
      setAllocation(alloc)
      applyPlanHighlight(
        iframeRef.current,
        alloc.highlight.map((h) => ({
          planRowId: h.planRowId,
          positions: [h.position],
          label: `${h.step}. ${canonicalPlanRowId(h.planRowId) || h.planRowId}`,
        })),
        { dimOthers: false, focus: true }
      )
      setPlanTaskChip(iframeRef.current, true)
      const grouped = new Map<string, string[]>()
      for (const h of alloc.highlight) {
        const id = canonicalPlanRowId(h.planRowId) || h.planRowId
        grouped.set(id, [...(grouped.get(id) ?? []), `${h.lpn}${h.expiryAt ? ` · ${h.expiryAt.slice(0, 10)}` : ""}`])
      }
      setPlanLegend(iframeRef.current, {
        title: `Задание ${alloc.taskId}: брать отсюда`,
        lines: [...grouped.entries()].map(([id, lpns]) => ({
          text: `${id} — ${lpns.join(", ")}`,
          color: "#84cc16",
        })),
      })
      setOpen(false)
    },
    [iframeRef]
  )

  const closeRowCard = useCallback(() => {
    setRowCardOpen(false)
    setRowId(null)
    rowIdRef.current = null
    setShipMsg(null)
    setShipErr(null)
    setStockMsg(null)
    setStockErr(null)
    clearPlanHighlight(iframeRef.current)
    setPlanLegend(iframeRef.current, null)
    setPlanRowChip(iframeRef.current, "Ряд", false)
  }, [iframeRef])
  closeRowCardRef.current = closeRowCard

  useEffect(() => {
    if (!rowCardOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRowCard()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [closeRowCard, rowCardOpen])

  const paintRowPallets = useCallback(
    (slots: FgPlanInventorySlot[], planRowId: string) => {
      applyPlanHighlight(
        iframeRef.current,
        [{ planRowId, label: rowHumanLabel(planRowId), color: "#84cc16" }],
        { dimOthers: false, focus: true }
      )
      setPlanTaskChip(iframeRef.current, true)
      const name = slots[0]?.nomenclature || "палеты ряда"
      setPlanLegend(iframeRef.current, {
        title: `${rowHumanLabel(planRowId)} · ${slots.length} палет`,
        lines: [
          { text: name, color: "#84cc16" },
          ...slots.slice(0, 8).map((slot, i) => ({
            text: `Снизу ${i + 1} · ${slot.palletId || slot.address}`,
            color: "#e2e8f0",
          })),
        ],
      })
    },
    [iframeRef]
  )

  const highlightTask = useCallback(async () => {
    setBusy(true)
    try {
      const selected = rowIdRef.current
      const slots = occupiedSlotsForRow(inventory, selected)
      const planRowId = canonicalPlanRowId(selected)
      if (planRowId && slots.length > 0) {
        paintRowPallets(slots, planRowId)
        return
      }
      let tasks = overview?.tasks ?? []
      if (tasks.length === 0) {
        const loaded = await loadPlacementTasks()
        tasks = loaded.tasks
        setOverview((prev) => (prev ? { ...prev, tasks } : prev))
      }
      const first = tasks.find((t) => t.allocation?.highlight?.length) ?? tasks[0]
      if (!first?.allocation?.highlight?.length) {
        setPlanLegend(iframeRef.current, {
          title: "Нет палет в выбранном ряду",
          lines: [{ text: "Кликните ряд на карте — как A-34, где уже лежат палеты с плана.", color: "#94a3b8" }],
        })
        return
      }
      paintTask(first.allocation)
    } finally {
      setBusy(false)
    }
  }, [iframeRef, inventory, overview?.tasks, paintRowPallets, paintTask])

  const highlightTaskRef = useRef(highlightTask)
  highlightTaskRef.current = highlightTask

  const shipFromSelectedRow = useCallback(async () => {
    if (!rowPlanId || rowSlots.length === 0) return
    const gtin = String(rowSlots[0]?.gtin || "").trim()
    if (!gtin) {
      setShipErr("У палет ряда нет GTIN — отгрузку не создать")
      return
    }
    setShipBusy(true)
    setShipErr(null)
    setShipMsg(null)
    try {
      const bottles = rowSlots.reduce((sum, slot) => sum + (Number(slot.quantity) || 0), 0)
      const qty = bottles > 0 ? bottles : rowSlots.length
      const first = rowSlots[0]
      const result = await createOperationalTaskBatch({
        operationType: "shipment",
        comment: `${rowHumanLabel(rowPlanId)} · снизу ${first.palletId || ""}`.trim(),
        sourceLocationCode: fgPlanLocationCode(rowPlanId),
        lines: [
          {
            itemCode: gtin,
            qty,
            batchLabel: first.batch,
            manufacturedAt: parsePlantBatch(first.batch).dateIso
              ? `${parsePlantBatch(first.batch).dateIso}T00:00:00`
              : first.productionDate
                ? `${first.productionDate}T00:00:00`
                : undefined,
            sourceLocationCode: fgPlanLocationCode(rowPlanId),
            comment: `${rowSlots.length} палет с плана`,
          },
        ],
      })
      const taskId = result.createdLines?.[0]?.taskId
      paintRowPallets(rowSlots, rowPlanId)
      setShipMsg(
        taskId
          ? `Отгрузка #${taskId} в очереди ТСД · ${rowHumanLabel(rowPlanId)} · ${rowSlots.length} палет`
          : `Задание создано · ${rowSlots.length} палет`
      )
    } catch (e) {
      setShipErr(e instanceof Error ? e.message : String(e))
    } finally {
      setShipBusy(false)
    }
  }, [paintRowPallets, rowPlanId, rowSlots])

  const postRowToWarehouse = useCallback(async () => {
    if (!rowPlanId || rowSlots.length === 0) return
    setStockBusy(true)
    setStockErr(null)
    setStockMsg(null)
    try {
      const result = await postFgPlanInventoryToWarehouse({
        addresses: rowSlots.map((slot) => slot.address),
      })
      setPlanStock(result.preview)
      if (result.posted > 0) {
        setStockMsg(`На склад: ${result.pallets} пал. / ${result.bottles} бут. · ${rowHumanLabel(rowPlanId)}`)
      } else if (result.failed > 0) {
        setStockErr(result.lines.find((line) => line.reason)?.reason || "Не удалось добавить на склад")
      } else {
        setStockMsg("Этот ряд уже на складе")
      }
      await reload()
    } catch (e) {
      setStockErr(e instanceof Error ? e.message : String(e))
    } finally {
      setStockBusy(false)
    }
  }, [reload, rowPlanId, rowSlots])

  const postAllPendingToWarehouse = useCallback(async () => {
    setStockBusy(true)
    setStockErr(null)
    setStockMsg(null)
    try {
      const result = await postFgPlanInventoryToWarehouse()
      setPlanStock(result.preview)
      if (result.posted > 0) {
        setStockMsg(`С плана на склад: ${result.pallets} пал. / ${result.bottles} бут.`)
      } else if (result.failed > 0) {
        setStockErr(result.lines.find((line) => line.reason)?.reason || "Не удалось добавить на склад")
      } else {
        setStockMsg("Вся продукция с плана уже на складе")
      }
      await reload()
    } catch (e) {
      setStockErr(e instanceof Error ? e.message : String(e))
    } finally {
      setStockBusy(false)
    }
  }, [reload])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    let stop = () => undefined as void
    const attach = () => {
      stop()
      stop = mountPlanChrome(iframe, {
        onPlace: () => setOpen(true),
        onTask: () => void highlightTaskRef.current(),
        onRules: () => setRulesOpen(true),
        onRowSettings: () => {
          const selected = rowIdRef.current || selectedPlanRowId(iframe)
          if (selected) {
            rowIdRef.current = selected
            setRowId(selected)
            setRowOpen(true)
            pickRowRef.current = false
            setPickRow(false)
            setPlanRowChip(iframe, canonicalPlanRowId(selected) || selected, false)
            return
          }
          pickRowRef.current = true
          setPickRow(true)
          setPlanRowChip(iframe, "кликните ряд", true)
        },
        onRowSelected: (id) => {
          const next = canonicalPlanRowId(id) || id
          if (rowIdRef.current && canonicalPlanRowId(rowIdRef.current) === next && rowCardOpenRef.current) {
            closeRowCardRef.current()
            return
          }
          rowIdRef.current = id
          setRowId(id)
          setRowCardOpen(true)
          setShipMsg(null)
          setShipErr(null)
          setStockMsg(null)
          setStockErr(null)
          setPlanRowChip(iframe, next, false)
          if (pickRowRef.current) {
            pickRowRef.current = false
            setPickRow(false)
            setRowOpen(true)
          }
        },
      })
      const already = selectedPlanRowId(iframe)
      if (already) {
        setPlanRowChip(iframe, canonicalPlanRowId(already) || already, false)
      }
    }
    if (iframe.contentDocument?.readyState === "complete") attach()
    iframe.addEventListener("load", attach)
    return () => {
      iframe.removeEventListener("load", attach)
      stop()
    }
  }, [iframeRef])

  return (
    <>
      {busy ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-lg bg-background/90 px-2 py-1 text-[11px] text-muted-foreground shadow">
          <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> карта
        </div>
      ) : null}

      {(planStock?.pendingSlots ?? 0) > 0 && !(rowCardOpen && rowPlanId && rowSlots.length > 0) ? (
        <div className="absolute top-3 left-1/2 z-30 w-[min(28rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-xl border border-emerald-500/40 bg-background/95 p-3 shadow-lg">
          <p className="text-sm font-medium text-foreground">
            На плане {planStock?.pendingPallets} пал. ещё не на складе
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Оприходуйте продукцию в ячейки ГП — иначе отгрузка не увидит остаток.
          </p>
          {stockMsg ? <p className="mt-1 text-[11px] text-lime-700">{stockMsg}</p> : null}
          {stockErr ? <p className="mt-1 text-[11px] text-destructive">{stockErr}</p> : null}
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs"
              disabled={stockBusy}
              onClick={() => void postAllPendingToWarehouse()}
            >
              {stockBusy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <PackagePlus className="mr-1.5 size-3.5" />}
              Добавить продукцию на склад
            </Button>
            <FgPlanPalletCzButton
              onClick={() => {
                setCzSlots(Object.values(inventory).filter((slot) => slot.status === "occupied" && slot.palletId))
                setCzOpen(true)
              }}
            />
          </div>
        </div>
      ) : null}

      {rowCardOpen && rowPlanId && rowSlots.length > 0 ? (
        <div className="absolute bottom-4 left-1/2 z-30 w-[min(34rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-xl border border-lime-500/50 bg-background/95 p-3 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                С плана · зона {rowZone || "—"} · {rowHumanLabel(rowPlanId)}
              </p>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">{rowCell}</p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              aria-label="Закрыть карточку ряда"
              onClick={closeRowCard}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-0.5 line-clamp-2 text-sm font-medium text-foreground">
            {rowSlots[0]?.nomenclature || "Палеты ряда"}
          </p>
          <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
            <p className="font-medium text-foreground">
              {rowSlots.length} {ruPalletsWord(rowSlots.length)} · {rowBlocks} {ruBlocksWord(rowBlocks)} · {rowBottles} бут.
            </p>
            {rowBatches.map(([lot, count]) => (
              <p key={lot} className="font-medium text-foreground">
                {count} пал. · {lot === "без партии" ? "без партии" : formatPlantBatch(lot)}
              </p>
            ))}
            {rowSlots[0]?.palletId ? (
              <p className="font-mono">
                Нижняя палета: {rowSlots[0].palletId}
              </p>
            ) : null}
          </div>
          {stockMsg ? <p className="mt-1 text-[11px] text-lime-700">{stockMsg}</p> : null}
          {stockErr ? <p className="mt-1 text-[11px] text-destructive">{stockErr}</p> : null}
          {shipMsg ? <p className="mt-1 text-[11px] text-lime-700">{shipMsg}</p> : null}
          {shipErr ? <p className="mt-1 text-[11px] text-destructive">{shipErr}</p> : null}
          <div className={`mt-2 grid grid-cols-1 gap-2 ${rowPending.length > 0 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            {rowPending.length > 0 ? (
              <Button
                type="button"
                size="sm"
                className="h-8 text-xs"
                disabled={stockBusy}
                onClick={() => void postRowToWarehouse()}
              >
                {stockBusy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <PackagePlus className="mr-1.5 size-3.5" />}
                Добавить на склад
              </Button>
            ) : null}
            <FgPlanPalletCzButton
              onClick={() => {
                setCzSlots(rowSlots)
                setCzOpen(true)
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={shipBusy}
              onClick={() => void shipFromSelectedRow()}
            >
              {shipBusy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Truck className="mr-1.5 size-3.5" />}
              Отгрузить ряд на ТСД
            </Button>
          </div>
        </div>
      ) : null}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="flex w-full flex-col gap-3 overflow-y-auto sm:max-w-sm">
          <SheetHeader>
            <SheetTitle>Размещение</SheetTitle>
            <SheetDescription>
              «Куда ставить» — ряд под выпуск. «Задание» на карте — откуда забирать. Двух кнопок подсветки больше нет.
            </SheetDescription>
          </SheetHeader>
          <div className="grid grid-cols-[1fr_3.5rem] gap-2">
            <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Номенклатура" />
            <Input value={qty} onChange={(e) => setQty(e.target.value)} title="Сколько палет подобрать" />
          </div>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const rec = await recommendFgPlace(sku)
                setRecommend({ ...rec, itemName: rec.item?.itemName })
                if (!rec.recommended) {
                  setPlanLegend(iframeRef.current, {
                    title: `Нет места под «${sku}»`,
                    lines: [{ text: "Нет свободного ряда по правилам.", color: "#94a3b8" }],
                  })
                  return
                }
                applyPlanHighlight(
                  iframeRef.current,
                  [
                    {
                      planRowId: rec.recommended.planRowId,
                      positions: [rec.recommended.position],
                      label: `Сюда · ${canonicalPlanRowId(rec.recommended.planRowId) || rec.recommended.planRowId}`,
                      color: "#84cc16",
                    },
                    ...rec.alternatives.slice(0, 2).map((a, i) => ({
                      planRowId: a.planRowId,
                      label: `Запас ${i + 1} · ${canonicalPlanRowId(a.planRowId) || a.planRowId}`,
                      color: "#38bdf8",
                    })),
                  ],
                  { dimOthers: false, focus: true }
                )
                setPlanLegend(iframeRef.current, {
                  title: `Под выпуск «${rec.item?.itemName || sku}»`,
                  lines: [
                    {
                      text: `${canonicalPlanRowId(rec.recommended.planRowId) || rec.recommended.planRowId} / P${String(rec.recommended.position).padStart(2, "0")} — лучшее место`,
                      color: "#84cc16",
                    },
                    ...rec.alternatives.slice(0, 2).map((a) => ({
                      text: `${canonicalPlanRowId(a.planRowId) || a.planRowId} — запасной`,
                      color: "#38bdf8",
                    })),
                  ],
                })
                setOpen(false)
              } finally {
                setBusy(false)
              }
            }}
          >
            <Sparkles className="mr-1 h-4 w-4" /> Куда ставить
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const result = await allocateFgTask(sku, Number(qty) || 1, true)
                paintTask(result)
                await reload()
              } finally {
                setBusy(false)
              }
            }}
          >
            Подобрать {qty} палет в задание
          </Button>
          {recommend?.recommended ? (
            <div className="rounded-lg border border-border p-2 text-sm">
              <p className="text-xs text-muted-foreground">Ряды под выпуск</p>
              <p className="font-medium">
                {canonicalPlanRowId(recommend.recommended.planRowId) || recommend.recommended.planRowId} — лучший
              </p>
              {recommend.alternatives.slice(0, 2).map((a) => (
                <p key={a.planRowId} className="text-xs text-muted-foreground">
                  {canonicalPlanRowId(a.planRowId) || a.planRowId} — запасной
                </p>
              ))}
            </div>
          ) : null}
          {allocation ? (
            <div className="rounded-lg border border-border p-2 text-sm">
              <p className="text-xs text-muted-foreground">Задание {allocation.taskId} — забирать из</p>
              <ol className="mt-1 space-y-0.5 font-mono text-[11px]">
                {allocation.highlight.slice(0, 8).map((h) => (
                  <li key={`${h.lpn}-${h.step}`}>
                    {h.step}. {canonicalPlanRowId(h.planRowId) || h.planRowId} · {h.lpn}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <FgPlacementRowSheet open={rowOpen} onOpenChange={setRowOpen} rowId={rowId} onSaved={() => void reload()} />
      <FgPlacementRulesDialog open={rulesOpen} onOpenChange={setRulesOpen} overview={overview} onChanged={() => void reload()} />
      <FgPlanPalletCzSheet open={czOpen} onOpenChange={setCzOpen} slots={czSlots} />
    </>
  )
}
