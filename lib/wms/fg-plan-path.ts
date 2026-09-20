import {
  type ForkliftRouteEdge,
  type ForkliftRouteNode,
  type ForkliftRoutesSnapshot,
  readFgPlanForkliftRoutes,
} from "@/lib/wms/fg-plan-forklift-routes-storage"

export type PathTag = {
  index: number
  id: string
  kind: ForkliftRouteNode["kind"]
  title: string
}

export type PathTripStop = {
  tagId: number
  kind: "waypoint" | "pickup" | "drop"
  label: string
  source: "path"
  nodeId: string
}

export function asPathIndex(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim())
  if (!Number.isFinite(n) || n < 1) return null
  return Math.trunc(n)
}

export function pathTagTitle(kind: ForkliftRouteNode["kind"], index: number): string {
  if (kind === "pickup") return `погрузка ${index}`
  if (kind === "drop") return `разгрузка ${index}`
  if (kind === "resume") return `продолжение ${index}`
  return `тег пути ${index}`
}

export function listPathTags(snapshot: ForkliftRoutesSnapshot): PathTag[] {
  return snapshot.nodes.map((node, i) => {
    const index = i + 1
    return {
      index,
      id: node.id,
      kind: node.kind,
      title: node.label ? `${pathTagTitle(node.kind, index)} · ${node.label}` : pathTagTitle(node.kind, index),
    }
  })
}

export function shortestNodePath(
  nodes: ForkliftRouteNode[],
  edges: ForkliftRouteEdge[],
  fromId: string,
  toId: string
): string[] {
  if (!fromId || !toId) return []
  if (fromId === toId) return [fromId]
  const adj = new Map<string, string[]>()
  for (const node of nodes) adj.set(node.id, [])
  for (const edge of edges) {
    adj.get(edge.from)?.push(edge.to)
    adj.get(edge.to)?.push(edge.from)
  }
  const prev = new Map<string, string | null>()
  prev.set(fromId, null)
  const q = [fromId]
  for (let i = 0; i < q.length; i += 1) {
    const cur = q[i]
    if (cur === toId) break
    for (const next of adj.get(cur) || []) {
      if (prev.has(next)) continue
      prev.set(next, cur)
      q.push(next)
    }
  }
  if (!prev.has(toId)) return []
  const out: string[] = []
  let cur: string | null = toId
  while (cur) {
    out.push(cur)
    cur = prev.get(cur) ?? null
  }
  return out.reverse()
}

function toStop(tag: PathTag, kind: PathTripStop["kind"]): PathTripStop {
  return {
    tagId: tag.index,
    kind,
    label: tag.title,
    source: "path",
    nodeId: tag.id,
  }
}

export function buildPathTrip(
  graph: ForkliftRoutesSnapshot,
  opts: { pickupIndex?: number | null; dropIndex?: number | null }
): PathTripStop[] {
  const tags = listPathTags(graph)
  const pickup = opts.pickupIndex ? tags.find((t) => t.index === opts.pickupIndex) : undefined
  const drop = opts.dropIndex ? tags.find((t) => t.index === opts.dropIndex) : undefined
  if (pickup && drop) {
    if (pickup.id === drop.id) return [toStop(pickup, pickup.kind === "drop" ? "drop" : "pickup")]
    const ids = shortestNodePath(graph.nodes, graph.edges, pickup.id, drop.id)
    if (ids.length < 2) return [toStop(pickup, "pickup"), toStop(drop, "drop")]
    return ids.map((id, i) => {
      const tag = tags.find((t) => t.id === id)
      if (!tag) return toStop(i === 0 ? pickup : drop, i === 0 ? "pickup" : "drop")
      const kind: PathTripStop["kind"] = i === 0 ? "pickup" : i === ids.length - 1 ? "drop" : "waypoint"
      return toStop(tag, kind)
    })
  }
  if (pickup) return [toStop(pickup, "pickup")]
  if (drop) return [toStop(drop, "drop")]
  return []
}

export async function loadPlanPath(siteId: number) {
  const graph = await readFgPlanForkliftRoutes(siteId)
  return { graph, tags: listPathTags(graph) }
}
