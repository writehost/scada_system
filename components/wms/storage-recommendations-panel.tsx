"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, Loader2, MapPin, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { recommendStorageLocations } from "@/lib/wms-api"
import { buildSlotTitle, type WmsStorageRecommendRow } from "@/lib/storage-slot-ui"
import { cn } from "@/lib/utils"
import { useCellsRequestGuard } from "@/components/wms/cells/cells-request-guard"

type Props = {
  itemCode: string
  qty?: number
  /** true — приоритет зоны RECV (ячейка приёмки) */
  preferReceiving?: boolean
  /** Выбрать ячейку для проведения / размещения */
  onPickLocation?: (locationCode: string) => void
  selectedLocationCode?: string
  compact?: boolean
  className?: string
}

export function StorageRecommendationsPanel({
  itemCode,
  qty,
  preferReceiving = false,
  onPickLocation,
  selectedLocationCode,
  compact,
  className,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<WmsStorageRecommendRow[]>([])
  const [reqTitle, setReqTitle] = useState<string | null>(null)
  const [matchingRules, setMatchingRules] = useState<string[]>([])
  const { nextGeneration, isCurrent } = useCellsRequestGuard()

  const load = useCallback(async () => {
    const code = itemCode.trim()
    if (!code) {
      setRows([])
      return
    }
    const generation = nextGeneration()
    setLoading(true)
    setError(null)
    try {
      const res = await recommendStorageLocations({
        itemCode: code,
        qty,
        preferReceiving,
        limit: compact ? 4 : 8,
      })
      if (!isCurrent(generation)) return
      setRows(res.recommendations || [])
      setReqTitle(buildSlotTitle(res.requirements))
      setMatchingRules((res.matchingRules ?? []).map((r) => r.name))
    } catch (e) {
      if (!isCurrent(generation)) return
      setError(e instanceof Error ? e.message : "Не удалось подобрать ячейки")
      setRows([])
      setMatchingRules([])
    } finally {
      if (isCurrent(generation)) setLoading(false)
    }
  }, [itemCode, qty, preferReceiving, compact, nextGeneration, isCurrent])

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 300)
    return () => window.clearTimeout(t)
  }, [load])

  const best = rows.find((r) => !r.forbidden) ?? rows[0]
  const hasAllowed = rows.some((r) => !r.forbidden)

  if (!itemCode.trim()) return null

  return (
    <div className={cn("rounded-xl border border-border/60 bg-card", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-primary" />
          Рекомендуемые ячейки
        </div>
        <Button variant="ghost" size="sm" className="h-8 rounded-lg text-xs" onClick={() => void load()} disabled={loading}>
          Обновить
        </Button>
      </div>

      <div className="space-y-3 px-4 py-3">
        {reqTitle && reqTitle !== "—" ? (
          <p className="text-xs text-muted-foreground">
            Профиль партии: <span className="text-foreground">{reqTitle}</span>
          </p>
        ) : null}
        {matchingRules.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Правила: <span className="text-foreground">{matchingRules.join(", ")}</span>
          </p>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Подбор ячеек…
          </div>
        ) : null}

        {error ? (
          <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        ) : null}

        {!loading && !error && !hasAllowed ? (
          <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              Нет точной свободной ячейки для этой партии.
            </p>
            <p className="text-xs text-muted-foreground">
              Можно создать ячейку с нужным профилем или выбрать ближайшую из списка ниже.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="rounded-lg" asChild>
                <Link href="/cells">Создать ячейку</Link>
              </Button>
              <Button variant="outline" size="sm" className="rounded-lg" asChild>
                <Link href="/cells/rules">Правило размещения</Link>
              </Button>
            </div>
          </div>
        ) : null}

        {best && !loading ? (
          <div
            className={cn(
              "rounded-lg border p-3",
              best.forbidden ? "border-border/60 opacity-80" : "border-primary/40 bg-primary/5"
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  {!best.forbidden ? (
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                  )}
                  <span className="font-mono text-sm font-semibold">{best.locationCode}</span>
                  <Badge variant="secondary" className="rounded-md font-mono text-xs">
                    {best.score} б.
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{best.displayName}</p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{best.zoneCode}</p>
              </div>
              {onPickLocation ? (
                <Button
                  size="sm"
                  className="rounded-lg shrink-0"
                  variant={selectedLocationCode === best.locationCode ? "secondary" : "default"}
                  disabled={best.forbidden}
                  onClick={() => onPickLocation(best.locationCode)}
                >
                  {selectedLocationCode === best.locationCode ? "Выбрано" : "Разместить сюда"}
                </Button>
              ) : null}
            </div>
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              {best.reasons.slice(0, compact ? 4 : 8).map((r) => (
                <li key={r}>· {r}</li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
              {best.availableCapacity != null ? (
                <span className="rounded bg-secondary px-1.5 py-0.5">
                  свободно ~{Math.round(best.availableCapacity)}
                </span>
              ) : null}
              <span className="rounded bg-secondary px-1.5 py-0.5">
                остаток {Math.round(best.currentUnits)}
              </span>
              {best.hasSameItem ? (
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">та же номенклатура</span>
              ) : null}
            </div>
          </div>
        ) : null}

        {!compact && rows.length > 1 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Другие варианты</p>
            {rows.slice(1, 6).map((r) => (
              <div
                key={r.locationCode}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/40 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-mono text-xs">{r.locationCode}</span>
                    <span className="text-[10px] text-muted-foreground">{r.score} б.</span>
                    {r.forbidden ? (
                      <Badge variant="outline" className="rounded text-[10px]">
                        ограничение
                      </Badge>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{r.displayName}</p>
                </div>
                {onPickLocation ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg shrink-0"
                    disabled={r.forbidden}
                    onClick={() => onPickLocation(r.locationCode)}
                  >
                    Выбрать
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
