"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { fmtCompactQty, plural, type DashboardZoneRow } from "@/lib/wms/dashboard-data"

/** Зоны из одной-двух ячеек (буфер, отгрузка) заполняются всегда — это не переполнение. */
export const MIN_ZONE_FOR_ALERT = 5

/**
 * Заполненность по всему складу, а не по первым шести зонам:
 * прежний виджет складывал только начало списка и показывал «0 / 640» при занятых ячейках.
 */
export function DashboardOccupancyPanel({
  zones,
  occupiedCount,
  locationCount,
  skuCount,
  totalQty,
  loading,
  className,
}: {
  zones: DashboardZoneRow[]
  occupiedCount: number
  locationCount: number
  skuCount: number
  totalQty: number
  loading?: boolean
  className?: string
}) {
  const [showAll, setShowAll] = useState(false)

  /** Сортировка по занятым ячейкам: зона из одной ячейки со 100% — не повод оттеснять реальный склад. */
  const rows = useMemo(() => {
    const sorted = [...zones].sort((a, b) => {
      if (b.nonEmptyCount !== a.nonEmptyCount) return b.nonEmptyCount - a.nonEmptyCount
      return b.locationCount - a.locationCount
    })
    return showAll ? sorted : sorted.slice(0, 6)
  }, [zones, showAll])

  const fillPct = locationCount > 0 ? Math.round((occupiedCount / locationCount) * 100) : 0
  const usedZones = zones.filter((z) => z.nonEmptyCount > 0).length

  return (
    <section className={cn("wms-panel", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <h2 className="wms-panel-title">Заполненность склада</h2>
        <Link
          href="/occupancy"
          prefetch={false}
          className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Подробнее
        </Link>
      </div>

      <div className="space-y-3 p-4">
        {loading && zones.length === 0 ? (
          <Skeleton className="h-24 rounded-xl" />
        ) : (
          <>
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-2xl font-semibold leading-none tabular-nums text-foreground">
                  {fillPct}%
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  занято {occupiedCount.toLocaleString("ru-RU")} из {locationCount.toLocaleString("ru-RU")}{" "}
                  {plural(locationCount, "ячейки", "ячеек", "ячеек")}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums text-foreground">{fmtCompactQty(totalQty)}</p>
                <p className="text-xs text-muted-foreground">
                  {skuCount} {plural(skuCount, "позиция", "позиции", "позиций")} на остатке
                </p>
              </div>
            </div>

            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${Math.min(100, Math.max(fillPct, occupiedCount > 0 ? 2 : 0))}%` }}
              />
            </div>

            <ul className="space-y-1.5">
              {rows.map((zone) => {
                const pct = zone.locationCount > 0 ? Math.round((zone.nonEmptyCount / zone.locationCount) * 100) : 0
                const hot = pct >= 90 && zone.locationCount >= MIN_ZONE_FOR_ALERT
                return (
                  <li key={`${zone.warehouseCode}-${zone.zoneCode}`} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate text-xs font-medium text-foreground">
                      {zone.zoneCode}
                    </span>
                    <span className="hidden w-16 shrink-0 truncate text-[11px] text-muted-foreground sm:block">
                      {zone.warehouseCode}
                    </span>
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className={cn(
                          "block h-full rounded-full",
                          hot ? "bg-destructive" : pct > 0 ? "bg-primary" : "bg-transparent"
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span
                      className={cn(
                        "w-20 shrink-0 text-right text-[11px] tabular-nums",
                        hot ? "font-semibold text-destructive" : "text-muted-foreground"
                      )}
                    >
                      {zone.nonEmptyCount}/{zone.locationCount}
                    </span>
                  </li>
                )
              })}
            </ul>

            {zones.length > 6 ? (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {showAll ? "Свернуть" : `Показать все зоны (${zones.length})`}
              </button>
            ) : null}

            {usedZones === 0 && locationCount > 0 ? (
              <p className="text-xs text-muted-foreground">
                Ни в одной зоне нет остатка — склад пустой либо приёмки ещё не проведены на ячейки.
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}
