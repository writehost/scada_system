"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowRight, Droplets, Link2, Link2Off, Wrench } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ProductionPlanLinkRow, ProductionPlanRow, VekasApsWatchRow } from "@/lib/wms-api"
import type { ApsLineEventKind, ApsLineEventRow } from "@/lib/wms/aps-line-events"
import { apsLineEventGroupKey } from "@/lib/wms/aps-line-events"
import {
  apsPlanBarColor,
  groupProductionPlansByLine,
  planOverlapsDateKey,
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
  dayKey: string
  watches: VekasApsWatchRow[]
  selectedPlanId: string | null
  dependencySourcePlanId: string | null
  onSelectPlan: (planId: string) => void
  onOpenMrp: (code: string) => void
  onEditPlan: (code: string) => void
  onShiftPlan: (planCode: string, deltaDays: number) => Promise<void>
  onCreateDependency: (sourcePlanId: string, targetPlanId: string) => Promise<void>
  onDeleteDependency: (linkId: string) => Promise<void>
  onSetDependencySource: (planId: string | null) => void
  onRequestLineEvent: (kind: ApsLineEventKind, plan: ProductionPlanRow) => void
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
const FACTORY_TZ = "Asia/Vladivostok"

function parseTs(value: string | null | undefined): Date | null {
  if (!value) return null
  let raw = String(value).trim()
  if (!raw) return null
  raw = raw.replace(/\.(\d{3})\d+/, ".$1")
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    raw = `${raw}+10:00`
  }
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

function factoryClock(date: Date): { dayKey: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: FACTORY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  return {
    dayKey: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  }
}

function pad2(n: number) {
  return String(n).padStart(2, "0")
}

function formatClock(hour: number, minute: number) {
  return `${pad2(hour)}:${pad2(minute)}`
}

function planLabel(plan: ProductionPlanRow) {
  const ws = plan.workshopCode || "Без цеха"
  if (plan.lineCode) return `${ws} · смена ${plan.lineCode}`
  return ws
}

function watchForPlan(plan: ProductionPlanRow, watches: VekasApsWatchRow[]) {
  return (
    watches.find((w) => w.planId && w.planId === plan.planId) ??
    watches.find((w) => w.planCode && w.planCode === plan.code) ??
    null
  )
}

function clipHoursToDay(
  start: Date,
  end: Date,
  dayKey: string
): { startHour: number; endHour: number; timeLabel: string } | null {
  const from = factoryClock(start)
  const to = factoryClock(end)
  if (to.dayKey < dayKey || from.dayKey > dayKey) return null
  const startHour = from.dayKey < dayKey ? 0 : from.hour + from.minute / 60
  let endHour = to.dayKey > dayKey ? 24 : to.hour + to.minute / 60
  if (endHour <= startHour) endHour = Math.min(24, startHour + 1 / 60)
  const labelStart = from.dayKey < dayKey ? "00:00" : formatClock(from.hour, from.minute)
  const labelEnd = to.dayKey > dayKey ? "24:00" : formatClock(to.hour, to.minute)
  return { startHour, endHour, timeLabel: `${labelStart}–${labelEnd}` }
}

function watchSpanOnDay(
  watch: VekasApsWatchRow | null,
  dayKey: string
): { startHour: number; endHour: number; timeLabel: string } | null {
  if (!watch) return null
  const start = parseTs(watch.startedAt)
  if (!start) return null
  const end =
    parseTs(watch.finishedAt) ??
    (watch.watchState === "watching" ? new Date() : null) ??
    parseTs(watch.completedAt) ??
    start
  return clipHoursToDay(start, end < start ? start : end, dayKey)
}

function planHoursOnDay(
  plan: ProductionPlanRow,
  dayKey: string,
  watch: VekasApsWatchRow | null
): { startHour: number; endHour: number; timeLabel: string } | null {
  const fromWatch = watchSpanOnDay(watch, dayKey)
  if (fromWatch) return fromWatch
  const fromPlan = watchSpanOnDay(
    {
      startedAt: plan.startedAt ?? null,
      finishedAt: plan.finishedAt ?? null,
      watchState: plan.status === "in_progress" ? "watching" : "completed",
      completedAt: null,
    } as VekasApsWatchRow,
    dayKey
  )
  if (fromPlan) return fromPlan
  if (!planOverlapsDateKey(plan, dayKey)) return null

  const startKey = plan.planDate
  const endKey = plan.planDateTo && plan.planDateTo >= plan.planDate ? plan.planDateTo : plan.planDate
  if (startKey === endKey) return { startHour: 8, endHour: 20, timeLabel: "08:00–20:00" }
  if (dayKey === startKey) return { startHour: 8, endHour: 24, timeLabel: "с 08:00" }
  if (dayKey === endKey) return { startHour: 0, endHour: 20, timeLabel: "до 20:00" }
  return { startHour: 0, endHour: 24, timeLabel: "весь день" }
}

function linkTypeLabel(type: ProductionPlanLinkRow["type"]) {
  if (type === "s2s") return "старт-старт"
  if (type === "s2e") return "старт-финиш"
  if (type === "e2e") return "финиш-финиш"
  return "после"
}

export function ProductionDayCalendar({
  plans,
  links,
  lineEvents,
  dayKey,
  watches,
  selectedPlanId,
  dependencySourcePlanId,
  onSelectPlan,
  onOpenMrp,
  onEditPlan,
  onShiftPlan,
  onCreateDependency,
  onDeleteDependency,
  onSetDependencySource,
  onRequestLineEvent,
}: Props) {
  const [nowHour, setNowHour] = useState(() => factoryClock(new Date()).hour)
  useEffect(() => {
    const tick = () => setNowHour(factoryClock(new Date()).hour)
    const id = window.setInterval(tick, 60_000)
    return () => window.clearInterval(id)
  }, [])
  const todayKey = useMemo(() => factoryClock(new Date()).dayKey, [])
  const isToday = dayKey === todayKey
  const dayPlans = useMemo(
    () =>
      plans.filter((plan) => {
        if (planOverlapsDateKey(plan, dayKey)) return true
        return watchSpanOnDay(watchForPlan(plan, watches), dayKey) != null
      }),
    [dayKey, plans, watches]
  )
  const groups = useMemo(() => groupProductionPlansByLine(dayPlans), [dayPlans])
  const planById = useMemo(() => new Map(plans.map((plan) => [plan.planId, plan])), [plans])
  const selectedPlan = selectedPlanId ? planById.get(selectedPlanId) ?? null : null
  const dependencySource = dependencySourcePlanId ? planById.get(dependencySourcePlanId) ?? null : null
  const selectedLinks = useMemo(() => {
    if (!selectedPlanId) return []
    return links.filter((link) => link.sourcePlanId === selectedPlanId || link.targetPlanId === selectedPlanId)
  }, [links, selectedPlanId])
  const dayEvents = useMemo(() => lineEvents.filter((ev) => ev.dateKey === dayKey), [dayKey, lineEvents])

  const gridCols = `minmax(300px, 360px) repeat(24, minmax(46px, 1fr))`

  function handlePlanClick(plan: ProductionPlanRow) {
    if (dependencySourcePlanId && dependencySourcePlanId !== plan.planId) {
      void onCreateDependency(dependencySourcePlanId, plan.planId)
      return
    }
    onSelectPlan(plan.planId)
  }

  if (dayPlans.length === 0) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center rounded-xl border border-dashed bg-muted/10 p-6 text-center text-sm text-muted-foreground">
        На этот день заказов нет
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
      <div className="relative min-h-0 flex-1 overflow-auto">
        <div className="min-w-max">
          <div className="sticky top-0 z-20 grid border-b bg-muted/50" style={{ gridTemplateColumns: gridCols }}>
            <div className="sticky left-0 z-30 border-r bg-muted/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              Номенклатура / линия
            </div>
            {HOURS.map((hour) => (
              <div
                key={hour}
                className={cn(
                  "border-r px-0.5 py-1 text-center text-[11px] font-medium leading-tight last:border-r-0",
                  isToday && hour === nowHour ? "bg-primary/15 text-primary" : "text-muted-foreground"
                )}
              >
                <div className="tabular-nums">{String(hour).padStart(2, "0")}</div>
              </div>
            ))}
          </div>

          {groups.map((group) => {
            const groupEvents = dayEvents.filter((ev) => apsLineEventGroupKey(ev) === group.key)
            return (
              <div key={group.key}>
                <div className="border-b bg-muted/25 text-[11px] font-semibold text-muted-foreground">
                  <span className="sticky left-0 inline-block px-2.5 py-0.5">
                    {group.label}
                    <span className="ml-1 font-normal tabular-nums">({group.plans.length})</span>
                  </span>
                </div>
                {group.plans.map((plan) => {
                  const watch = watchForPlan(plan, watches)
                  const span = planHoursOnDay(plan, dayKey, watch)
                  const selected = plan.planId === selectedPlanId
                  const source = plan.planId === dependencySourcePlanId
                  const fact = resolveApsPlanFact(plan)
                  const timing = resolveApsPlanTiming(plan, fact)
                  const progress = fact.barPercent
                  const tooltip = [
                    plan.itemName,
                    `${plan.code}${span ? ` · ${span.timeLabel}` : ""} · ${planLabel(plan)}`,
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
                  return (
                    <div key={plan.planId} className="grid border-b last:border-b-0" style={{ gridTemplateColumns: gridCols }}>
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
                          {plan.code} · {planLabel(plan)}
                          {span ? ` · ${span.timeLabel}` : ""}
                        </span>
                        <ApsFactLine plan={plan} />
                      </button>
                      <div className="relative min-h-[52px]" style={{ gridColumn: "2 / span 24" }}>
                        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: "repeat(24, 1fr)" }}>
                          {HOURS.map((hour) => (
                            <div
                              key={hour}
                              className={cn(
                                "border-r last:border-r-0",
                                isToday && hour === nowHour && "bg-primary/5"
                              )}
                            />
                          ))}
                        </div>
                        {span ? (
                          <button
                            type="button"
                            title={tooltip}
                            className={cn(
                              "absolute top-1/2 z-[2] flex h-8 min-w-0 -translate-y-1/2 overflow-hidden rounded-md text-left text-[10px] font-medium text-white shadow-sm",
                              selected && "ring-2 ring-primary ring-offset-1",
                              source && "ring-2 ring-amber-500 ring-offset-1"
                            )}
                            style={{
                              left: `calc((100% / 24) * ${span.startHour} + 2px)`,
                              width: `calc((100% / 24) * ${span.endHour - span.startHour} - 4px)`,
                              backgroundColor: apsPlanBarColor(plan),
                            }}
                            onClick={() => handlePlanClick(plan)}
                            onDoubleClick={(e) => {
                              e.preventDefault()
                              onOpenMrp(plan.code)
                            }}
                          >
                            <span className="flex min-w-0 flex-1 flex-col overflow-hidden">
                              <span className="truncate px-1.5 pt-0.5">
                                {span.timeLabel} · {apsFactLabel(fact, { short: true })}
                              </span>
                              <span className="mt-auto h-1 bg-white/25">
                                <span className="block h-full bg-white" style={{ width: `${progress}%` }} />
                              </span>
                            </span>
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
                {groupEvents.length > 0 ? (
                  <div className="grid border-b bg-muted/10" style={{ gridTemplateColumns: gridCols }}>
                    <div className="sticky left-0 z-10 border-r bg-muted/10 px-2.5 py-1 text-[10px] text-muted-foreground">
                      События линии
                    </div>
                    <div className="relative min-h-9" style={{ gridColumn: "2 / span 24" }}>
                      {groupEvents.map((ev) => (
                        <div
                          key={ev.eventId}
                          className="absolute top-1/2 z-[4] -translate-x-1/2 -translate-y-1/2"
                          style={{ left: "calc((100% / 24) * 8 + (100% / 24) / 2)" }}
                          title={ev.title}
                        >
                          {ev.kind === "wash" ? (
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
                      ))}
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
              onClick={() =>
                onSetDependencySource(dependencySourcePlanId === selectedPlan.planId ? null : selectedPlan.planId)
              }
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
            <span>Полоска — старт и финиш с линии, двойной клик — MRP</span>
            {isToday ? <span>Подсвечен текущий час {String(nowHour).padStart(2, "0")}:00</span> : null}
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
                  <span className="text-muted-foreground">
                    ({linkTypeLabel(link.type)} +{link.lagDays}д)
                  </span>
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
