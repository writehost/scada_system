import path from "node:path"
import { readFile } from "node:fs/promises"
import type { PoolClient } from "pg"
import {
  type FleetSnapshot,
  type KaraMission,
  type KaraMissionKind,
  type KaraMissionSource,
  type KaraRoute,
  type KaraUnit,
  newFleetId,
  normalizeStops,
  parseStopPath,
  readFgKaraFleet,
  upsertKara,
  upsertLoadingPoint,
  upsertRoute,
  writeFgKaraFleet,
  addViolation,
} from "@/lib/wms/fg-kara-fleet-storage"
import { asPathIndex, buildPathTrip, loadPlanPath } from "@/lib/wms/fg-plan-path"
import { suggestInterleave, type InterleaveOffer } from "@/lib/wms/fg-interleave"

export type FleetTag = {
  tagId: number
  label: string
  rows: string[]
}

export type RowAdvice = {
  rowId: string
  label: string
  fillPercent: number
  tagId: number | null
  reason: string
}

function shiftCode(value: string | null | undefined): string {
  return (value || "").trim().replace(/^смена\s+/i, "").toLowerCase()
}

function sameCode(a: string | null | undefined, b: string | null | undefined): boolean {
  return shiftCode(a) === shiftCode(b)
}

function apriltagsPath(siteId: number): string {
  const shared = (process.env.WMS_SHARED_DIR ?? "").trim()
  const cwd = process.cwd()
  const marker = `${path.sep}current${path.sep}`
  const idx = cwd.toLowerCase().indexOf(marker.toLowerCase())
  const root = shared
    ? path.join(shared, "uploads", "fg-plan-apriltags")
    : idx >= 0
      ? path.join(cwd.slice(0, idx), "shared", "uploads", "fg-plan-apriltags")
      : path.join(cwd, "public", "fg-plan-apriltags")
  return path.join(root, `site-${siteId}.json`)
}

export async function loadFleetTags(siteId: number): Promise<FleetTag[]> {
  try {
    const snap = JSON.parse(await readFile(apriltagsPath(siteId), "utf8")) as {
      tags?: Array<{ tagId?: number; label?: string; coverage?: { rows?: string[] } }>
    }
    return (snap.tags || []).map((tag) => ({
      tagId: Number(tag.tagId),
      label: String(tag.label || `ID ${tag.tagId}`),
      rows: Array.isArray(tag.coverage?.rows) ? tag.coverage.rows.map(String) : [],
    }))
  } catch {
    return []
  }
}

export function pickRoute(
  routes: KaraRoute[],
  opts: { routeId?: string; lineCode?: string; itemCode?: string; allowedIds?: string[] }
): KaraRoute | null {
  if (opts.allowedIds && opts.allowedIds.length === 0) return null
  const pool = opts.allowedIds
    ? routes.filter((r) => r.enabled && opts.allowedIds!.includes(r.id))
    : routes.filter((r) => r.enabled)
  if (!pool.length) return null
  if (opts.routeId) return pool.find((r) => r.id === opts.routeId) || null
  const item = (opts.itemCode || "").trim()
  const line = (opts.lineCode || "").trim()
  const scored = pool
    .map((route) => {
      let score = 0
      if (item && route.itemCode && sameCode(route.itemCode, item)) score += 8
      if (line && route.lineCode && sameCode(route.lineCode, line)) score += 4
      if (item && !route.itemCode) score += 1
      if (line && !route.lineCode) score += 1
      return { route, score }
    })
    .sort((a, b) => b.score - a.score)
  if (item || line) {
    const best = scored[0]
    if (!best) return null
    if (best.score >= 4) return best.route
    // Смена/линия из АПС без своего маршрута: берём общий назначенный маршрут кары.
    if (line && !item && best.score >= 1) return best.route
    return null
  }
  return scored[0]?.route || pool[0] || null
}

export function findKara(
  karas: KaraUnit[],
  opts: { karaId?: string; karaName?: string; lineCode?: string }
): KaraUnit | null {
  const enabled = karas.filter((k) => k.enabled)
  if (opts.karaId) return enabled.find((k) => k.id === opts.karaId) || null
  if (opts.karaName) {
    const name = opts.karaName.trim().toLowerCase()
    return enabled.find((k) => k.name.trim().toLowerCase() === name) || null
  }
  if (opts.lineCode) {
    return enabled.find((k) => sameCode(k.lineCode, opts.lineCode)) || null
  }
  return enabled[0] || null
}

