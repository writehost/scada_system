"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"

export interface OccupancyItem {
  name: string
  value: number
  total: number
  color: string
}

interface OccupancyWidgetProps {
  data?: OccupancyItem[]
  className?: string
}

export function OccupancyWidget({ data = [], className }: OccupancyWidgetProps) {
  const totalOccupied = data.reduce((acc, item) => acc + item.value, 0)
  const totalCapacity = data.reduce((acc, item) => acc + item.total, 0)
  const overallPercentage = totalCapacity > 0 ? Math.round((totalOccupied / totalCapacity) * 100) : 0

  return (
    <div className={cn("rounded-2xl bg-card shadow-sm", className)}>
      <div className="flex items-center justify-between p-5 pb-3">
        <h3 className="font-semibold text-card-foreground">Заполненность склада</h3>
        <Link
          href="/occupancy"
          className="text-sm font-medium text-foreground/70 transition-colors hover:text-foreground"
        >
          Подробнее
        </Link>
      </div>
      <div className="p-5 pt-0">
        {/* Overall progress */}
        <div className={cn("mb-6", data.length === 0 && "mb-0")}>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Общая заполненность</p>
              <p className="text-3xl font-bold text-card-foreground">{overallPercentage}%</p>
            </div>
            <p className="text-sm text-muted-foreground">
              {totalOccupied} / {totalCapacity} ячеек
            </p>
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                overallPercentage >= 90 ? "bg-destructive" : overallPercentage >= 70 ? "bg-chart-3" : "bg-chart-1"
              )}
              style={{ width: `${overallPercentage}%` }}
            />
          </div>
        </div>

        {/* Zone breakdown */}
        {data.length > 0 ? (
          <div className="space-y-3">
          {data.map((item) => {
            const percentage = item.total > 0 ? Math.round((item.value / item.total) * 100) : 0
            return (
              <div key={item.name}>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className={cn("h-2 w-2 rounded-full", item.color)} />
                    <span className="text-muted-foreground">{item.name}</span>
                  </div>
                  <span className="font-medium text-card-foreground">
                    {percentage}%
                    <span className="ml-2 text-muted-foreground">
                      ({item.value}/{item.total})
                    </span>
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn("h-full rounded-full transition-all", item.color)}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            )
          })}
          </div>
        ) : (
          <div className="rounded-xl bg-secondary/40 p-4 text-sm text-muted-foreground">
            Нет данных по зонам склада
          </div>
        )}
      </div>
    </div>
  )
}
