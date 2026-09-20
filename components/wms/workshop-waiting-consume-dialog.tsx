"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowDownToLine, Loader2 } from "lucide-react"
import { toast } from "sonner"
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
import { cn } from "@/lib/utils"
import { mapWmsError } from "@/lib/wms-error-messages"
import {
  getItemStockAvailability,
  postWaitingCellHandoff,
  type ProductionPlanRow,
  type WaitingCellHandoff,
  type WmsLocationRow,
} from "@/lib/wms-api"
import { planOptionsForWaitingCell } from "@/lib/wms/workshop-plan-context"

export type WorkshopLineOption = {
  /** Подпись для оператора (чип). */
  lineLabel: string
  /** Значение в handoff / APS (SIPA, JR…). По умолчанию = lineLabel. */
  lineCode?: string
  locationCode?: string
}

function optionValue(line: WorkshopLineOption) {
  return (line.lineCode || line.lineLabel).trim()
}

function fmtQty(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value)
}

function locationOnHandQty(loc: WmsLocationRow) {
  return (loc.inProductionQty ?? 0) + (loc.availableQty ?? 0)
}

function isUsableLineLabel(value: string | null | undefined) {
  const trimmed = (value ?? "").trim()
  return trimmed.length >= 2
}

export function WorkshopWaitingConsumeDialog({
  open,
  onOpenChange,
  location,
  lineOptions,
  activePlans = [],
  onConfirmed,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  location: WmsLocationRow | null
  lineOptions: WorkshopLineOption[]
  activePlans?: ProductionPlanRow[]
  onConfirmed?: (payload: {
    locationCode: string
    waitingHandoff: WaitingCellHandoff
  }) => void
}) {
  const code = location?.locationCode ?? ""
  const itemCode = location?.occupiedItemCode?.trim() ?? ""
  const itemName = location?.occupiedItemName?.trim() || itemCode
  const onHand = location ? locationOnHandQty(location) : 0

  const [lineCode, setLineCode] = useState("")
  const [batch, setBatch] = useState("")
  const [planCode, setPlanCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [lotsLoading, setLotsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lineSuggestions = useMemo(() => {
    const map = new Map<string, WorkshopLineOption>()
    for (const line of lineOptions) {
      const label = line.lineLabel.trim()
      if (!isUsableLineLabel(label)) continue
      const value = optionValue(line)
      if (!map.has(value)) map.set(value, { ...line, lineLabel: label, lineCode: value })
    }
    const existingLine = location?.waitingHandoff?.lineCode?.trim()
    if (isUsableLineLabel(existingLine) && !map.has(existingLine!)) {
      map.set(existingLine!, { lineLabel: existingLine!, lineCode: existingLine!, locationCode: code })
    }
    return Array.from(map.values()).sort((a, b) => a.lineLabel.localeCompare(b.lineLabel, "ru"))
  }, [lineOptions, location?.waitingHandoff?.lineCode, code])

  const planSuggestions = useMemo(() => {
    return planOptionsForWaitingCell({
      cellItemCode: itemCode,
      lineCode: lineCode.trim() || location?.waitingHandoff?.lineCode,
      plans: activePlans,
    })
  }, [activePlans, itemCode, lineCode, location?.waitingHandoff?.lineCode])

  const selectedPlan = useMemo(
    () => planSuggestions.find((p) => p.code === planCode) ?? null,
    [planSuggestions, planCode]
  )

  const selectedLine = useMemo(() => {
    const raw = lineCode.trim().toLowerCase()
    if (!raw) return null
    return (
      lineSuggestions.find((line) => optionValue(line).toLowerCase() === raw) ??
      lineSuggestions.find((line) => line.lineLabel.trim().toLowerCase() === raw) ??
      null
    )
  }, [lineCode, lineSuggestions])

  // Только при открытии / смене ячейки — иначе клик по чипу линии сбрасывается при пересчёте планов.
  useEffect(() => {
    if (!open) return
    const existing = location?.waitingHandoff
    const savedLine = existing?.lineCode?.trim() ?? ""
    setLineCode(isUsableLineLabel(savedLine) ? savedLine : "")
    setBatch(existing?.batchLabel ?? "")
    setPlanCode(existing?.planCode ?? "")
    setError(null)
  }, [open, location?.locationCode, location?.waitingHandoff])

  useEffect(() => {
    if (!open) return
    if (lineCode.trim()) return
    const first = lineSuggestions[0]
    if (first) setLineCode(optionValue(first))
  }, [open, lineCode, lineSuggestions])

  useEffect(() => {
    if (!open) return
    if (planCode.trim()) return
    const first = planSuggestions[0]
    if (first?.code) setPlanCode(first.code)
  }, [open, planCode, planSuggestions])

  useEffect(() => {
    if (!open || !itemCode || !code) return
    if (location?.waitingHandoff?.batchLabel) return
    let cancelled = false
    setLotsLoading(true)
    void getItemStockAvailability({ itemCode, locationCode: code })
      .then((res) => {
        if (cancelled) return
        const firstLot = (res.lots ?? []).find(
          (lot) => (lot.availableQty ?? 0) + (lot.inProductionQty ?? 0) > 0
        )
        setBatch(firstLot?.lotCode ?? "Без партии")
      })
      .catch(() => {
        if (!cancelled) setBatch("Без партии")
      })
      .finally(() => {
        if (!cancelled) setLotsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, itemCode, code, location?.waitingHandoff?.batchLabel])

  function resolveLineForSubmit(raw: string): string {
    const t = raw.trim()
    if (!t) return t
    const byCode = lineSuggestions.find((line) => optionValue(line).toLowerCase() === t.toLowerCase())
    if (byCode) return optionValue(byCode)
    const byLabel = lineSuggestions.find((line) => line.lineLabel.trim().toLowerCase() === t.toLowerCase())
    if (byLabel) return optionValue(byLabel)
    return t
  }

  async function submit() {
    if (!code) return
    if (!itemCode) {
      setError("В ячейке не определена номенклатура — обновите страницу или заполните ячейку заново")
      return
    }
    const line = resolveLineForSubmit(lineCode)
    if (!isUsableLineLabel(line)) {
      setError("Выберите линию расхода из списка")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await postWaitingCellHandoff({
        locationCode: code,
        lineCode: line,
        batchLabel: batch.trim() || null,
        itemCode,
        planId: selectedPlan?.planId ?? null,
        planCode: (selectedPlan?.code ?? planCode.trim()) || null,
        planProductName: selectedPlan?.itemName ?? null,
      })
      const lineLabel = selectedLine?.lineLabel || line
      toast.success("Отдано в производство", {
        description: `${code} → ${lineLabel}${batch.trim() ? ` · ${batch.trim()}` : ""}`,
      })
      onOpenChange(false)
      if (result.waitingHandoff) {
        onConfirmed?.({
          locationCode: result.locationCode,
          waitingHandoff: result.waitingHandoff,
        })
      } else {
        onConfirmed?.({
          locationCode: result.locationCode,
          waitingHandoff: {
            status: "handed_to_production",
            lineCode: line,
            batchLabel: batch.trim() || null,
            itemCode,
            handedAt: new Date().toISOString(),
          },
        })
      }
    } catch (e) {
      setError(mapWmsError(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !loading && onOpenChange(v)}>
      <DialogContent className="max-h-[min(92vh,720px)] gap-0 overflow-hidden rounded-xl p-0 sm:max-w-md">
        <DialogHeader className="border-border/60 space-y-1 border-b px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <ArrowDownToLine className="text-primary h-5 w-5 shrink-0" />
            Расход на линию
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-0.5">
              <p className="text-foreground font-medium">{code}</p>
              <p className="text-muted-foreground text-sm">{itemName}</p>
              <p className="text-muted-foreground pt-1 text-sm">
                В ячейке:{" "}
                <span className="text-foreground font-medium tabular-nums">{fmtQty(onHand)} шт.</span>
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div className="bg-muted/40 text-muted-foreground rounded-xl border px-3 py-2.5 text-xs leading-relaxed">
            Фиксируем передачу на линию по плану APS. Количество не списывается — для этого используйте
            «Списать» на карточке ячейки.
          </div>

          {planSuggestions.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor="waiting-consume-plan">План APS</Label>
              <div className="flex flex-wrap gap-1.5">
                {planSuggestions.map((plan) => (
                  <button
                    key={plan.planId}
                    type="button"
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-left text-xs font-medium transition-colors",
                      planCode === plan.code
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border/70 bg-background text-foreground hover:border-primary/40"
                    )}
                    onClick={() => setPlanCode(plan.code)}
                  >
                    {plan.code} · {plan.itemName}
                  </button>
                ))}
              </div>
              {selectedPlan?.status === "in_progress" ? (
                <p className="text-amber-700 dark:text-amber-300 text-xs">
                  План уже в производстве — резерв заблокирован до списания по партии.
                </p>
              ) : selectedPlan?.shortageCount ? (
                <p className="text-destructive text-xs">
                  По плану не хватает материалов на складе — сначала закройте дефицит или снимите резерв в APS.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label>Линия расхода</Label>
            {lineSuggestions.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {lineSuggestions.map((line) => {
                  const value = optionValue(line)
                  const active =
                    lineCode.trim().toLowerCase() === value.toLowerCase() ||
                    lineCode.trim().toLowerCase() === line.lineLabel.trim().toLowerCase()
                  return (
                    <button
                      key={value}
                      type="button"
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border/70 bg-background text-foreground hover:border-primary/40"
                      )}
                      onClick={() => {
                        setLineCode(value)
                        setError(null)
                      }}
                    >
                      {line.lineLabel}
                    </button>
                  )
                })}
              </div>
            ) : (
              <Input
                id="waiting-consume-line"
                value={lineCode}
                onChange={(e) => setLineCode(e.target.value)}
                placeholder="Sipa, JR, Devin…"
                className="rounded-xl"
                autoComplete="off"
              />
            )}
            {selectedLine ? (
              <p className="text-muted-foreground text-xs">
                Выбрано: <span className="text-foreground font-medium">{selectedLine.lineLabel}</span>
                {selectedLine.lineCode && selectedLine.lineCode !== selectedLine.lineLabel
                  ? ` (${selectedLine.lineCode})`
                  : ""}
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                Нажмите на линию из справочника «Линии производства».
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="waiting-consume-batch">Партия</Label>
            <Input
              id="waiting-consume-batch"
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
              placeholder={lotsLoading ? "Загрузка партий…" : "Номер партии"}
              className="rounded-xl"
            />
            <p className="text-muted-foreground text-xs">
              Позже будет подставляться из MES, если партия запущена на линии.
            </p>
          </div>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>

        <DialogFooter className="border-border/60 gap-2 border-t px-5 py-4 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            disabled={loading}
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
          <Button
            type="button"
            className="rounded-xl"
            disabled={loading || onHand <= 0 || !selectedLine}
            onClick={() => void submit()}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Сохраняю…
              </>
            ) : (
              "Передать на линию"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