export async function lookupLineItem(
  client: PoolClient,
  siteId: number,
  lineCode: string
): Promise<{ itemCode: string; itemName: string } | null> {
  const line = lineCode.trim()
  if (!line) return null
  try {
    const r = await client.query<{ item_code: string; item_name: string }>(
      `SELECT item_code, COALESCE(item_name, item_nomenclature, item_code) AS item_name
       FROM wms_production_plans
       WHERE site_id = $1 AND UPPER(line_code) = UPPER($2)
         AND COALESCE(status, '') NOT IN ('cancelled', 'done', 'finished')
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,
      [siteId, line]
    )
    const row = r.rows[0]
    if (!row?.item_code) return null
    return { itemCode: row.item_code, itemName: row.item_name }
  } catch {
    return null
  }
}

export async function recommendRows(
  client: PoolClient,
  siteId: number,
  route: KaraRoute | null,
  tags: FleetTag[]
): Promise<RowAdvice[]> {
  let rows: Array<{ rowId: string; label: string; fillPercent: number }> = []
  try {
    const mod = (await import("@/lib/wms/finished-goods-warehouse")) as {
      listFgStorageRows?: (
        c: PoolClient,
        id: number,
        opts?: { query?: string }
      ) => Promise<Array<{ rowId: string; rowCode?: string; label?: string; fillPercent: number }>>
    }
    if (mod.listFgStorageRows) {
      const list = await mod.listFgStorageRows(client, siteId, {})
      rows = list.map((r) => ({
        rowId: r.rowId,
        label: r.label || r.rowCode || r.rowId,
        fillPercent: r.fillPercent,
      }))
    }
  } catch {
    rows = []
  }
  const byId = new Map(rows.map((r) => [r.rowId.toUpperCase(), r]))
  const out: RowAdvice[] = []
  const seen = new Set<string>()

  const push = (rowId: string, reason: string, tagId: number | null) => {
    const key = rowId.toUpperCase()
    if (!rowId || seen.has(key)) return
    seen.add(key)
    const hit = byId.get(key)
    out.push({
      rowId,
      label: hit?.label || rowId,
      fillPercent: hit?.fillPercent ?? 0,
      tagId,
      reason,
    })
  }

  for (const rowId of route?.recommendedRowIds || []) {
    const tag = tags.find((t) => t.rows.some((r) => sameCode(r, rowId)))
    push(rowId, "задан на маршруте под эту номенклатуру", tag?.tagId ?? null)
  }

  const dropTag = [...(route?.stops || [])].reverse().find((s) => s.kind === "drop")
  if (dropTag) {
    const tag = tags.find((t) => t.tagId === dropTag.tagId)
    for (const rowId of tag?.rows || []) {
      push(rowId, `ряд закрывает тег ${tag?.tagId}`, dropTag.tagId)
    }
  }

  if (!out.length) {
    for (const tag of tags) {
      for (const rowId of tag.rows) push(rowId, `тег ${tag.tagId} на плане`, tag.tagId)
    }
  }

  return out.sort((a, b) => a.fillPercent - b.fillPercent).slice(0, 12)
}

export async function recommendFor(
  client: PoolClient,
  siteId: number,
  opts: { karaId?: string; lineCode?: string; itemCode?: string; routeId?: string }
) {
  const fleet = await readFgKaraFleet(siteId)
  const tags = await loadFleetTags(siteId)
  const kara = findKara(fleet.karas, opts)
  let itemCode = opts.itemCode || ""
  let itemName: string | null = null
  const lineCode = opts.lineCode || kara?.lineCode || ""
  if (!itemCode && lineCode) {
    const fromPlan = await lookupLineItem(client, siteId, lineCode)
    if (fromPlan) {
      itemCode = fromPlan.itemCode
      itemName = fromPlan.itemName
    }
  }
  const route = pickRoute(fleet.routes, {
    routeId: opts.routeId,
    lineCode,
    itemCode,
    allowedIds: kara?.routeIds,
  })
  const rows = await recommendRows(client, siteId, route, tags)
  const active = kara ? fleet.missions.find((m) => m.karaId === kara.id && m.status === "active") : null
  const at = active?.stops[active.currentIndex] ?? active?.stops[active.stops.length - 1] ?? null
  const interleave = suggestInterleave(fleet, kara, at)
  return {
    fleet,
    tags,
    kara,
    route,
    itemCode: itemCode || null,
    itemName,
    lineCode: lineCode || null,
    rows,
    interleave,
  }
}

export async function dispatchKara(
  client: PoolClient,
  siteId: number,
  input: {
    karaId?: string
    karaName?: string
    lineCode?: string
    itemCode?: string
    routeId?: string
    stops?: unknown
    path?: unknown
    pickupIndex?: unknown
    dropIndex?: unknown
    note?: string
    kind?: KaraMissionKind | string
    source?: KaraMissionSource | string
    driverId?: string | null
    lotCode?: string | null
    palletId?: string | null
    targetRowId?: string | null
    priority?: number
    /** queued = ждать «взял»; active = сразу в работе */
    startStatus?: "queued" | "active"
  }
): Promise<{
  fleet: FleetSnapshot
  mission: KaraMission
  kara: KaraUnit
  route: KaraRoute | null
  interleave: InterleaveOffer | null
}> {
  const fleet = await readFgKaraFleet(siteId)
  const kara = findKara(fleet.karas, input)
  if (!kara) throw new Error("кара не найдена или выключена")

  // Карщик: явный → закреплённый за карой → закреплённый за линией
  let resolvedDriverId =
    input.driverId != null && String(input.driverId).trim()
      ? String(input.driverId).trim().slice(0, 64)
      : null
  if (!resolvedDriverId) {
    const byKara = (fleet.drivers || []).find((d) => d.enabled && d.karaId === kara.id)
    if (byKara) resolvedDriverId = byKara.id
  }
  if (!resolvedDriverId) {
    const lineHint = (input.lineCode || kara.lineCode || "").trim()
    if (lineHint) {
      const byLine = (fleet.drivers || []).find(
        (d) => d.enabled && d.lineCode && d.lineCode.toUpperCase() === lineHint.replace(/^смена\s+/i, "").toUpperCase()
      )
      if (byLine) resolvedDriverId = byLine.id
    }
  }

  let itemCode = (input.itemCode || "").trim()
  const loadingPoint =
    fleet.loadingPoints.find(
      (p) =>
        p.enabled &&
        ((input.lineCode && sameCode(p.lineCode, input.lineCode)) ||
          sameCode(p.lineCode, kara.lineCode))
    ) || null
  const lineCode = (input.lineCode || kara.lineCode || loadingPoint?.lineCode || "")
    .trim()
    .replace(/^смена\s+/i, "")
  if (!itemCode && lineCode) {
    const fromPlan = await lookupLineItem(client, siteId, lineCode)
    if (fromPlan) itemCode = fromPlan.itemCode
  }

  const pickupIndex = asPathIndex(input.pickupIndex)
  const dropIndex = asPathIndex(input.dropIndex)
  const hasPathTrip = pickupIndex != null || dropIndex != null

  const explicit = normalizeStops(input.stops)
  const fromPath = parseStopPath(input.path)
  const hasManualPath = explicit.length > 0 || fromPath.length > 0
  const route = hasPathTrip
    ? null
    : pickRoute(fleet.routes, {
        routeId: input.routeId,
        lineCode,
        itemCode,
        allowedIds: kara.routeIds,
      })
  if (!hasManualPath && !hasPathTrip) {
    if (!kara.routeIds.length) {
      throw new Error("кара не поедет: на неё не назначен ни один маршрут")
    }
    if (!route) {
      throw new Error(
        "кара не поедет: нет маршрута под эту линию/номенклатуру — назначьте маршрут каре или передайте path"
      )
    }
  }

  let stops = hasManualPath ? (explicit.length ? explicit : fromPath) : route?.stops || []
  let pathRouteName = ""
  if (hasPathTrip) {
    const { graph, tags } = await loadPlanPath(siteId)
    if (pickupIndex != null && !tags.some((t) => t.index === pickupIndex)) {
      throw new Error(`на линии маршрута нет тега пути ${pickupIndex}`)
    }
    if (dropIndex != null && !tags.some((t) => t.index === dropIndex)) {
      throw new Error(`на линии маршрута нет тега пути ${dropIndex}`)
    }
    stops = buildPathTrip(graph, { pickupIndex, dropIndex })
    if (pickupIndex != null && dropIndex != null) {
      pathRouteName = `погрузка ${pickupIndex} → разгрузка ${dropIndex}`
    } else if (pickupIndex != null) {
      pathRouteName = `к погрузке ${pickupIndex}`
    } else {
      pathRouteName = `к разгрузке ${dropIndex}`
    }
  } else if (!hasManualPath && loadingPoint?.tagId != null) {
    const already = stops.some((s) => s.tagId === loadingPoint.tagId)
    if (!already) {
      stops = [
        { tagId: loadingPoint.tagId, kind: "pickup", label: loadingPoint.name, source: "apriltag" },
        ...stops,
      ]
    }
  }
  if (!stops.length) throw new Error("в выбранном маршруте нет точек-тегов")

  const now = new Date().toISOString()
  const kindRaw = String(input.kind || "main").toLowerCase()
  const kind: KaraMissionKind =
    kindRaw === "interleave" || kindRaw === "urgent" || kindRaw === "main" ? kindRaw : "main"
  const sourceRaw = String(input.source || "wms").toLowerCase()
  const source: KaraMissionSource =
    sourceRaw === "mes" || sourceRaw === "manual" || sourceRaw === "wms" ? sourceRaw : "wms"
  const startStatus = input.startStatus === "queued" ? "queued" : "active"
  const priority =
    typeof input.priority === "number" && Number.isFinite(input.priority)
      ? Math.max(0, Math.min(100, Math.trunc(input.priority)))
      : kind === "urgent"
        ? 90
        : kind === "interleave"
          ? 40
          : 50
  const dropStop = [...stops].reverse().find((s) => s.kind === "drop")
  const mission: KaraMission = {
    id: newFleetId("ms"),
    karaId: kara.id,
    routeId: route?.id || null,
    routeName: pathRouteName || route?.name || (input.path ? "По тегам" : "Задание"),
    lineCode: lineCode || null,
    itemCode: itemCode || route?.itemCode || null,
    status: startStatus,
    stops,
    currentIndex: 0,
    createdAt: now,
    updatedAt: now,
    note:
      typeof input.note === "string"
        ? input.note.trim().slice(0, 240)
        : hasPathTrip
          ? "Теги пути на оранжевой линии, не AprilTag рядов."
          : undefined,
    kind,
    source,
    driverId: resolvedDriverId,
    lotCode: input.lotCode ? String(input.lotCode).trim().slice(0, 64) : null,
    palletId: input.palletId ? String(input.palletId).trim().slice(0, 80) : null,
    targetRowId:
      (input.targetRowId ? String(input.targetRowId).trim().slice(0, 40) : null) ||
      dropStop?.rowId ||
      null,
    priority,
    acceptedAt: startStatus === "active" ? now : null,
    doneAt: null,
    refusedAt: null,
    refuseReason: null,
  }

  const missions = [
    mission,
    ...fleet.missions.map((m) =>
      m.karaId === kara.id && m.status === "active"
        ? { ...m, status: "cancelled" as const, updatedAt: now }
        : m
    ),
  ].slice(0, 200)

  const next = await writeFgKaraFleet(siteId, { ...fleet, missions })
  const interleave = suggestInterleave(next, kara, mission.stops[0] ?? null)
  return { fleet: next, mission, kara, route, interleave }
}

export async function advanceMission(
  siteId: number,
  missionId: string,
  action: "advance" | "cancel" | "complete" | "accept" | "refuse" | "wrong_row",
  opts?: {
    driverId?: string | null
    refuseReason?: string | null
    actualRowId?: string | null
  }
): Promise<{ fleet: FleetSnapshot; mission: KaraMission; interleave: InterleaveOffer | null }> {
  const fleet = await readFgKaraFleet(siteId)
  const current = fleet.missions.find((m) => m.id === missionId)
  if (!current) throw new Error("задание не найдено")
  const now = new Date().toISOString()
  let mission: KaraMission = { ...current, updatedAt: now }
  let snapshot: FleetSnapshot = fleet

  if (action === "accept") {
    if (current.status !== "queued" && current.status !== "active") {
      throw new Error("задание нельзя взять в этом статусе")
    }
    // чужое задание: назначено другому driverId
    if (current.driverId && opts?.driverId && current.driverId !== opts.driverId) {
      const v = addViolation(snapshot, {
        kind: "wrong_task",
        driverId: opts.driverId,
        karaId: current.karaId,
        missionId: current.id,
        message: "Взял чужое задание",
        meta: { assignedDriverId: current.driverId },
      })
      snapshot = v.snapshot
    }
    mission = {
      ...mission,
      status: "active",
      acceptedAt: current.acceptedAt || now,
      driverId: opts?.driverId || current.driverId,
    }
  } else if (action === "refuse") {
    if (current.status === "done") throw new Error("выполненное задание нельзя отклонить")
    const reason = (opts?.refuseReason || "").trim().slice(0, 240) || "отказ"
    mission = {
      ...mission,
      status: "refused",
      refusedAt: now,
      refuseReason: reason,
      driverId: opts?.driverId || current.driverId,
    }
    const v = addViolation(snapshot, {
      kind: current.kind === "urgent" ? "ignored_urgent" : "refuse",
      driverId: opts?.driverId || current.driverId,
      karaId: current.karaId,
      missionId: current.id,
      message: reason,
      meta: { kind: current.kind, palletId: current.palletId || "" },
    })
    snapshot = v.snapshot
  } else if (action === "wrong_row") {
    const actual = (opts?.actualRowId || "").trim().slice(0, 40) || "?"
    const expected = current.targetRowId || "?"
    const v = addViolation(snapshot, {
      kind: "wrong_row",
      driverId: opts?.driverId || current.driverId,
      karaId: current.karaId,
      missionId: current.id,
      message: `Поставил не в тот ряд: ожидали ${expected}, факт ${actual}`,
      meta: { expected, actual, palletId: current.palletId || "" },
    })
    snapshot = v.snapshot
    // задание остаётся active — диспетчер решает
    mission = { ...mission, note: `нарушение ряда: ${expected}→${actual}` }
  } else if (action === "cancel") {
    mission = { ...mission, status: "cancelled" }
  } else if (action === "complete") {
    mission = {
      ...mission,
      status: "done",
      currentIndex: Math.max(0, mission.stops.length - 1),
      doneAt: now,
      acceptedAt: current.acceptedAt || now,
      driverId: opts?.driverId || current.driverId,
    }
  } else {
    const nextIndex = current.currentIndex + 1
    if (nextIndex >= current.stops.length) {
      mission = {
        ...mission,
        status: "done",
        currentIndex: current.stops.length - 1,
        doneAt: now,
      }
    } else {
      mission = { ...mission, status: "active", currentIndex: nextIndex }
    }
  }

  let missions = snapshot.missions.map((m) => (m.id === mission.id ? mission : m))

  // После сдачи основного/срочного — если рядом попутный маршрут, ставим interleave в очередь
  let spawnedInterleave: KaraMission | null = null
  const justDone = mission.status === "done" && current.status !== "done"
  if (justDone && mission.kind !== "interleave") {
    const karaForOffer = snapshot.karas.find((k) => k.id === mission.karaId) ?? null
    const atDone = mission.stops[mission.stops.length - 1] ?? null
    const offer = suggestInterleave({ ...snapshot, missions }, karaForOffer, atDone)
    if (offer && karaForOffer) {
      const route = snapshot.routes.find((r) => r.id === offer.routeId) || null
      const stops = route?.stops?.length
        ? route.stops
        : ([
            {
              tagId: offer.pickupTagId || 1,
              kind: "pickup" as const,
              label: offer.pickupLabel,
              rowId: offer.pickupRowId || undefined,
            },
            {
              tagId: offer.fromTagId || 0,
              kind: "drop" as const,
              label: offer.fromLabel,
              rowId: offer.fromRowId || undefined,
            },
          ] as KaraMission["stops"])
      const drop = [...stops].reverse().find((s) => s.kind === "drop")
      spawnedInterleave = {
        id: newFleetId("ms"),
        karaId: karaForOffer.id,
        routeId: route?.id || offer.routeId || null,
        routeName: offer.routeName || "Попутно",
        lineCode: route?.lineCode || mission.lineCode || karaForOffer.lineCode || null,
        itemCode: route?.itemCode || null,
        status: "queued",
        stops,
        currentIndex: 0,
        createdAt: now,
        updatedAt: now,
        note: offer.reason.slice(0, 240),
        kind: "interleave",
        source: "wms",
        driverId: mission.driverId,
        lotCode: null,
        palletId: null,
        targetRowId: drop?.rowId || offer.fromRowId || null,
        priority: 40,
        acceptedAt: null,
        doneAt: null,
        refusedAt: null,
        refuseReason: null,
      }
      // не дублировать такой же queued interleave на ту же кару/route
      const dup = missions.some(
        (m) =>
          m.karaId === spawnedInterleave!.karaId &&
          m.kind === "interleave" &&
          (m.status === "queued" || m.status === "active") &&
          m.routeId === spawnedInterleave!.routeId
      )
      if (!dup) {
        missions = [spawnedInterleave, ...missions].slice(0, 200)
      } else {
        spawnedInterleave = null
      }
    }
  }

  const next = await writeFgKaraFleet(siteId, {
    ...snapshot,
    missions,
  })
  const kara = next.karas.find((k) => k.id === mission.karaId) ?? null
  const at =
    mission.status === "done"
      ? mission.stops[mission.stops.length - 1] ?? null
      : mission.stops[mission.currentIndex] ?? null
  const interleave =
    spawnedInterleave
      ? {
          karaId: spawnedInterleave.karaId,
          karaName: kara?.name || spawnedInterleave.karaId,
          fromTagId: at?.tagId ?? null,
          fromRowId: at?.rowId ?? null,
          fromLabel: at?.label || at?.rowId || "",
          routeId: spawnedInterleave.routeId || "",
          routeName: spawnedInterleave.routeName,
          pickupTagId: spawnedInterleave.stops.find((s) => s.kind === "pickup")?.tagId ?? null,
          pickupRowId: spawnedInterleave.stops.find((s) => s.kind === "pickup")?.rowId ?? null,
          pickupLabel: spawnedInterleave.stops.find((s) => s.kind === "pickup")?.label || "забор",
          distance: 0,
          savedEmptyRun: true,
          reason: spawnedInterleave.note || "Создано попутное задание",
        }
      : suggestInterleave(next, kara, at)
  return { fleet: next, mission, interleave }
}

export async function setFleetVisibility(
  siteId: number,
  patch: {
    hideAllRoutes?: boolean
    hideEditorRoute?: boolean
    hiddenRouteIds?: string[]
    routeId?: string
    hidden?: boolean
  }
) {
  const fleet = await readFgKaraFleet(siteId)
  let routes = fleet.routes
  if (patch.hiddenRouteIds) {
    const hidden = new Set(patch.hiddenRouteIds)
    routes = routes.map((r) => ({ ...r, hidden: hidden.has(r.id) }))
  }
  if (patch.routeId && typeof patch.hidden === "boolean") {
    routes = routes.map((r) => (r.id === patch.routeId ? { ...r, hidden: patch.hidden } : r))
  }
  return writeFgKaraFleet(siteId, {
    ...fleet,
    routes,
    settings: {
      hideAllRoutes:
        patch.hideAllRoutes === undefined ? fleet.settings.hideAllRoutes : Boolean(patch.hideAllRoutes),
      hideEditorRoute:
        patch.hideEditorRoute === undefined ? fleet.settings.hideEditorRoute : Boolean(patch.hideEditorRoute),
    },
  })
}

export { readFgKaraFleet, writeFgKaraFleet, upsertKara, upsertRoute, upsertLoadingPoint }
