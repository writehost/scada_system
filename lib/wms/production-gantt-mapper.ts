import type { ILink, ITask } from "@svar-ui/react-gantt"
import type { ProductionPlanLinkRow, ProductionPlanRow } from "@/lib/wms-api"

const LINE_PARENT_PREFIX = "line:"
const PLAN_TASK_PREFIX = "plan:"
const LINK_PREFIX = "link:"

function parseDateKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (
    Number.isNaN(d.getTime()) ||
    d.getFullYear() !== Number(m[1]) ||
    d.getMonth() !== Number(m[2]) - 1 ||
    d.getDate() !== Number(m[3])
  ) {
    return null
  }
  return d
}

export function toDateKey(date: Date): string {
  const yyyy = String(date.getFullYear())
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function exclusiveEnd(endKey: string): Date {
  const d = parseDateKey(endKey)
  if (!d) return new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(0, 0, 0, 0)
  return d
}

export function inclusiveEndFromExclusive(end: Date): string {
  const d = new Date(end)
  d.setDate(d.getDate() - 1)
  return toDateKey(d)
}

function materialCoverage(plan: ProductionPlanRow): number {
  const mats = plan.materials ?? []
  if (mats.length === 0) return plan.isFullyCovered ? 100 : 0
  const ok = mats.filter((m) => m.shortageQty <= 1e-6).length
  return Math.round((ok / mats.length) * 100)
}

export function formatApsPlanQty(qty: number): string {
  if (!Number.isFinite(qty)) return "—"
  return qty.toLocaleString("ru-RU", { maximumFractionDigits: 3 })
}

/** Пока партия в Векас «в процессе», факт ещё неизвестен — в APS стоит заглушка 1. */
export function isVekasInProcessPlaceholder(
  plan: Pick<ProductionPlanRow, "externalSource" | "status" | "plannedQty"> | null | undefined
): boolean {
  if (!plan) return false
  return plan.externalSource === "vekas" && plan.status === "in_progress" && Number(plan.plannedQty) === 1
}

export function formatApsPlanQtyOrLive(
  plan: Pick<ProductionPlanRow, "externalSource" | "status" | "plannedQty" | "actualQty" | "vekasProducedQty">
): string {
  if (isVekasInProcessPlaceholder(plan)) return "на линии"
  const fact = Number(plan.vekasProducedQty ?? plan.actualQty ?? 0)
  if (
    plan.externalSource === "vekas" &&
    plan.status === "done" &&
    Number(plan.plannedQty) === 1 &&
    plan.vekasProducedQty == null
  ) {
    return "факт считается"
  }
  const qty = fact > 0 ? fact : plan.plannedQty
  return `${formatApsPlanQty(qty)} шт`
}

export function planOverlapsDateKey(
  plan: Pick<ProductionPlanRow, "planDate" | "planDateTo">,
  dayKey: string
): boolean {
  const end = plan.planDateTo && plan.planDateTo >= plan.planDate ? plan.planDateTo : plan.planDate
  return plan.planDate <= dayKey && end >= dayKey
}

const APS_FACTORY_TZ = "Asia/Vladivostok"

function factoryDayKeyOf(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APS_FACTORY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

/** День по StartDate/FinalizationDate Векас, не по firstSeen WMS. */
export function vekasWatchOverlapsDay(
  watch:
    | {
        startedAt?: string | null
        finishedAt?: string | null
        completedAt?: string | null
        watchState?: string | null
      }
    | null
    | undefined,
  dayKey: string
): boolean {
  if (!watch?.startedAt) return false
  const start = new Date(watch.startedAt)
  if (Number.isNaN(start.getTime())) return false
  const endIso =
    watch.finishedAt ||
    (watch.watchState === "watching" ? new Date().toISOString() : watch.completedAt) ||
    watch.startedAt
  const end = new Date(endIso)
  const from = factoryDayKeyOf(start)
  const to = factoryDayKeyOf(Number.isNaN(end.getTime()) || end < start ? start : end)
  return from <= dayKey && to >= dayKey
}

/** Составная строка номенклатуры: формат/объём, профиль, артикул. */
export function formatApsItemCompositeLine(
  plan: Pick<
    ProductionPlanRow,
    | "itemNomenclature"
    | "packagingFormat"
    | "itemSku"
    | "packagingProfile"
    | "itemCode"
    | "code"
  >
): string {
  const parts: string[] = []
  const composite = (plan.itemNomenclature ?? plan.packagingFormat ?? "").trim()
  if (composite) parts.push(composite)
  const profile = (plan.packagingProfile ?? "").trim()
  if (profile && profile.toLowerCase() !== "custom") {
    const profileLabel =
      profile === "water" ? "вода" : profile === "stickers" ? "стикеры" : profile
    parts.push(profileLabel)
  }
  const sku = (plan.itemSku ?? "").trim()
  if (sku) parts.push(`арт. ${sku}`)
  if (parts.length > 0) return parts.join(" · ")
  const code = (plan.itemCode ?? "").trim()
  const planCode = (plan.code ?? "").trim()
  if (code && planCode) return `${code} · ${planCode}`
  return code || planCode || ""
}

export function productionPlanMrpPercent(plan: ProductionPlanRow): number {
  return materialCoverage(plan)
}

export function resolveApsPlanQtyLabel(
  plan: Pick<ProductionPlanRow, "plannedQty"> | null | undefined,
  task?: { qtyLabel?: string; plannedQty?: number } | null
): string {
  const raw = plan?.plannedQty ?? task?.plannedQty
  if (raw != null && Number.isFinite(Number(raw)) && Number(raw) > 0) {
    return `${formatApsPlanQty(Number(raw))} шт`
  }
  return task?.qtyLabel?.trim() || ""
}

function apsPlanQtyLabel(qty: number): string {
  return `${formatApsPlanQty(qty)} шт`
}

/** Палитра полосок — у каждого плана свой оттенок в рамках месяца. */
export const APS_PLAN_BAR_PALETTE = [
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#3b82f6",
  "#64748b",
] as const

function hashPlanPaletteIndex(planId: string): number {
  let h = 0
  for (let i = 0; i < planId.length; i += 1) {
    h = (h * 31 + planId.charCodeAt(i)) >>> 0
  }
  return h % APS_PLAN_BAR_PALETTE.length
}

function mixHex(base: string, accent: string, accentWeight: number): string {
  const parse = (hex: string) => {
    const n = hex.replace("#", "")
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)] as const
  }
  const [br, bg, bb] = parse(base)
  const [ar, ag, ab] = parse(accent)
  const w = Math.max(0, Math.min(1, accentWeight))
  const r = Math.round(br * (1 - w) + ar * w)
  const g = Math.round(bg * (1 - w) + ag * w)
  const b = Math.round(bb * (1 - w) + ab * w)
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
}

