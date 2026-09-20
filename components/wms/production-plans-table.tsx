"use client"

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ChevronsUpDown, Gauge, PackageCheck, Pencil, Radio } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ProductionPlanRow } from "@/lib/wms-api"
import { formatApsItemCompositeLine } from "@/lib/wms/production-gantt-mapper"
import {
  apsFactLabel,
  apsPlanLabel,
  formatApsClock,
  formatApsDuration,
  formatApsQty,
  resolveApsPlanFact,
  resolveApsPlanTiming,
  summarizeApsFacts,
  type ApsPlanFact,
} from "@/lib/wms/production-plan-fact"

export type ApsTableSortKey = "date" | "item" | "code" | "line" | "plan" | "fact" | "rate" | "status"

type Props = {
  plans: ProductionPlanRow[]
  selectedPlanId: string | null
  onSelectPlan: (planId: string) => void
  onOpenMrp: (code: string) => void
  onEditPlan: (code: string) => void
  onEnterFact: (plan: ProductionPlanRow) => void
  query: string
}

const STATUS_ORDER: Record<string, number> = {
  in_progress: 0,
  reserved: 1,
  checked: 2,
  draft: 3,
  done: 4,
  cancelled: 5,
}

function statusView(plan: ProductionPlanRow, fact: ApsPlanFact) {
  if (plan.status === "done") {
    return { label: "Выпущена", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" }
  }
  if (plan.status === "in_progress") {
    return { label: "На линии", className: "bg-amber-500/15 text-amber-800 dark:text-amber-200" }
  }
  if (plan.status === "reserved") {
    return { label: "Резерв", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" }
  }
  if (plan.status === "cancelled") {
    return { label: "Отменён", className: "bg-muted text-muted-foreground" }
  }
  if (fact.planQty != null && plan.shortageCount > 0) {
    return { label: `Дефицит ${plan.shortageCount}`, className: "bg-destructive/15 text-destructive" }
  }
  if (plan.isFullyCovered) {
    return { label: "MRP OK", className: "bg-sky-500/15 text-sky-700 dark:text-sky-300" }
  }
  return { label: "Черновик", className: "bg-muted text-muted-foreground" }
}

function formatDateRu(key: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return key
  return `${m[3]}.${m[2]}`
}

function planPeriod(plan: ProductionPlanRow) {
  const to = plan.planDateTo && plan.planDateTo > plan.planDate ? ` — ${formatDateRu(plan.planDateTo)}` : ""
  return `${formatDateRu(plan.planDate)}${to}`
}

function lineLabel(plan: ProductionPlanRow) {
  const ws = (plan.workshopCode || "").trim() || "Без цеха"
  if (plan.lineCode) return `${ws} · ${plan.lineCode}`
  return ws
}

/** Подсветка совпадений поиска, чтобы было видно, почему строка нашлась. */
function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1)
  if (terms.length === 0) return <>{text}</>

  const pattern = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi")
  const parts = text.split(pattern)
  return (
    <>
      {parts.map((part, i) =>
        terms.includes(part.toLowerCase()) ? (
          <mark key={i} className="rounded bg-primary/20 px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

function SortHeader({
  label,
  sortKey,
  active,
  dir,
  onSort,
  className,
  align,
}: {
  label: string
  sortKey: ApsTableSortKey
  active: boolean
  dir: "asc" | "desc"
  onSort: (key: ApsTableSortKey) => void
  className?: string
  align?: "right" | "center"
}) {
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown
  return (
    <th className={cn("px-2.5 py-1.5 font-medium", className)}>
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground",
          active && "text-foreground",
          align === "right" && "flex-row-reverse"
        )}
        onClick={() => onSort(sortKey)}
      >
        {label}
        <Icon className={cn("size-3", active ? "opacity-100" : "opacity-40")} />
      </button>
    </th>
  )
}

export function ProductionPlansTable({
  plans,
  selectedPlanId,
  onSelectPlan,
  onOpenMrp,
  onEditPlan,
  onEnterFact,
  query,
}: Props) {
  const [sortKey, setSortKey] = useState<ApsTableSortKey>("date")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  function handleSort(key: ApsTableSortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
      return
    }
    setSortKey(key)
    // Числовые колонки полезнее сразу по убыванию: «где сделали больше всего».
    setSortDir(key === "item" || key === "code" || key === "line" ? "asc" : "desc")
  }

  const rows = useMemo(() => {
    const enriched = plans.map((plan) => {
      const fact = resolveApsPlanFact(plan)
      return { plan, fact, timing: resolveApsPlanTiming(plan, fact) }
    })

    const dir = sortDir === "asc" ? 1 : -1
    const cmpText = (a: string, b: string) => a.localeCompare(b, "ru")
    const cmpNum = (a: number | null, b: number | null) => {
      // Пустые значения всегда внизу: результат ниже умножается на dir,
      // поэтому возврат ±dir даёт постоянный знак при любом направлении.
      if (a == null && b == null) return 0
      if (a == null) return dir
      if (b == null) return -dir
      return a - b
    }

    return [...enriched].sort((x, y) => {
      let r = 0
      switch (sortKey) {
        case "item":
          r = cmpText(x.plan.itemName, y.plan.itemName)
          break
        case "code":
          r = cmpText(x.plan.code, y.plan.code)
          break
        case "line":
          r = cmpText(lineLabel(x.plan), lineLabel(y.plan))
          break
        case "plan":
          r = cmpNum(x.fact.planQty, y.fact.planQty)
          break
        case "fact":
          r = cmpNum(x.fact.factQty, y.fact.factQty)
          break
        case "rate":
          r = cmpNum(x.timing.ratePerHour, y.timing.ratePerHour)
          break
        case "status":
          r = (STATUS_ORDER[x.plan.status] ?? 9) - (STATUS_ORDER[y.plan.status] ?? 9)
          break
        default:
          r = x.plan.planDate.localeCompare(y.plan.planDate)
          if (r === 0) {
            r = (x.timing.startedAt?.getTime() ?? 0) - (y.timing.startedAt?.getTime() ?? 0)
          }
      }
      if (r === 0) r = cmpText(x.plan.code, y.plan.code)
      return r * dir
    })
  }, [plans, sortDir, sortKey])

  const totals = useMemo(() => summarizeApsFacts(plans), [plans])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="sticky top-0 z-10 bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
            <tr className="border-b">
              <SortHeader label="Дата" sortKey="date" active={sortKey === "date"} dir={sortDir} onSort={handleSort} className="w-[104px] whitespace-nowrap" />
              <SortHeader label="Партия" sortKey="code" active={sortKey === "code"} dir={sortDir} onSort={handleSort} className="w-[150px] whitespace-nowrap" />
              <SortHeader label="Номенклатура" sortKey="item" active={sortKey === "item"} dir={sortDir} onSort={handleSort} className="min-w-[300px]" />
              <SortHeader label="Цех / смена" sortKey="line" active={sortKey === "line"} dir={sortDir} onSort={handleSort} className="w-[140px]" />
              <th className="w-[150px] px-2.5 py-1.5 font-medium">Время на линии</th>
              <SortHeader label="План" sortKey="plan" active={sortKey === "plan"} dir={sortDir} onSort={handleSort} className="w-[110px] text-right" align="right" />
              <SortHeader label="Сделано" sortKey="fact" active={sortKey === "fact"} dir={sortDir} onSort={handleSort} className="w-[150px] text-right" align="right" />
              <SortHeader label="Темп, шт/ч" sortKey="rate" active={sortKey === "rate"} dir={sortDir} onSort={handleSort} className="w-[110px] text-right" align="right" />
              <SortHeader label="Статус" sortKey="status" active={sortKey === "status"} dir={sortDir} onSort={handleSort} className="w-[130px]" />
              <th className="w-[120px] px-2.5 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ plan, fact, timing }) => {
              const selected = plan.planId === selectedPlanId
              const status = statusView(plan, fact)
              const composite = formatApsItemCompositeLine(plan)
              return (
                <tr
                  key={plan.planId}
                  className={cn(
                    "border-b border-border/60 align-middle transition-colors last:border-b-0 hover:bg-muted/40",
                    selected && "bg-primary/10 hover:bg-primary/15",
                    plan.status === "in_progress" && !selected && "bg-amber-500/[0.04]"
                  )}
                  onClick={() => onSelectPlan(plan.planId)}
                  onDoubleClick={() => onOpenMrp(plan.code)}
                >
                  <td className="whitespace-nowrap px-2.5 py-1.5 tabular-nums text-muted-foreground">
                    {planPeriod(plan)}
                  </td>
                  <td className="px-2.5 py-1.5">
                    <span className="font-mono text-xs font-medium text-foreground">
                      <Highlight text={plan.code} query={query} />
                    </span>
                  </td>
                  <td className="px-2.5 py-1.5">
                    <div className="line-clamp-2 font-medium leading-tight text-foreground" title={plan.itemName}>
                      <Highlight text={plan.itemName} query={query} />
                    </div>
                    {composite ? (
                      <div className="line-clamp-1 text-[11px] leading-tight text-muted-foreground" title={composite}>
                        <Highlight text={composite} query={query} />
                      </div>
                    ) : null}
                  </td>
                  <td className="px-2.5 py-1.5 text-xs text-muted-foreground">
                    <Highlight text={lineLabel(plan)} query={query} />
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-xs text-muted-foreground">
                    {timing.startedAt ? (
                      <>
                        <div className="tabular-nums text-foreground">
                          {formatApsClock(timing.startedAt)}
                          {timing.finishedAt ? `–${formatApsClock(timing.finishedAt)}` : "–…"}
                        </div>
                        {timing.durationMs != null ? (
                          <div className={cn("tabular-nums", timing.running && "text-amber-700 dark:text-amber-300")}>
                            {timing.running ? "идёт " : ""}
                            {formatApsDuration(timing.durationMs)}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <span>—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums text-muted-foreground">
                    {apsPlanLabel(fact)}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right">
                    {fact.factQty != null ? (
                      <>
                        <div className="font-semibold tabular-nums text-foreground">{formatApsQty(fact.factQty)}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {fact.percent != null
                            ? `шт · ${Math.round(fact.percent)}% от плана`
                            : fact.factSource
                              ? `шт · ${fact.factSource}`
                              : "шт"}
                        </div>
                      </>
                    ) : fact.state === "running" ? (
                      <div className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                        <Radio className="size-3 animate-pulse" />
                        идёт выпуск
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        {fact.state === "unknown" ? "нет данных" : "—"}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums text-muted-foreground">
                    {timing.ratePerHour != null ? (
                      <span className="inline-flex items-center gap-1">
                        <Gauge className="size-3 opacity-60" />
                        {formatApsQty(timing.ratePerHour)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2.5 py-1.5">
                    <Badge variant="secondary" className={cn("font-normal", status.className)}>
                      {status.label}
                    </Badge>
                  </td>
                  <td className="px-2.5 py-1.5">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        title="Внести факт выпуска"
                        onClick={(e) => {
                          e.stopPropagation()
                          onEnterFact(plan)
                        }}
                      >
                        <PackageCheck className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        title="Редактировать заказ"
                        disabled={plan.status === "reserved"}
                        onClick={(e) => {
                          e.stopPropagation()
                          onEditPlan(plan.code)
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t bg-muted/20 px-2.5 py-1 text-xs text-muted-foreground">
        <span>
          Строк <strong className="tabular-nums text-foreground">{rows.length}</strong>
        </span>
        <span>
          Сделано всего <strong className="tabular-nums text-foreground">{formatApsQty(totals.producedQty)}</strong> шт
        </span>
        {totals.plannedQty > 0 ? (
          <span>
            План <strong className="tabular-nums text-foreground">{formatApsQty(totals.plannedQty)}</strong> шт
          </span>
        ) : null}
        {totals.running > 0 ? (
          <span className="text-amber-700 dark:text-amber-300">
            На линии <strong className="tabular-nums">{totals.running}</strong>
          </span>
        ) : null}
        <span className="ml-auto">Клик — выбрать · двойной клик — MRP</span>
      </div>
    </div>
  )
}
