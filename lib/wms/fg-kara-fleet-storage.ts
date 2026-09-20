import path from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { randomBytes } from "node:crypto"

export type KaraStopKind = "waypoint" | "pickup" | "drop"

export type KaraStopSource = "path" | "apriltag"

export type KaraStop = {
  tagId: number
  kind: KaraStopKind
  label?: string
  rowId?: string
  /** path = номер на оранжевой линии; apriltag = фиолетовый ID ряда. */
  source?: KaraStopSource
  nodeId?: string
}

export type KaraRoute = {
  id: string
  name: string
  lineCode: string | null
  itemCode: string | null
  itemName: string | null
  recommendedRowIds: string[]
  stops: KaraStop[]
  enabled: boolean
  hidden: boolean
  createdAt: string
  updatedAt: string
}

/** Точка погрузки, привязанная к смене APS (= код линии, SIPA / JR / L5). */
export type LoadingPoint = {
  id: string
  name: string
  lineCode: string | null
  tagId: number | null
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type FleetSettings = {
  hideAllRoutes: boolean
  hideEditorRoute: boolean
}

export type KaraUnit = {
  id: string
  name: string
  /** Название борта / погрузчика на плане */
  boardName: string | null
  /** Бортовой / инвентарный номер */
  boardNumber: string | null
  /** Внешний id для трека на плане ГП */
  externalId: string | null
  enabled: boolean
  lineCode: string | null
  routeIds: string[]
  createdAt: string
  updatedAt: string
}

/** Слот графика карщика: weekday 0=вс … 6=сб, from/to HH:MM */
export type KaraDriverScheduleSlot = {
  weekday: number
  from: string
  to: string
}

/** Карщик (водитель погрузчика) */
export type KaraDriver = {
  id: string
  fullName: string
  photoUrl: string | null
  karaId: string | null
  lineCode: string | null
  /** Смена производства: A/B/C/D … */
  shiftCode: string | null
  schedule: KaraDriverScheduleSlot[]
  enabled: boolean
  createdAt: string
  updatedAt: string
  note?: string
}

export type KaraMissionStatus = "queued" | "active" | "done" | "cancelled" | "refused"

/** main — с линии; interleave — попутно; urgent — срочный забор */
export type KaraMissionKind = "main" | "interleave" | "urgent"

export type KaraMissionSource = "mes" | "wms" | "manual"

export type KaraMission = {
  id: string
  karaId: string
  routeId: string | null
  routeName: string
  lineCode: string | null
  itemCode: string | null
  status: KaraMissionStatus
  stops: KaraStop[]
  currentIndex: number
  createdAt: string
  updatedAt: string
  note?: string
  kind: KaraMissionKind
  source: KaraMissionSource
  /** Карщик, которому назначено / кто взял */
  driverId: string | null
  lotCode: string | null
  palletId: string | null
  /** Целевой ряд выгрузки */
  targetRowId: string | null
  priority: number
  acceptedAt: string | null
  doneAt: string | null
  refusedAt: string | null
  refuseReason: string | null
}

/** Нарушение карщика / диспетчеризации */
export type KaraViolationKind =
  | "refuse"
  | "wrong_row"
  | "wrong_task"
  | "ignored_urgent"
  | "other"

export type KaraViolation = {
  id: string
  kind: KaraViolationKind
  driverId: string | null
  karaId: string | null
  missionId: string | null
  message: string
  createdAt: string
  meta?: Record<string, string>
}

export type FleetSnapshot = {
  version: 1
  updatedAt: string
  karas: KaraUnit[]
  drivers: KaraDriver[]
  routes: KaraRoute[]
  missions: KaraMission[]
  loadingPoints: LoadingPoint[]
  violations: KaraViolation[]
  settings: FleetSettings
}

const STOP_KINDS: KaraStopKind[] = ["waypoint", "pickup", "drop"]

function sharedRoot(): string {
  const shared = (process.env.WMS_SHARED_DIR ?? "").trim()
  if (shared) return path.join(shared, "uploads", "fg-kara-fleet")

  const cwd = process.cwd()
  const currentMarker = `${path.sep}current${path.sep}`
  const markerIndex = cwd.toLowerCase().indexOf(currentMarker.toLowerCase())
  if (markerIndex >= 0) {
    const installRoot = cwd.slice(0, markerIndex)
    return path.join(installRoot, "shared", "uploads", "fg-kara-fleet")
  }

  return path.join(process.cwd(), "public", "fg-kara-fleet")
}

function fleetPath(siteId: number): string {
  return path.join(sharedRoot(), `site-${siteId}.json`)
}

export function newFleetId(prefix: string): string {
  return `${prefix}-${randomBytes(5).toString("hex")}`
}

function asText(value: unknown, max = 160): string {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

/** В АПС линия часто пишется как «смена SIPA» — храним код линии. */
function asLineCode(value: unknown): string {
  return asText(value, 64)
    .replace(/^смена\s+/i, "")
    .toUpperCase()
}

function asKind(value: unknown): KaraStopKind {
  const raw = String(value ?? "").trim() as KaraStopKind
  return STOP_KINDS.includes(raw) ? raw : "waypoint"
}

function asTagId(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim())
  if (!Number.isFinite(n) || n < 0) return null
  return Math.trunc(n)
}

export function normalizeStops(raw: unknown): KaraStop[] {
  if (!Array.isArray(raw)) return []
  const out: KaraStop[] = []
  for (const item of raw.slice(0, 400)) {
    if (typeof item === "number" || typeof item === "string") {
      const tagId = asTagId(item)
      if (tagId == null) continue
      out.push({ tagId, kind: "waypoint" })
      continue
    }
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const tagId = asTagId(row.tagId ?? row.tag ?? row.id)
    if (tagId == null) continue
    const label = asText(row.label, 80) || undefined
    const rowId = asText(row.rowId, 64) || undefined
    const sourceRaw = asText(row.source, 16)
    const source: KaraStopSource | undefined =
      sourceRaw === "path" || sourceRaw === "apriltag" ? sourceRaw : undefined
    const nodeId = asText(row.nodeId, 64) || undefined
    out.push({ tagId, kind: asKind(row.kind), label, rowId, source, nodeId })
  }
  return out
}

/** Строка вида `1, 2, 3, drop:0, pickup:1, выгрузка:0`. */
export function parseStopPath(raw: unknown): KaraStop[] {
  const text = asText(raw, 2000)
  if (!text) return []
  const parts = text.split(/[,\n;]+/).map((p) => p.trim()).filter(Boolean)
  const out: KaraStop[] = []
  for (const part of parts) {
    const labeled = part.match(/^(waypoint|way|точка|pickup|погрузка|drop|выгрузка)\s*[:#\s]+(\d+)$/i)
    if (labeled) {
      const kindRaw = labeled[1].toLowerCase()
      const kind: KaraStopKind =
        kindRaw.startsWith("pick") || kindRaw.startsWith("погр")
          ? "pickup"
          : kindRaw.startsWith("drop") || kindRaw.startsWith("выгр")
            ? "drop"
            : "waypoint"
      out.push({ tagId: Number(labeled[2]), kind })
      continue
    }
    const only = part.match(/^(\d+)$/)
    if (only) out.push({ tagId: Number(only[1]), kind: "waypoint" })
  }
  return out
}

function normalizeRoute(raw: unknown, fallback?: KaraRoute): KaraRoute | null {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const name = asText(row.name, 120) || fallback?.name || ""
  if (!name && !fallback) return null
  const now = new Date().toISOString()
  const stops = normalizeStops(row.stops)
  const recommended = Array.isArray(row.recommendedRowIds)
    ? row.recommendedRowIds.map((v) => asText(v, 64)).filter(Boolean).slice(0, 80)
    : fallback?.recommendedRowIds || []
  return {
    id: asText(row.id, 64) || fallback?.id || newFleetId("rt"),
    name: name || fallback?.name || "Маршрут",
    lineCode: asLineCode(row.lineCode) || fallback?.lineCode || null,
    itemCode: asText(row.itemCode, 80) || fallback?.itemCode || null,
    itemName: asText(row.itemName, 160) || fallback?.itemName || null,
    recommendedRowIds: recommended,
    stops: stops.length ? stops : fallback?.stops || [],
    enabled: row.enabled === undefined ? (fallback?.enabled ?? true) : Boolean(row.enabled),
    hidden: row.hidden === undefined ? (fallback?.hidden ?? false) : Boolean(row.hidden),
    createdAt: fallback?.createdAt || (asText(row.createdAt, 40) || now),
    updatedAt: now,
  }
}

function normalizeLoadingPoint(raw: unknown, fallback?: LoadingPoint): LoadingPoint | null {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const name = asText(row.name, 80) || fallback?.name || ""
  if (!name && !fallback) return null
  const now = new Date().toISOString()
  const tagId = asTagId(row.tagId)
  return {
    id: asText(row.id, 64) || fallback?.id || newFleetId("lp"),
    name: name || fallback?.name || "Погрузка",
    lineCode: asLineCode(row.lineCode) || fallback?.lineCode || null,
    tagId: tagId ?? fallback?.tagId ?? null,
    enabled: row.enabled === undefined ? (fallback?.enabled ?? true) : Boolean(row.enabled),
    createdAt: fallback?.createdAt || (asText(row.createdAt, 40) || now),
    updatedAt: now,
  }
}

function normalizeSettings(raw: unknown): FleetSettings {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  return {
    hideAllRoutes: Boolean(row.hideAllRoutes),
    hideEditorRoute: Boolean(row.hideEditorRoute),
  }
}

function normalizeKara(raw: unknown, fallback?: KaraUnit): KaraUnit | null {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const name = asText(row.name, 80) || fallback?.name || ""
  if (!name && !fallback) return null
  const now = new Date().toISOString()
  const routeIds = Array.isArray(row.routeIds)
    ? [...new Set(row.routeIds.map((v) => asText(v, 64)).filter(Boolean))].slice(0, 400)
    : fallback?.routeIds || []
  const boardName =
    asText(row.boardName, 80) || fallback?.boardName || null
  const boardNumber =
    asText(row.boardNumber, 40) || fallback?.boardNumber || null
  const externalId =
    asText(row.externalId, 64) || fallback?.externalId || null
  return {
    id: asText(row.id, 64) || fallback?.id || newFleetId("k"),
    name: name || fallback?.name || "Кара",
    boardName,
    boardNumber,
    externalId,
    enabled: row.enabled === undefined ? (fallback?.enabled ?? true) : Boolean(row.enabled),
    lineCode: asLineCode(row.lineCode) || fallback?.lineCode || null,
    routeIds,
    createdAt: fallback?.createdAt || (asText(row.createdAt, 40) || now),
    updatedAt: now,
  }
}

function asShiftCode(value: unknown): string | null {
  const raw = asText(value, 8).toUpperCase()
  if (!raw) return null
  return raw.slice(0, 4)
}

function normalizeSchedule(raw: unknown): KaraDriverScheduleSlot[] {
  if (!Array.isArray(raw)) return []
  const out: KaraDriverScheduleSlot[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const weekday = Math.trunc(Number(row.weekday))
    if (!Number.isFinite(weekday) || weekday < 0 || weekday > 6) continue
    const from = asText(row.from, 8) || "08:00"
    const to = asText(row.to, 8) || "20:00"
    if (!/^\d{1,2}:\d{2}$/.test(from) || !/^\d{1,2}:\d{2}$/.test(to)) continue
    out.push({ weekday, from, to })
  }
  return out.slice(0, 14)
}

export function normalizeDriver(raw: unknown, fallback?: KaraDriver): KaraDriver | null {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const fullName = asText(row.fullName, 120) || fallback?.fullName || ""
  if (!fullName && !fallback) return null
  const now = new Date().toISOString()
  const schedule =
    row.schedule !== undefined ? normalizeSchedule(row.schedule) : fallback?.schedule || []
  let permissions: string[] | undefined
  if (Array.isArray(row.permissions)) {
    permissions = row.permissions.map((x) => asText(x, 40)).filter(Boolean).slice(0, 32)
  } else if (fallback?.permissions) {
    permissions = fallback.permissions
  }
  return {
    id: asText(row.id, 64) || fallback?.id || newFleetId("drv"),
    fullName: fullName || fallback?.fullName || "Карщик",
    photoUrl: asText(row.photoUrl, 250000) || fallback?.photoUrl || null,
    karaId: asText(row.karaId, 64) || fallback?.karaId || null,
    lineCode: asLineCode(row.lineCode) || fallback?.lineCode || null,
    shiftCode: asShiftCode(row.shiftCode) || fallback?.shiftCode || null,
    schedule,
    enabled: row.enabled === undefined ? (fallback?.enabled ?? true) : Boolean(row.enabled),
    permissions,
    createdAt: fallback?.createdAt || (asText(row.createdAt, 40) || now),
    updatedAt: now,
    note: asText(row.note, 240) || fallback?.note || undefined,
  }
}

function normalizeMissionKind(value: unknown): KaraMissionKind {
  const raw = asText(value, 20).toLowerCase()
  if (raw === "interleave" || raw === "urgent" || raw === "main") return raw
  return "main"
}

function normalizeMissionSource(value: unknown): KaraMissionSource {
  const raw = asText(value, 20).toLowerCase()
  if (raw === "mes" || raw === "wms" || raw === "manual") return raw
  return "wms"
}

function normalizeMission(raw: unknown): KaraMission | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const karaId = asText(row.karaId, 64)
  const stops = normalizeStops(row.stops)
  if (!karaId || !stops.length) return null
  const statusRaw = asText(row.status, 20) as KaraMissionStatus
  const status: KaraMissionStatus = ["queued", "active", "done", "cancelled", "refused"].includes(statusRaw)
    ? statusRaw
    : "queued"
  const now = new Date().toISOString()
  const currentIndex = Math.max(0, Math.min(stops.length - 1, Math.trunc(Number(row.currentIndex) || 0)))
  const priorityRaw = Number(row.priority)
  const priority = Number.isFinite(priorityRaw) ? Math.max(0, Math.min(100, Math.trunc(priorityRaw))) : 0
  return {
    id: asText(row.id, 64) || newFleetId("ms"),
    karaId,
    routeId: asText(row.routeId, 64) || null,
    routeName: asText(row.routeName, 120) || "Маршрут",
    lineCode: asLineCode(row.lineCode) || null,
    itemCode: asText(row.itemCode, 80) || null,
    status,
    stops,
    currentIndex,
    createdAt: asText(row.createdAt, 40) || now,
    updatedAt: asText(row.updatedAt, 40) || now,
    note: asText(row.note, 240) || undefined,
    kind: normalizeMissionKind(row.kind),
    source: normalizeMissionSource(row.source),
    driverId: asText(row.driverId, 64) || null,
    lotCode: asText(row.lotCode, 64) || null,
    palletId: asText(row.palletId, 80) || null,
    targetRowId: asText(row.targetRowId, 40) || null,
    priority: priority || (normalizeMissionKind(row.kind) === "urgent" ? 90 : 0),
    acceptedAt: asText(row.acceptedAt, 40) || null,
    doneAt: asText(row.doneAt, 40) || null,
    refusedAt: asText(row.refusedAt, 40) || null,
    refuseReason: asText(row.refuseReason, 240) || null,
  }
}

function emptySnapshot(): FleetSnapshot {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    karas: [],
    drivers: [],
    routes: [],
    missions: [],
    loadingPoints: [],
    violations: [],
    settings: { hideAllRoutes: false, hideEditorRoute: false },
  }
}

function seedSnapshot(): FleetSnapshot {
  const now = new Date().toISOString()
  const routeA: KaraRoute = {
    id: "rt-a30",
    name: "Линия → ряды A-30–A-32",
    lineCode: "SIPA",
    itemCode: null,
    itemName: null,
    recommendedRowIds: ["A-30", "A-31", "A-32"],
    stops: [
      { tagId: 1, kind: "pickup", label: "Погрузка / тег 1" },
      { tagId: 2, kind: "waypoint", label: "Точка 2" },
      { tagId: 0, kind: "drop", label: "Выгрузка / тег 0" },
    ],
    enabled: true,
    hidden: false,
    createdAt: now,
    updatedAt: now,
  }
  const routeB: KaraRoute = {
    id: "rt-a33",
    name: "Линия → ряды A-33–A-35",
    lineCode: "JR",
    itemCode: null,
    itemName: null,
    recommendedRowIds: ["A-33", "A-34", "A-35"],
    stops: [
      { tagId: 1, kind: "pickup", label: "Погрузка / тег 1" },
      { tagId: 0, kind: "drop", label: "Выгрузка / тег 0" },
    ],
    enabled: true,
    hidden: false,
    createdAt: now,
    updatedAt: now,
  }
  return {
    version: 1,
    updatedAt: now,
    karas: [
      {
        id: "kara-1",
        name: "Кара 1",
        boardName: "Кара 1",
        boardNumber: "1",
        externalId: "kara-1",
        enabled: true,
        lineCode: "SIPA",
        routeIds: [routeA.id, routeB.id],
        createdAt: now,
        updatedAt: now,
      },
    ],
    drivers: [],
    routes: [routeA, routeB],
    missions: [],
    loadingPoints: [],
    violations: [],
    settings: { hideAllRoutes: false, hideEditorRoute: false },
  }
}

export function normalizeFleet(raw: unknown): Omit<FleetSnapshot, "version" | "updatedAt"> {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const routes = Array.isArray(row.routes)
    ? row.routes.map((item) => normalizeRoute(item)).filter((x): x is KaraRoute => Boolean(x))
    : []
  const knownRoutes = new Set(routes.map((r) => r.id))
  const karas = Array.isArray(row.karas)
    ? row.karas
        .map((item) => normalizeKara(item))
        .filter((x): x is KaraUnit => Boolean(x))
        .map((k) => ({ ...k, routeIds: k.routeIds.filter((id) => knownRoutes.has(id)) }))
    : []
  const missions = Array.isArray(row.missions)
    ? row.missions.map((item) => normalizeMission(item)).filter((x): x is KaraMission => Boolean(x)).slice(0, 200)
    : []
  const loadingPoints = Array.isArray(row.loadingPoints)
    ? row.loadingPoints
        .map((item) => normalizeLoadingPoint(item))
        .filter((x): x is LoadingPoint => Boolean(x))
        .slice(0, 200)
    : []
  const knownKaras = new Set(karas.map((k) => k.id))
  const drivers = Array.isArray(row.drivers)
    ? row.drivers
        .map((item) => normalizeDriver(item))
        .filter((x): x is KaraDriver => Boolean(x))
        .map((d) => ({
          ...d,
          karaId: d.karaId && knownKaras.has(d.karaId) ? d.karaId : d.karaId,
        }))
        .slice(0, 200)
    : []
  const violations = Array.isArray(row.violations)
    ? row.violations
        .map((item) => normalizeViolation(item))
        .filter((x): x is KaraViolation => Boolean(x))
        .slice(0, 500)
    : []
  return {
    karas,
    drivers,
    routes,
    missions,
    loadingPoints,
    violations,
    settings: normalizeSettings(row.settings),
  }
}

function normalizeViolationKind(value: unknown): KaraViolationKind {
  const raw = asText(value, 32).toLowerCase()
  if (
    raw === "refuse" ||
    raw === "wrong_row" ||
    raw === "wrong_task" ||
    raw === "ignored_urgent" ||
    raw === "other"
  ) {
    return raw
  }
  return "other"
}

function normalizeViolation(raw: unknown): KaraViolation | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const message = asText(row.message, 400)
  if (!message) return null
  const metaRaw = row.meta
  const meta: Record<string, string> | undefined =
    metaRaw && typeof metaRaw === "object"
      ? Object.fromEntries(
          Object.entries(metaRaw as Record<string, unknown>)
            .map(([k, v]) => [String(k).slice(0, 40), String(v ?? "").slice(0, 120)])
            .filter(([k]) => k)
        )
      : undefined
  return {
    id: asText(row.id, 64) || newFleetId("vl"),
    kind: normalizeViolationKind(row.kind),
    driverId: asText(row.driverId, 64) || null,
    karaId: asText(row.karaId, 64) || null,
    missionId: asText(row.missionId, 64) || null,
    message,
    createdAt: asText(row.createdAt, 40) || new Date().toISOString(),
    meta,
  }
}

