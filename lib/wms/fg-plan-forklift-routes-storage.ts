import path from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"

/**
 * Тип точки маршрута.
 * - way    — обычная путевая точка;
 * - pickup — точка погрузки: на вилы добавляется груз;
 * - drop   — точка остановки/разгрузки: груз снимается, кара отъезжает назад и разворачивается;
 * - resume — точка продолжения движения: куда кара уходит после разворота.
 */
export type ForkliftNodeKind = "way" | "pickup" | "drop" | "resume"

export const FORKLIFT_NODE_KINDS: ForkliftNodeKind[] = ["way", "pickup", "drop", "resume"]

export type ForkliftRouteNode = {
  id: string
  x: number
  y: number
  kind: ForkliftNodeKind
  label?: string
}

/** Ребро маршрута. Проезд возможен в обе стороны, направление выбирает симуляция. */
export type ForkliftRouteEdge = {
  id: string
  from: string
  to: string
}

export type ForkliftUnit = {
  id: string
  label?: string
  startNodeId: string | null
  enabled: boolean
}

export type ForkliftSettings = {
  /** План-пиксели в секунду. План склада ГП — 3503×2562, ряд зоны A шириной 18 px. */
  speed: number
  /** Длина корпуса кары в план-пикселях. По умолчанию не больше одной ячейки ряда. */
  bodyLength: number
  /** Насколько кара отъезжает назад после разгрузки, план-пиксели. */
  reverseDistance: number
  /** Пауза на погрузке/разгрузке, мс. */
  dwellMs: number
  /** Дальность конуса сканирования, план-пиксели. */
  scannerRange: number
  /** Угол обзора конуса, градусы. */
  scannerFov: number
  scannerEnabled: boolean
}

export type ForkliftRoutesSnapshot = {
  version: 1
  updatedAt: string
  nodes: ForkliftRouteNode[]
  edges: ForkliftRouteEdge[]
  units: ForkliftUnit[]
  settings: ForkliftSettings
}

/** Ячейка ряда зоны A: 18×18 план-пикселей. Кара не должна быть больше. */
export const DEFAULT_FORKLIFT_SETTINGS: ForkliftSettings = {
  speed: 90,
  bodyLength: 18,
  reverseDistance: 26,
  dwellMs: 900,
  scannerRange: 110,
  scannerFov: 46,
  scannerEnabled: true,
}

const PLAN_WIDTH = 3503
const PLAN_HEIGHT = 2562

function sharedRoot(): string {
  const shared = (process.env.WMS_SHARED_DIR ?? "").trim()
  if (shared) return path.join(shared, "uploads", "fg-plan-forklift-routes")

  const cwd = process.cwd()
  const currentMarker = `${path.sep}current${path.sep}`
  const markerIndex = cwd.toLowerCase().indexOf(currentMarker.toLowerCase())
  if (markerIndex >= 0) {
    const installRoot = cwd.slice(0, markerIndex)
    return path.join(installRoot, "shared", "uploads", "fg-plan-forklift-routes")
  }

  return path.join(process.cwd(), "public", "fg-plan-forklift-routes")
}

function routesPath(siteId: number): string {
  return path.join(sharedRoot(), `site-${siteId}.json`)
}

function asFinite(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function asKind(value: unknown): ForkliftNodeKind {
  const raw = String(value ?? "").trim() as ForkliftNodeKind
  return FORKLIFT_NODE_KINDS.includes(raw) ? raw : "way"
}

function asLabel(value: unknown): string | undefined {
  const raw = typeof value === "string" ? value.trim() : ""
  return raw ? raw.slice(0, 120) : undefined
}

export function normalizeForkliftNodes(raw: unknown): ForkliftRouteNode[] {
  if (!Array.isArray(raw)) return []
  const out: ForkliftRouteNode[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const x = asFinite(row.x)
    const y = asFinite(row.y)
    if (x == null || y == null) continue
    let id = typeof row.id === "string" && row.id.trim() ? row.id.trim().slice(0, 64) : `n-${out.length + 1}`
    while (seen.has(id)) id = `${id}-${out.length + 1}`
    seen.add(id)
    out.push({
      id,
      x: round3(clamp(x, 0, PLAN_WIDTH)),
      y: round3(clamp(y, 0, PLAN_HEIGHT)),
      kind: asKind(row.kind),
      label: asLabel(row.label),
    })
  }
  return out
}

/** Ребра без существующих концов и петли отбрасываются, дубликаты сводятся к одному. */
export function normalizeForkliftEdges(raw: unknown, nodes: ForkliftRouteNode[]): ForkliftRouteEdge[] {
  if (!Array.isArray(raw)) return []
  const known = new Set(nodes.map(node => node.id))
  const out: ForkliftRouteEdge[] = []
  const seenPair = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const from = String(row.from ?? "").trim()
    const to = String(row.to ?? "").trim()
    if (!from || !to || from === to) continue
    if (!known.has(from) || !known.has(to)) continue
    const pair = from < to ? `${from}|${to}` : `${to}|${from}`
    if (seenPair.has(pair)) continue
    seenPair.add(pair)
    out.push({
      id: typeof row.id === "string" && row.id.trim() ? row.id.trim().slice(0, 64) : `e-${out.length + 1}`,
      from,
      to,
    })
  }
  return out
}

