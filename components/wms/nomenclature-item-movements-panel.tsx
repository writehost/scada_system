"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  listWmsItemMovements,
  type WmsItemMovementRow,
} from "@/lib/wms-api"
import { cn } from "@/lib/utils"

const DAY_PRESETS = [
  { label: "7 дн.", value: 7 },
  { label: "30 дн.", value: 30 },
  { label: "90 дн.", value: 90 },
  { label: "Всё", value: null },
] as const

const PAGE = 40

const TYPE_RU: Record<string, string> = {
  RECEIPT: "Приёмка",
  ISSUE: "Выдача",
  TRANSFER: "Перемещение",
  ADJUST: "Корректировка",
  ADJUSTMENT: "Корректировка",
  PUTAWAY: "Размещение",
  PICK: "Отбор",
  RETURN: "Возврат",
  WRITEOFF: "Списание",
  CONSUME: "Списание в пр-во",
  PRODUCTION: "Производство",
}

function fmtQty(n: unknown): string {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return "0"
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

function fmtDateTimeRu(value: unknown): string {
  if (!value) return "—"
  try {
    return new Date(String(value)).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return "—"
  }
}

function typeLabel(code: string): string {
  const key = code.trim().toUpperCase()
  return (TYPE_RU[key] ?? code) || "—"
}

type Props = {
  itemCode: string
  active: boolean
  className?: string
}

export function NomenclatureItemMovementsPanel({ itemCode, active, className }: Props) {
  const [days, setDays] = useState<number | null>(30)
  const [rows, setRows] = useState<WmsItemMovementRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadedOnce, setLoadedOnce] = useState(false)

  const fetchPage = useCallback(
    async (opts: { offset: number; append: boolean; daysFilter: number | null }) => {
      if (!itemCode) return
      if (opts.append) setLoadingMore(true)
      else setLoading(true)
      setError(null)
      try {
        const res = await listWmsItemMovements(itemCode, {
          limit: PAGE,
          offset: opts.offset,
          days: opts.daysFilter,
        })
        setRows((prev) => (opts.append ? [...prev, ...res.movements] : res.movements))
        setHasMore(res.hasMore)
        setLoadedOnce(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить движения")
        if (!opts.append) setRows([])
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [itemCode]
  )

  useEffect(() => {
    if (!active || !itemCode) return
    void fetchPage({ offset: 0, append: false, daysFilter: days })
  }, [active, itemCode, days, fetchPage])

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="inline-flex rounded-lg border border-border/60 bg-muted/30 p-0.5">
          {DAY_PRESETS.map((p) => (
            <button
              key={String(p.value)}
              type="button"
              onClick={() => setDays(p.value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition",
                days === p.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 rounded-lg"
          disabled={loading}
          onClick={() => void fetchPage({ offset: 0, append: false, daysFilter: days })}
        >
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
          Обновить
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {loading && !loadedOnce ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загрузка…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
          За выбранный период движений нет
        </div>
      ) : (
        <div className="overflow-auto">
          <table className="wms-ag-grid min-w-[720px]">
            <thead className="sticky top-0 z-[1]">
              <tr>
                <th>Когда</th>
                <th>Тип</th>
                <th className="text-right">Кол-во</th>
                <th>Маршрут</th>
                <th>Партия</th>
                <th>Док.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.movementId} className="wms-ag-row">
                  <td className="whitespace-nowrap text-muted-foreground">
                    {fmtDateTimeRu(row.movementAt)}
                  </td>
                  <td>
                    <span className="wms-ag-status">{typeLabel(row.movementType)}</span>
                  </td>
                  <td className="wms-ag-cell-num font-semibold">{fmtQty(row.qty)}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
                      <span className="text-muted-foreground">{row.fromLocationCode || "—"}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground/70" />
                      <span className="font-medium">{row.toLocationCode || "—"}</span>
                    </div>
                  </td>
                  <td className="font-mono text-xs text-muted-foreground">{row.lotCode || "—"}</td>
                  <td className="font-mono text-xs">
                    {row.documentId ? (
                      <Link
                        href={`/documents/${encodeURIComponent(row.documentId)}`}
                        className="text-emerald-800 underline-offset-2 hover:underline dark:text-emerald-400"
                      >
                        {row.documentId.slice(0, 8)}…
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasMore ? (
            <div className="border-t border-border/60 p-3 text-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-lg"
                disabled={loadingMore}
                onClick={() =>
                  void fetchPage({ offset: rows.length, append: true, daysFilter: days })
                }
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Загрузка…
                  </>
                ) : (
                  `Ещё ${PAGE}`
                )}
              </Button>
            </div>
          ) : (
            <div className="border-t border-border/40 px-4 py-2 text-center text-[11px] text-muted-foreground">
              Показано {rows.length}
              {days != null ? ` за ${days} дн.` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
