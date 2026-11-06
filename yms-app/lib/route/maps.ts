import type { PoolClient } from "pg"
import draftSeed from "@/data/route/fg-map-draft.json"
import { WmsHttpError } from "@/lib/wms/errors"
import { publish } from "@/lib/route/events"
import { emptyGeometry, validateMap, type MapGeometry, type MapIssue } from "@/lib/route/graph"

export type MapVersionRow = {
  mapId: string
  version: number
  status: "draft" | "published" | "archived"
  title: string | null
  note: string | null
  revision: number
  basedOn: number | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  publishedBy: string | null
  publishedAt: string | null
}

export type PublishedMap = MapVersionRow & { geometry: MapGeometry }

const cache = new Map<number, { key: string; map: PublishedMap }>()

const COLS = `map_id::text AS "mapId", version, status, title, note, revision, based_on AS "basedOn",
  created_by AS "createdBy", created_at::text AS "createdAt", updated_at::text AS "updatedAt",
  published_by AS "publishedBy", published_at::text AS "publishedAt"`

/** Первая версия — черновик из реального плана (scripts/route-draft-map.py). Не публикуется сам. */
export async function seedDraftIfEmpty(client: PoolClient, siteId: number): Promise<void> {
  const any = await client.query(`SELECT 1 FROM route_map_versions WHERE site_id = $1 LIMIT 1`, [siteId])
  if (any.rowCount) return
  const seed = draftSeed as unknown as { geometry?: MapGeometry; note?: string; source?: string }
  const geometry = seed.geometry ?? emptyGeometry()
  const r = await client.query<{ map_id: string }>(
    `INSERT INTO route_map_versions (site_id, version, status, title, geometry, note, created_by)
     VALUES ($1, 1, 'draft', $2, $3::jsonb, $4, 'system')
     ON CONFLICT (site_id, version) DO NOTHING
     RETURNING map_id::text`,
    [siteId, "Склад ГП — черновик по плану", JSON.stringify(geometry), seed.note ?? null]
  )
  if (r.rows[0]) {
    await client.query(
      `INSERT INTO route_map_changes (site_id, map_id, version, action, summary, actor_login, payload)
       VALUES ($1, $2::bigint, 1, 'seed', $3, 'system', $4::jsonb)`,
      [
        siteId,
        r.rows[0].map_id,
        `Черновик из плана: ${geometry.nodes.length} узлов, ${geometry.edges.length} проездов, ${geometry.addresses.length} адресов`,
        JSON.stringify({ source: seed.source ?? null }),
      ]
    )
  }
}

export async function getPublishedMap(client: PoolClient, siteId: number): Promise<PublishedMap | null> {
  const head = await client.query<{ map_id: string; revision: number }>(
    `SELECT map_id::text, revision FROM route_map_versions WHERE site_id = $1 AND status = 'published'`,
    [siteId]
  )
  const row = head.rows[0]
  if (!row) return null
  const key = `${row.map_id}:${row.revision}`
  const hit = cache.get(siteId)
  if (hit && hit.key === key) return hit.map
  const full = await client.query<MapVersionRow & { geometry: MapGeometry }>(
    `SELECT ${COLS}, geometry FROM route_map_versions WHERE map_id = $1::bigint`,
    [row.map_id]
  )
  const map = full.rows[0]
  if (!map) return null
  cache.set(siteId, { key, map })
  return map
}

export async function requirePublishedMap(client: PoolClient, siteId: number): Promise<PublishedMap> {
  const map = await getPublishedMap(client, siteId)
  if (!map) throw new WmsHttpError(409, "Нет опубликованной карты склада. Диспетчер должен опубликовать карту.", "map_not_published")
  return map
}

export async function listMapVersions(client: PoolClient, siteId: number): Promise<MapVersionRow[]> {
  const r = await client.query<MapVersionRow>(
    `SELECT ${COLS} FROM route_map_versions WHERE site_id = $1 ORDER BY version DESC LIMIT 50`,
    [siteId]
  )
  return r.rows
}

export async function getMapVersion(client: PoolClient, siteId: number, mapId: string): Promise<PublishedMap> {
  if (!/^\d+$/.test(mapId)) throw new WmsHttpError(400, "некорректный mapId", "bad_map_id")
  const r = await client.query<PublishedMap>(
    `SELECT ${COLS}, geometry FROM route_map_versions WHERE site_id = $1 AND map_id = $2::bigint`,
    [siteId, mapId]
  )
  if (!r.rows[0]) throw new WmsHttpError(404, "версия карты не найдена", "map_not_found")
  return r.rows[0]
}

