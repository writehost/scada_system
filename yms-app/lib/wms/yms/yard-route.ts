export type YardRect = {
  objectId: string
  kind: string
  x: number
  y: number
  w: number
  h: number
}

export type RoutePoint = { x: number; y: number }

const TRAVEL = new Set(["road", "gate_in", "gate_out", "parking", "dock", "wait_zone", "unload_zone"])

function center(rect: YardRect): RoutePoint {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
}

function contains(rect: YardRect, point: RoutePoint, pad = 0): boolean {
  return (
    point.x >= rect.x - pad &&
    point.x <= rect.x + rect.w + pad &&
    point.y >= rect.y - pad &&
    point.y <= rect.y + rect.h + pad
  )
}

function sample(a: RoutePoint, b: RoutePoint, steps: number): RoutePoint[] {
  const points: RoutePoint[] = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }
  return points
}

function hitsBuilding(objects: YardRect[], a: RoutePoint, b: RoutePoint): boolean {
  const buildings = objects.filter((object) => object.kind === "building")
  const doors = objects.filter((object) => object.kind === "dock")
  return sample(a, b, 12).some((point) => {
    const insideBuilding = buildings.some((building) => contains(building, point, -1))
    if (!insideBuilding) return false
    return !doors.some((door) => contains(door, point, 28))
  })
}

function onApron(objects: YardRect[], a: RoutePoint, b: RoutePoint): boolean {
  const pads = objects.filter((object) => TRAVEL.has(object.kind))
  return sample(a, b, 10).every((point) => pads.some((pad) => contains(pad, point, 6)))
}

/** Кратчайший путь по проездам. Сквозь здания не строится. */
export function routeBetween(objects: YardRect[], fromId: string | null, toId: string | null): RoutePoint[] | null {
  if (!fromId || !toId || fromId === toId) return null
  const nodes = objects.filter((object) => TRAVEL.has(object.kind))
  const from = nodes.find((object) => object.objectId === fromId)
  const to = nodes.find((object) => object.objectId === toId)
  if (!from || !to) return null

  const points = new Map(nodes.map((object) => [object.objectId, center(object)]))
  const neighbours = new Map<string, string[]>()
  for (const left of nodes) {
    neighbours.set(left.objectId, [])
  }
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = points.get(nodes[i].objectId)!
      const b = points.get(nodes[j].objectId)!
      if (hitsBuilding(objects, a, b)) continue
      const linked = onApron(objects, a, b) || (!hitsBuilding(objects, a, b) && Math.hypot(a.x - b.x, a.y - b.y) < 280)
      if (!linked) continue
      neighbours.get(nodes[i].objectId)!.push(nodes[j].objectId)
      neighbours.get(nodes[j].objectId)!.push(nodes[i].objectId)
    }
  }

  const dist = new Map<string, number>([[fromId, 0]])
  const prev = new Map<string, string | null>([[fromId, null]])
  const queue = [fromId]
  while (queue.length) {
    queue.sort((left, right) => (dist.get(left) ?? Infinity) - (dist.get(right) ?? Infinity))
    const current = queue.shift()!
    if (current === toId) break
    for (const next of neighbours.get(current) ?? []) {
      const a = points.get(current)!
      const b = points.get(next)!
      const weight = Math.hypot(a.x - b.x, a.y - b.y)
      const candidate = (dist.get(current) ?? Infinity) + weight
      if (candidate + 0.01 < (dist.get(next) ?? Infinity)) {
        dist.set(next, candidate)
        prev.set(next, current)
        queue.push(next)
      }
    }
  }
  if (!prev.has(toId)) return null
  const path: RoutePoint[] = []
  let cursor: string | null = toId
  const guard = new Set<string>()
  while (cursor) {
    if (guard.has(cursor)) return null
    guard.add(cursor)
    const point = points.get(cursor)
    if (!point) return null
    path.push(point)
    cursor = prev.get(cursor) ?? null
  }
  path.reverse()
  for (let i = 1; i < path.length; i += 1) {
    if (hitsBuilding(objects, path[i - 1], path[i])) return null
  }
  return path
}
