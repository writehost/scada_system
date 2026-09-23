"use client"

const SITE = "skeet"

function siteCode() {
  return SITE
}

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
  jobs?: Array<{
    jobId: string
    visitId: string
    dockObjectId: string | null
    fleetUnitId: string
    status: string
    carryingCode: string | null
  }>
}

async function parse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login"
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data as T
}

function siteQuery() {
  return `siteCode=${encodeURIComponent(siteCode())}`
}

export async function fetchBoard(params: URLSearchParams): Promise<BoardPayload> {
  params.set("siteCode", siteCode())
  const res = await fetch(`/api/yms/board?${params.toString()}`, {
    cache: "no-store",
    credentials: "include",
  })
  return parse(res)
}

export async function fetchVisit(visitId: string) {
  const res = await fetch(`/api/yms/visits/${visitId}?${siteQuery()}`, {
    cache: "no-store",
    credentials: "include",
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
    loading?: {
      phase: { code: string; label: string }
      documentNo: string | null
      plannedQty: number
      confirmedQty: number
      plannedPallets: number
      loadedPallets: number
      gap: string | null
      startedAt: string | null
      idleMinutes: number | null
      canFinish: boolean
      blockReason: string | null
      wmsScanCodes: string[]
    }
    calls?: Array<{
      callId: string
      channel: string
      message: string
      sentAt: string
      deliveredAt: string | null
      acknowledgedAt: string | null
    }>
  }>(res)
}

export async function postVisit(body: Record<string, unknown>) {
  const res = await fetch(`/api/yms/visits?${siteQuery()}`, {
    method: "POST",
    credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, siteCode: siteCode() }),
  })
  return parse<{ visit: YmsVisit }>(res)
}

export async function postTransition(visitId: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/yms/visits/${visitId}/transition?${siteQuery()}`, {
    method: "POST",
    credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      siteCode: siteCode(),
      requestId: crypto.randomUUID(),
    }),
  })
  return parse<{ visit: YmsVisit }>(res)
}

export async function postDiscrepancy(visitId: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/yms/visits/${visitId}/discrepancy?${siteQuery()}`, {
    method: "POST",
    credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, siteCode: siteCode() }),
  })
  return parse<{ ok: boolean }>(res)
}

export async function searchOrders(q: string) {
  const params = new URLSearchParams({ siteCode: siteCode(), q, limit: "12" })
  const res = await fetch(`/api/yms/orders?${params}`, {
    cache: "no-store",
    credentials: "include",
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

export async function postScan(visitId: string, code: string, mark?: string) {
  const res = await fetch(`/api/yms/visits/${visitId}/scan?${siteQuery()}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ siteCode: siteCode(), code, mark, requestId: crypto.randomUUID() }),
  })
  return parse<{ result: string }>(res)
}

export async function postDriver(visitId: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/yms/visits/${visitId}/driver?${siteQuery()}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, siteCode: siteCode() }),
  })
  return parse<{ driverId: string }>(res)
}

export async function postEquipment(visitId: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/yms/visits/${visitId}/equipment?${siteQuery()}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, siteCode: siteCode() }),
  })
  return parse<{ vehicleId?: string; trailerVehicleId?: string | null }>(res)
}

export async function fetchFleet() {
  const res = await fetch(`/api/yms/fleet?${siteQuery()}`, { cache: "no-store", credentials: "include" })
  return parse<{
    fleet: { available: boolean; reason?: string; units?: Array<{ id: string; name: string; enabled: boolean; driverName: string | null; shiftCode: string | null; missionStatus: string | null; hasPosition: false }> }
    jobs: Array<{ jobId: string; visitId: string; fleetUnitId: string; status: string; carryingCode: string | null }>
  }>(res)
}

export async function postJob(visitId: string, fleetUnitId: string) {
  const res = await fetch(`/api/yms/visits/${visitId}/job?${siteQuery()}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ siteCode: siteCode(), fleetUnitId }),
  })
  return parse<{ jobId: string }>(res)
}

export async function saveYard(body: Record<string, unknown>) {
  const res = await fetch(`/api/yms/yard?${siteQuery()}`, {
    method: "POST",
    credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, siteCode: siteCode() }),
  })
  return parse<{ objectId: string }>(res)
}
