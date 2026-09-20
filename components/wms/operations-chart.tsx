"use client"

import { cn } from "@/lib/utils"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"

export interface OperationsChartPoint {
  time: string
  receiving: number
  shipping: number
  movement: number
}

interface OperationsChartProps {
  data?: OperationsChartPoint[]
  className?: string
}

export function OperationsChart({ data = [], className }: OperationsChartProps) {
  const hasData = data.some((point) => point.receiving || point.shipping || point.movement)

  return (
    <div className={cn("rounded-2xl bg-card shadow-sm", className)}>
      <div className="flex items-center justify-between p-5 pb-3">
        <div>
          <h3 className="font-semibold text-card-foreground">Операции за сегодня</h3>
          <p className="text-sm text-muted-foreground">Динамика по часам</p>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-6 rounded-full bg-chart-1" />
            <span className="text-muted-foreground">Приёмка</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-6 rounded-full bg-chart-2" />
            <span className="text-muted-foreground">Отгрузка</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-6 rounded-full bg-chart-3" />
            <span className="text-muted-foreground">Перемещения</span>
          </div>
        </div>
      </div>
      <div className="p-4">
        {hasData ? (
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="colorReceiving" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="oklch(0.83 0.18 115)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="oklch(0.83 0.18 115)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorShipping" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="oklch(0.55 0.12 250)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="oklch(0.55 0.12 250)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorMovement" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="oklch(0.7 0.15 55)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="oklch(0.7 0.15 55)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.88 0.02 90)" vertical={false} />
            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "oklch(0.5 0.02 145)", fontSize: 12 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "oklch(0.5 0.02 145)", fontSize: 12 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "oklch(0.995 0 0)",
                border: "1px solid oklch(0.88 0.02 90)",
                borderRadius: "12px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
              }}
              labelStyle={{ color: "oklch(0.25 0.04 145)" }}
              itemStyle={{ color: "oklch(0.35 0.04 145)" }}
            />
            <Area
              type="monotone"
              dataKey="receiving"
              stroke="oklch(0.83 0.18 115)"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorReceiving)"
              name="Приёмка"
            />
            <Area
              type="monotone"
              dataKey="shipping"
              stroke="oklch(0.55 0.12 250)"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorShipping)"
              name="Отгрузка"
            />
            <Area
              type="monotone"
              dataKey="movement"
              stroke="oklch(0.7 0.15 55)"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorMovement)"
              name="Перемещения"
            />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-[250px] items-center justify-center rounded-xl bg-secondary/40 text-sm text-muted-foreground">
            За сегодня операций ещё нет
          </div>
        )}
      </div>
    </div>
  )
}