export function apsPlanBarColor(plan: ProductionPlanRow): string {
  const base = APS_PLAN_BAR_PALETTE[hashPlanPaletteIndex(plan.planId)]
  if (plan.status === "done") return mixHex(base, "#059669", 0.55)
  if (plan.status === "reserved") return mixHex(base, "#10b981", 0.35)
  if (plan.shortageCount > 0) return mixHex(base, "#ef4444", 0.4)
  if (plan.status === "in_progress") return base
  if (plan.isFullyCovered) return mixHex(base, "#ffffff", 0.08)
  return mixHex(base, "#94a3b8", 0.25)
}

function planColor(plan: ProductionPlanRow): string {
  return apsPlanBarColor(plan)
}

function lineKey(plan: ProductionPlanRow): string {
  const w = (plan.workshopCode || "").trim().toUpperCase()
  return w || "UNASSIGNED"
}

export type ProductionPlanLineGroup = {
  key: string
  label: string
  plans: ProductionPlanRow[]
}

export function groupProductionPlansByLine(plans: ProductionPlanRow[]): ProductionPlanLineGroup[] {
  const lineGroups = new Map<string, ProductionPlanLineGroup>()
  for (const plan of plans) {
    const key = lineKey(plan)
    const group = lineGroups.get(key)
    if (group) group.plans.push(plan)
    else lineGroups.set(key, { key, label: lineLabel(plan), plans: [plan] })
  }
  return [...lineGroups.values()]
}

function lineLabel(plan: ProductionPlanRow): string {
  if (plan.workshopCode) return plan.workshopCode
  return "Без цеха / линии"
}

export function ganttTaskIdFromPlanId(planId: string): string {
  return `${PLAN_TASK_PREFIX}${planId}`
}