export function normalizeForkliftUnits(raw: unknown, nodes: ForkliftRouteNode[]): ForkliftUnit[] {
  if (!Array.isArray(raw)) return []
  const known = new Set(nodes.map(node => node.id))
  const out: ForkliftUnit[] = []
  for (const item of raw.slice(0, 24)) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const startRaw = String(row.startNodeId ?? "").trim()
    out.push({
      id: typeof row.id === "string" && row.id.trim() ? row.id.trim().slice(0, 64) : `f-${out.length + 1}`,
      label: asLabel(row.label),
      startNodeId: startRaw && known.has(startRaw) ? startRaw : null,
      enabled: row.enabled === undefined ? true : Boolean(row.enabled),
    })
  }
  return out
}

export function normalizeForkliftSettings(raw: unknown): ForkliftSettings {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const pick = (key: keyof ForkliftSettings, min: number, max: number): number => {
    const value = asFinite(row[key])
    if (value == null) return DEFAULT_FORKLIFT_SETTINGS[key] as number
    return round3(clamp(value, min, max))
  }
  return {
    speed: pick("speed", 5, 1200),
    bodyLength: pick("bodyLength", 6, 160),
    reverseDistance: pick("reverseDistance", 0, 400),
    dwellMs: pick("dwellMs", 0, 20000),
    scannerRange: pick("scannerRange", 0, 900),
    scannerFov: pick("scannerFov", 4, 180),
    scannerEnabled:
      row.scannerEnabled === undefined ? DEFAULT_FORKLIFT_SETTINGS.scannerEnabled : Boolean(row.scannerEnabled),
  }
}

export function normalizeForkliftRoutes(raw: unknown): Omit<ForkliftRoutesSnapshot, "version" | "updatedAt"> {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const nodes = normalizeForkliftNodes(row.nodes)
  return {
    nodes,
    edges: normalizeForkliftEdges(row.edges, nodes),
    units: normalizeForkliftUnits(row.units, nodes),
    settings: normalizeForkliftSettings(row.settings),
  }
}

function emptySnapshot(): ForkliftRoutesSnapshot {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    nodes: [],
    edges: [],
    units: [],
    settings: { ...DEFAULT_FORKLIFT_SETTINGS },
  }
}

export async function readFgPlanForkliftRoutes(siteId: number): Promise<ForkliftRoutesSnapshot> {
  const filePath = routesPath(siteId)
  try {
    const raw = await readFile(filePath, "utf8")
    const parsed = JSON.parse(raw) as ForkliftRoutesSnapshot
    if (parsed?.version === 1) {
      const normalized = normalizeForkliftRoutes(parsed)
      return {
        version: 1,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
        ...normalized,
      }
    }
  } catch {
    /* файла ещё нет — отдаём пустой маршрут */
  }
  return emptySnapshot()
}

export async function writeFgPlanForkliftRoutes(
  siteId: number,
  payload: unknown
): Promise<ForkliftRoutesSnapshot> {
  const dir = sharedRoot()
  await mkdir(dir, { recursive: true })
  const snapshot: ForkliftRoutesSnapshot = {
    version: 1,
    updatedAt: new Date().toISOString(),
    ...normalizeForkliftRoutes(payload),
  }
  await writeFile(routesPath(siteId), JSON.stringify(snapshot, null, 2), "utf8")
  return snapshot
}
