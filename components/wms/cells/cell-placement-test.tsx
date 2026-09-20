"use client"

import { useCallback, useState } from "react"
import { FlaskConical, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { recommendStorageLocations } from "@/lib/wms-api"
import { formatCellQty } from "@/lib/storage-slot-ui"
import { cn } from "@/lib/utils"
import { useCellsRequestGuard } from "./cells-request-guard"

type Props = {
  defaultItemCode?: string
  highlightLocationCode?: string
  compact?: boolean
}

export function CellPlacementTest({
  defaultItemCode = "",
  highlightLocationCode,
  compact = false,
}: Props) {
  const [itemCode, setItemCode] = useState(defaultItemCode)
  const [qty, setQty] = useState("1000")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<
    Array<{ locationCode: string; score: number; forbidden: boolean; reasons: string[] }>
  >([])
  const [matchingRules, setMatchingRules] = useState<Array<{ name: string; priority: number }>>([])
  const { nextGeneration, isCurrent } = useCellsRequestGuard()

  const run = useCallback(async () => {
    const code = itemCode.trim()
    if (!code) return
    const generation = nextGeneration()
    setLoading(true)
    setError(null)
    try {
      const res = await recommendStorageLocations({
        itemCode: code,
        qty: Number(qty) || 1,
        limit: 6,
      })
      if (!isCurrent(generation)) return
      setRows(res.recommendations ?? [])
      setMatchingRules(
        (res.matchingRules ?? []).map((r) => ({ name: r.name, priority: r.priority }))
      )
    } catch (e) {
      if (!isCurrent(generation)) return
      setError(e instanceof Error ? e.message : "Ошибка подбора")
      setRows([])
    } finally {
      if (isCurrent(generation)) setLoading(false)
    }
  }, [itemCode, qty, nextGeneration, isCurrent])

  return (
    <div className="min-w-0 space-y-3 rounded-xl border border-border/60 bg-secondary/20 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <FlaskConical className="h-4 w-4 shrink-0 text-primary" />
        Проверка подбора
      </div>
      <div className={cn("grid gap-2", compact ? "grid-cols-1" : "sm:grid-cols-3")}>
        <div className={compact ? "" : "sm:col-span-2"}>
          <Label className="text-xs">Код номенклатуры</Label>
          <Input
            value={itemCode}
            onChange={(e) => setItemCode(e.target.value)}
            className="mt-1 h-8 w-full rounded-lg font-mono text-xs"
            placeholder="04607017164372"
          />
        </div>
        <div>
          <Label className="text-xs">Кол-во</Label>
          <Input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="mt-1 h-8 w-full rounded-lg text-xs"
            inputMode="numeric"
          />
        </div>
      </div>
      <Button size="sm" className="rounded-lg" onClick={() => void run()} disabled={loading}>
        {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
        Подобрать
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {matchingRules.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Сработает правил: {matchingRules.map((r) => r.name).join(", ")}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li
              key={r.locationCode}
              className={
                r.locationCode === highlightLocationCode
                  ? "min-w-0 rounded-lg border border-primary/50 bg-primary/10 px-2 py-1.5 text-xs"
                  : "min-w-0 rounded-lg border border-border/40 px-2 py-1.5 text-xs"
              }
            >
              <div className="flex items-start justify-between gap-2 font-mono">
                <span className="min-w-0 break-all">{r.locationCode}</span>
                <span className={r.forbidden ? "text-amber-700" : "text-primary"}>
                  {r.score} б.{r.forbidden ? " · огранич." : ""}
                </span>
              </div>
              {r.reasons[0] ? (
                <div className="mt-0.5 text-muted-foreground">{r.reasons[0]}</div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
