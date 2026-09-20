"use client"

import { useEffect, useState } from "react"
import { Radio } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ProductionPlanRow } from "@/lib/wms-api"
import {
  formatApsClock,
  formatApsDuration,
  formatApsQty,
  resolveApsPlanFact,
  resolveApsPlanTiming,
} from "@/lib/wms/production-plan-fact"

/**
 * Строка «сколько сделали» под названием заказа в календаре. У партий с линии
 * планового задания нет, поэтому там показывается только факт, а пока партия
 * идёт — время на линии вместо пустого места.
 */
export function ApsFactLine({ plan, className }: { plan: ProductionPlanRow; className?: string }) {
  const fact = resolveApsPlanFact(plan)
  const [now, setNow] = useState(() => Date.now())
  const running = plan.status === "in_progress"

  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [running])

  const timing = resolveApsPlanTiming(plan, fact, now)

  if (fact.factQty != null) {
    return (
      <span className={cn("text-[11px] leading-tight tabular-nums", className)}>
        <strong className="font-semibold text-emerald-700 dark:text-emerald-400">
          {formatApsQty(fact.factQty)} шт
        </strong>
        {fact.planQty != null ? (
          <span className="text-muted-foreground">
            {" из "}
            {formatApsQty(fact.planQty)}
            {fact.percent != null ? ` · ${Math.round(fact.percent)}%` : ""}
          </span>
        ) : (
          <span className="text-muted-foreground"> сделано</span>
        )}
        {timing.ratePerHour != null ? (
          <span className="text-muted-foreground"> · {formatApsQty(timing.ratePerHour)} шт/ч</span>
        ) : null}
      </span>
    )
  }

  if (fact.state === "running") {
    return (
      <span className={cn("inline-flex items-center gap-1 text-[11px] leading-tight text-amber-700 dark:text-amber-300", className)}>
        <Radio className="size-3 shrink-0 animate-pulse" />
        {timing.startedAt ? (
          <span className="tabular-nums">
            идёт с {formatApsClock(timing.startedAt)}
            {timing.durationMs != null ? ` · ${formatApsDuration(timing.durationMs)}` : ""}
          </span>
        ) : (
          <span>идёт выпуск</span>
        )}
      </span>
    )
  }

  if (fact.planQty != null) {
    return (
      <span className={cn("text-[11px] leading-tight tabular-nums text-muted-foreground", className)}>
        План {formatApsQty(fact.planQty)} шт · факта нет
      </span>
    )
  }

  return <span className={cn("text-[11px] leading-tight text-muted-foreground", className)}>Количество неизвестно</span>
}
