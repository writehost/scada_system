/**
 * Топология проездов склада и расчёт маршрута.
 *
 * Координаты — пиксели плана склада ГП (3503×2562), масштаб задаётся в coord.metersPerUnit.
 * Маршрут ищется A* по рёбрам графа. Прямых «по воздуху» нет: путь — только по рёбрам,
 * а публикация карты запрещена, если ребро пересекает стеллаж, стену или запретную зону.
 */

export type Pt = { x: number; y: number }

export type MapNodeKind = "way" | "junction" | "access" | "pickup" | "drop" | "buffer" | "ship" | "gate"

export type MapNode = {
  id: string
  x: number
  y: number
  kind: MapNodeKind
  label?: string
}

export type MapEdge = {
  id: string
  from: string
  to: string
  /** true — только from → to */
  oneway?: boolean
  /** Если не задано — считается по координатам. */
  lengthM?: number
  /** Пусто — любой тип погрузчика. */
  forkliftTypes?: string[]
  maxWidthM?: number | null
  maxHeightM?: number | null
  /** false — с грузом нельзя. По умолчанию можно. */
  loadedAllowed?: boolean
  speedKmh?: number | null
  /** Постоянная блокировка в версии карты. Временные — отдельно, у диспетчера. */
  blocked?: boolean
  blockReason?: string | null
  /** Доплата за опасный/загруженный участок, секунды. */
  penaltyS?: number
  pedestrian?: boolean
}

export type MapAreaKind = "obstacle" | "no_go" | "pedestrian" | "wall" | "zone"

export type MapArea = {
  id: string
  kind: MapAreaKind
  polygon: Array<[number, number]>
  label?: string
}

export type MapPointKind = "line_pickup" | "storage" | "buffer" | "shipping" | "return" | "other"

export type MapPoint = {
  id: string
  code: string
  kind: MapPointKind
  nodeId: string
  label: string
}

export type AddressBinding = {
  /** Код адреса WMS, например FG-A-32 */
  locationCode: string
  nodeId: string
}

export type RackRect = { id: string; zone: string; x: number; y: number; w: number; h: number }

export type MapGeometry = {
  coord: {
    unit: "plan_px"
    metersPerUnit: number
    width: number
    height: number
    background?: string | null
  }
  nodes: MapNode[]
  edges: MapEdge[]
  areas: MapArea[]
  points: MapPoint[]
  addresses: AddressBinding[]
  racks: RackRect[]
}

export type RouteConstraints = {
  forkliftType?: string | null
  widthM?: number | null
  heightM?: number | null
  loaded?: boolean
  /** Временные блокировки диспетчера */
  blockedEdgeIds?: ReadonlySet<string>
  defaultSpeedKmh?: number
}

export type RouteResult =
  | {
      ok: true
      nodeIds: string[]
      edgeIds: string[]
      polyline: Pt[]
      lengthM: number
      etaS: number
      snappedFrom: Pt | null
    }
  | { ok: false; code: "unknown_node" | "off_graph" | "no_path" | "same_place"; reason: string }

const DEFAULT_SPEED_KMH = 8

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function edgeLengthM(g: MapGeometry, edge: MapEdge, nodes: Map<string, MapNode>): number {
  if (typeof edge.lengthM === "number" && edge.lengthM > 0) return edge.lengthM
  const a = nodes.get(edge.from)
  const b = nodes.get(edge.to)
  if (!a || !b) return Infinity
  return dist(a, b) * g.coord.metersPerUnit
}

/** Можно ли ехать по ребру с данными ограничениями. */
export function edgeAllowed(edge: MapEdge, c: RouteConstraints): boolean {
  if (edge.blocked) return false
  if (c.blockedEdgeIds?.has(edge.id)) return false
  if (c.loaded && edge.loadedAllowed === false) return false
  if (edge.forkliftTypes && edge.forkliftTypes.length && c.forkliftType) {
    if (!edge.forkliftTypes.includes(c.forkliftType)) return false
  }
  if (edge.maxWidthM != null && c.widthM != null && c.widthM > edge.maxWidthM) return false
  if (edge.maxHeightM != null && c.heightM != null && c.heightM > edge.maxHeightM) return false
  return true
}

function edgeCostS(lengthM: number, edge: MapEdge, c: RouteConstraints): number {
  const kmh = edge.speedKmh && edge.speedKmh > 0 ? edge.speedKmh : c.defaultSpeedKmh || DEFAULT_SPEED_KMH
  return lengthM / (kmh / 3.6) + Math.max(0, edge.penaltyS ?? 0)
}

type Arc = { to: string; edgeId: string; lengthM: number; costS: number }

