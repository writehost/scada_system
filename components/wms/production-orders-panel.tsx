"use client"

import { Pencil, PackageCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ProductionPlanRow } from "@/lib/wms-api"
import { formatApsPlanQty, formatApsItemCompositeLine, groupProductionPlansByLine, productionPlanMrpPercent } from "@/lib/wms/production-gantt-mapper"

type Props = {
  plans: ProductionPlanRow[]
  selectedPlanId: string | null
  onSelectPlan: (planId: string) => void
  onEditPlan: (code: string) => void
  onOpenMrp: (code: string) => void
}

function statusBadge(plan: ProductionPlanRow) {
  if (plan.status === "done") {
    return { label: "Выполнен", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" }
  }
  if (plan.status === "in_progress") {
    return { label: `${Math.round(plan.actualPercent ?? 0)}%`, className: "bg-amber-500/15 text-amber-700 dark:text-amber-300" }
  }
  if (plan.status === "reserved") {
    return { label: "Резерв", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" }
  }
  if (plan.isFullyCovered) {
    return { label: "MRP OK", className: "bg-sky-500/15 text-sky-700 dark:text-sky-300" }
  }
  if (plan.shortageCount > 0) {
    return { label: `Дефицит ${plan.shortageCount}`, className: "bg-destructive/15 text-destructive" }
  }
  return { label: "Черновик", className: "bg-muted text-muted-foreground" }
}

function formatDateRu(key: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return key
  return `${m[3]}.${m[2]}.${m[1]}`
}

function planPeriod(plan: ProductionPlanRow) {
  const to =
    plan.planDateTo && plan.planDateTo >= plan.planDate ? ` — ${formatDateRu(plan.planDateTo)}` : ""
  return `${formatDateRu(plan.planDate)}${to}`
}

export function ProductionOrdersPanel({
  plans,
  selectedPlanId,
  onSelectPlan,
  onEditPlan,
  onOpenMrp,
}: Props) {
  const groups = groupProductionPlansByLine(plans)

  if (plans.length === 0) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center rounded-xl border border-dashed bg-muted/10 p-6 text-center text-sm text-muted-foreground">
        Нет заказов на выбранный месяц
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_52px_88px_108px_72px] gap-2 border-b bg-muted/30 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Номенклатура / линия</span>
        <span className="text-right">MRP</span>
        <span className="text-right">План, шт</span>
        <span>Период</span>
        <span className="text-center">Статус</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.key}>
            <div className="sticky top-0 z-[1] border-b bg-muted/50 px-3 py-2 text-xs font-semibold text-muted-foreground">
              {group.label}
            </div>
            {group.plans.map((plan) => {
              const selected = plan.planId === selectedPlanId
              const badge = statusBadge(plan)
              const composite = formatApsItemCompositeLine(plan)
              const mrpPct = productionPlanMrpPercent(plan)
              return (
                <div
                  key={plan.planId}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "grid cursor-pointer grid-cols-[minmax(0,1fr)_52px_88px_108px_72px] gap-2 border-b px-3 py-3 text-sm transition-colors",
                    selected ? "bg-primary/10 ring-1 ring-inset ring-primary/30" : "hover:bg-muted/40"
                  )}
                  onClick={() => onSelectPlan(plan.planId)}
                  onDoubleClick={() => onOpenMrp(plan.code)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onSelectPlan(plan.planId)
                    }
                  }}
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium leading-snug text-foreground">{plan.itemName}</p>
                    {composite ? (
                      <p className="text-xs leading-snug text-sky-900/90 dark:text-sky-100/90">{composite}</p>
                    ) : null}
                    {plan.actualPercent > 0 ? (
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-amber-500"
                          style={{ width: `${Math.max(0, Math.min(100, plan.actualPercent))}%` }}
                        />
                      </div>
                    ) : null}
                    <p className="text-[11px] text-muted-foreground">
                      {plan.itemCode} · {plan.code}
                    </p>
                    {selected ? (
                      <div className="flex flex-wrap gap-1 pt-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={(e) => {
                            e.stopPropagation()
                            onEditPlan(plan.code)
                          }}
                        >
                          <Pencil className="mr-1 size-3" />
                          Изменить
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={(e) => {
                            e.stopPropagation()
                            onOpenMrp(plan.code)
                          }}
                        >
                          <PackageCheck className="mr-1 size-3" />
                          MRP
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <div
                    className={cn(
                      "self-start text-right text-xs tabular-nums font-semibold",
                      mrpPct >= 100
                        ? "text-sky-700 dark:text-sky-300"
                        : mrpPct > 0
                          ? "text-amber-700 dark:text-amber-300"
                          : "text-muted-foreground"
                    )}
                  >
                    {mrpPct}%
                  </div>
                  <div className="self-start text-right font-semibold tabular-nums text-sky-800 dark:text-sky-200">
                    {formatApsPlanQty(plan.plannedQty)}
                  </div>
                  <div className="self-start text-xs tabular-nums text-muted-foreground">{planPeriod(plan)}</div>
                  <div className="self-start text-center">
                    <Badge variant="outline" className={cn("text-[10px] font-normal", badge.className)}>
                      {badge.label}
                    </Badge>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
