import { getSiteCode } from "@/lib/wms-api"
import type {
  AllocationResult,
  EffectiveRowSettings,
  MapTint,
  MapViewMode,
  PlacementAuditRow,
  PlacementCandidate,
  PlacementRule,
  PlaceCheckResult,
  RowPlacementDraft,
  WarehousePlacementPolicy,
} from "@/lib/wms/fg-placement-types"

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  })
  const data = (await r.json().catch(() => ({}))) as T & { error?: string }
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
  return data
}

function withSite(path: string, extra?: Record<string, string>) {
  const qp = new URLSearchParams({ siteCode: getSiteCode(), ...(extra ?? {}) })
  return `${path}?${qp.toString()}`
}

export type PlacementOverview = {
  policy: WarehousePlacementPolicy
  rules: PlacementRule[]
  rows: Array<
    Pick<
      EffectiveRowSettings,
      | "locationId"
      | "locationCode"
      | "planRowId"
      | "zone"
      | "label"
      | "capacity"
      | "palletCount"
      | "fillPercent"
      | "storageStrategy"
      | "allocationStrategy"
      | "placementPriority"
      | "allowedMode"
      | "allowedProducts"
      | "isBlocked"
      | "ruleCode"
    >
  >
  tasks: Array<{
    taskId: string
    itemQuery: string
    itemCode: string | null
    itemName: string | null
    requestedQty: number
    allocation: AllocationResult
    createdAt: string
  }>
  audit: PlacementAuditRow[]
}

export function loadPlacementOverview() {
  return api<PlacementOverview>(withSite("/api/wms/warehouse/finished-goods/placement"))
}

export function loadPlacementTasks() {
  return api<{ tasks: PlacementOverview["tasks"] }>(
    withSite("/api/wms/warehouse/finished-goods/placement", { view: "tasks" })
  )
}

export function loadPlacementShell() {
  return Promise.all([
    api<{ policy: PlacementOverview["policy"] }>(
      withSite("/api/wms/warehouse/finished-goods/placement", { view: "policy" })
    ),
    api<{ rules: PlacementOverview["rules"] }>(
      withSite("/api/wms/warehouse/finished-goods/placement", { view: "rules" })
    ),
    loadPlacementTasks(),
    api<{ audit: PlacementOverview["audit"] }>(
      withSite("/api/wms/warehouse/finished-goods/placement", { view: "audit" })
    ),
  ]).then(([policy, rules, tasks, audit]) => ({
    policy: policy.policy,
    rules: rules.rules,
    rows: [] as PlacementOverview["rows"],
    tasks: tasks.tasks,
    audit: audit.audit,
  }))
}

export function loadPlacementRow(id: string) {
  return api<{ settings: EffectiveRowSettings; draft: RowPlacementDraft }>(
    withSite("/api/wms/warehouse/finished-goods/placement", { view: "row", id })
  )
}

export function loadPlacementMap(mode: MapViewMode, taskId?: string) {
  return api<{ tints: MapTint[] }>(
    withSite("/api/wms/warehouse/finished-goods/placement", {
      view: "map",
      mode,
      ...(taskId ? { taskId } : {}),
    })
  )
}

function post<T>(body: Record<string, unknown>) {
  return api<T>(withSite("/api/wms/warehouse/finished-goods/placement"), {
    method: "POST",
    body: JSON.stringify({ siteCode: getSiteCode(), ...body }),
  })
}

export function savePlacementPolicy(policy: WarehousePlacementPolicy) {
  return post<{ policy: WarehousePlacementPolicy }>({ action: "save-policy", policy })
}

export function savePlacementRule(rule: PlacementRule) {
  return post<{ rule: PlacementRule }>({ action: "save-rule", rule })
}

export function deletePlacementRule(ruleId: string) {
  return post<{ ok: true }>({ action: "delete-rule", ruleId })
}

export function savePlacementRow(locationId: string, draft: RowPlacementDraft) {
  return post<{ settings: EffectiveRowSettings }>({ action: "save-row", locationId, draft })
}

export function resetPlacementRow(locationId: string) {
  return post<{ settings: EffectiveRowSettings }>({ action: "reset-row", locationId })
}

export function applyPlacementToRows(selector: string, draft: RowPlacementDraft) {
  return post<{ updated: number; locationIds: string[] }>({ action: "apply-to-rows", selector, draft })
}

export function recommendFgPlace(query: string) {
  return post<{
    item: { itemCode: string; itemName: string }
    recommended: PlacementCandidate | null
    alternatives: PlacementCandidate[]
  }>({ action: "recommend", query })
}

export function checkFgPlace(query: string, planRowId: string, position?: number) {
  return post<PlaceCheckResult>({ action: "check", query, planRowId, position })
}

export function placeFgAnyway(query: string, planRowId: string, reason: string, position?: number) {
  return post<PlaceCheckResult>({ action: "place-anyway", query, planRowId, position, reason })
}

export function allocateFgTask(query: string, qty: number, persist = true) {
  return post<AllocationResult>({ action: "allocate", query, qty, persist })
}

export function seedFgPlacementDemo() {
  return post<{
    rowsTagged: number
    demoPallets: number
    taskId: string
    fifoTaskId: string
    items: Array<{ itemCode: string; itemName: string }>
  }>({ action: "seed" })
}

export function verifyFgPlacementDemo() {
  return post<{
    fefo: { pass: boolean; got: string[]; expected: string[] }
    fifo: { pass: boolean; got: string[]; expected: string[] }
    recommend: { pass: boolean; planRowId: string | null }
  }>({ action: "verify" })
}