function buildAdjacency(g: MapGeometry, c: RouteConstraints) {
  const nodes = new Map(g.nodes.map((n) => [n.id, n]))
  const adj = new Map<string, Arc[]>()
  for (const n of g.nodes) adj.set(n.id, [])
  for (const e of g.edges) {
    if (!nodes.has(e.from) || !nodes.has(e.to)) continue
    if (!edgeAllowed(e, c)) continue
    const lengthM = edgeLengthM(g, e, nodes)
    const costS = edgeCostS(lengthM, e, c)
    adj.get(e.from)!.push({ to: e.to, edgeId: e.id, lengthM, costS })
    if (!e.oneway) adj.get(e.to)!.push({ to: e.from, edgeId: e.id, lengthM, costS })
  }
  return { nodes, adj }
}

/** Мини-куча для A*. */
class Heap {
  private items: Array<{ id: string; f: number }> = []
  get size() {
    return this.items.length
  }
  push(id: string, f: number) {
    const a = this.items
    a.push({ id, f })
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p].f <= a[i].f) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop(): { id: string; f: number } | undefined {
    const a = this.items
    if (!a.length) return undefined
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l].f < a[m].f) m = l
        if (r < a.length && a[r].f < a[m].f) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}

export type Snap = {
  edgeId: string
  point: Pt
  t: number
  distance: number
  from: string
  to: string
  oneway: boolean
}

function projectOnSegment(p: Pt, a: Pt, b: Pt): { point: Pt; t: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { point: { ...a }, t: 0 }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return { point: { x: a.x + dx * t, y: a.y + dy * t }, t }
}

/** Ближайшая точка на разрешённом ребре. */
export function snapToGraph(
  g: MapGeometry,
  p: Pt,
  c: RouteConstraints,
  maxDistanceUnits: number
): Snap | null {
  const nodes = new Map(g.nodes.map((n) => [n.id, n]))
  let best: Snap | null = null
  for (const e of g.edges) {
    if (!edgeAllowed(e, c)) continue
    const a = nodes.get(e.from)
    const b = nodes.get(e.to)
    if (!a || !b) continue
    const { point, t } = projectOnSegment(p, a, b)
    const d = dist(p, point)
    if (d <= maxDistanceUnits && (!best || d < best.distance)) {
      best = { edgeId: e.id, point, t, distance: d, from: e.from, to: e.to, oneway: Boolean(e.oneway) }
    }
  }
  return best
}

const START = "__start__"

/**
 * Маршрут от узла или от произвольной точки (текущая позиция погрузчика) до узла.
 * От точки — сначала привязка к ближайшему разрешённому ребру (не дальше snapMaxM).
 */
