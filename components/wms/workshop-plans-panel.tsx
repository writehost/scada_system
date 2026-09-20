"use client"

import Link from "next/link"
import { CalendarDays } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { ProductionPlanRow } from "@/lib/wms/production-plan-meta"
import { fmtPlanQty, isActiveWorkshopPlan } from "@/lib/wms/workshop-plan-context"

function planStatusLabel(plan: ProductionPlanRow): { text: string; className: string } {
  if (plan.status === "in_progress") {
    return {
      text: "В производстве",
      className: "bg-amber-500/15 text-amber-800 dark:text-amber-200",
    }
  }
  if (plan.status === "reserved") {
    return {
      text: "Зарезервирован",
      className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
    }
  }
  if (plan.shortageCount > 0) {
    return {
      text: `Не хватает: ${plan.shortageCount}`,
      className: "bg-destructive/15 text-destructive",
    }
  }
  return { text: plan.status, className: "bg-muted text-muted-foreground" }
}

export function WorkshopPlansPanel({ plans }: { plans: ProductionPlanRow[] }) {
  const active = plans.filter(isActiveWorkshopPlan)
  if (active.length === 0) return null

  return (
    <section className="wms-panel overflow-hidden">
      <div className="border-border/60 flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="font-semibold">Планы APS в цехе</h3>
          <p className="text-muted-foreground text-sm">
            Резерв на складе материалов · передача и списание из точек ожидания
          </p>
        </div>
        <Link
          href="/production-calendar"
          className="border-border/70 text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors"
        >
          <CalendarDays className="h-3.5 w-3.5" />
          Календарь APS
        </Link>
      </div>
      <div className="divide-border/60 divide-y">
        {active.map((plan) => {
          const status = planStatusLabel(plan)
          const shortageMaterials = (plan.materials ?? []).filter((m) => m.shortageQty > 0)
          return (
            <div key={plan.planId} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="bg-primary/10 text-primary rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                      План
                    </span>
                    <span className="font-mono text-xs">{plan.code}</span>
                    <Badge variant="outline" className={cn("rounded-md text-[10px]", status.className)}>
                      {status.text}
                    </Badge>
                  </div>
                  <p className="mt-1 font-medium">{plan.itemName}</p>
                  <p className="text-muted-foreground text-xs">
                    {plan.lineCode ? `Линия ${plan.lineCode}` : "Линия не указана"}
                    {plan.plannedQty ? ` · ${fmtPlanQty(plan.plannedQty)} шт.` : ""}
                    {plan.status === "in_progress" && plan.actualPercent != null
                      ? ` · ${Math.round(plan.actualPercent)}%`
                      : ""}
                  </p>
                </div>
              </div>
              {shortageMaterials.length > 0 ? (
                <div className="bg-destructive/5 text-destructive rounded-lg border border-dashed px-3 py-2 text-xs">
                  <p className="font-medium">Не хватает на складе материалов:</p>
                  <ul className="mt-1 space-y-0.5">
                    {shortageMaterials.slice(0, 4).map((m) => (
                      <li key={m.planMaterialId}>
                        {m.itemName || m.itemCode} — {fmtPlanQty(m.shortageQty)} {m.uomCode || "шт."}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : plan.status === "reserved" ? (
                <p className="text-muted-foreground text-xs">
                  Материалы зарезервированы — можно выдавать в цех. После запуска резерв снять нельзя до
                  списания по партии.
                </p>
              ) : plan.status === "in_progress" ? (
                <p className="text-amber-800/90 dark:text-amber-200/90 text-xs">
                  План в производстве — резерв заблокирован до списания по партии. Остаток может остаться в
                  точке ожидания или вернуться на склад материалов.
                </p>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function WaitingCellPlanHint({
  planProductName,
  planCode,
  inCellQty,
  workshopQty,
  needFromWarehouse,
  materialShortage,
  inProduction,
}: {
  planProductName: string
  planCode: string
  inCellQty: number
  workshopQty: number
  needFromWarehouse: number
  materialShortage: number
  inProduction: boolean
}) {
  return (
    <div className="mt-2 space-y-1 rounded-lg border border-dashed px-2.5 py-2 text-[11px] leading-snug">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="bg-primary/12 text-primary rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase">
          План
        </span>
        <span className="text-muted-foreground font-mono">{planCode}</span>
        {inProduction ? (
          <span className="font-medium text-amber-700 dark:text-amber-300">в пр-ве</span>
        ) : null}
      </div>
      <p className="text-foreground line-clamp-2 font-medium">{planProductName}</p>
      <p className="text-muted-foreground">
        В ячейке <span className="text-foreground tabular-nums">{fmtPlanQty(inCellQty)}</span>
        {" · "}
        в цеху <span className="text-foreground tabular-nums">{fmtPlanQty(workshopQty)}</span>
        {needFromWarehouse > 0 ? (
          <>
            {" · "}
            взять со склада{" "}
            <span className="text-foreground tabular-nums">{fmtPlanQty(needFromWarehouse)}</span>
          </>
        ) : null}
      </p>
      {materialShortage > 0 ? (
        <p className="text-destructive font-medium">
          Не хватает материала: {fmtPlanQty(materialShortage)} шт.
        </p>
      ) : null}
    </div>
  )
}