export async function createDraft(
  client: PoolClient,
  siteId: number,
  fromMapId: string,
  actor: string
): Promise<PublishedMap> {
  const base = await getMapVersion(client, siteId, fromMapId)
  const next = await client.query<{ v: number }>(
    `SELECT COALESCE(max(version), 0) + 1 AS v FROM route_map_versions WHERE site_id = $1`,
    [siteId]
  )
  const version = next.rows[0].v
  const r = await client.query<{ map_id: string }>(
    `INSERT INTO route_map_versions (site_id, version, status, title, geometry, based_on, created_by)
     VALUES ($1, $2, 'draft', $3, $4::jsonb, $5, $6) RETURNING map_id::text`,
    [siteId, version, base.title, JSON.stringify(base.geometry), base.version, actor]
  )
  await logChange(client, siteId, r.rows[0].map_id, version, "create_draft", `Черновик v${version} на основе v${base.version}`, actor, {})
  return getMapVersion(client, siteId, r.rows[0].map_id)
}

function diffSummary(before: MapGeometry, after: MapGeometry): { summary: string; payload: Record<string, unknown> } {
  const ids = <T extends { id: string }>(list: T[]) => new Set(list.map((x) => x.id))
  const delta = <T extends { id: string }>(a: T[], b: T[]) => {
    const ia = ids(a)
    const ib = ids(b)
    const added = [...ib].filter((x) => !ia.has(x))
    const removed = [...ia].filter((x) => !ib.has(x))
    const byA = new Map(a.map((x) => [x.id, JSON.stringify(x)]))
    const changed = b.filter((x) => byA.has(x.id) && byA.get(x.id) !== JSON.stringify(x)).map((x) => x.id)
    return { added, removed, changed }
  }
  const n = delta(before.nodes, after.nodes)
  const e = delta(before.edges, after.edges)
  const ar = delta(before.areas, after.areas)
  const pt = delta(before.points, after.points)
  const addrBefore = new Map(before.addresses.map((a) => [a.locationCode, a.nodeId]))
  const addrChanged = after.addresses.filter((a) => addrBefore.get(a.locationCode) !== a.nodeId).map((a) => a.locationCode)
  const parts: string[] = []
  const push = (label: string, d: { added: string[]; removed: string[]; changed: string[] }) => {
    if (d.added.length || d.removed.length || d.changed.length) {
      parts.push(`${label}: +${d.added.length} −${d.removed.length} ~${d.changed.length}`)
    }
  }
  push("узлы", n)
  push("проезды", e)
  push("зоны", ar)
  push("точки", pt)
  if (addrChanged.length) parts.push(`адреса: ~${addrChanged.length}`)
  return {
    summary: parts.join("; ") || "без изменений геометрии",
    payload: {
      nodes: n,
      edges: e,
      areas: ar,
      points: pt,
      addresses: addrChanged.slice(0, 200),
    },
  }
}

function sanitizeGeometry(raw: unknown, base: MapGeometry): MapGeometry {
  if (!raw || typeof raw !== "object") throw new WmsHttpError(400, "geometry обязательна", "geometry_required")
  const g = raw as Partial<MapGeometry>
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  const out: MapGeometry = {
    coord: base.coord,
    nodes: arr<MapGeometry["nodes"][number]>(g.nodes).map((n) => ({
      id: String(n.id).slice(0, 64),
      x: Number(n.x),
      y: Number(n.y),
      kind: n.kind || "way",
      ...(n.label ? { label: String(n.label).slice(0, 120) } : {}),
    })),
    edges: arr<MapGeometry["edges"][number]>(g.edges).map((e) => ({
      ...e,
      id: String(e.id).slice(0, 64),
      from: String(e.from),
      to: String(e.to),
    })),
    areas: arr(g.areas),
    points: arr(g.points),
    addresses: arr<MapGeometry["addresses"][number]>(g.addresses).map((a) => ({
      locationCode: String(a.locationCode).trim().toUpperCase(),
      nodeId: String(a.nodeId),
    })),
    racks: base.racks,
  }
  if (out.nodes.length > 50000 || out.edges.length > 100000) {
    throw new WmsHttpError(413, "слишком большая карта", "map_too_large")
  }
  return out
}

