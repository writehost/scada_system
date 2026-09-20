"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react"
import { ArrowRight, Check, Droplets, Link2, Link2Off, Radio, Wrench } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ProductionPlanLinkRow, ProductionPlanRow } from "@/lib/wms-api"
import type { ApsLineEventKind, ApsLineEventRow } from "@/lib/wms/aps-line-events"
import { apsLineEventDayInMonth, apsLineEventGroupKey } from "@/lib/wms/aps-line-events"
import {
  apsPlanBarColor,
  groupProductionPlansByLine,
  toDateKey,
} from "@/lib/wms/production-gantt-mapper"
import { ApsFactLine } from "@/components/wms/production-fact-line"
import {
  apsFactLabel,
  formatApsQty,
  resolveApsPlanFact,
  resolveApsPlanTiming,
} from "@/lib/wms/production-plan-fact"

type Props = {
  plans: ProductionPlanRow[]
  links: ProductionPlanLinkRow[]
  lineEvents: ApsLineEventRow[]
  year: number
  monthIdx: number
  selectedPlanId: string | null
  dependencySourcePlanId: string | null
  onSelectPlan: (planId: string) => void
  onOpenMrp: (code: string) => void
  onEditPlan: (code: string) => void
  onShiftPlan: (planCode: string, deltaDays: number) => Promise<void>
  onResizePlan: (planCode: string, patch: { planDate?: string; planDateTo?: string | null }) => Promise<void>
  onCreateDependency: (sourcePlanId: string, targetPlanId: string) => Promise<void>
  onDeleteDependency: (linkId: string) => Promise<void>
  onSetDependencySource: (planId: string | null) => void
  onRequestLineEvent: (kind: ApsLineEventKind, plan: ProductionPlanRow) => void
  onOpenDay?: (dayKey: string) => void
}

type SideEvent = "wash" | "maint"

const WEEKDAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

function parseDateKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

function formatDateRu(key: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return key
  return `${m[3]}.${m[2]}`
}

function planPeriod(plan: ProductionPlanRow) {
  const to = plan.planDateTo && plan.planDateTo >= plan.planDate ? ` — ${formatDateRu(plan.planDateTo)}` : ""
  return `${formatDateRu(plan.planDate)}${to}`
}

function planSpanInMonth(
  plan: ProductionPlanRow,
  year: number,
  monthIdx: number
): { startCol: number; span: number } | null {
  const monthStart = new Date(year, monthIdx, 1)
  const monthEnd = new Date(year, monthIdx + 1, 0)
  const planStart = parseDateKey(plan.planDate)
  const planEnd = parseDateKey(
    plan.planDateTo && plan.planDateTo >= plan.planDate ? plan.planDateTo : plan.planDate
  )
  if (!planStart || !planEnd) return null
  if (planEnd < monthStart || planStart > monthEnd) return null

  const visibleStart = planStart < monthStart ? monthStart : planStart
  const visibleEnd = planEnd > monthEnd ? monthEnd : planEnd
  return {
    startCol: visibleStart.getDate(),
    span: visibleEnd.getDate() - visibleStart.getDate() + 1,
  }
}

function planLabel(plan: ProductionPlanRow) {
  const ws = plan.workshopCode || "Без цеха"
  if (plan.lineCode) return `${ws} · смена ${plan.lineCode}`
  return ws
}

function planEndDateKey(plan: ProductionPlanRow) {
  return plan.planDateTo && plan.planDateTo >= plan.planDate ? plan.planDateTo : plan.planDate
}

function shiftDateKey(key: string, deltaDays: number): string {
  const [yyyy, mm, dd] = key.split("-").map(Number)
  const date = new Date(yyyy, (mm || 1) - 1, dd || 1)
  date.setDate(date.getDate() + deltaDays)
  return toDateKey(date)
}

