"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  ContextMenu,
  Gantt,
  Toolbar,
  Willow,
  getMenuOptions,
  getToolbarButtons,
  type IApi,
  type ILink,
  type ITask,
} from "@svar-ui/react-gantt"
import "@svar-ui/react-gantt/all.css"
import { Locale } from "@svar-ui/react-core"
import { ru as coreRu } from "@svar-ui/core-locales"
import type { ProductionPlanLinkRow, ProductionPlanRow } from "@/lib/wms-api"
import { productionGanttRuWords } from "@/lib/wms/production-gantt-locale"
import {
  ganttTaskIdFromPlanId,
  calculateProductionGanttLayout,
  inclusiveEndFromExclusive,
  linkIdFromGanttLinkId,
  planIdFromGanttTaskId,
  productionGanttScales,
  productionPlanLinksToGanttLinks,
  productionPlansToGanttTasks,
  resolveApsPlanQtyLabel,
  toDateKey,
} from "@/lib/wms/production-gantt-mapper"

type ProductionGanttBoardProps = {
  plans: ProductionPlanRow[]
  links: ProductionPlanLinkRow[]
  year: number
  monthIdx: number
  selectedPlanId: string | null
  onSelectPlanCode: (planCode: string) => void
  onOpenPlanDetail: (planCode: string) => void
  onEditPlan: (planCode: string) => void
  planCodeById: Map<string, string>
  planById: Map<string, ProductionPlanRow>
  onPlanReschedule: (planCode: string, planDate: string, planDateTo: string | null) => Promise<void>
  onPlanCopy: (planCode: string, planDate: string, planDateTo: string | null) => Promise<void>
  onPlanDelete: (planCode: string) => Promise<void>
  onLinkCreate: (input: {
    sourcePlanId: string
    targetPlanId: string
    type: ProductionPlanLinkRow["type"]
    lagDays?: number
  }) => Promise<void>
  onLinkUpdate: (
    linkId: string,
    patch: Partial<{ type: ProductionPlanLinkRow["type"]; lagDays: number }>
  ) => Promise<void>
  onLinkDelete: (linkId: string) => Promise<void>
  onMutationError: (message: string) => void
  onRecover: () => Promise<void>
}

const APS_CONTEXT_MENU_IDS = new Set(["edit-task", "copy-task", "cut-task", "paste-task", "delete-task"])

function ApsGanttTaskLabel({
  data,
  planById,
}: {
  data: ITask & { qtyLabel?: string; plannedQty?: number }
  planById: Map<string, ProductionPlanRow>
}): ReactNode {
  const planId = planIdFromGanttTaskId(data.id)
  const plan = planId ? planById.get(planId) : null
  const qty = resolveApsPlanQtyLabel(plan, data)
  if (!qty) return null
  return (
    <div className="aps-gantt-bar-qty" title={qty}>
      {qty}
    </div>
  )
}

function planCodeForTask(taskId: string | number, planCodeById: Map<string, string>): string | null {
  const planId = planIdFromGanttTaskId(taskId)
  if (!planId) return null
  return planCodeById.get(planId) ?? null
}

function datesFromTask(task: Partial<ITask>): { planDate: string; planDateTo: string | null } | null {
  if (!task.start || !task.end) return null
  const planDate = toDateKey(task.start)
  const planDateTo = inclusiveEndFromExclusive(task.end)
  return { planDate, planDateTo: planDateTo === planDate ? null : planDateTo }
}

function planDatesEqual(
  plan: ProductionPlanRow,
  dates: { planDate: string; planDateTo: string | null }
): boolean {
  const currentTo =
    plan.planDateTo && plan.planDateTo >= plan.planDate ? plan.planDateTo : null
  return dates.planDate === plan.planDate && dates.planDateTo === currentTo
}

function resolveTaskDates(
  api: IApi | null,
  taskId: string | number,
  patch: Partial<ITask>
): { planDate: string; planDateTo: string | null } | null {
  const current = api?.getTask(taskId)
  return datesFromTask({ ...current, ...patch })
}

function scrollChartToTask(api: IApi, taskId: string) {
  const task = api.getTask(taskId) as { $x?: number } | null
  if (task?.$x == null) return
  api.exec("scroll-chart", { left: Math.max(0, task.$x - 48) })
}