export function findRoute(
  g: MapGeometry,
  from: { nodeId: string } | { point: Pt; snapMaxM?: number },
  toNodeId: string,
  c: RouteConstraints = {}
): RouteResult {
  const { nodes, adj } = buildAdjacency(g, c)
  const target = nodes.get(toNodeId)
  if (!target) return { ok: false, code: "unknown_node", reason: `узел назначения ${toNodeId} не найден на карте` }

  let startId: string
  let snapped: Pt | null = null
  if ("nodeId" in from) {
    if (!nodes.has(from.nodeId)) {
      return { ok: false, code: "unknown_node", reason: `узел ${from.nodeId} не найден на карте` }
    }
    startId = from.nodeId
  } else {
    const maxUnits = (from.snapMaxM ?? 4) / g.coord.metersPerUnit
    const snap = snapToGraph(g, from.point, c, maxUnits)
    if (!snap) {
      return { ok: false, code: "off_graph", reason: "позиция погрузчика вне разрешённых проездов" }
    }
    snapped = snap.point
    startId = START
    const a = nodes.get(snap.from)!
    const b = nodes.get(snap.to)!
    const edge = g.edges.find((e) => e.id === snap.edgeId)!
    const arcs: Arc[] = []
    const toB = dist(snap.point, b) * g.coord.metersPerUnit
    arcs.push({ to: snap.to, edgeId: snap.edgeId, lengthM: toB, costS: edgeCostS(toB, edge, c) })
    if (!snap.oneway) {
      const toA = dist(snap.point, a) * g.coord.metersPerUnit
      arcs.push({ to: snap.from, edgeId: snap.edgeId, lengthM: toA, costS: edgeCostS(toA, edge, c) })
    }
    adj.set(START, arcs)
  }

  if (startId === toNodeId) {
    return { ok: false, code: "same_place", reason: "погрузчик уже в точке назначения" }
  }

  const maxKmh = Math.max(
    c.defaultSpeedKmh || DEFAULT_SPEED_KMH,
    ...g.edges.map((e) => (e.speedKmh && e.speedKmh > 0 ? e.speedKmh : 0))
  )
  const h = (id: string) => {
    const n = id === START ? snapped! : nodes.get(id)!
    return (dist(n, target) * g.coord.metersPerUnit) / (maxKmh / 3.6)
  }

  const gScore = new Map<string, number>([[startId, 0]])
  const prev = new Map<string, { node: string; arc: Arc }>()
  const closed = new Set<string>()
  const heap = new Heap()
  heap.push(startId, h(startId))
  while (heap.size) {
    const cur = heap.pop()!.id
    if (closed.has(cur)) continue
    if (cur === toNodeId) break
    closed.add(cur)
    const base = gScore.get(cur) ?? Infinity
    for (const arc of adj.get(cur) ?? []) {
      if (closed.has(arc.to)) continue
      const cand = base + arc.costS
      if (cand < (gScore.get(arc.to) ?? Infinity)) {
        gScore.set(arc.to, cand)
        prev.set(arc.to, { node: cur, arc })
        heap.push(arc.to, cand + h(arc.to))
      }
    }
  }
  if (!prev.has(toNodeId)) {
    return { ok: false, code: "no_path", reason: "безопасный маршрут не найден: проезды закрыты или нет связи" }
  }

  const nodeIds: string[] = []
  const edgeIds: string[] = []
  let lengthM = 0
  let cursor = toNodeId
  while (cursor !== startId) {
    const step = prev.get(cursor)!
    nodeIds.push(cursor)
    edgeIds.push(step.arc.edgeId)
    lengthM += step.arc.lengthM
    cursor = step.node
  }
  nodeIds.reverse()
  edgeIds.reverse()
  const polyline: Pt[] = []
  if (startId === START) polyline.push(snapped!)
  else {
    const s = nodes.get(startId)!
    polyline.push({ x: s.x, y: s.y })
    nodeIds.unshift(startId)
  }
  for (const id of startId === START ? nodeIds : nodeIds.slice(1)) {
    const n = nodes.get(id)!
    polyline.push({ x: n.x, y: n.y })
  }
  return {
    ok: true,
    nodeIds,
    edgeIds,
    polyline,
    lengthM: Math.round(lengthM * 10) / 10,
    etaS: Math.round(gScore.get(toNodeId) ?? 0),
    snappedFrom: snapped,
  }
}

/* ---------- Геометрия для проверки карты ---------- */

function orient(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

export function segmentsIntersect(p1: Pt, p2: Pt, q1: Pt, q2: Pt): boolean {
  const d1 = orient(q1, q2, p1)
  const d2 = orient(q1, q2, p2)
  const d3 = orient(p1, p2, q1)
  const d4 = orient(p1, p2, q2)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  return false
}

export function pointInPolygon(p: Pt, poly: Array<[number, number]>): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Отрезок проходит через внутреннюю часть прямоугольника (касание края не считается). */
export function segmentHitsRect(a: Pt, b: Pt, r: { x: number; y: number; w: number; h: number }, inset = 0.5): boolean {
  const x0 = r.x + inset
  const y0 = r.y + inset
  const x1 = r.x + r.w - inset
  const y1 = r.y + r.h - inset
  if (x1 <= x0 || y1 <= y0) return false
  // Liang–Barsky
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  const checks: Array<[number, number]> = [
    [-dx, a.x - x0],
    [dx, x1 - a.x],
    [-dy, a.y - y0],
    [dy, y1 - a.y],
  ]
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false
    } else {
      const t = q / p
      if (p < 0) {
        if (t > t1) return false
        if (t > t0) t0 = t
      } else {
        if (t < t0) return false
        if (t < t1) t1 = t
      }
    }
  }
  return t1 - t0 > 1e-9
}

export function segmentHitsPolygon(a: Pt, b: Pt, poly: Array<[number, number]>): boolean {
  if (poly.length < 3) return false
  if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return true
  if (pointInPolygon({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, poly)) return true
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (segmentsIntersect(a, b, { x: poly[j][0], y: poly[j][1] }, { x: poly[i][0], y: poly[i][1] })) return true
  }
  return false
}

export type MapIssue = { level: "error" | "warning"; code: string; message: string; ref?: string }

