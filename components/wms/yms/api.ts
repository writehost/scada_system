"use client"

import { authRequestHeaders } from "@/lib/auth/client-token"
import { getSiteCode } from "@/lib/wms-api"

export type YmsVisit = {
  visitId: string
  visitNo: string
  plate: string
  vehicleType: string
  trailerPlate: string | null
  carrierName: string | null
  driverName: string | null
  driverPhone: string | null
  counterparty: string | null
  operation: string
  plannedArrival: string | null
  actualArrival: string | null
  parkingObjectId: string | null
  parkingCode: string | null
  dockObjectId: string | null
  dockCode: string | null
  wmsDocumentId: string | null
  status: string
  priority: number
  note: string | null
  restrictions: string | null
  capacityKg: number | null
  actions: string[]
  late: boolean
  early: boolean
}

export type YardObject = {
  objectId: string
  code: string
  name: string
  kind: string
  status: string
  x: number
  y: number
  w: number
  h: number
  allowedVehicleTypes: string[]
  allowedOperations: string[]
  currentVisitId: string | null
  blockedReason: string | null
}

export type BoardPayload = {
  kpis: {
    onYard: number
    awaitingEntry: number
    awaitingDock: number
    loading: number
    unloading: number
    readyExit: number
    overdue: number
  }
  visits: YmsVisit[]
  events: Array<{
    eventId: string
    visitId: string
    visitNo: string
    plate: string
    fromStatus: string | null
    toStatus: string
    action: string | null
    actorLogin: string | null
    reason: string | null
    createdAt: string
  }>
  notifications: Array<{
    notificationId: string
    message: string
    kind: string
    createdAt: string
  }>
  objects: YardObject[]
}

async function parse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data as T
}

function siteQuery() {
  return `siteCode=${encodeURIComponent(getSiteCode())}`
}

export async function fetchBoard(params: URLSearchParams): Promise<BoardPayload> {
  params.set("siteCode", getSiteCode())
  const res = await fetch(`/api/wms/yms/board?${params.toString()}`, {
    cache: "no-store",
    headers: authRequestHeaders(),
  })
  return parse(res)
}

export async function fetchVisit(visitId: string) {
  const res = await fetch(`/api/wms/yms/visits/${visitId}?${siteQuery()}`, {
    cache: "no-store",
    headers: authRequestHeaders(),
  })
  return parse<{
    visit: YmsVisit
    events: BoardPayload["events"]
    discrepancies: Array<{ discrepancyId: string; kind: string; qty: number | null; note: string | null }>
    order: {
      documentId: string
      documentNo: string | null
      comment: string | null
      counterparty: string | null
      plannedQty: number
      confirmedQty: number
      remainingQty: number
      palletCount: number
      locations: string | null
      ready: boolean
      documentStatus: string
    } | null
  }>(res)
}

export async function postVisit(body: Record<string, unknown>) {
  const res = await fetch(`/api/wms/yms/visits?${siteQuery()}`, {
    method: "POST",
    headers: authRequestHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ ...body, siteCode: getSiteCode() }),
  })
  return parse<{ visit: YmsVisit }>(res)
}

export async function postTransition(visitId: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/wms/yms/visits/${visitId}/transition?${siteQuery()}`, {
    method: "POST",
    headers: authRequestHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      ...body,
      siteCode: getSiteCode(),
      requestId: crypto.randomUUID(),
    }),
  })
  return parse<{ visit: YmsVisit }>(res)
}

export async function postDiscrepancy(visitId: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/wms/yms/visits/${visitId}/discrepancy?${siteQuery()}`, {
    method: "POST",
    headers: authRequestHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ ...body, siteCode: getSiteCode() }),
  })
  return parse<{ ok: boolean }>(res)
}

export async function searchOrders(q: string) {
  const params = new URLSearchParams({ siteCode: getSiteCode(), q, limit: "12" })
  const res = await fetch(`/api/wms/yms/orders?${params}`, {
    cache: "no-store",
    headers: authRequestHeaders(),
  })
  return parse<{
    orders: Array<{
      documentId: string
      documentNo: string | null
      comment: string | null
      plannedQty: number
      confirmedQty: number
      ready: boolean
    }>
  }>(res)
}

export async function saveYard(body: Record<string, unknown>) {
  const res = await fetch(`/api/wms/yms/yard?${siteQuery()}`, {
    method: "POST",
    headers: authRequestHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ ...body, siteCode: getSiteCode() }),
  })
  return parse<{ objectId: string }>(res)
}