export function ProductionGanttBoard({
  plans,
  links,
  year,
  monthIdx,
  selectedPlanId,
  onSelectPlanCode,
  onOpenPlanDetail,
  onEditPlan,
  planCodeById,
  planById,
  onPlanReschedule,
  onPlanCopy,
  onPlanDelete,
  onLinkCreate,
  onLinkUpdate,
  onLinkDelete,
  onMutationError,
  onRecover,
}: ProductionGanttBoardProps) {
  const [api, setApi] = useState<IApi | null>(null)
  const apiRef = useRef<IApi | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const pendingRef = useRef(false)
  const mainRef = useRef<HTMLDivElement>(null)
  const lastSelectRef = useRef<{ id: string | number; at: number } | null>(null)

  const tasks = useMemo(() => productionPlansToGanttTasks(plans), [plans])
  const ganttLinks = useMemo(() => productionPlanLinksToGanttLinks(links), [links])

  const taskTemplate = useCallback(
    (props: { data: ITask }) => <ApsGanttTaskLabel data={props.data} planById={planById} />,
    [planById]
  )

  const apsGanttLocale = useMemo(() => ({ ...coreRu, ...productionGanttRuWords }), [])

  const contextMenuOptions = useMemo(
    () =>
      getMenuOptions({ splitTasks: false }).filter(
        (item) => item.id != null && APS_CONTEXT_MENU_IDS.has(String(item.id))
      ),
    []
  )

  const toolbarItems = useMemo(() => {
    const supported = new Set(["delete-task", "copy-task", "paste-task"])
    const labels: Record<string, string> = {
      "delete-task": "Удалить",
      "copy-task": "Копировать",
      "paste-task": "Вставить",
    }
    const items = getToolbarButtons().filter(
      (item) => item.comp === "separator" || (item.id != null && supported.has(String(item.id)))
    )
    return items
      .filter(
        (item, index) =>
          item.comp !== "separator" ||
          (index > 0 &&
            index < items.length - 1 &&
            items[index - 1]?.comp !== "separator")
      )
      .map((item) => {
        if (item.comp === "separator" || item.id == null) return item
        const id = String(item.id)
        return { ...item, comp: "button" as const, text: labels[id] ?? item.text }
      })
  }, [])

  const range = useMemo(() => {
    const start = new Date(year, monthIdx, 1)
    const end = new Date(year, monthIdx + 1, 0)
    end.setDate(end.getDate() + 1)
    return { start, end }
  }, [year, monthIdx])

  const daysInRange = useMemo(
    () => new Date(year, monthIdx + 1, 0).getDate(),
    [year, monthIdx]
  )
  const layout = useMemo(
    () => calculateProductionGanttLayout(containerWidth, daysInRange, true),
    [containerWidth, daysInRange]
  )

  const markers = useMemo(() => {
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    return [{ start: today, text: "Сегодня" }]
  }, [])

  const selected = useMemo(() => {
    if (!selectedPlanId) return undefined
    return [ganttTaskIdFromPlanId(selectedPlanId)]
  }, [selectedPlanId])

  const runMutation = useCallback(
    async (fn: () => Promise<void>) => {
      if (pendingRef.current) return
      pendingRef.current = true
      try {
        await fn()
      } catch (e) {
        onMutationError(e instanceof Error ? e.message : "Не удалось сохранить изменения")
        await onRecover().catch(() => undefined)
      } finally {
        pendingRef.current = false
      }
    },
    [onMutationError, onRecover]
  )

  const handleInit = useCallback((nextApi: IApi) => {
    apiRef.current = nextApi
    setApi(nextApi)
  }, [])

  useEffect(() => {
    const element = mainRef.current
    if (!element) return
    const updateWidth = () => setContainerWidth(element.getBoundingClientRect().width)
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!api) return
    api.intercept(
      "show-editor",
      (ev: { id?: string | number | null }) => {
        if (ev.id == null) return false
        const code = planCodeForTask(ev.id, planCodeById)
        if (!code) return false
        onEditPlan(code)
        return false
      },
      { tag: "aps-editor" }
    )
    return () => api.detach("aps-editor")
  }, [api, onEditPlan, planCodeById])

  useEffect(() => {
    if (!api || !selectedPlanId) return
    const taskId = ganttTaskIdFromPlanId(selectedPlanId)
    requestAnimationFrame(() => scrollChartToTask(api, taskId))
  }, [api, selectedPlanId, tasks])

  useEffect(() => {
    if (!api || selectedPlanId || plans.length === 0) return
    const first = plans[0]
    if (!first) return
    requestAnimationFrame(() => scrollChartToTask(api, ganttTaskIdFromPlanId(first.planId)))
  }, [api, plans, selectedPlanId, tasks])

  useEffect(() => {
    if (!api) return

    const blockIfLocked = (taskId: string | number) => {
      const planId = planIdFromGanttTaskId(taskId)
      if (!planId) return true
      const plan = planById.get(planId)
      return !plan || plan.status === "reserved"
    }
    const blockLinkIfLocked = (linkId: string | number) => {
      const id = linkIdFromGanttLinkId(linkId)
      if (!id) return true
      const link = links.find((item) => item.linkId === id)
      if (!link) return true
      return blockIfLocked(ganttTaskIdFromPlanId(link.sourcePlanId)) ||
        blockIfLocked(ganttTaskIdFromPlanId(link.targetPlanId))
    }

    api.detach("aps-guards")
    api.intercept("update-task", (ev) => {
      if (pendingRef.current) return false
      if (blockIfLocked(ev.id)) return false
    }, { tag: "aps-guards" })
    api.intercept("drag-task", (ev) => {
      if (pendingRef.current) return false
      if (blockIfLocked(ev.id)) return false
    }, { tag: "aps-guards" })
    api.intercept("delete-task", (ev) => {
      if (pendingRef.current) return false
      if (blockIfLocked(ev.id)) return false
      const planId = planIdFromGanttTaskId(ev.id)
      const plan = planId ? planById.get(planId) : null
      if (!plan || !confirm(`Удалить производственный заказ «${plan.itemName}»?`)) return false
    }, { tag: "aps-guards" })
    api.intercept("copy-task", (ev) => {
      if (pendingRef.current) return false
      if (blockIfLocked(ev.id)) return false
    }, { tag: "aps-guards" })
    api.intercept("add-link", (ev) => {
      if (pendingRef.current) return false
      if (blockIfLocked(ev.link.source!) || blockIfLocked(ev.link.target!)) return false
    }, { tag: "aps-guards" })
    api.intercept("update-link", (ev) => {
      if (pendingRef.current) return false
      if (blockLinkIfLocked(ev.id)) return false
    }, { tag: "aps-guards" })
    api.intercept("delete-link", (ev) => {
      if (pendingRef.current) return false
      if (blockLinkIfLocked(ev.id)) return false
    }, { tag: "aps-guards" })

    return () => api.detach("aps-guards")
  }, [api, links, planById])

  const handleSelectTask = useCallback(
    (ev: { id: string | number }) => {
      const code = planCodeForTask(ev.id, planCodeById)
      if (!code) return

      const now = Date.now()
      const last = lastSelectRef.current
      if (last && last.id === ev.id && now - last.at < 450) {
        lastSelectRef.current = null
        onOpenPlanDetail(code)
        return
      }

      lastSelectRef.current = { id: ev.id, at: now }
      onSelectPlanCode(code)
    },
    [onOpenPlanDetail, onSelectPlanCode, planCodeById]
  )

  const persistPlanDates = useCallback(
    (taskId: string | number, patch: Partial<ITask>) => {
      const planId = planIdFromGanttTaskId(taskId)
      if (!planId) return
      const plan = planById.get(planId)
      if (!plan || plan.status === "reserved") return

      const dates = resolveTaskDates(apiRef.current, taskId, patch)
      if (!dates || planDatesEqual(plan, dates)) return

      void runMutation(async () => {
        await onPlanReschedule(plan.code, dates.planDate, dates.planDateTo)
      })
    },
    [onPlanReschedule, planById, runMutation]
  )

  const handleUpdateTask = useCallback(
    (ev: { id: string | number; task: Partial<ITask>; inProgress?: boolean }) => {
      if (ev.inProgress) return
      persistPlanDates(ev.id, ev.task)
    },
    [persistPlanDates]
  )

  const handleDragTask = useCallback(
    (ev: { id: string | number; inProgress?: boolean }) => {
      if (ev.inProgress) return
      persistPlanDates(ev.id, {})
    },
    [persistPlanDates]
  )

  const handleCopyTask = useCallback(
    (ev: { id: string | number; source?: string | number }) => {
      const sourceId = ev.source ?? ev.id
      const planId = planIdFromGanttTaskId(sourceId)
      if (!planId) return
      const plan = planById.get(planId)
      if (!plan || plan.status === "reserved") return

      const copied = api?.getTask(ev.id)
      const dates = copied ? datesFromTask(copied) : null
      const planDate = dates?.planDate ?? plan.planDate
      const planDateTo = dates?.planDateTo ?? plan.planDateTo

      void runMutation(async () => {
        await onPlanCopy(plan.code, planDate, planDateTo)
      })
    },
    [api, onPlanCopy, planById, runMutation]
  )

  const handleDeleteTask = useCallback(
    (ev: { id: string | number }) => {
      const planId = planIdFromGanttTaskId(ev.id)
      if (!planId) return
      const plan = planById.get(planId)
      if (!plan || plan.status === "reserved") return

      void runMutation(async () => {
        await onPlanDelete(plan.code)
      })
    },
    [onPlanDelete, planById, runMutation]
  )

  const handleAddLink = useCallback(
    (ev: { link: Partial<ILink> }) => {
      const sourcePlanId = planIdFromGanttTaskId(ev.link.source!)
      const targetPlanId = planIdFromGanttTaskId(ev.link.target!)
      if (!sourcePlanId || !targetPlanId) return

      void runMutation(async () => {
        await onLinkCreate({
          sourcePlanId,
          targetPlanId,
          type: (ev.link.type ?? "e2s") as ProductionPlanLinkRow["type"],
          lagDays: ev.link.lag,
        })
      })
    },
    [onLinkCreate, runMutation]
  )

  const handleUpdateLink = useCallback(
    (ev: { id: string | number; link: Partial<ILink> }) => {
      const linkId = linkIdFromGanttLinkId(ev.id)
      if (!linkId) return

      void runMutation(async () => {
        await onLinkUpdate(linkId, {
          type: ev.link.type as ProductionPlanLinkRow["type"] | undefined,
          lagDays: ev.link.lag,
        })
      })
    },
    [onLinkUpdate, runMutation]
  )

  const handleDeleteLink = useCallback(
    (ev: { id: string | number }) => {
      const linkId = linkIdFromGanttLinkId(ev.id)
      if (!linkId) return

      void runMutation(async () => {
        await onLinkDelete(linkId)
      })
    },
    [onLinkDelete, runMutation]
  )

  return (
    <Willow fonts={false}>
      <Locale words={apsGanttLocale}>
        <div className="production-gantt-board production-gantt-board--chart-only flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border bg-card">
          {selectedPlanId ? (
            <div className="production-gantt-toolbar shrink-0 border-b bg-muted/30 px-2 py-1.5">
              <Toolbar api={api} items={toolbarItems} />
            </div>
          ) : null}
          <div ref={mainRef} className="production-gantt-main min-h-0 flex-1">
            {containerWidth > 0 ? (
              <ContextMenu api={api} options={contextMenuOptions}>
                <Gantt
                  init={handleInit}
                  tasks={tasks}
                  links={ganttLinks}
                  scales={productionGanttScales}
                  columns={[]}
                  displayMode="chart"
                  start={range.start}
                  end={range.end}
                  autoScale={false}
                  zoom={{ minCellWidth: 20, maxCellWidth: 80 }}
                  markers={markers}
                  selected={selected}
                  cellBorders="full"
                  cellHeight={52}
                  cellWidth={layout.cellWidth}
                  scaleHeight={40}
                  gridWidth={0}
                  taskTemplate={taskTemplate}
                  onSelectTask={handleSelectTask}
                  onUpdateTask={handleUpdateTask}
                  onDragTask={handleDragTask}
                  onCopyTask={handleCopyTask}
                  onDeleteTask={handleDeleteTask}
                  onAddLink={handleAddLink}
                  onUpdateLink={handleUpdateLink}
                  onDeleteLink={handleDeleteLink}
                />
              </ContextMenu>
            ) : null}
          </div>
        </div>
      </Locale>
    </Willow>
  )
}