/** Ортогональная линия зависимости с несколькими изломами, стрелка входит в левый торец цели. */
function buildApsDependencyPath(x1: number, y1: number, x2: number, y2: number): string {
  const stubOut = 14
  const stubIn = 12
  const endX = x2 - 1
  const startX = x1
  const sameRow = Math.abs(y2 - y1) < 5
  const gap = endX - startX

  if (sameRow && gap > stubOut + stubIn + 24) {
    const p1 = startX + stubOut
    const p2 = p1 + 10
    const p5 = endX - stubIn
    const p4 = p5 - 10
    const mid = (p2 + p4) / 2
    return `M ${startX} ${y1} L ${p1} ${y1} L ${p2} ${y1} L ${mid} ${y1} L ${mid} ${y2} L ${p4} ${y2} L ${p5} ${y2} L ${endX} ${y2}`
  }

  const routeDown = y2 >= y1
  const laneOffset = routeDown ? 26 : -26
  const laneY = routeDown ? Math.max(y1, y2) + laneOffset : Math.min(y1, y2) + laneOffset
  const p1 = startX + stubOut
  const p5 = endX - stubIn
  const midLaneX = gap > 0 ? (p1 + p5) / 2 : Math.max(startX, endX) + 32

  if (gap > stubOut + stubIn) {
    const bend1 = y1 + laneOffset / 2
    const bend2 = y2 - laneOffset / 2
    return `M ${startX} ${y1} L ${p1} ${y1} L ${p1} ${bend1} L ${p1} ${laneY} L ${midLaneX} ${laneY} L ${p5} ${laneY} L ${p5} ${bend2} L ${p5} ${y2} L ${endX} ${y2}`
  }

  const detourX = Math.max(startX, endX) + 36
  return `M ${startX} ${y1} L ${p1} ${y1} L ${p1} ${laneY} L ${detourX} ${laneY} L ${detourX} ${y2} L ${p5} ${y2} L ${endX} ${y2}`
}

function linkTypeLabel(type: ProductionPlanLinkRow["type"]) {
  if (type === "s2s") return "старт-старт"
  if (type === "s2e") return "старт-финиш"
  if (type === "e2e") return "финиш-финиш"
  return "после"
}

function LineEventMarker({ kind, leftPct, title }: { kind: SideEvent; leftPct: string; title: string }) {
  return (
    <div
      className="pointer-events-none absolute top-1/2 z-[4] -translate-x-1/2 -translate-y-1/2"
      style={{ left: leftPct }}
      title={title}
    >
      {kind === "wash" ? (
        <div className="flex size-6 items-center justify-center rounded-full border-2 border-sky-500 bg-sky-50 text-sky-700 shadow-sm dark:bg-sky-950 dark:text-sky-300">
          <Droplets className="size-3" />
        </div>
      ) : (
        <div className="relative flex size-6 items-center justify-center">
          <div className="absolute inset-0 rotate-45 rounded-sm border-2 border-amber-500 bg-amber-100 dark:bg-amber-950" />
          <Wrench className="relative size-3 text-amber-800 dark:text-amber-200" />
        </div>
      )}
    </div>
  )
}

