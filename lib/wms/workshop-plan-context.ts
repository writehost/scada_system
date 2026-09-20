import type {
  ProductionPlanMaterialRow,
  ProductionPlanRow,
} from "@/lib/wms/production-plan-meta"
import type { WorkshopStockRow } from "@/lib/wms-api"

export type WorkshopPlanMaterialContext = {
  plan: ProductionPlanRow
  material: ProductionPlanMaterialRow
  inCellQty: number
  workshopQty: number
  needFromWarehouse: number
}

const ACTIVE_PLAN_STATUSES = new Set(["reserved", "in_progress"])

export function isActiveWorkshopPlan(plan: ProductionPlanRow): boolean {
  return ACTIVE_PLAN_STATUSES.has(plan.status)
}

export function listActiveWorkshopPlans(plans: ProductionPlanRow[]): ProductionPlanRow[] {
  return plans.filter(isActiveWorkshopPlan)
}

export function buildWorkshopQtyByItem(stockRows: WorkshopStockRow[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of stockRows) {
    const code = row.itemCode.trim().toLowerCase()
    if (!code) continue
    map.set(code, (map.get(code) ?? 0) + row.inProductionQty + (row.availableQty ?? 0))
  }
  return map
}

function lineMatches(plan: ProductionPlanRow, handoffLineCode: string | null | undefined): boolean {
  if (!handoffLineCode?.trim()) return true
  const planLine = (plan.lineCode ?? "").trim().toLowerCase()
  if (!planLine) return true
  return planLine === handoffLineCode.trim().toLowerCase()
}

function findMaterialInPlan(
  plan: ProductionPlanRow,
  itemKey: string
): ProductionPlanMaterialRow | null {
  return (
    (plan.materials ?? []).find((m) => m.itemCode.trim().toLowerCase() === itemKey) ?? null
  )
}

export function findPlanContextForWaitingCell(input: {
  cellItemCode: string | null | undefined
  handoffLineCode?: string | null
  handoffPlanCode?: string | null
  inCellQty: number
  plans: ProductionPlanRow[]
  workshopQtyByItem: Map<string, number>
}): WorkshopPlanMaterialContext | null {
  const itemKey = input.cellItemCode?.trim().toLowerCase()
  if (!itemKey) return null

  const active = listActiveWorkshopPlans(input.plans)

  if (input.handoffPlanCode?.trim()) {
    const plan = active.find(
      (p) => p.code.trim().toUpperCase() === input.handoffPlanCode!.trim().toUpperCase()
    )
    if (plan) {
      const material = findMaterialInPlan(plan, itemKey)
      if (material) {
        const workshopQty = input.workshopQtyByItem.get(itemKey) ?? input.inCellQty
        return {
          plan,
          material,
          inCellQty: input.inCellQty,
          workshopQty,
          needFromWarehouse: Math.max(0, material.requiredQty - workshopQty),
        }
      }
    }
  }

  for (const plan of active) {
    if (!lineMatches(plan, input.handoffLineCode)) continue
    const material = findMaterialInPlan(plan, itemKey)
    if (!material) continue
    const workshopQty = input.workshopQtyByItem.get(itemKey) ?? input.inCellQty
    return {
      plan,
      material,
      inCellQty: input.inCellQty,
      workshopQty,
      needFromWarehouse: Math.max(0, material.requiredQty - workshopQty),
    }
  }

  if (!input.handoffLineCode?.trim()) {
    for (const plan of active) {
      const material = findMaterialInPlan(plan, itemKey)
      if (!material) continue
      const workshopQty = input.workshopQtyByItem.get(itemKey) ?? input.inCellQty
      return {
        plan,
        material,
        inCellQty: input.inCellQty,
        workshopQty,
        needFromWarehouse: Math.max(0, material.requiredQty - workshopQty),
      }
    }
  }

  return null
}

export function planOptionsForWaitingCell(input: {
  cellItemCode: string | null | undefined
  lineCode?: string | null
  plans: ProductionPlanRow[]
}): ProductionPlanRow[] {
  const itemKey = input.cellItemCode?.trim().toLowerCase()
  if (!itemKey) return []
  return listActiveWorkshopPlans(input.plans).filter((plan) => {
    if (!findMaterialInPlan(plan, itemKey)) return false
    return lineMatches(plan, input.lineCode)
  })
}

export function fmtPlanQty(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value)
}