export async function saveDraft(
  client: PoolClient,
  siteId: number,
  mapId: string,
  input: { geometry: unknown; expectedRevision: number | null; summary?: string },
  actor: string
): Promise<{ map: PublishedMap; issues: MapIssue[] }> {
  const current = await getMapVersion(client, siteId, mapId)
  if (current.status !== "draft") {
    throw new WmsHttpError(409, "Опубликованную версию менять нельзя — создайте черновик", "map_not_draft")
  }
  if (input.expectedRevision != null && input.expectedRevision !== current.revision) {
    throw new WmsHttpError(409, "Черновик уже изменил другой пользователь — обновите редактор", "map_revision_conflict", {
      revision: current.revision,
    })
  }
  const geometry = sanitizeGeometry(input.geometry, current.geometry)
  const diff = diffSummary(current.geometry, geometry)
  await client.query(
    `UPDATE route_map_versions SET geometry = $3::jsonb, revision = revision + 1, updated_at = now()
     WHERE site_id = $1 AND map_id = $2::bigint`,
    [siteId, mapId, JSON.stringify(geometry)]
  )
  await logChange(
    client,
    siteId,
    mapId,
    current.version,
    "edit",
    input.summary ? `${input.summary} (${diff.summary})` : diff.summary,
    actor,
    diff.payload
  )
  return { map: await getMapVersion(client, siteId, mapId), issues: validateMap(geometry).issues }
}

export async function publishMap(
  client: PoolClient,
  siteId: number,
  mapId: string,
  actor: string,
  note: string
): Promise<{ map: PublishedMap; issues: MapIssue[] }> {
  const target = await getMapVersion(client, siteId, mapId)
  if (target.status !== "draft") throw new WmsHttpError(409, "Публикуется только черновик", "map_not_draft")
  const check = validateMap(target.geometry)
  if (!check.ok) {
    throw new WmsHttpError(422, "Карта не прошла проверку — публикация запрещена", "map_invalid", {
      issues: check.issues.filter((i) => i.level === "error").slice(0, 100),
    })
  }
  await client.query(
    `UPDATE route_map_versions SET status = 'archived', updated_at = now()
     WHERE site_id = $1 AND status = 'published'`,
    [siteId]
  )
  await client.query(
    `UPDATE route_map_versions SET status = 'published', published_by = $3, published_at = now(),
            note = COALESCE(NULLIF($4, ''), note), updated_at = now()
     WHERE site_id = $1 AND map_id = $2::bigint`,
    [siteId, mapId, actor, note]
  )
  await logChange(client, siteId, mapId, target.version, "publish", `Опубликована v${target.version}${note ? `: ${note}` : ""}`, actor, {
    warnings: check.issues.filter((i) => i.level === "warning").length,
  })
  await publish(client, siteId, "map.published", { payload: { mapId, version: target.version } })
  cache.delete(siteId)
  return { map: await getMapVersion(client, siteId, mapId), issues: check.issues }
}

async function logChange(
  client: PoolClient,
  siteId: number,
  mapId: string,
  version: number,
  action: string,
  summary: string,
  actor: string,
  payload: Record<string, unknown>
) {
  await client.query(
    `INSERT INTO route_map_changes (site_id, map_id, version, action, summary, actor_login, payload)
     VALUES ($1, $2::bigint, $3, $4, $5, $6, $7::jsonb)`,
    [siteId, mapId, version, action, summary.slice(0, 2000), actor, JSON.stringify(payload)]
  )
}

export async function mapChanges(client: PoolClient, siteId: number, mapId: string | null) {
  const r = await client.query(
    `SELECT change_id::text AS "changeId", map_id::text AS "mapId", version, action, summary,
            actor_login AS "actor", created_at::text AS "at"
     FROM route_map_changes
     WHERE site_id = $1 AND ($2::text IS NULL OR map_id = $2::bigint)
     ORDER BY change_id DESC LIMIT 200`,
    [siteId, mapId]
  )
  return r.rows
}

export type EdgeBlock = { blockId: string; edgeId: string; reason: string; createdBy: string | null; createdAt: string; untilAt: string | null }

export async function activeBlocks(client: PoolClient, siteId: number): Promise<EdgeBlock[]> {
  const r = await client.query<EdgeBlock>(
    `SELECT block_id::text AS "blockId", edge_id AS "edgeId", reason, created_by AS "createdBy",
            created_at::text AS "createdAt", until_at::text AS "untilAt"
     FROM route_edge_blocks
     WHERE site_id = $1 AND released_at IS NULL AND (until_at IS NULL OR until_at > now())
     ORDER BY block_id`,
    [siteId]
  )
  return r.rows
}

export async function blockedEdgeSet(client: PoolClient, siteId: number): Promise<Set<string>> {
  return new Set((await activeBlocks(client, siteId)).map((b) => b.edgeId))
}

export function invalidateMapCacheForTests() {
  cache.clear()
}