export function addViolation(
  snapshot: FleetSnapshot,
  input: {
    kind: KaraViolationKind | string
    driverId?: string | null
    karaId?: string | null
    missionId?: string | null
    message: string
    meta?: Record<string, string>
  }
): { snapshot: FleetSnapshot; violation: KaraViolation } {
  const violation = normalizeViolation({
    ...input,
    id: newFleetId("vl"),
    createdAt: new Date().toISOString(),
  })
  if (!violation) throw new Error("укажите текст нарушения")
  const violations = [violation, ...(snapshot.violations || [])].slice(0, 500)
  return { snapshot: { ...snapshot, violations }, violation }
}

export type KaraDriverStats = {
  driverId: string
  fullName: string
  shiftCode: string | null
  lineCode: string | null
  karaId: string | null
  tasksTotal: number
  tasksDone: number
  tasksMain: number
  tasksInterleave: number
  tasksUrgent: number
  tasksRefused: number
  palletsDone: number
  workMinutes: number
  violations: number
}

export function computeDriverStats(snapshot: FleetSnapshot): KaraDriverStats[] {
  const byDriver = new Map<string, KaraDriverStats>()
  for (const d of snapshot.drivers || []) {
    byDriver.set(d.id, {
      driverId: d.id,
      fullName: d.fullName,
      shiftCode: d.shiftCode,
      lineCode: d.lineCode,
      karaId: d.karaId,
      tasksTotal: 0,
      tasksDone: 0,
      tasksMain: 0,
      tasksInterleave: 0,
      tasksUrgent: 0,
      tasksRefused: 0,
      palletsDone: 0,
      workMinutes: 0,
      violations: 0,
    })
  }

  for (const m of snapshot.missions || []) {
    const id = m.driverId
    if (!id) continue
    let row = byDriver.get(id)
    if (!row) {
      row = {
        driverId: id,
        fullName: id,
        shiftCode: null,
        lineCode: m.lineCode,
        karaId: m.karaId,
        tasksTotal: 0,
        tasksDone: 0,
        tasksMain: 0,
        tasksInterleave: 0,
        tasksUrgent: 0,
        tasksRefused: 0,
        palletsDone: 0,
        workMinutes: 0,
        violations: 0,
      }
      byDriver.set(id, row)
    }
    row.tasksTotal += 1
    if (m.kind === "main") row.tasksMain += 1
    if (m.kind === "interleave") row.tasksInterleave += 1
    if (m.kind === "urgent") row.tasksUrgent += 1
    if (m.status === "done") {
      row.tasksDone += 1
      row.palletsDone += 1
      if (m.acceptedAt && m.doneAt) {
        const a = Date.parse(m.acceptedAt)
        const b = Date.parse(m.doneAt)
        if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
          row.workMinutes += Math.round((b - a) / 60000)
        }
      }
    }
    if (m.status === "refused") row.tasksRefused += 1
  }

  for (const v of snapshot.violations || []) {
    if (!v.driverId) continue
    const row = byDriver.get(v.driverId)
    if (row) row.violations += 1
  }

  return [...byDriver.values()].sort(
    (a, b) => b.tasksDone - a.tasksDone || a.fullName.localeCompare(b.fullName, "ru")
  )
}