/** Проверка версии карты перед публикацией. Ошибки запрещают публикацию. */
export function validateMap(g: MapGeometry): { ok: boolean; issues: MapIssue[]; components: number } {
  const issues: MapIssue[] = []
  const nodes = new Map<string, MapNode>()
  for (const n of g.nodes) {
    if (nodes.has(n.id)) issues.push({ level: "error", code: "dup_node", message: `повтор узла ${n.id}`, ref: n.id })
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) {
      issues.push({ level: "error", code: "bad_node", message: `у узла ${n.id} нет координат`, ref: n.id })
    }
    nodes.set(n.id, n)
  }
  const edgeIds = new Set<string>()
  for (const e of g.edges) {
    if (edgeIds.has(e.id)) issues.push({ level: "error", code: "dup_edge", message: `повтор ребра ${e.id}`, ref: e.id })
    edgeIds.add(e.id)
    const a = nodes.get(e.from)
    const b = nodes.get(e.to)
    if (!a || !b) {
      issues.push({ level: "error", code: "dangling_edge", message: `ребро ${e.id} ссылается на несуществующий узел`, ref: e.id })
      continue
    }
    if (e.from === e.to) issues.push({ level: "error", code: "loop_edge", message: `ребро ${e.id} — петля`, ref: e.id })
    for (const rack of g.racks) {
      if (segmentHitsRect(a, b, rack)) {
        issues.push({
          level: "error",
          code: "edge_through_rack",
          message: `проезд ${e.id} проходит сквозь стеллаж ${rack.id}`,
          ref: e.id,
        })
        break
      }
    }
    for (const area of g.areas) {
      if (area.kind !== "obstacle" && area.kind !== "wall" && area.kind !== "no_go") continue
      if (segmentHitsPolygon(a, b, area.polygon)) {
        issues.push({
          level: "error",
          code: "edge_through_obstacle",
          message: `проезд ${e.id} пересекает ${area.kind === "no_go" ? "запретную зону" : "препятствие"} ${area.label || area.id}`,
          ref: e.id,
        })
        break
      }
    }
    for (const area of g.areas) {
      if (area.kind === "pedestrian" && segmentHitsPolygon(a, b, area.polygon) && !(e.penaltyS && e.penaltyS > 0)) {
        issues.push({
          level: "warning",
          code: "pedestrian_no_penalty",
          message: `проезд ${e.id} через пешеходную зону ${area.label || area.id} без доплаты стоимости`,
          ref: e.id,
        })
        break
      }
    }
  }
  for (const p of g.points) {
    if (!nodes.has(p.nodeId)) {
      issues.push({ level: "error", code: "point_node", message: `точка ${p.code} привязана к несуществующему узлу`, ref: p.id })
    }
  }
  const seenAddr = new Set<string>()
  for (const a of g.addresses) {
    const code = a.locationCode.trim().toUpperCase()
    if (seenAddr.has(code)) issues.push({ level: "error", code: "dup_address", message: `адрес ${code} привязан дважды`, ref: code })
    seenAddr.add(code)
    if (!nodes.has(a.nodeId)) {
      issues.push({ level: "error", code: "address_node", message: `адрес ${code} привязан к несуществующему узлу`, ref: code })
    }
  }
  // связность (без учёта направлений)
  const adj = new Map<string, string[]>()
  for (const n of g.nodes) adj.set(n.id, [])
  for (const e of g.edges) {
    if (!nodes.has(e.from) || !nodes.has(e.to)) continue
    adj.get(e.from)!.push(e.to)
    adj.get(e.to)!.push(e.from)
  }
  const seen = new Set<string>()
  let components = 0
  for (const n of g.nodes) {
    if (seen.has(n.id)) continue
    components += 1
    const stack = [n.id]
    seen.add(n.id)
    while (stack.length) {
      const cur = stack.pop()!
      for (const next of adj.get(cur) ?? []) {
        if (!seen.has(next)) {
          seen.add(next)
          stack.push(next)
        }
      }
    }
  }
  if (components > 1) {
    issues.push({
      level: "warning",
      code: "disconnected",
      message: `граф разделён на ${components} несвязанных частей — часть адресов недостижима`,
    })
  }
  return { ok: !issues.some((i) => i.level === "error"), issues, components }
}

/** Узел доступа к адресу WMS. FG-A-32 / A-32 — одно и то же. */
export function nodeForAddress(g: MapGeometry, locationCode: string): string | null {
  const want = normalizeLocation(locationCode)
  if (!want) return null
  const hit = g.addresses.find((a) => normalizeLocation(a.locationCode) === want)
  if (hit) return hit.nodeId
  const point = g.points.find((p) => normalizeLocation(p.code) === want)
  return point?.nodeId ?? null
}

export function normalizeLocation(raw: string | null | undefined): string {
  const v = (raw ?? "").trim().toUpperCase().replace(/\s+/g, "")
  if (!v) return ""
  return v.startsWith("FG-") ? v : /^[A-ZА-ЯЁ]-\d+/.test(v) ? `FG-${v}` : v
}

export function emptyGeometry(): MapGeometry {
  return {
    coord: { unit: "plan_px", metersPerUnit: 0.8 / 12, width: 3503, height: 2562, background: null },
    nodes: [],
    edges: [],
    areas: [],
    points: [],
    addresses: [],
    racks: [],
  }
}