export function ProductionMonthCalendar({
  plans,
  links,
  lineEvents,
  year,
  monthIdx,
  selectedPlanId,
  dependencySourcePlanId,
  onSelectPlan,
  onOpenMrp,
  onEditPlan,
  onShiftPlan,
  onResizePlan,
  onCreateDependency,
  onDeleteDependency,
  onSetDependencySource,
  onRequestLineEvent,
  onOpenDay,
}: Props) {
  const daysInMonth = useMemo(() => new Date(year, monthIdx + 1, 0).getDate(), [year, monthIdx])
  const [todayKey, setTodayKey] = useState<string | null>(null)
  const groups = useMemo(() => groupProductionPlansByLine(plans), [plans])
  const planById = useMemo(() => new Map(plans.map((plan) => [plan.planId, plan])), [plans])
  const selectedPlan = selectedPlanId ? planById.get(selectedPlanId) ?? null : null
  const dependencySource = dependencySourcePlanId ? planById.get(dependencySourcePlanId) ?? null : null
  const gridRefs = useRef(new Map<string, HTMLDivElement>())
  const barRefs = useRef(new Map<string, HTMLDivElement>())
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null)
  const [linkPaths, setLinkPaths] = useState<Array<{ id: string; d: string }>>([])
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 })
  const [drag, setDrag] = useState<{
    planId: string
    startX: number
    deltaDays: number
  } | null>(null)
  const [resize, setResize] = useState<{
    planId: string
    edge: "start" | "end"
    startX: number
    deltaDays: number
  } | null>(null)

  useEffect(() => {
    setTodayKey(toDateKey(new Date()))
  }, [])

  const dayMeta = useMemo(() => {
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1
      const date = new Date(year, monthIdx, day)
      const key = toDateKey(date)
      const weekday = (date.getDay() + 6) % 7
      return { day, key, weekday, isWeekend: weekday >= 5, isToday: todayKey !== null && key === todayKey }
    })
  }, [daysInMonth, monthIdx, todayKey, year])

  const selectedLinks = useMemo(() => {
    if (!selectedPlanId) return []
    return links.filter((link) => link.sourcePlanId === selectedPlanId || link.targetPlanId === selectedPlanId)
  }, [links, selectedPlanId])

  /**
   * Месяц шире экрана, поэтому при открытии подводим текущий день к левому краю
   * сетки — иначе сегодняшняя колонка остаётся за правым краем и её ищут руками.
   */
  const autoScrolledMonthRef = useRef<string | null>(null)
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll || todayKey === null) return
    const monthTag = `${year}-${monthIdx}`
    if (autoScrolledMonthRef.current === monthTag) return
    autoScrolledMonthRef.current = monthTag

    const todayCell = scroll.querySelector<HTMLElement>("[data-aps-today='1']")
    const stickyCol = scroll.querySelector<HTMLElement>("[data-aps-left-col='1']")
    if (!todayCell) return
    const stickyWidth = stickyCol ? stickyCol.getBoundingClientRect().width : 0
    const offset =
      todayCell.getBoundingClientRect().left - scroll.getBoundingClientRect().left + scroll.scrollLeft
    scroll.scrollLeft = Math.max(0, offset - stickyWidth - 16)
  }, [monthIdx, todayKey, year])

  const gridCols = `minmax(300px, 360px) repeat(${daysInMonth}, minmax(52px, 1fr))`

  const recomputeLinkPaths = useCallback(() => {
    const scroll = scrollRef.current
    const content = contentRef.current
    if (!scroll || !content) return

    setSvgSize({ w: content.scrollWidth, h: content.scrollHeight })
    const scrollRect = scroll.getBoundingClientRect()

    const paths = links
      .map((link) => {
        const srcBar = barRefs.current.get(link.sourcePlanId)
        const tgtBar = barRefs.current.get(link.targetPlanId)
        if (!srcBar || !tgtBar) return null

        const sr = srcBar.getBoundingClientRect()
        const tr = tgtBar.getBoundingClientRect()
        const x1 = sr.right - scrollRect.left + scroll.scrollLeft
        const y1 = sr.top + sr.height / 2 - scrollRect.top + scroll.scrollTop
        const x2 = tr.left - scrollRect.left + scroll.scrollLeft
        const y2 = tr.top + tr.height / 2 - scrollRect.top + scroll.scrollTop

        return { id: link.linkId, d: buildApsDependencyPath(x1, y1, x2, y2) }
      })
      .filter((p): p is { id: string; d: string } => p !== null)

    setLinkPaths(paths)
  }, [links])

  useEffect(() => {
    let active = true
    const run = () => {
      if (!active) return
      recomputeLinkPaths()
    }

    const frame = requestAnimationFrame(run)
    const scroll = scrollRef.current
    if (!scroll) {
      return () => {
        active = false
        cancelAnimationFrame(frame)
      }
    }

    scroll.addEventListener("scroll", run, { passive: true })
    const ro = new ResizeObserver(run)
    ro.observe(scroll)
    if (contentRef.current) ro.observe(contentRef.current)
    window.addEventListener("resize", run)
    return () => {
      active = false
      cancelAnimationFrame(frame)
      scroll.removeEventListener("scroll", run)
      ro.disconnect()
      window.removeEventListener("resize", run)
    }
  }, [recomputeLinkPaths, plans, drag, resize])

  function dayDeltaForPointer(planId: string, startX: number, currentX: number) {
    const el = gridRefs.current.get(planId)
    if (!el) return 0
    const cellWidth = el.getBoundingClientRect().width / daysInMonth
    if (!Number.isFinite(cellWidth) || cellWidth <= 0) return 0
    return Math.round((currentX - startX) / cellWidth)
  }

  function handlePlanClick(plan: ProductionPlanRow) {
    if (dependencySourcePlanId && dependencySourcePlanId !== plan.planId) {
      void onCreateDependency(dependencySourcePlanId, plan.planId)
      return
    }
    onSelectPlan(plan.planId)
  }

  function handlePointerDown(plan: ProductionPlanRow, event: PointerEvent<HTMLButtonElement>) {
    if (plan.status === "reserved") return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setResize(null)
    setDrag({ planId: plan.planId, startX: event.clientX, deltaDays: 0 })
  }

  function handleResizePointerDown(
    plan: ProductionPlanRow,
    edge: "start" | "end",
    event: PointerEvent<HTMLDivElement>
  ) {
    if (plan.status === "reserved") return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag(null)
    setResize({ planId: plan.planId, edge, startX: event.clientX, deltaDays: 0 })
  }

  function handleResizePointerMove(plan: ProductionPlanRow, event: PointerEvent<HTMLDivElement>) {
    if (!resize || resize.planId !== plan.planId) return
    const deltaDays = dayDeltaForPointer(plan.planId, resize.startX, event.clientX)
    if (resize.edge === "start") {
      const span = planSpanInMonth(plan, year, monthIdx)
      if (span && span.span - deltaDays < 1) return
    }
    if (resize.edge === "end") {
      const span = planSpanInMonth(plan, year, monthIdx)
      if (span && span.span + deltaDays < 1) return
    }
    if (deltaDays !== resize.deltaDays) setResize({ ...resize, deltaDays })
  }

  function handleResizePointerUp(plan: ProductionPlanRow, event: PointerEvent<HTMLDivElement>) {
    if (!resize || resize.planId !== plan.planId) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    const deltaDays = dayDeltaForPointer(plan.planId, resize.startX, event.clientX)
    const edge = resize.edge
    setResize(null)
    if (deltaDays === 0) return

    setPendingPlanId(plan.planId)
    const endKey = planEndDateKey(plan)
    const patch =
      edge === "start"
        ? { planDate: shiftDateKey(plan.planDate, deltaDays) }
        : { planDateTo: shiftDateKey(endKey, deltaDays) }

    if (edge === "start" && patch.planDate && patch.planDate > endKey) {
      setPendingPlanId(null)
      return
    }
    if (edge === "end" && patch.planDateTo && patch.planDateTo < plan.planDate) {
      setPendingPlanId(null)
      return
    }

    void onResizePlan(plan.code, patch).finally(() => setPendingPlanId(null))
  }

  function handlePointerMove(plan: ProductionPlanRow, event: PointerEvent<HTMLButtonElement>) {
    if (!drag || drag.planId !== plan.planId) return
    const deltaDays = dayDeltaForPointer(plan.planId, drag.startX, event.clientX)
    if (deltaDays !== drag.deltaDays) setDrag({ ...drag, deltaDays })
  }

  function handlePointerUp(plan: ProductionPlanRow, event: PointerEvent<HTMLButtonElement>) {
    if (!drag || drag.planId !== plan.planId) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    const deltaDays = dayDeltaForPointer(plan.planId, drag.startX, event.clientX)
    setDrag(null)
    if (deltaDays !== 0) {
      setPendingPlanId(plan.planId)
      void onShiftPlan(plan.code, deltaDays).finally(() => setPendingPlanId(null))
    }
  }

  if (plans.length === 0) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center rounded-xl border border-dashed bg-muted/10 p-6 text-center text-sm text-muted-foreground">
        Нет заказов для отображения на календаре
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
        <div ref={contentRef} className="relative min-w-max">
          {svgSize.w > 0 && linkPaths.length > 0 ? (
            <svg
              className="pointer-events-none absolute left-0 top-0 z-[5]"
              width={svgSize.w}
              height={svgSize.h}
              aria-hidden
            >
              <defs>
                <marker id="aps-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 Z" className="fill-indigo-500" />
                </marker>
              </defs>
              {linkPaths.map((path) => (
                <path
                  key={path.id}
                  d={path.d}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.75}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  className="text-indigo-500/85"
                  markerEnd="url(#aps-arrow)"
                />
              ))}
            </svg>
          ) : null}

          <div className="sticky top-0 z-20 grid border-b bg-muted/50" style={{ gridTemplateColumns: gridCols }}>
            <div
              data-aps-left-col="1"
              className="sticky left-0 z-30 border-r bg-muted/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
            >
              Номенклатура / линия
            </div>
            {dayMeta.map((d) => (
              <button
                key={d.key}
                type="button"
                data-aps-today={d.isToday ? "1" : undefined}
                title={`Открыть ${d.day} число по часам`}
                className={cn(
                  "border-r px-1 py-1 text-center text-[11px] font-medium leading-tight last:border-r-0 hover:bg-primary/10",
                  d.isToday ? "bg-primary/15 text-primary" : "text-muted-foreground",
                  d.isWeekend && !d.isToday && "bg-muted/30"
                )}
                onClick={() => onOpenDay?.(d.key)}
              >
                <div className="tabular-nums">{d.day}</div>
                <div className="text-[9px] font-normal opacity-80">{WEEKDAYS_RU[d.weekday]}</div>
              </button>
            ))}
          </div>

          {groups.map((group) => {
            const groupEvents = lineEvents.filter((ev) => apsLineEventGroupKey(ev) === group.key)

            return (
            <div key={group.key}>
              {/* Подпись группы держится у левого края: сетка месяца шире экрана
                  и при горизонтальной прокрутке она иначе уезжает из виду. */}
              <div className="border-b bg-muted/25 text-[11px] font-semibold text-muted-foreground">
                <span className="sticky left-0 inline-block px-2.5 py-0.5">
                  {group.label}
                  <span className="ml-1 font-normal tabular-nums">({group.plans.length})</span>
                </span>
              </div>

              {group.plans.map((plan) => {
                const span = planSpanInMonth(plan, year, monthIdx)
                const selected = plan.planId === selectedPlanId
                const source = plan.planId === dependencySourcePlanId
                const fact = resolveApsPlanFact(plan)
                const timing = resolveApsPlanTiming(plan, fact)
                const progress = fact.barPercent
                const barLabel = apsFactLabel(fact, { short: true })
                const tooltip = [
                  plan.itemName,
                  `${plan.code} · ${planPeriod(plan)} · ${planLabel(plan)}`,
                  fact.factQty != null
                    ? `Сделано ${formatApsQty(fact.factQty)} шт${
                        fact.planQty != null ? ` из ${formatApsQty(fact.planQty)}` : ""
                      }`
                    : fact.state === "running"
                      ? "Идёт выпуск, факт придёт после закрытия партии"
                      : fact.planQty != null
                        ? `План ${formatApsQty(fact.planQty)} шт, факта нет`
                        : "Количество неизвестно",
                  timing.ratePerHour != null ? `Темп ${formatApsQty(timing.ratePerHour)} шт/ч` : "",
                ]
                  .filter(Boolean)
                  .join("\n")
                const dragging = drag?.planId === plan.planId ? drag.deltaDays : 0
                const resizing = resize?.planId === plan.planId ? resize : null
                const pending = pendingPlanId === plan.planId
                let barStartCol = span?.startCol ?? 1
                let barSpan = span?.span ?? 1
                if (span && dragging) {
                  barStartCol += dragging
                }
                if (span && resizing) {
                  if (resizing.edge === "start") {
                    barStartCol += resizing.deltaDays
                    barSpan -= resizing.deltaDays
                  } else {
                    barSpan += resizing.deltaDays
                  }
                }
                barSpan = Math.max(1, barSpan)

                return (
                  <div
                    key={plan.planId}
                    className="grid border-b last:border-b-0"
                    style={{ gridTemplateColumns: gridCols }}
                  >
                    <button
                      type="button"
                      className={cn(
                        "sticky left-0 z-10 flex min-h-[52px] flex-col justify-center gap-px border-r bg-card px-2.5 py-1 text-left text-xs transition-colors hover:bg-muted/40",
                        selected && "bg-primary/10 ring-1 ring-inset ring-primary/30",
                        source && "bg-amber-500/10 ring-1 ring-inset ring-amber-500/40"
                      )}
                      onClick={() => handlePlanClick(plan)}
                      onDoubleClick={() => onOpenMrp(plan.code)}
                    >
                      <span className="line-clamp-2 font-medium leading-tight text-foreground" title={plan.itemName}>{plan.itemName}</span>
                      <span className="truncate text-[10px] leading-tight text-muted-foreground">
                        {plan.code} · {planLabel(plan)} · {planPeriod(plan)}
                      </span>
                      <ApsFactLine plan={plan} />
                    </button>

                    <div
                      ref={(node) => {
                        if (node) gridRefs.current.set(plan.planId, node)
                        else gridRefs.current.delete(plan.planId)
                      }}
                      className="relative min-h-[52px]"
                      style={{ gridColumn: `2 / span ${daysInMonth}` }}
                    >
                      <div
                        className="absolute inset-0 grid"
                        style={{ gridTemplateColumns: `repeat(${daysInMonth}, 1fr)` }}
                      >
                        {dayMeta.map((d) => (
                          <div
                            key={d.key}
                            className={cn(
                              "border-r last:border-r-0",
                              d.isToday && "bg-primary/5",
                              d.isWeekend && !d.isToday && "bg-muted/10"
                            )}
                          />
                        ))}
                      </div>

                      {span ? (
                        <div
                          ref={(node) => {
                            if (node) barRefs.current.set(plan.planId, node)
                            else barRefs.current.delete(plan.planId)
                          }}
                          className={cn(
                            "absolute top-1/2 z-[2] flex h-8 min-w-0 -translate-y-1/2 overflow-hidden rounded-md text-left text-[10px] font-medium text-white shadow-sm",
                            selected && "ring-2 ring-primary ring-offset-1",
                            source && "ring-2 ring-amber-500 ring-offset-1",
                            plan.status === "reserved" && "opacity-90",
                            pending && "animate-pulse"
                          )}
                          style={{
                            left: `calc((100% / ${daysInMonth}) * ${barStartCol - 1} + 2px)`,
                            width: `calc((100% / ${daysInMonth}) * ${barSpan} - 4px)`,
                            backgroundColor: apsPlanBarColor(plan),
                          }}
                        >
                          <div
                            role="separator"
                            aria-label="Изменить начало"
                            className={cn(
                              "w-2 shrink-0 touch-none",
                              plan.status === "reserved" ? "cursor-not-allowed" : "cursor-ew-resize hover:bg-white/25"
                            )}
                            onPointerDown={(e) => handleResizePointerDown(plan, "start", e)}
                            onPointerMove={(e) => handleResizePointerMove(plan, e)}
                            onPointerUp={(e) => handleResizePointerUp(plan, e)}
                            onPointerCancel={() => setResize(null)}
                          />
                          <button
                            type="button"
                            title={tooltip}
                            className={cn(
                              "flex min-w-0 flex-1 cursor-grab flex-col overflow-hidden text-left active:cursor-grabbing",
                              plan.status === "reserved" && "cursor-not-allowed"
                            )}
                            onClick={() => handlePlanClick(plan)}
                            onDoubleClick={(e) => {
                              e.preventDefault()
                              onOpenMrp(plan.code)
                            }}
                            onPointerDown={(e) => handlePointerDown(plan, e)}
                            onPointerMove={(e) => handlePointerMove(plan, e)}
                            onPointerUp={(e) => handlePointerUp(plan, e)}
                            onPointerCancel={() => setDrag(null)}
                          >
                            {/* Внутри однодневной полоски остаётся ~32px — там не
                                помещается ни одно осмысленное число, поэтому вместо
                                обрезанной подписи показывается значок статуса. Точное
                                количество всегда есть в левой колонке и в тултипе. */}
                            <span className="flex min-w-0 flex-1 items-center justify-center px-0.5">
                              {barSpan >= 3 ? (
                                <span className="truncate tabular-nums">{barLabel}</span>
                              ) : fact.state === "running" ? (
                                <Radio className="size-3 shrink-0 animate-pulse opacity-90" />
                              ) : fact.factQty != null ? (
                                <Check className="size-3 shrink-0 opacity-90" />
                              ) : null}
                            </span>
                            <span className="h-1 bg-white/25">
                              <span className="block h-full bg-white" style={{ width: `${progress}%` }} />
                            </span>
                          </button>
                          <div
                            role="separator"
                            aria-label="Изменить окончание"
                            className={cn(
                              "w-2 shrink-0 touch-none",
                              plan.status === "reserved" ? "cursor-not-allowed" : "cursor-ew-resize hover:bg-white/25"
                            )}
                            onPointerDown={(e) => handleResizePointerDown(plan, "end", e)}
                            onPointerMove={(e) => handleResizePointerMove(plan, e)}
                            onPointerUp={(e) => handleResizePointerUp(plan, e)}
                            onPointerCancel={() => setResize(null)}
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })}

              {groupEvents.length > 0 ? (
                <div className="grid border-b bg-muted/10" style={{ gridTemplateColumns: gridCols }}>
                  <div className="sticky left-0 z-10 border-r bg-muted/10 px-3 py-1.5 text-[10px] text-muted-foreground">
                    События линии
                  </div>
                  <div className="relative min-h-9" style={{ gridColumn: `2 / span ${daysInMonth}` }}>
                    <div
                      className="absolute inset-0 grid"
                      style={{ gridTemplateColumns: `repeat(${daysInMonth}, 1fr)` }}
                    >
                      {dayMeta.map((d) => (
                        <div key={d.key} className="border-r last:border-r-0" />
                      ))}
                    </div>
                    {groupEvents.map((ev) => {
                      const day = apsLineEventDayInMonth(ev, year, monthIdx)
                      if (!day) return null
                      const left = `calc((100% / ${daysInMonth}) * ${day - 1} + (100% / ${daysInMonth}) / 2)`
                      return <LineEventMarker key={ev.eventId} kind={ev.kind} leftPct={left} title={ev.title} />
                    })}
                  </div>
                </div>
              ) : null}
            </div>
            )
          })}
        </div>
      </div>

      <div className="shrink-0 space-y-1 border-t bg-muted/20 px-2.5 py-1 text-[11px] text-muted-foreground">
        {selectedPlan ? (
          <div className="flex flex-wrap items-center gap-1.5 text-foreground">
            <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px] font-normal">
              {selectedPlan.code}
            </Badge>
            <span className="max-w-[200px] truncate text-muted-foreground">{selectedPlan.itemName}</span>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-1.5 text-[11px]"
              title="Открыть карточку заказа"
              onClick={() => onEditPlan(selectedPlan.code)}
            >
              Изменить
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-1.5 text-[11px] tabular-nums"
              title="Сдвинуть заказ на день назад"
              disabled={selectedPlan.status === "reserved"}
              onClick={() => void onShiftPlan(selectedPlan.code, -1)}
            >
              −1 д
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-1.5 text-[11px] tabular-nums"
              title="Сдвинуть заказ на день вперёд"
              disabled={selectedPlan.status === "reserved"}
              onClick={() => void onShiftPlan(selectedPlan.code, 1)}
            >
              +1 д
            </Button>
            <Button
              variant={dependencySourcePlanId === selectedPlan.planId ? "secondary" : "outline"}
              size="sm"
              className="h-6 px-1.5 text-[11px]"
              title="Сделать этот заказ предыдущим в цепочке"
              disabled={selectedPlan.status === "reserved"}
              onClick={() => onSetDependencySource(dependencySourcePlanId === selectedPlan.planId ? null : selectedPlan.planId)}
            >
              <Link2 className="mr-1 size-3" />
              Связь
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-1.5 text-[11px]"
              title="Поставить мойку после заказа"
              onClick={() => onRequestLineEvent("wash", selectedPlan)}
            >
              <Droplets className="mr-1 size-3 text-sky-600" />
              Мойка
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-1.5 text-[11px]"
              title="Поставить профилактику после заказа"
              onClick={() => onRequestLineEvent("maint", selectedPlan)}
            >
              <Wrench className="mr-1 size-3 text-amber-600" />
              Профилактика
            </Button>
            {dependencySource ? (
              <Badge variant="outline" className="h-5 border-amber-500/50 bg-amber-500/10 px-1.5 text-[10px] font-normal text-amber-700 dark:text-amber-300">
                Связь от {dependencySource.code}: выберите следующий заказ
              </Badge>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2.5">
            <span>Полоска: центр — сдвиг, края — длительность, двойной клик — MRP</span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-flex size-3.5 items-center justify-center rounded-full border border-sky-500 bg-sky-50">
                <Droplets className="size-2 text-sky-600" />
              </span>
              мойка
            </span>
            <span className="inline-flex items-center gap-1">
              <Wrench className="size-3 text-amber-600" />
              профилактика
            </span>
            <span className="hidden 2xl:inline">Клик по заказу — действия и связи</span>
          </div>
        )}

        {selectedLinks.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span>Связи выбранного:</span>
            {selectedLinks.map((link) => {
              const source = planById.get(link.sourcePlanId)
              const target = planById.get(link.targetPlanId)
              return (
                <Badge key={link.linkId} variant="outline" className="gap-1">
                  <span>{source?.code ?? link.sourcePlanId}</span>
                  <ArrowRight className="size-3" />
                  <span>{target?.code ?? link.targetPlanId}</span>
                  <span className="text-muted-foreground">({linkTypeLabel(link.type)} +{link.lagDays}д)</span>
                  <button
                    type="button"
                    className="ml-1 rounded-sm text-muted-foreground hover:text-destructive"
                    onClick={() => void onDeleteDependency(link.linkId)}
                    aria-label="Удалить связь"
                  >
                    <Link2Off className="size-3" />
                  </button>
                </Badge>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}