export function planIdFromGanttTaskId(taskId: string | number): string | null {
  const raw = String(taskId)
  if (raw.startsWith(PLAN_TASK_PREFIX)) return raw.slice(PLAN_TASK_PREFIX.length)
  return null
}

export function linkIdFromGanttLinkId(linkId: string | number): string | null {
  const raw = String(linkId)
  if (raw.startsWith(LINK_PREFIX)) return raw.slice(LINK_PREFIX.length)
  if (/^\d+$/.test(raw)) return raw
  return null
}

export function productionPlanLinksToGanttLinks(links: ProductionPlanLinkRow[]): ILink[] {
  return links.map((link) => ({
    id: `${LINK_PREFIX}${link.linkId}`,
    source: ganttTaskIdFromPlanId(link.sourcePlanId),
    target: ganttTaskIdFromPlanId(link.targetPlanId),
    type: link.type,
    lag: link.lagDays,
  }))
}

export function filterProductionPlanLinks(
  links: ProductionPlanLinkRow[],
  visiblePlanIds: ReadonlySet<string>
): ProductionPlanLinkRow[] {
  return links.filter(
    (link) => visiblePlanIds.has(link.sourcePlanId) && visiblePlanIds.has(link.targetPlanId)
  )
}

export function calculateProductionGanttLayout(
  containerWidth: number,
  daysInRange: number,
  chartOnly = false
) {
  const safeWidth = Number.isFinite(containerWidth) ? Math.max(0, containerWidth) : 0
  const safeDays = Number.isFinite(daysInRange) ? Math.max(1, Math.floor(daysInRange)) : 1
  if (chartOnly) {
    const cellWidth = Math.min(44, Math.max(22, Math.floor(safeWidth / safeDays)))
    return { gridWidth: 0, cellWidth }
  }
  const dividerWidth = 12
  const targetCellWidth = 26
  const minChartWidth = Math.max(320, Math.floor(safeWidth * 0.42))
  const maxGridWidth = Math.max(0, safeWidth - minChartWidth - dividerWidth)
  const gridWidth = Math.min(Math.max(400, productionGanttGridWidth), maxGridWidth || productionGanttGridWidth)
  const chartWidth = Math.max(0, safeWidth - gridWidth - dividerWidth)
  const cellWidth = Math.min(40, Math.max(22, Math.floor(chartWidth / safeDays)))
  return { gridWidth, cellWidth }
}

export function productionPlansToGanttTasks(plans: ProductionPlanRow[]): ITask[] {
  const tasks: ITask[] = []

  for (const group of groupProductionPlansByLine(plans)) {
    const parentId = `${LINE_PARENT_PREFIX}${group.key}`
    tasks.push({
      id: parentId,
      text: group.label,
      type: "summary",
      open: true,
      parent: 0,
      readonly: true,
    })

    for (const plan of group.plans) {
      const start = parseDateKey(plan.planDate)
      if (!start) continue
      const endKey =
        plan.planDateTo && plan.planDateTo >= plan.planDate ? plan.planDateTo : plan.planDate
      const end = exclusiveEnd(endKey)
      const progress = materialCoverage(plan)
      const locked = plan.status === "reserved"
      tasks.push({
        id: ganttTaskIdFromPlanId(plan.planId),
        text: plan.itemName,
        type: "task",
        parent: parentId,
        start,
        end,
        progress,
        color: planColor(plan),
        details: plan.code,
        planCode: plan.code,
        status: plan.status,
        plannedQty: plan.plannedQty,
        qtyLabel: apsPlanQtyLabel(plan.plannedQty),
        readonly: locked,
      })
    }
  }

  return tasks
}

export const productionGanttScales = [
  { unit: "month" as const, step: 1, format: "%F %Y" },
  { unit: "day" as const, step: 1, format: "%j" },
]

export const productionGanttColumns = [
  { id: "text", header: "Заказ / линия", width: 300, flexgrow: 10, resize: true },
  { id: "plannedQty", header: "План, шт", width: 96, align: "center" as const },
  { id: "start", header: "Начало", width: 88, align: "center" as const, resize: true },
  { id: "duration", header: "Дней", width: 56, align: "center" as const },
  { id: "progress", header: "MRP %", width: 56, align: "center" as const },
]

/** Минимальная ширина левой таблицы (названия ГП + служебные колонки). */
export const productionGanttGridWidth = 560