export async function readFgKaraFleet(siteId: number): Promise<FleetSnapshot> {
  const filePath = fleetPath(siteId)
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as FleetSnapshot
    if (parsed?.version === 1) {
      return {
        version: 1,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
        ...normalizeFleet(parsed),
      }
    }
  } catch {
    /* first run */
  }
  const seeded = seedSnapshot()
  await writeFgKaraFleet(siteId, seeded)
  return seeded
}

export async function writeFgKaraFleet(siteId: number, payload: unknown): Promise<FleetSnapshot> {
  await mkdir(sharedRoot(), { recursive: true })
  const snapshot: FleetSnapshot = {
    version: 1,
    updatedAt: new Date().toISOString(),
    ...normalizeFleet(payload),
  }
  await writeFile(fleetPath(siteId), JSON.stringify(snapshot, null, 2), "utf8")
  return snapshot
}

export function upsertKara(snapshot: FleetSnapshot, input: unknown): { snapshot: FleetSnapshot; kara: KaraUnit } {
  const existing = snapshot.karas.find((k) => k.id === asText((input as { id?: string })?.id, 64))
  const kara = normalizeKara(input, existing)
  if (!kara) throw new Error("укажите имя кары")
  const karas = existing
    ? snapshot.karas.map((k) => (k.id === kara.id ? kara : k))
    : [...snapshot.karas, kara]
  return { snapshot: { ...snapshot, karas }, kara }
}

