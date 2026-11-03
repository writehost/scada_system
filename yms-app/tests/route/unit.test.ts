/**
 * Модульные тесты чистой логики Route: машина состояний, маршрутизация, выбор задания, коды, решения по скану.
 * Запуск: tsx --tsconfig tests/route/tsconfig.yms.json --test tests/route/unit.test.ts
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import draft from "@/data/route/fg-map-draft.json"
import { classifyScan, gs1CheckDigit, parseAddressScan, parseSscc, palletKey } from "@/lib/route/codes"
import { fefoEligible, rankCandidates, type Candidate } from "@/lib/route/dispatch"
import { findRoute, segmentHitsRect, validateMap, type MapGeometry } from "@/lib/route/graph"
import { positionState } from "@/lib/route/positions"
import { decideAddressScan, decidePalletScan } from "@/lib/route/scan-rules"
import { allowedRouteActions, isLoaded, resolveRouteTransition, ROUTE_ACTIONS, ROUTE_TASK_STATUSES } from "@/lib/route/state-machine"

const G = (draft as unknown as { geometry: MapGeometry }).geometry

test("FSM: полный путь задания только по шагам", () => {
  let s = "CREATED" as (typeof ROUTE_TASK_STATUSES)[number]
  for (const a of ["queue", "offer", "accept", "start_pickup", "arrive_pickup", "confirm_load", "start_dropoff", "arrive_dropoff", "complete"] as const) {
    const r = resolveRouteTransition(s, a)
    assert.ok(r.ok, `${s} --${a}`)
    if (r.ok) s = r.to
  }
  assert.equal(s, "COMPLETED")
})

test("FSM: нельзя пропустить скан/погрузку и завершить завершённое", () => {
  assert.equal(resolveRouteTransition("EN_ROUTE_PICKUP", "confirm_load").ok, false)
  assert.equal(resolveRouteTransition("AT_PICKUP", "complete").ok, false)
  assert.equal(resolveRouteTransition("COMPLETED", "complete").ok, false)
  assert.equal(resolveRouteTransition("COMPLETED", "cancel").ok, false)
  assert.equal(resolveRouteTransition("CANCELLED", "accept").ok, false)
  for (const st of ROUTE_TASK_STATUSES) {
    for (const a of ROUTE_ACTIONS) {
      const r = resolveRouteTransition(st, a, "AT_PICKUP")
      if (st === "COMPLETED" || st === "CANCELLED") assert.equal(r.ok, false, `${st} ${a}`)
    }
  }
})

test("FSM: пауза/блок возвращают в прежний статус; груз на вилах не переназначается", () => {
  const p = resolveRouteTransition("EN_ROUTE_DROPOFF", "pause")
  assert.ok(p.ok && p.to === "PAUSED" && p.resumeStatus === "EN_ROUTE_DROPOFF")
  const r = resolveRouteTransition("PAUSED", "resume", "EN_ROUTE_DROPOFF")
  assert.ok(r.ok && r.to === "EN_ROUTE_DROPOFF")
  assert.equal(isLoaded("PAUSED", "EN_ROUTE_DROPOFF"), true)
  assert.equal(resolveRouteTransition("PAUSED", "requeue", "EN_ROUTE_DROPOFF").ok, false)
  assert.equal(resolveRouteTransition("PAUSED", "requeue", "EN_ROUTE_PICKUP").ok, true)
  assert.equal(resolveRouteTransition("LOAD_CONFIRMED", "requeue").ok, false)
  const b = resolveRouteTransition("PAUSED", "block", "AT_DROPOFF")
  assert.ok(b.ok && b.resumeStatus === "AT_DROPOFF")
  assert.deepEqual(allowedRouteActions("AT_DROPOFF").sort(), ["block", "cancel", "complete", "pause", "redirect"].sort())
})

test("карта из реального плана: без проездов сквозь стеллажи, связная", () => {
  const v = validateMap(G)
  const errors = v.issues.filter((i) => i.level === "error")
  assert.equal(errors.length, 0, JSON.stringify(errors.slice(0, 3)))
  assert.equal(v.components, 1)
  assert.ok(G.addresses.length >= 600, `адресов: ${G.addresses.length}`)
})

test("маршрут: A* по графу, путь не пересекает стеллажи, ~1 с с запасом", () => {
  const nodes = new Map(G.nodes.map((n) => [n.id, n]))
  const from = G.addresses.find((a) => a.locationCode === "FG-A-1")!.nodeId
  const to = G.addresses.find((a) => a.locationCode === "FG-F-37-ПРАВЫЙ")?.nodeId || G.addresses[G.addresses.length - 1].nodeId
  const t0 = performance.now()
  const r = findRoute(G, { nodeId: from }, to, { loaded: true })
  const ms = performance.now() - t0
  assert.ok(r.ok, JSON.stringify(r))
  if (!r.ok) return
  assert.ok(ms < 1000, `расчёт ${ms} мс`)
  for (let i = 1; i < r.nodeIds.length; i += 1) {
    const a: { id: string; x: number; y: number } = nodes.get(r.nodeIds[i - 1])!
    const b: { id: string; x: number; y: number } = nodes.get(r.nodeIds[i])!
    for (const rack of G.racks) assert.equal(segmentHitsRect(a, b, rack), false, `${a.id}→${b.id} через ${rack.id}`)
  }
  // прямая между точками короче маршрута по проездам — значит, путь не «по воздуху»
  const straight = Math.hypot(nodes.get(from)!.x - nodes.get(to)!.x, nodes.get(from)!.y - nodes.get(to)!.y) * G.coord.metersPerUnit
  assert.ok(r.lengthM >= straight)
})

test("маршрут: закрытый проезд обходится, полностью закрытый — нет пути; односторонний", () => {
  const from = G.addresses.find((a) => a.locationCode === "FG-A-1")!.nodeId
  const to = G.addresses.find((a) => a.locationCode === "FG-A-32")!.nodeId
  const base = findRoute(G, { nodeId: from }, to)
  assert.ok(base.ok)
  if (!base.ok) return
  const blocked = new Set([base.edgeIds[Math.floor(base.edgeIds.length / 2)]])
  const alt = findRoute(G, { nodeId: from }, to, { blockedEdgeIds: blocked })
  if (alt.ok) assert.ok(!alt.edgeIds.some((e) => blocked.has(e)))
  const around = new Set(G.edges.filter((e) => e.from === to || e.to === to).map((e) => e.id))
  const none = findRoute(G, { nodeId: from }, to, { blockedEdgeIds: around })
  assert.equal(none.ok, false)
  if (!none.ok) assert.equal(none.code, "no_path")

  const tiny: MapGeometry = {
    ...G,
    racks: [],
    nodes: [
      { id: "a", x: 0, y: 0, kind: "way" },
      { id: "b", x: 100, y: 0, kind: "way" },
    ],
    edges: [{ id: "ab", from: "a", to: "b", oneway: true }],
    addresses: [],
    points: [],
  }
  assert.equal(findRoute(tiny, { nodeId: "a" }, "b").ok, true)
  assert.equal(findRoute(tiny, { nodeId: "b" }, "a").ok, false)
  const noLoad: MapGeometry = { ...tiny, edges: [{ id: "ab", from: "a", to: "b", loadedAllowed: false }] }
  assert.equal(findRoute(noLoad, { nodeId: "a" }, "b", { loaded: true }).ok, false)
  const narrow: MapGeometry = { ...tiny, edges: [{ id: "ab", from: "a", to: "b", maxWidthM: 1.2 }] }
  assert.equal(findRoute(narrow, { nodeId: "a" }, "b", { widthM: 1.5 }).ok, false)
  assert.equal(findRoute(tiny, { point: { x: 500, y: 500 }, snapMaxM: 2 }, "b").ok, false)
})

test("проверка карты ловит проезд сквозь стеллаж", () => {
  const bad: MapGeometry = {
    ...G,
    racks: [{ id: "R", zone: "A", x: 40, y: -10, w: 18, h: 20 }],
    nodes: [
      { id: "a", x: 0, y: 0, kind: "way" },
      { id: "b", x: 100, y: 0, kind: "way" },
    ],
    edges: [{ id: "ab", from: "a", to: "b" }],
    addresses: [],
    points: [],
    areas: [],
  }
  const v = validateMap(bad)
  assert.equal(v.ok, false)
  assert.ok(v.issues.some((i) => i.code === "edge_through_rack"))
})

test("FEFO: близость не отменяет срок годности", () => {
  const now = Date.parse("2026-11-03T10:00:00Z")
  const c = (id: string, expiry: string): Candidate => ({
    taskId: id,
    type: "SHIPPING_PICK",
    priority: 50,
    createdAt: "2026-11-03T09:00:00Z",
    itemCode: "ITEM-1",
    expiryAt: expiry,
    forkliftTypes: null,
    declinedBy: [],
  })
  const list = [c("near-late", "2027-05-01"), c("far-early", "2026-12-01")]
  assert.deepEqual([...fefoEligible(list)], ["far-early"])
  const ranked = rankCandidates(list, { karaId: "k", forkliftType: null, now }, (x) => (x.taskId === "near-late" ? 5 : 300))
  assert.equal(ranked[0].taskId, "far-early")
  // в пределах уровня срочности побеждает меньший пустой пробег
  const other = [
    { ...c("a", ""), type: "PUTAWAY" as const, itemCode: "X" },
    { ...c("b", ""), type: "PUTAWAY" as const, itemCode: "Y" },
  ]
  const r2 = rankCandidates(other, { karaId: "k", forkliftType: null, now }, (x) => (x.taskId === "a" ? 200 : 20))
  assert.equal(r2[0].taskId, "b")
  // без пути — кандидат исключён (безопасность первым приоритетом)
  const r3 = rankCandidates(other, { karaId: "k", forkliftType: null, now }, (x) => (x.taskId === "a" ? null : 20))
  assert.deepEqual(r3.map((x) => x.taskId), ["b"])
})

test("коды: GS1 SSCC с AI 00, адрес из QR ячейки", () => {
  const d17 = "46000000000000001"
  const sscc = `00${d17}${gs1CheckDigit(d17)}`
  assert.equal(parseSscc(`]C1${sscc}`).ok, true)
  assert.equal(parseSscc(`(00)${sscc.slice(2)}`).ok, true)
  const bad = parseSscc(`00${d17}${(gs1CheckDigit(d17) + 1) % 10}`)
  assert.ok(bad.ok && !bad.checkOk)
  assert.equal(palletKey(`(00) ${sscc.slice(2)}`), sscc)
  assert.equal(parseAddressScan("https://wms.scada25.ru/s/c/FG-A-32"), "FG-A-32")
  assert.equal(parseAddressScan("a-32"), "FG-A-32")
  assert.equal(classifyScan("https://wms.scada25.ru/s/c/FG-A-32").kind, "address")
  assert.equal(classifyScan(sscc).kind, "sscc")
})

test("решение по скану: чужая палета, карантин, не тот адрес, нет места", () => {
  const task = { huCode: "00460000000000000017", sourceCode: "FG-A-1", sourceIsStorage: true, destCode: "FG-A-32", taskRef: "ROUTE:RT-1" }
  const pallet = {
    palletId: "1",
    code: task.huCode,
    sscc: task.huCode,
    itemCode: "I",
    itemName: "Сок",
    lotCode: "L",
    qty: 6,
    expiryAt: null,
    locationCode: "FG-A-1",
    locationStatus: "active" as const,
    reservedTaskRef: null,
    resortOpen: false,
    status: "stored",
  }
  assert.equal(decidePalletScan(task, "00460000000000000024", { found: true, pallet, problems: [] }).ok, false)
  assert.equal(decidePalletScan(task, task.huCode, { found: true, pallet, problems: [] }).ok, true)
  const q = decidePalletScan(task, task.huCode, { found: true, pallet: { ...pallet, locationStatus: "quarantine" }, problems: [] })
  assert.ok(!q.ok && q.code === "pallet_quarantine")
  const moved = decidePalletScan(task, task.huCode, { found: true, pallet: { ...pallet, locationCode: "FG-B-5" }, problems: [] })
  assert.ok(!moved.ok && moved.code === "pallet_location_mismatch")
  const addr = { locationCode: "FG-A-32", locationId: "9", active: true, quarantine: false, isFgRow: true, capacity: 2, occupied: 2, free: 0, reservedBy: [] }
  assert.equal(decideAddressScan(task, "FG-A-31", { found: true, address: addr, problems: [], placement: null }).ok, false)
  const full = decideAddressScan(task, "FG-A-32", { found: true, address: addr, problems: [], placement: null })
  assert.ok(!full.ok && full.code === "address_full")
  const ok = decideAddressScan(task, "a-32", { found: true, address: { ...addr, occupied: 0, free: 2 }, problems: [], placement: { ok: true, reason: "" } })
  assert.equal(ok.ok, true)
})

test("позиция: свежая — ок, старая — неточная, совсем старая — не определена, ручная — отдельно", () => {
  const now = Date.parse("2026-11-03T10:00:10Z")
  assert.equal(positionState({ source: "apriltag", quality: 0.9, measuredAt: "2026-11-03T10:00:09.500Z" }, now).state, "ok")
  assert.equal(positionState({ source: "apriltag", quality: 0.9, measuredAt: "2026-11-03T10:00:05Z" }, now).state, "degraded")
  assert.equal(positionState({ source: "apriltag", quality: 0.9, measuredAt: "2026-11-03T09:59:50Z" }, now).state, "lost")
  assert.equal(positionState({ source: "odometry", quality: 0.4, measuredAt: "2026-11-03T10:00:09.900Z" }, now).state, "degraded")
  assert.equal(positionState({ source: "manual", quality: 1, measuredAt: "2026-11-03T08:00:00Z" }, now).state, "manual")
})