export function upsertLoadingPoint(
  snapshot: FleetSnapshot,
  input: unknown
): { snapshot: FleetSnapshot; point: LoadingPoint } {
  const existing = snapshot.loadingPoints.find((p) => p.id === asText((input as { id?: string })?.id, 64))
  const point = normalizeLoadingPoint(input, existing)
  if (!point) throw new Error("укажите название точки погрузки")
  const loadingPoints = existing
    ? snapshot.loadingPoints.map((p) => (p.id === point.id ? point : p))
    : [...snapshot.loadingPoints, point]
  return { snapshot: { ...snapshot, loadingPoints }, point }
}

export function upsertRoute(snapshot: FleetSnapshot, input: unknown): { snapshot: FleetSnapshot; route: KaraRoute } {
  const existing = snapshot.routes.find((r) => r.id === asText((input as { id?: string })?.id, 64))
  const route = normalizeRoute(input, existing)
  if (!route) throw new Error("укажите название маршрута")
  if (!route.stops.length) throw new Error("маршрут должен содержать хотя бы одну точку-тег")
  const routes = existing
    ? snapshot.routes.map((r) => (r.id === route.id ? route : r))
    : [...snapshot.routes, route]
  return { snapshot: { ...snapshot, routes }, route }
}

export function upsertDriver(
  snapshot: FleetSnapshot,
  input: unknown
): { snapshot: FleetSnapshot; driver: KaraDriver } {
  const existing = snapshot.drivers.find((d) => d.id === asText((input as { id?: string })?.id, 64))
  const driver = normalizeDriver(input, existing)
  if (!driver) throw new Error("укажите ФИО карщика")
  if (driver.karaId && !snapshot.karas.some((k) => k.id === driver.karaId)) {
    throw new Error("кара не найдена")
  }
  const drivers = existing
    ? snapshot.drivers.map((d) => (d.id === driver.id ? driver : d))
    : [...snapshot.drivers, driver]
  return { snapshot: { ...snapshot, drivers }, driver }
}

export function removeDriver(snapshot: FleetSnapshot, driverId: string): FleetSnapshot {
  return {
    ...snapshot,
    drivers: snapshot.drivers.filter((d) => d.id !== driverId),
  }
}

