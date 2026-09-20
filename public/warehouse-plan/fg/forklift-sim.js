/*
 * Симуляция движения погрузчиков по плану склада ГП.
 *
 * Приложение плана — собранный React-бандл, исходников которого на сервере нет,
 * поэтому симуляция сделана самостоятельным слоем поверх него. Слой вставляется
 * ВНУТРЬ .planStage: у стейджа один transform (translate+scale) для пан/зума,
 * и вложенный слой наследует его автоматически, без пересчёта координат.
 *
 * Система координат — та же, что у хотспотов рядов: viewBox "0 0 3503 2562",
 * то есть план-пиксели. Ряд A-34, например, это x=1859 y=888 18×288.
 */

const PLAN_WIDTH = 3503
const PLAN_HEIGHT = 2562

const ROUTES_API = "/api/wms/warehouse/finished-goods/forklift-routes"
const FLEET_API = "/api/wms/warehouse/finished-goods/fleet"
const VISIBILITY_API = "/api/wms/warehouse/finished-goods/fleet/visibility"
const DISPATCH_API = "/api/wms/warehouse/finished-goods/dispatch"
const MISSIONS_API = "/api/wms/warehouse/finished-goods/missions"
const TAGS_API = "/api/wms/warehouse/finished-goods/plan-apriltags"
const FLEET_COLORS = ["#7c3aed", "#0e74d2", "#059669", "#c026d3", "#ea580c", "#0891b2"]
const SPRITE_URL = "/warehouse-plan/fg/forklift.png"
const SPRITE_ASPECT = 320 / 127
const LS_KEY = "fgPlanForkliftRoutes"

/** Ячейка ряда зоны A — 18×18 план-пикселей, кара не должна быть больше. */
const DEFAULT_SETTINGS = {
  speed: 90,
  bodyLength: 18,
  reverseDistance: 26,
  dwellMs: 900,
  scannerRange: 110,
  scannerFov: 46,
  scannerEnabled: true,
}

const NODE_KINDS = {
  way: { title: "Точка пути", glyph: "", dot: "flDotWay" },
  pickup: { title: "Погрузка", glyph: "+", dot: "flDotPickup" },
  drop: { title: "Разгрузка", glyph: "", dot: "flDotDrop" },
  resume: { title: "Продолжение", glyph: "›", dot: "flDotResume" },
}

const TURN_RATE = 2.6 // рад/с
const REVERSE_FACTOR = 0.55
/** Груз — квадрат на вилах: доля длины кары и вынос вперёд от её центра. */
const CARGO_SIZE_RATIO = 0.28
const CARGO_OFFSET_RATIO = 0.36
const SCAN_COOLDOWN_MS = 2500
const SCAN_FLASH_MS = 1100
const MAX_SCAN_LOG = 60
const MAX_UNITS = 12

const SVG_NS = "http://www.w3.org/2000/svg"

const state = {
  nodes: [],
  edges: [],
  units: [],
  settings: { ...DEFAULT_SETTINGS },
  tags: [],
  running: false,
  editMode: null,
  linkFrom: null,
  selectedNodeId: null,
  dragNodeId: null,
  sim: [],
  scanLog: [],
  scanSeen: new Map(),
  scanFlash: new Map(),
  panelOpen: false,
  tab: "route",
  message: null,
  messageKind: "ok",
  dirty: false,
  scale: 1,
  fleetRoutes: [],
  fleetKaras: [],
  missions: [],
  pathTags: [],
  loadingPoints: [],
  fleetView: { hideAllRoutes: false, hideEditorRoute: false },
  appliedMissionId: null,
  appliedMissionUpdated: null,
  pickupIndex: 1,
  dropIndex: 9,
}

let dom = {
  shell: null,
  viewport: null,
  stage: null,
  controls: null,
  layer: null,
  gEdges: null,
  gHint: null,
  gFleet: null,
  gNodes: null,
  gTags: null,
  gUnits: null,
  toolButton: null,
  panelHost: null,
  panel: null,
}

const unitEls = new Map()
let lastFrame = 0
let nodeSeq = 0
let edgeSeq = 0

/* ------------------------------------------------------------------ утилиты */

const siteCode = (() => {
  try {
    const fromUrl = new URLSearchParams(location.search).get("siteCode")
    return (fromUrl && fromUrl.trim()) || "DEFAULT"
  } catch {
    return "DEFAULT"
  }
})()

function el(tag, cls, attrs) {
  const node = document.createElementNS(SVG_NS, tag)
  if (cls) node.setAttribute("class", cls)
  if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  return node
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v))
}

function normalizeAngle(a) {
  let x = a
  while (x > Math.PI) x -= Math.PI * 2
  while (x < -Math.PI) x += Math.PI * 2
  return x
}

function nodeById(id) {
  if (!id) return null
  return state.nodes.find(n => n.id === id) || null
}

function nodeIndex(id) {
  return state.nodes.findIndex(n => n.id === id)
}

function nodeTitle(node) {
  if (!node) return "—"
  return node.label || `${NODE_KINDS[node.kind].title} ${nodeIndex(node.id) + 1}`
}

function neighbors(nodeId) {
  const out = []
  for (const e of state.edges) {
    if (e.from === nodeId) out.push(e.to)
    else if (e.to === nodeId) out.push(e.from)
  }
  return out
}

function nodeByPathIndex(index) {
  const i = Number(index)
  if (!Number.isFinite(i) || i < 1) return null
  return state.nodes[i - 1] || null
}

function firstHopToward(fromId, toId, prevId) {
  if (!fromId || !toId || fromId === toId) return null
  const prev = new Map()
  prev.set(fromId, null)
  const q = [fromId]
  for (let i = 0; i < q.length; i += 1) {
    const cur = q[i]
    if (cur === toId) break
    for (const next of neighbors(cur)) {
      if (prev.has(next)) continue
      prev.set(next, cur)
      q.push(next)
    }
  }
  if (!prev.has(toId)) return null
  let cur = toId
  let before = prev.get(cur)
  while (before && before !== fromId) {
    cur = before
    before = prev.get(cur)
  }
  if (cur === prevId) {
    const alt = neighbors(fromId).find(id => id !== prevId && id !== cur)
    if (alt) return alt
  }
  return cur
}

function resolvePathStop(stop) {
  if (!stop || stop.source === "apriltag") return null
  if (stop.source !== "path") return null
  if (stop.nodeId) {
    const byId = nodeById(stop.nodeId)
    if (byId) return byId
  }
  return nodeByPathIndex(stop.tagId)
}

function tripActive(f) {
  return Boolean(f?.trip?.length && f.tripIndex < f.trip.length)
}

function findSimForKara(kara) {
  if (!state.sim.length) return null
  if (!kara) return state.sim[0]
  const name = String(kara.name || "").trim().toLowerCase()
  return (
    state.sim.find(f => f.unitId === kara.id) ||
    state.sim.find(f => String(f.label || "").trim().toLowerCase() === name) ||
    state.sim[0]
  )
}

function finishTripStop(f) {
  f.pendingTripAdvance = false
  f.tripIndex += 1
  if (!tripActive(f)) {
    const missionId = f.missionId
    f.trip = []
    f.tripIndex = 0
    f.missionId = null
    f.targetNodeId = null
    f.phase = "idle"
    if (state.appliedMissionId === missionId) {
      state.appliedMissionId = null
      state.appliedMissionUpdated = null
    }
    if (missionId) completeMission(missionId)
    setMessage("Задание выполнено — кара на месте.", "ok")
    renderNodes()
    renderPanel()
    return
  }
  departFrom(f)
}

function completeMission(missionId) {
  fetch(`${MISSIONS_API}/${encodeURIComponent(missionId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ siteCode, action: "complete" }),
  }).catch(() => {})
}

function applyPathMission(mission, kara) {
  const f = findSimForKara(kara)
  if (!f) return false
  const trip = []
  for (const stop of mission.stops || []) {
    const node = resolvePathStop(stop)
    if (node) trip.push({ nodeId: node.id, kind: stop.kind || node.kind })
  }
  if (!trip.length) return false
  f.trip = trip
  f.tripIndex = 0
  f.missionId = mission.id
  f.pendingTripAdvance = false
  state.appliedMissionId = mission.id
  state.appliedMissionUpdated = mission.updatedAt || mission.id
  state.running = true
  lastFrame = performance.now()
  if (f.nodeId === trip[0].nodeId) handleTripArrive(f, nodeById(f.nodeId), performance.now())
  else departFrom(f)
  setMessage(`Задание: ${mission.routeName || "теги пути"}`, "ok")
  renderNodes()
  renderPanel()
  return true
}

function applyActivePathMissions() {
  const missions = state.missions || []
  const karas = state.fleetKaras || []
  let applied = false
  for (const mission of missions) {
    if (mission.status !== "active") continue
    const isPath = (mission.stops || []).some(s => s.source === "path")
    if (!isPath) continue
    if (state.appliedMissionId === mission.id && state.appliedMissionUpdated === (mission.updatedAt || mission.id)) {
      applied = true
      continue
    }
    const kara = karas.find(k => k.id === mission.karaId)
    if (applyPathMission(mission, kara)) applied = true
  }
  if (state.appliedMissionId) {
    const current = missions.find(m => m.id === state.appliedMissionId)
    if (!current || current.status !== "active") {
      for (const f of state.sim) {
        if (f.missionId === state.appliedMissionId) {
          f.trip = []
          f.tripIndex = 0
          f.missionId = null
          f.pendingTripAdvance = false
          f.phase = "idle"
          f.targetNodeId = null
        }
      }
      state.appliedMissionId = null
      state.appliedMissionUpdated = null
      renderNodes()
    }
  }
  return applied
}

function defaultPathIndex(kind, fallback) {
  const tags = state.pathTags || []
  if (kind === "drop") {
    for (let i = tags.length - 1; i >= 0; i -= 1) {
      if (tags[i].kind === "drop") return tags[i].index
    }
  } else {
    const hit = tags.find(t => t.kind === kind)
    if (hit) return hit.index
  }
  const nodeHit = kind === "drop"
    ? [...state.nodes].map((n, i) => ({ n, i })).reverse().find(x => x.n.kind === "drop")
    : state.nodes.findIndex(n => n.kind === kind)
  if (kind === "drop" && nodeHit) return nodeHit.i + 1
  if (typeof nodeHit === "number" && nodeHit >= 0) return nodeHit + 1
  return fallback
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => {
    switch (ch) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case '"':
        return "&quot;"
      default:
        return "&#39;"
    }
  })
}

function setMessage(text, kind) {
  state.message = text
  state.messageKind = kind || "ok"
  renderPanel()
  if (text) {
    window.clearTimeout(setMessage._t)
    setMessage._t = window.setTimeout(() => {
      state.message = null
      renderPanel()
    }, 4000)
  }
}

/* --------------------------------------------------------------- монтирование */

function findHosts() {
  dom.shell = document.querySelector(".planShell")
  dom.viewport = document.querySelector(".planViewport")
  dom.stage = document.querySelector(".planStage")
  dom.controls = document.querySelector(".mapControls")
  return Boolean(dom.stage && dom.viewport)
}

function buildLayer() {
  const layer = el("svg", "flLayer", {
    viewBox: `0 0 ${PLAN_WIDTH} ${PLAN_HEIGHT}`,
    width: PLAN_WIDTH,
    height: PLAN_HEIGHT,
    "aria-label": "Маршруты погрузчиков",
  })
  dom.gEdges = el("g", "flEdges")
  dom.gHint = el("g", "flHintLayer")
  dom.gFleet = el("g", "flFleet")
  dom.gTags = el("g", "flTags")
  dom.gNodes = el("g", "flNodes")
  dom.gUnits = el("g", "flUnits")
  layer.append(dom.gEdges, dom.gHint, dom.gFleet, dom.gTags, dom.gNodes, dom.gUnits)

  layer.addEventListener("pointerdown", onLayerPointerDown)
  layer.addEventListener("pointermove", onLayerPointerMove)
  layer.addEventListener("pointerup", onLayerPointerUp)
  layer.addEventListener("pointercancel", onLayerPointerUp)
  return layer
}

function buildToolButton() {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "flToolButton"
  button.textContent = "Кары"
  button.title = "Погрузчики — маршруты и симуляция"
  button.addEventListener("click", event => {
    event.stopPropagation()
    state.panelOpen = !state.panelOpen
    if (!state.panelOpen) state.editMode = null
    syncToolButton()
    renderPanel()
    applyEditCursor()
  })
  return button
}

function syncToolButton() {
  if (!dom.toolButton) return
  dom.toolButton.classList.toggle("active", state.panelOpen)
  dom.toolButton.setAttribute("aria-pressed", state.panelOpen ? "true" : "false")
}

function ensureMounted() {
  // Быстрый путь: цикл анимации зовёт эту функцию каждый кадр, поэтому пока
  // всё на месте — никаких querySelector и getComputedStyle.
  if (
    dom.layer?.isConnected &&
    dom.stage?.isConnected &&
    dom.panelHost?.isConnected &&
    (dom.toolButton?.isConnected || !dom.controls?.isConnected)
  ) {
    return true
  }

  if (!findHosts()) return false

  if (!dom.layer || !dom.layer.isConnected) {
    dom.layer = buildLayer()
    dom.stage.appendChild(dom.layer)
    renderEdges()
    renderNodes()
    renderFleetOverlays()
    rebuildUnitEls()
  } else if (dom.layer.parentNode !== dom.stage) {
    dom.stage.appendChild(dom.layer)
  }

  if (dom.controls && (!dom.toolButton || !dom.toolButton.isConnected)) {
    dom.toolButton = buildToolButton()
    dom.controls.appendChild(dom.toolButton)
    syncToolButton()
  }

  if (dom.shell && (!dom.panelHost || !dom.panelHost.isConnected)) {
    dom.panelHost = document.createElement("div")
    dom.panelHost.className = "flPanelHost"
    dom.panelHost.hidden = true
    dom.viewport.appendChild(dom.panelHost)
    renderPanel()
  }

  observeStageScale()
  readScale()
  initOnce()
  return true
}

const scaleObserver = new MutationObserver(() => readScale())
let observedStage = null

function observeStageScale() {
  if (!dom.stage || observedStage === dom.stage) return
  scaleObserver.disconnect()
  scaleObserver.observe(dom.stage, { attributes: true, attributeFilter: ["style"] })
  observedStage = dom.stage
}

let didInit = false

function initOnce() {
  if (didInit) return
  didInit = true
  void loadRoutes()
  void loadTags()
  void loadFleet()
  if (!state._fleetPoll) {
    state._fleetPoll = window.setInterval(() => {
      void loadFleet()
    }, 2000)
  }
}

/**
 * Масштаб плана нужен, чтобы маркеры редактора держали постоянный размер
 * на экране: сами по себе они лежат в план-координатах и иначе схлопывались
 * бы при отдалении.
 */
function readScale() {
  if (!dom.stage) return
  const t = getComputedStyle(dom.stage).transform
  if (!t || t === "none") {
    state.scale = 1
    return
  }
  const m = t.match(/matrix(?:3d)?\(([^)]+)\)/)
  if (!m) return
  // И в matrix(), и в matrix3d() первый компонент — масштаб по X.
  const next = Number(m[1].split(",")[0])
  if (Number.isFinite(next) && next > 0 && Math.abs(next - state.scale) > 1e-4) {
    state.scale = next
    renderEdges()
    renderNodes()
    renderFleetOverlays()
  }
}

function inv() {
  return 1 / Math.max(state.scale, 1e-3)
}

/* ------------------------------------------------------------------ координаты */

function toPlanPoint(event) {
  const svg = dom.layer
  if (!svg) return null
  const ctm = svg.getScreenCTM()
  if (!ctm) return null
  const pt = svg.createSVGPoint()
  pt.x = event.clientX
  pt.y = event.clientY
  const p = pt.matrixTransform(ctm.inverse())
  return { x: clamp(p.x, 0, PLAN_WIDTH), y: clamp(p.y, 0, PLAN_HEIGHT) }
}

/* -------------------------------------------------------------------- данные */

function makeNodeId() {
  nodeSeq += 1
  return `n${Date.now().toString(36)}${nodeSeq}`
}

function makeEdgeId() {
  edgeSeq += 1
  return `e${Date.now().toString(36)}${edgeSeq}`
}

function addNode(kind, x, y) {
  const node = { id: makeNodeId(), x, y, kind }
  state.nodes.push(node)
  state.dirty = true
  return node
}

function removeNode(id) {
  state.nodes = state.nodes.filter(n => n.id !== id)
  state.edges = state.edges.filter(e => e.from !== id && e.to !== id)
  state.units = state.units.map(u => (u.startNodeId === id ? { ...u, startNodeId: null } : u))
  if (state.selectedNodeId === id) state.selectedNodeId = null
  if (state.linkFrom === id) state.linkFrom = null
  state.dirty = true
}

function addEdge(from, to) {
  if (!from || !to || from === to) return false
  const exists = state.edges.some(
    e => (e.from === from && e.to === to) || (e.from === to && e.to === from)
  )
  if (exists) return false
  state.edges.push({ id: makeEdgeId(), from, to })
  state.dirty = true
  return true
}

function ensureUnits(count) {
  const next = []
  for (let i = 0; i < count; i += 1) {
    const existing = state.units[i]
    if (existing) {
      next.push(existing)
    } else {
      next.push({
        id: `f${i + 1}-${Date.now().toString(36)}`,
        label: `Кара ${i + 1}`,
        startNodeId: defaultStartNode(next),
        enabled: true,
      })
    }
  }
  state.units = next
  state.dirty = true
}

function defaultStartNode(taken) {
  const used = new Set(taken.map(u => u.startNodeId).filter(Boolean))
  const free = state.nodes.find(n => !used.has(n.id))
  return free ? free.id : state.nodes[0]?.id ?? null
}

async function loadRoutes() {
  let loaded = null
  try {
    const res = await fetch(`${ROUTES_API}?siteCode=${encodeURIComponent(siteCode)}`, {
      cache: "no-store",
    })
    if (res.ok) loaded = await res.json()
  } catch {
    /* сеть недоступна — ниже попробуем локальный черновик */
  }
  if (!loaded) {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) loaded = JSON.parse(raw)
    } catch {
      /* нет черновика */
    }
  }
  applySnapshot(loaded)
}

function applySnapshot(snapshot) {
  const src = snapshot && typeof snapshot === "object" ? snapshot : {}
  state.nodes = Array.isArray(src.nodes)
    ? src.nodes
        .filter(n => n && Number.isFinite(Number(n.x)) && Number.isFinite(Number(n.y)))
        .map((n, i) => ({
          id: String(n.id || `n${i + 1}`),
          x: clamp(Number(n.x), 0, PLAN_WIDTH),
          y: clamp(Number(n.y), 0, PLAN_HEIGHT),
          kind: NODE_KINDS[n.kind] ? n.kind : "way",
          label: typeof n.label === "string" && n.label.trim() ? n.label.trim() : undefined,
        }))
    : []
  const known = new Set(state.nodes.map(n => n.id))
  state.edges = Array.isArray(src.edges)
    ? src.edges
        .filter(e => e && known.has(String(e.from)) && known.has(String(e.to)) && e.from !== e.to)
        .map((e, i) => ({ id: String(e.id || `e${i + 1}`), from: String(e.from), to: String(e.to) }))
    : []
  state.units = Array.isArray(src.units)
    ? src.units.slice(0, MAX_UNITS).map((u, i) => ({
        id: String(u.id || `f${i + 1}`),
        label: typeof u.label === "string" && u.label.trim() ? u.label.trim() : `Кара ${i + 1}`,
        startNodeId: u.startNodeId && known.has(String(u.startNodeId)) ? String(u.startNodeId) : null,
        enabled: u.enabled === undefined ? true : Boolean(u.enabled),
      }))
    : []
  state.settings = { ...DEFAULT_SETTINGS, ...(src.settings && typeof src.settings === "object" ? src.settings : {}) }
  state.settings.speed = clamp(Number(state.settings.speed) || DEFAULT_SETTINGS.speed, 5, 1200)
  state.settings.bodyLength = clamp(Number(state.settings.bodyLength) || DEFAULT_SETTINGS.bodyLength, 6, 160)
  state.settings.reverseDistance = clamp(Number(state.settings.reverseDistance) || 0, 0, 400)
  state.settings.dwellMs = clamp(Number(state.settings.dwellMs) || 0, 0, 20000)
  state.settings.scannerRange = clamp(Number(state.settings.scannerRange) || 0, 0, 900)
  state.settings.scannerFov = clamp(Number(state.settings.scannerFov) || DEFAULT_SETTINGS.scannerFov, 4, 180)
  state.settings.scannerEnabled = Boolean(state.settings.scannerEnabled)
  state.dirty = false
  resetSim()
  renderEdges()
  renderNodes()
  renderFleetOverlays()
  renderPanel()
}

function snapshotPayload() {
  return {
    siteCode,
    nodes: state.nodes,
    edges: state.edges,
    units: state.units,
    settings: state.settings,
  }
}

function cacheLocally() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(snapshotPayload()))
  } catch {
    /* приватный режим — просто не кэшируем */
  }
}

async function saveRoutes() {
  cacheLocally()
  try {
    const res = await fetch(ROUTES_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshotPayload()),
    })
    if (!res.ok) {
      const text = await res.text()
      setMessage(`Сервер отклонил сохранение (${res.status}). Черновик сохранён локально. ${text.slice(0, 90)}`, "error")
      return
    }
    const snapshot = await res.json()
    applySnapshot(snapshot)
    setMessage("Маршрут сохранён на сервере.", "ok")
  } catch (error) {
    setMessage(`Нет связи с API, черновик сохранён локально. ${String(error).slice(0, 90)}`, "error")
  }
}

async function loadTags() {
  try {
    const res = await fetch(`${TAGS_API}?siteCode=${encodeURIComponent(siteCode)}`, { cache: "no-store" })
    if (!res.ok) return
    const data = await res.json()
    state.tags = Array.isArray(data?.tags)
      ? data.tags
          .filter(t => Number.isFinite(Number(t.x)) && Number.isFinite(Number(t.y)))
          .map(t => ({
            id: String(t.id || `tag-${t.tagId}`),
            tagId: Number(t.tagId) || 0,
            x: Number(t.x),
            y: Number(t.y),
            label: typeof t.label === "string" ? t.label : "",
          }))
      : []
    renderFleetOverlays()
    renderPanel()
  } catch {
    /* теги не обязательны для симуляции движения */
  }
}

function editorGraphHidden() {
  if (state.editMode) return false
  return Boolean(state.fleetView.hideAllRoutes || state.fleetView.hideEditorRoute)
}

function tagPoint(tagId) {
  const id = Number(tagId)
  return state.tags.find(t => Number(t.tagId) === id) || null
}

async function loadFleet() {
  try {
    const res = await fetch(`${FLEET_API}?siteCode=${encodeURIComponent(siteCode)}`, { cache: "no-store" })
    if (!res.ok) return
    const data = await res.json()
    state.fleetRoutes = Array.isArray(data.routes) ? data.routes : []
    state.fleetKaras = Array.isArray(data.karas) ? data.karas : []
    state.missions = Array.isArray(data.missions) ? data.missions : []
    state.pathTags = Array.isArray(data.pathTags) ? data.pathTags : []
    state.loadingPoints = Array.isArray(data.loadingPoints) ? data.loadingPoints : []
    state.fleetView = {
      hideAllRoutes: Boolean(data.settings?.hideAllRoutes),
      hideEditorRoute: Boolean(data.settings?.hideEditorRoute),
    }
    if (!state.pathTags.length && state.nodes.length) {
      state.pathTags = state.nodes.map((n, i) => ({
        index: i + 1,
        id: n.id,
        kind: n.kind,
        title: n.kind === "pickup" ? `погрузка ${i + 1}` : n.kind === "drop" ? `разгрузка ${i + 1}` : `тег пути ${i + 1}`,
      }))
    }
    if (!state.pickupIndex) state.pickupIndex = defaultPathIndex("pickup", 1)
    if (!state.dropIndex) state.dropIndex = defaultPathIndex("drop", 9)
    const fleetKey = JSON.stringify({
      m: state.missions.map(m => [m.id, m.status, m.updatedAt]),
      v: state.fleetView,
      p: state.pathTags.map(t => t.index),
    })
    const fleetChanged = fleetKey !== state._fleetKey
    state._fleetKey = fleetKey
    applyActivePathMissions()
    if (fleetChanged) {
      renderEdges()
      renderNodes()
      renderFleetOverlays()
      renderPanel()
    }
  } catch {
    /* флот необязателен для симуляции */
  }
}

async function saveVisibility(patch) {
  try {
    const res = await fetch(VISIBILITY_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteCode, ...patch }),
    })
    if (!res.ok) {
      const text = await res.text()
      setMessage(`Не сохранили вид (${res.status}). ${text.slice(0, 90)}`, "error")
      return
    }
    const data = await res.json()
    if (data?.fleet) {
      state.fleetRoutes = Array.isArray(data.fleet.routes) ? data.fleet.routes : state.fleetRoutes
      state.loadingPoints = Array.isArray(data.fleet.loadingPoints)
        ? data.fleet.loadingPoints
        : state.loadingPoints
      state.fleetView = {
        hideAllRoutes: Boolean(data.fleet.settings?.hideAllRoutes),
        hideEditorRoute: Boolean(data.fleet.settings?.hideEditorRoute),
      }
    }
    renderEdges()
    renderNodes()
    renderFleetOverlays()
    renderPanel()
    setMessage("Вид маршрутов обновлён.", "ok")
  } catch (error) {
    setMessage(`Нет связи с API вида. ${String(error).slice(0, 90)}`, "error")
  }
}

/* ----------------------------------------------------------------- симуляция */

function resetSim() {
  state.sim = []
  state.scanSeen.clear()
  state.scanFlash.clear()
  state.appliedMissionId = null
  state.appliedMissionUpdated = null
  for (const unit of state.units) {
    if (!unit.enabled) continue
    const start = nodeById(unit.startNodeId)
    if (!start) continue
    const f = {
      unitId: unit.id,
      label: unit.label || "Кара",
      x: start.x,
      y: start.y,
      nodeId: start.id,
      prevNodeId: null,
      targetNodeId: null,
      heading: 0,
      phase: "idle",
      phaseUntil: 0,
      // Кара, поставленная на точку погрузки, стартует уже гружёной —
      // иначе она забрала бы груз только на втором круге.
      cargo: start.kind === "pickup",
      reverseLeft: 0,
      turnTo: 0,
      seq: 0,
      lastDropId: null,
      trip: [],
      tripIndex: 0,
      missionId: null,
      pendingTripAdvance: false,
    }
    state.sim.push(f)
  }
  if (!applyActivePathMissions()) {
    for (const f of state.sim) departFrom(f)
  }
  for (const f of state.sim) {
    if (!f.targetNodeId && !tripActive(f) && f.phase !== "dwell") departFrom(f)
    const target = nodeById(f.targetNodeId)
    if (target) f.heading = Math.atan2(target.y - f.y, target.x - f.x)
  }
  rebuildUnitEls()
}

function bfsGoals(startId, kind, blockedId) {
  const out = []
  const seen = new Set()
  if (blockedId) seen.add(blockedId)
  const q = [[startId, 0]]
  while (q.length) {
    const [id, d] = q.shift()
    if (seen.has(id)) continue
    seen.add(id)
    const n = nodeById(id)
    if (n && n.kind === kind) out.push({ goalId: id, dist: d })
    for (const nxt of neighbors(id)) {
      if (!seen.has(nxt)) q.push([nxt, d + 1])
    }
  }
  return out
}

function hopsToKind(fromId, kind) {
  const options = []
  for (const hop of neighbors(fromId)) {
    for (const goal of bfsGoals(hop, kind, fromId)) {
      options.push({ hop, goalId: goal.goalId, dist: goal.dist })
    }
  }
  return options
}

function pickDropGoal(options, f) {
  const goals = [...new Set(options.map(o => o.goalId))].sort((a, b) => nodeIndex(a) - nodeIndex(b))
  if (!goals.length) return null
  if (goals.length === 1) return goals[0]
  const last = f.lastDropId
  if (last && goals.includes(last)) {
    return goals[(goals.indexOf(last) + 1) % goals.length]
  }
  return goals[0]
}

function pickNext(nodeId, prevId, f) {
  if (tripActive(f)) {
    const dest = f.trip[f.tripIndex]
    if (!dest || dest.nodeId === nodeId) return null
    return firstHopToward(nodeId, dest.nodeId, prevId) || dest.nodeId
  }
  const nb = neighbors(nodeId)
  if (nb.length === 0) return null
  const node = nodeById(nodeId)

  if (node && node.kind === "drop") {
    const resume = nb.find(id => nodeById(id)?.kind === "resume")
    if (resume) return resume
    const home = hopsToKind(nodeId, "pickup").sort((a, b) => a.dist - b.dist)[0]
    if (home) return home.hop
    return prevId || nb[0]
  }

  // Гружёная — к следующей разгрузке по кругу. Пустая — только к погрузке.
  // Иначе на развилке (точки 8 и 9) кара начинает ходить разгрузка↔разгрузка.
  const options = hopsToKind(nodeId, f.cargo ? "drop" : "pickup")
  if (options.length) {
    if (f.cargo) {
      const goal = pickDropGoal(options, f)
      const match = options.filter(o => o.goalId === goal).sort((a, b) => a.dist - b.dist)[0]
      if (match) return match.hop
    }
    options.sort((a, b) => a.dist - b.dist || (a.hop === prevId ? 1 : 0) - (b.hop === prevId ? 1 : 0))
    return options[0].hop
  }

  const forward = nb.filter(id => id !== prevId)
  return forward[0] || nb[0]
}

function departFrom(f) {
  f.targetNodeId = pickNext(f.nodeId, f.prevNodeId, f)
  f.seq += 1
  f.phase = f.targetNodeId ? "driving" : "idle"
}

function handleTripArrive(f, node, now) {
  if (!node) return
  f.prevNodeId = f.nodeId
  f.nodeId = node.id
  const dest = f.trip[f.tripIndex]
  const atDest = dest && dest.nodeId === node.id
  const kind = atDest ? dest.kind : node.kind
  const s = state.settings
  if (atDest && kind === "pickup" && !f.cargo) {
    f.cargo = true
    f.phase = "dwell"
    f.phaseUntil = now + s.dwellMs
    f.pendingTripAdvance = true
    return
  }
  if (atDest && kind === "drop") {
    if (f.cargo) f.cargo = false
    f.lastDropId = node.id
    f.phase = "dwell"
    f.phaseUntil = now + s.dwellMs
    f.pendingTripAdvance = true
    return
  }
  if (atDest) f.tripIndex += 1
  departFrom(f)
}

function arrive(f, node, now) {
  if (tripActive(f)) {
    handleTripArrive(f, node, now)
    return
  }
  f.prevNodeId = f.nodeId
  f.nodeId = node.id
  const s = state.settings

  if (node.kind === "pickup" && !f.cargo) {
    f.cargo = true
    f.phase = "dwell"
    f.phaseUntil = now + s.dwellMs
    return
  }
  if (node.kind === "drop") {
    // Кара упирается в точку, оставляет груз, затем отъезжает и разворачивается.
    if (f.cargo) f.cargo = false
    f.lastDropId = node.id
    f.phase = "dwell"
    f.phaseUntil = now + s.dwellMs
    return
  }
  departFrom(f)
}

function stepUnit(f, dt, now) {
  const s = state.settings

  if (f.phase === "dwell") {
    if (now >= f.phaseUntil) {
      const node = nodeById(f.nodeId)
      const dest = tripActive(f) ? f.trip[f.tripIndex] : null
      const isDrop = (dest && dest.kind === "drop" && dest.nodeId === f.nodeId) || node?.kind === "drop"
      if (isDrop && s.reverseDistance > 0) {
        f.reverseLeft = s.reverseDistance
        f.phase = "reversing"
      } else if (f.pendingTripAdvance) {
        finishTripStop(f)
      } else {
        departFrom(f)
      }
    }
    return
  }

  if (f.phase === "reversing") {
    const step = Math.min(s.speed * REVERSE_FACTOR * dt, f.reverseLeft)
    f.x = clamp(f.x - Math.cos(f.heading) * step, 0, PLAN_WIDTH)
    f.y = clamp(f.y - Math.sin(f.heading) * step, 0, PLAN_HEIGHT)
    f.reverseLeft -= step
    if (f.reverseLeft <= 1e-3) {
      if (f.pendingTripAdvance) finishTripStop(f)
      else departFrom(f)
      const target = nodeById(f.targetNodeId)
      if (!target) {
        f.phase = "idle"
        return
      }
      f.turnTo = Math.atan2(target.y - f.y, target.x - f.x)
      f.phase = "turning"
    }
    return
  }

  if (f.phase === "turning") {
    const diff = normalizeAngle(f.turnTo - f.heading)
    const step = TURN_RATE * dt
    if (Math.abs(diff) <= step) {
      f.heading = f.turnTo
      f.phase = "driving"
    } else {
      f.heading = normalizeAngle(f.heading + Math.sign(diff) * step)
    }
    return
  }

  if (f.phase !== "driving") return

  const target = nodeById(f.targetNodeId)
  if (!target) {
    f.phase = "idle"
    return
  }

  const dx = target.x - f.x
  const dy = target.y - f.y
  const dist = Math.hypot(dx, dy)
  const want = Math.atan2(dy, dx)
  const diff = normalizeAngle(want - f.heading)
  const turnStep = TURN_RATE * dt

  if (Math.abs(diff) <= turnStep) f.heading = want
  else f.heading = normalizeAngle(f.heading + Math.sign(diff) * turnStep)

  // Пока корпус развёрнут сильно в сторону, кара доворачивает на месте —
  // иначе она описывала бы круги вокруг точки вместо подъезда к ней.
  if (Math.abs(normalizeAngle(want - f.heading)) > 0.55) return

  const step = s.speed * dt
  if (dist <= Math.max(step, 0.4)) {
    f.x = target.x
    f.y = target.y
    arrive(f, target, now)
    return
  }
  f.x = clamp(f.x + Math.cos(f.heading) * step, 0, PLAN_WIDTH)
  f.y = clamp(f.y + Math.sin(f.heading) * step, 0, PLAN_HEIGHT)
}

function scanTags(f, now) {
  const s = state.settings
  if (!s.scannerEnabled || s.scannerRange <= 0 || state.tags.length === 0) return
  const half = ((s.scannerFov * Math.PI) / 180) / 2
  for (const tag of state.tags) {
    const dx = tag.x - f.x
    const dy = tag.y - f.y
    const dist = Math.hypot(dx, dy)
    if (dist > s.scannerRange) continue
    if (Math.abs(normalizeAngle(Math.atan2(dy, dx) - f.heading)) > half) continue

    const key = `${f.unitId}|${tag.id}`
    const last = state.scanSeen.get(key) || 0
    state.scanFlash.set(tag.id, now)
    if (now - last < SCAN_COOLDOWN_MS) continue
    state.scanSeen.set(key, now)
    const entry = {
      at: new Date(),
      unit: f.label,
      tagId: tag.tagId,
      label: tag.label,
      dist: Math.round(dist),
    }
    state.scanLog.unshift(entry)
    if (state.scanLog.length > MAX_SCAN_LOG) state.scanLog.length = MAX_SCAN_LOG
    window.dispatchEvent(
      new CustomEvent("forklift:scan", {
        detail: { ...entry, at: entry.at.toISOString(), unitId: f.unitId, x: tag.x, y: tag.y },
      })
    )
    if (state.panelOpen && state.tab === "scan") renderPanel()
  }
}

/* ---------------------------------------------------------------- отрисовка */

function renderEdges() {
  if (!dom.gEdges) return
  if (editorGraphHidden()) {
    dom.gEdges.replaceChildren()
    return
  }
  const frag = document.createDocumentFragment()
  for (const edge of state.edges) {
    const a = nodeById(edge.from)
    const b = nodeById(edge.to)
    if (!a || !b) continue
    const hit = el("line", "flEdgeHit", { x1: a.x, y1: a.y, x2: b.x, y2: b.y })
    hit.dataset.edgeId = edge.id
    const line = el("line", "flEdge", { x1: a.x, y1: a.y, x2: b.x, y2: b.y })
    frag.append(hit, line)
  }
  dom.gEdges.replaceChildren(frag)
}

function renderFleetOverlays() {
  if (!dom.gFleet) return
  const frag = document.createDocumentFragment()
  const k = inv()
  if (!state.fleetView.hideAllRoutes) {
    state.fleetRoutes.forEach((route, idx) => {
      if (!route || route.hidden || route.enabled === false) return
      const pts = (route.stops || []).map(stop => tagPoint(stop.tagId)).filter(Boolean)
      if (pts.length < 2) return
      const color = FLEET_COLORS[idx % FLEET_COLORS.length]
      const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ")
      const path = el("path", "flFleetRoute", { d, stroke: color })
      frag.appendChild(path)
      const mid = pts[Math.floor((pts.length - 1) / 2)]
      const caption = el("g", "flFleetCaption", { transform: `translate(${mid.x} ${mid.y}) scale(${k})` })
      const text = el("text", "flFleetCaptionText", { x: 10, y: -10 })
      text.textContent = route.name || `Маршрут ${idx + 2}`
      caption.appendChild(text)
      frag.appendChild(caption)
    })
  }
  for (const point of state.loadingPoints) {
    if (!point || point.enabled === false || point.tagId == null) continue
    const tag = tagPoint(point.tagId)
    if (!tag) continue
    const g = el("g", "flLoadPoint", { transform: `translate(${tag.x} ${tag.y}) scale(${k})` })
    g.appendChild(el("rect", "flLoadPointBadge", { x: -6, y: -22, width: 12, height: 12, rx: 2 }))
    const label = el("text", "flLoadPointLabel", { x: 10, y: -12 })
    label.textContent = point.lineCode ? `${point.name} · смена ${point.lineCode}` : point.name
    g.appendChild(label)
    frag.appendChild(g)
  }
  dom.gFleet.replaceChildren(frag)
}

function renderNodes() {
  if (!dom.gNodes) return
  if (editorGraphHidden()) {
    dom.gNodes.replaceChildren()
    return
  }
  const k = inv()
  const frag = document.createDocumentFragment()
  state.nodes.forEach((node, index) => {
    const g = el("g", "flNode", { transform: `translate(${node.x} ${node.y}) scale(${k})` })
    g.dataset.nodeId = node.id
    g.dataset.kind = node.kind
    if (state.selectedNodeId === node.id) g.classList.add("flNodeSelected")

    const hit = el("circle", "flNodeHit", { r: 13 })
    let body
    if (node.kind === "drop") {
      body = el("rect", "flNodeBody", { x: -7, y: -7, width: 14, height: 14, rx: 3 })
    } else if (node.kind === "resume") {
      body = el("polygon", "flNodeBody", { points: "-7,-7 8,0 -7,7" })
    } else {
      body = el("circle", "flNodeBody", { r: node.kind === "pickup" ? 8 : 6.5 })
    }
    g.append(hit, body)

    const glyph = NODE_KINDS[node.kind].glyph
    if (glyph) {
      const text = el("text", "flNodeGlyph", { x: node.kind === "resume" ? -1 : 0, y: 0.5 })
      text.textContent = glyph
      g.appendChild(text)
    }

    const tripDest = state.sim.find(u => tripActive(u))
    if (tripDest && tripDest.trip[tripDest.tripIndex]?.nodeId === node.id) {
      g.classList.add("flNodeTrip")
    }

    const label = el("text", "flNodeLabel", { x: 0, y: -12 })
    label.textContent = node.label || String(index + 1)
    g.appendChild(label)

    frag.appendChild(g)
  })
  dom.gNodes.replaceChildren(frag)
}

function conePath(range, fovDeg) {
  const half = ((fovDeg * Math.PI) / 180) / 2
  const x1 = Math.cos(-half) * range
  const y1 = Math.sin(-half) * range
  const x2 = Math.cos(half) * range
  const y2 = Math.sin(half) * range
  const largeArc = fovDeg > 180 ? 1 : 0
  return `M0 0 L${x1.toFixed(2)} ${y1.toFixed(2)} A${range} ${range} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`
}

function rebuildUnitEls() {
  if (!dom.gUnits) return
  unitEls.clear()
  const frag = document.createDocumentFragment()
  const s = state.settings
  const bodyW = s.bodyLength
  const bodyH = bodyW / SPRITE_ASPECT
  // На спрайте вилы занимают правые ~33% длины, поэтому груз такого размера
  // ложится ровно на них и не закрывает корпус.
  const cargoSize = bodyW * CARGO_SIZE_RATIO

  for (const f of state.sim) {
    const g = el("g", "flUnit")
    const cone = el("path", "flScanCone", { d: conePath(s.scannerRange, s.scannerFov) })
    cone.style.display = s.scannerEnabled && s.scannerRange > 0 ? "" : "none"

    const sprite = el("image", "flUnitSprite", {
      x: -bodyW / 2,
      y: -bodyH / 2,
      width: bodyW,
      height: bodyH,
      preserveAspectRatio: "xMidYMid meet",
    })
    sprite.setAttributeNS("http://www.w3.org/1999/xlink", "href", SPRITE_URL)
    sprite.setAttribute("href", SPRITE_URL)

    const cargo = el("rect", "flCargo", {
      x: bodyW * CARGO_OFFSET_RATIO - cargoSize / 2,
      y: -cargoSize / 2,
      width: cargoSize,
      height: cargoSize,
      rx: cargoSize * 0.1,
    })
    cargo.style.display = "none"

    g.append(cone, sprite, cargo)

    // Подпись держится вне вращаемой группы, иначе она переворачивалась бы
    // вместе с корпусом при движении влево. Смещение задаётся в renderUnits:
    // оно зависит от масштаба, чтобы подпись всегда стояла над корпусом.
    const tag = el("text", "flUnitTag", { x: 0, y: 0 })
    tag.textContent = f.label
    const wrap = el("g", "flUnitWrap")
    wrap.append(g, tag)
    frag.appendChild(wrap)

    unitEls.set(f.unitId, { wrap, g, cone, cargo, tag })
  }
  dom.gUnits.replaceChildren(frag)
}

function renderUnits(now) {
  const s = state.settings
  if (state.sim.length !== unitEls.size) rebuildUnitEls()
  const k = inv()
  // Подпись поднимаем над корпусом: половина габарита в план-пикселях плюс
  // постоянный экранный зазор, иначе на большом зуме она легла бы на кару.
  const lift = s.bodyLength / SPRITE_ASPECT / 2 + 5 * k
  for (const f of state.sim) {
    const refs = unitEls.get(f.unitId)
    if (!refs) continue
    const deg = (f.heading * 180) / Math.PI
    refs.g.setAttribute("transform", `translate(${f.x.toFixed(2)} ${f.y.toFixed(2)}) rotate(${deg.toFixed(2)})`)
    refs.tag.setAttribute("transform", `translate(${f.x.toFixed(2)} ${(f.y - lift).toFixed(2)}) scale(${k})`)
    refs.cargo.style.display = f.cargo ? "" : "none"
    refs.cone.style.display = s.scannerEnabled && s.scannerRange > 0 ? "" : "none"
  }

  // Подсветка только что отсканированных тегов
  const frag = document.createDocumentFragment()
  for (const [tagId, at] of state.scanFlash) {
    if (now - at > SCAN_FLASH_MS) {
      state.scanFlash.delete(tagId)
      continue
    }
    const tag = state.tags.find(t => t.id === tagId)
    if (!tag) continue
    frag.appendChild(el("circle", "flTagHit", { cx: tag.x, cy: tag.y, r: 16 }))
  }
  dom.gTags.replaceChildren(frag)
}

function renderLinkHint(point) {
  if (!dom.gHint) return
  if (state.editMode !== "link" || !state.linkFrom) {
    dom.gHint.replaceChildren()
    return
  }
  const from = nodeById(state.linkFrom)
  if (!from || !point) {
    dom.gHint.replaceChildren()
    return
  }
  const line = el("line", "flEdgeHint", { x1: from.x, y1: from.y, x2: point.x, y2: point.y })
  dom.gHint.replaceChildren(line)
}

/* ------------------------------------------------------------------- ввод */

function applyEditCursor() {
  if (!dom.layer) return
  const editing = Boolean(state.editMode)
  dom.layer.classList.toggle("flLayerEditing", editing)
  if (dom.viewport) dom.viewport.classList.toggle("planViewportPlacing", editing)
}

let pointerStart = null

/*
 * Постановка точек висит на pointerup, а не на click: приложение плана
 * при начале панорамирования забирает pointer capture на .planViewport,
 * и браузер перенаправляет туда же последующий click — до слоя он не доходит.
 * Поэтому в режиме редактирования гасим pointerdown, чтобы план не начинал
 * тащиться, и сами решаем по смещению, был это клик или жест.
 */
function onLayerPointerDown(event) {
  if (!state.editMode) return
  event.stopPropagation()

  const nodeGroup = event.target.closest?.(".flNode")
  pointerStart = {
    x: event.clientX,
    y: event.clientY,
    moved: false,
    nodeId: nodeGroup?.dataset.nodeId ?? null,
    edgeId: event.target.closest?.(".flEdgeHit")?.dataset.edgeId ?? null,
  }

  if (state.editMode === "move" && nodeGroup) {
    state.dragNodeId = nodeGroup.dataset.nodeId
    state.selectedNodeId = state.dragNodeId
    dom.layer.setPointerCapture?.(event.pointerId)
    event.preventDefault()
    renderNodes()
  }
}

function onLayerPointerMove(event) {
  if (pointerStart) {
    const dx = event.clientX - pointerStart.x
    const dy = event.clientY - pointerStart.y
    if (Math.hypot(dx, dy) > 4) pointerStart.moved = true
  }

  if (state.dragNodeId) {
    const p = toPlanPoint(event)
    const node = nodeById(state.dragNodeId)
    if (p && node) {
      node.x = p.x
      node.y = p.y
      state.dirty = true
      renderNodes()
      renderEdges()
    }
    event.stopPropagation()
    return
  }

  if (state.editMode === "link" && state.linkFrom) {
    renderLinkHint(toPlanPoint(event))
  }
}

function onLayerPointerUp(event) {
  if (!state.editMode) return
  event.stopPropagation()

  if (state.dragNodeId) {
    state.dragNodeId = null
    dom.layer.releasePointerCapture?.(event.pointerId)
    pointerStart = null
    renderPanel()
    return
  }

  const gesture = pointerStart
  pointerStart = null
  if (!gesture || gesture.moved) return
  handleEditClick(event, gesture)
}

function handleEditClick(event, gesture) {
  const nodeId = gesture.nodeId
  const edgeId = gesture.edgeId
  const mode = state.editMode

  if (mode === "erase") {
    if (nodeId) {
      removeNode(nodeId)
    } else if (edgeId) {
      state.edges = state.edges.filter(e => e.id !== edgeId)
      state.dirty = true
    } else {
      return
    }
    resetSim()
    renderEdges()
    renderNodes()
    renderPanel()
    return
  }

  if (mode === "link") {
    if (!nodeId) return
    if (!state.linkFrom) {
      state.linkFrom = nodeId
    } else if (state.linkFrom === nodeId) {
      state.linkFrom = null
    } else {
      addEdge(state.linkFrom, nodeId)
      state.linkFrom = nodeId
      renderEdges()
      resetSim()
    }
    renderLinkHint(null)
    renderNodes()
    renderPanel()
    return
  }

  if (mode === "move") {
    if (nodeId) {
      state.selectedNodeId = nodeId
      renderNodes()
      renderPanel()
    }
    return
  }

  if (!NODE_KINDS[mode]) return
  const p = toPlanPoint(event)
  if (!p) return

  const created = addNode(mode, p.x, p.y)
  // Последовательное построение маршрута: новая точка сама цепляется к предыдущей
  const prev = state.nodes[state.nodes.length - 2]
  if (prev && state.nodes.length > 1) addEdge(prev.id, created.id)
  state.selectedNodeId = created.id
  if (state.units.length === 0) ensureUnits(1)
  if (state.units.length > 0 && !state.units.some(u => u.startNodeId)) {
    state.units[0].startNodeId = created.id
  }
  resetSim()
  renderEdges()
  renderNodes()
  renderPanel()
}

/* ------------------------------------------------------------------ панель */

function renderPanel() {
  if (!dom.panelHost) return
  dom.panelHost.hidden = !state.panelOpen
  if (!state.panelOpen) {
    dom.panelHost.replaceChildren()
    return
  }

  const s = state.settings
  const counts = {
    way: state.nodes.filter(n => n.kind === "way").length,
    pickup: state.nodes.filter(n => n.kind === "pickup").length,
    drop: state.nodes.filter(n => n.kind === "drop").length,
    resume: state.nodes.filter(n => n.kind === "resume").length,
  }

  const modeButton = (mode, label, dotClass) =>
    `<button type="button" class="flModeButton${state.editMode === mode ? " active" : ""}" data-mode="${mode}">
       <i class="flDot ${dotClass}"></i>${escapeHtml(label)}
     </button>`

  const tabButton = (id, label) =>
    `<button type="button" data-tab="${id}" class="${state.tab === id ? "active" : ""}">${escapeHtml(label)}</button>`

  let body = ""

  if (state.tab === "route") {
    body = `
      <div class="flSection">
        <div class="flSectionHead"><h3>Инструмент</h3><span>КЛИК ПО ПЛАНУ</span></div>
        <div class="flModeGrid">
          ${modeButton("way", "Точка пути", "flDotWay")}
          ${modeButton("pickup", "Погрузка", "flDotPickup")}
          ${modeButton("drop", "Разгрузка", "flDotDrop")}
          ${modeButton("resume", "Продолжение", "flDotResume")}
          ${modeButton("link", "Связать", "flDotLink")}
          ${modeButton("move", "Двигать", "flDotMove")}
          ${modeButton("erase", "Удалить", "flDotErase")}
        </div>
        <p class="flHint">${escapeHtml(hintForMode())}</p>
      </div>
      <div class="flSection">
        <div class="flSectionHead"><h3>Маршрут</h3><span>${state.nodes.length} ТОЧЕК · ${state.edges.length} СВЯЗЕЙ</span></div>
        ${
          state.nodes.length === 0
            ? `<p class="flEmpty">Маршрута ещё нет. Выберите «Точка пути» и щёлкайте по плану — точки соединятся в дорогу автоматически.</p>`
            : `<ul class="flCountList">
                 <li><i class="flDot flDotWay"></i>Путь<b>${counts.way}</b></li>
                 <li><i class="flDot flDotPickup"></i>Погрузка<b>${counts.pickup}</b></li>
                 <li><i class="flDot flDotDrop"></i>Разгрузка<b>${counts.drop}</b></li>
                 <li><i class="flDot flDotResume"></i>Продолжение<b>${counts.resume}</b></li>
               </ul>
               <button type="button" class="flSecondary flWide" data-action="clear">Очистить маршрут</button>`
        }
      </div>`
  } else if (state.tab === "units") {
    body = `
      <div class="flSection">
        <div class="flSectionHead"><h3>Количество погрузчиков</h3><span>ДО ${MAX_UNITS}</span></div>
        <div class="flField">
          <label>Кар на плане <b>${state.units.length}</b></label>
          <input type="range" min="0" max="${MAX_UNITS}" step="1" value="${state.units.length}" data-count="1" />
        </div>
        ${
          state.units.length === 0
            ? `<p class="flEmpty">Погрузчиков нет. Добавьте хотя бы одного и выберите точку старта.</p>`
            : `<ul class="flUnitList">${state.units
                .map(
                  (u, i) => `
              <li>
                <div class="flUnitHead">
                  ${escapeHtml(u.label || `Кара ${i + 1}`)}
                  <span>${u.startNodeId ? escapeHtml(nodeTitle(nodeById(u.startNodeId))) : "старт не задан"}</span>
                  <button type="button" class="flUnitToggle${u.enabled ? " on" : ""}" data-unit-toggle="${escapeHtml(u.id)}">
                    ${u.enabled ? "вкл" : "выкл"}
                  </button>
                </div>
                <select data-unit-start="${escapeHtml(u.id)}">
                  <option value="">— точка старта —</option>
                  ${state.nodes
                    .map(
                      (n, idx) =>
                        `<option value="${escapeHtml(n.id)}"${u.startNodeId === n.id ? " selected" : ""}>${idx + 1}. ${escapeHtml(
                          n.label || NODE_KINDS[n.kind].title
                        )}</option>`
                    )
                    .join("")}
                </select>
              </li>`
                )
                .join("")}</ul>`
        }
      </div>
      <div class="flSection">
        <div class="flSectionHead"><h3>Движение</h3><span>ПЛАН-ПИКСЕЛИ</span></div>
        <div class="flField">
          <label>Скорость <b>${s.speed} px/с</b></label>
          <input type="range" min="5" max="600" step="5" value="${s.speed}" data-set="speed" />
        </div>
        <div class="flField">
          <label>Размер кары <b>${s.bodyLength} px</b></label>
          <input type="range" min="6" max="80" step="1" value="${s.bodyLength}" data-set="bodyLength" />
        </div>
        <div class="flField">
          <label>Откат назад после разгрузки <b>${s.reverseDistance} px</b></label>
          <input type="range" min="0" max="200" step="2" value="${s.reverseDistance}" data-set="reverseDistance" />
        </div>
        <div class="flField">
          <label>Пауза на точке <b>${s.dwellMs} мс</b></label>
          <input type="range" min="0" max="5000" step="100" value="${s.dwellMs}" data-set="dwellMs" />
        </div>
        <p class="flHint">Ячейка ряда зоны A — 18 план-пикселей, так что размер 18 держит кару в габарите одной ячейки.</p>
      </div>`
  } else if (state.tab === "trip") {
    const tags = (state.pathTags.length ? state.pathTags : state.nodes.map((n, i) => ({
      index: i + 1,
      id: n.id,
      kind: n.kind,
      title: n.kind === "pickup" ? `погрузка ${i + 1}` : n.kind === "drop" ? `разгрузка ${i + 1}` : `тег пути ${i + 1}`,
    })))
    const pickup = state.pickupIndex || defaultPathIndex("pickup", 1)
    const drop = state.dropIndex || defaultPathIndex("drop", 9)
    const optionList = (selected) =>
      tags
        .map(
          t =>
            `<option value="${t.index}"${Number(t.index) === Number(selected) ? " selected" : ""}>${escapeHtml(
              t.title || `тег пути ${t.index}`
            )}</option>`
        )
        .join("")
    const activeMission = (state.missions || []).find(m => m.status === "active")
    body = `
      <div class="flSection">
        <div class="flSectionHead"><h3>Теги пути</h3><span>ОРАНЖЕВАЯ ЛИНИЯ</span></div>
        <p class="flHint">Номера на линии маршрута (1, 2, 4, 5, 6, 9) ведут кару. Фиолетовые ID на стеллажах — ряды, не маршрут.</p>
        <div class="flField">
          <label>Погрузка</label>
          <select data-path-pick="1">${optionList(pickup)}</select>
        </div>
        <div class="flField">
          <label>Разгрузка</label>
          <select data-path-drop="1">${optionList(drop)}</select>
        </div>
        <div class="flModeGrid">
          <button type="button" class="flModeButton" data-path-send="trip">Погрузка → разгрузка</button>
          <button type="button" class="flModeButton" data-path-send="pickup">К погрузке</button>
          <button type="button" class="flModeButton" data-path-send="drop">К разгрузке</button>
        </div>
        ${
          activeMission
            ? `<p class="flHint">Сейчас: ${escapeHtml(activeMission.routeName || "задание")}.</p>`
            : `<p class="flEmpty">Задания нет — кара стоит или едет по кругу, пока не отправите её.</p>`
        }
      </div>`
  } else if (state.tab === "view") {
    const hideAll = state.fleetView.hideAllRoutes
    const hideEditor = state.fleetView.hideEditorRoute
    const fleetList = state.fleetRoutes.length
      ? `<ul class="flUnitList">${state.fleetRoutes
          .map(
            (route, idx) => `<li>
              <div class="flUnitHead">
                ${escapeHtml(route.name || `Маршрут ${idx + 2}`)}
                <span>${route.hidden ? "скрыт" : "на плане"}</span>
                <button type="button" class="flUnitToggle${route.hidden ? "" : " on"}" data-vis-route="${escapeHtml(route.id)}" data-hidden="${route.hidden ? "0" : "1"}">
                  ${route.hidden ? "показать" : "скрыть"}
                </button>
              </div>
            </li>`
          )
          .join("")}</ul>`
      : `<p class="flEmpty">Именных маршрутов кар ещё нет — они появятся со страницы «Кары ГП».</p>`
    const points = state.loadingPoints.length
      ? `<ul class="flScanList">${state.loadingPoints
          .map(
            point => `<li>
              <b>${escapeHtml(point.name)}</b>
              <span>${point.lineCode ? `смена ${escapeHtml(point.lineCode)}` : "смена не назначена"}</span>
              <i>${point.tagId != null ? `тег ${point.tagId}` : "без тега"}</i>
            </li>`
          )
          .join("")}</ul>`
      : `<p class="flEmpty">Точки погрузки к сменам не привязаны. Назначьте их на странице «Кары ГП» → Погрузки.</p>`
    body = `
      <div class="flSection">
        <div class="flSectionHead"><h3>Скрыть на плане</h3><span>ТОЛЬКО ВИД</span></div>
        <label class="flCheckRow">
          <input type="checkbox" data-vis="all"${hideAll ? " checked" : ""} />
          Скрыть все маршруты
        </label>
        <label class="flCheckRow">
          <input type="checkbox" data-vis="editor"${hideEditor ? " checked" : ""} />
          Скрыть маршрут 1 (нумерованная разметка)
        </label>
        <p class="flHint">Серые кружки с номерами на оранжевой линии — теги пути. Фиолетовые кружки ID — теги рядов. Скрытие линий не отменяет задание.</p>
      </div>
      <div class="flSection">
        <div class="flSectionHead"><h3>Маршруты кар</h3><span>${state.fleetRoutes.length}</span></div>
        ${fleetList}
      </div>
      <div class="flSection">
        <div class="flSectionHead"><h3>Погрузки и смены</h3><span>${state.loadingPoints.length}</span></div>
        ${points}
      </div>`
  } else {
    body = `
      <div class="flSection">
        <div class="flSectionHead"><h3>Сканирование AprilTag</h3><span>СИМУЛЯЦИЯ</span></div>
        <label class="flCheckRow">
          <input type="checkbox" data-set-bool="scannerEnabled"${s.scannerEnabled ? " checked" : ""} />
          Показывать область сканирования
        </label>
        <div class="flField">
          <label>Дальность <b>${s.scannerRange} px</b></label>
          <input type="range" min="0" max="600" step="10" value="${s.scannerRange}" data-set="scannerRange" />
        </div>
        <div class="flField">
          <label>Угол обзора <b>${s.scannerFov}°</b></label>
          <input type="range" min="6" max="180" step="2" value="${s.scannerFov}" data-set="scannerFov" />
        </div>
        <p class="flHint">Метки берутся из калибровки AprilTag этого плана: загружено ${state.tags.length}.</p>
      </div>
      <div class="flSection">
        <div class="flSectionHead"><h3>Журнал считываний</h3><span>${state.scanLog.length}</span></div>
        ${
          state.scanLog.length === 0
            ? `<p class="flEmpty">Пока ничего не отсканировано. Запустите симуляцию — метки в конусе попадут в журнал.</p>`
            : `<ul class="flScanList">${state.scanLog
                .slice(0, 30)
                .map(
                  entry => `<li>
                    <b>ID ${entry.tagId}</b>
                    <span>${escapeHtml(scanRowsLabel(entry))}</span>
                    <i>${escapeHtml(entry.unit)} · ${entry.dist}px</i>
                  </li>`
                )
                .join("")}</ul>`
        }
      </div>`
  }

  const activeUnits = state.sim.length
  const panel = document.createElement("div")
  panel.className = "flPanel"
  panel.innerHTML = `
    <div class="flPanelHeader">
      <div>
        <span class="flEyebrow">СИМУЛЯЦИЯ</span>
        <h2>Погрузчики</h2>
        <p>Номера на оранжевой линии — теги пути. Фиолетовые ID — ряды.</p>
      </div>
      <button type="button" class="flCloseButton" data-action="close" aria-label="Закрыть">×</button>
    </div>
    <div class="flRunBar">
      <button type="button" class="flRunPrimary" data-action="toggle-run"${activeUnits === 0 ? " disabled" : ""}>
        ${state.running ? "Пауза" : "Старт"}
      </button>
      <button type="button" data-action="reset">Сброс</button>
    </div>
    <div class="flTabs">
      ${tabButton("route", "Маршрут")}
      ${tabButton("units", "Кары")}
      ${tabButton("trip", "Задание")}
      ${tabButton("view", "Вид")}
      ${tabButton("scan", "Скан")}
    </div>
    <div class="flPanelBody">
      ${body}
      ${
        state.message
          ? `<p class="flMessage${state.messageKind === "error" ? " error" : ""}">${escapeHtml(state.message)}</p>`
          : ""
      }
    </div>
    <div class="flPanelFooter">
      <button type="button" class="flPrimary" data-action="save"${state.dirty ? "" : " disabled"}>Сохранить</button>
      <button type="button" class="flSecondary" data-action="reload">Загрузить</button>
    </div>`

  panel.addEventListener("pointerdown", event => event.stopPropagation())
  panel.addEventListener("click", onPanelClick)
  panel.addEventListener("input", onPanelInput)
  panel.addEventListener("change", onPanelChange)

  dom.panelHost.replaceChildren(panel)
  dom.panel = panel
}

/** Подписи меток в калибровке выглядят как «ID 0 · A-33 · A-34 · A-35»,
 *  а номер уже показан отдельно — оставляем только перекрытые ряды. */
function scanRowsLabel(entry) {
  const raw = (entry.label || "").trim()
  if (!raw) return "без подписи"
  const rows = raw.replace(/^ID\s*\d+\s*·?\s*/i, "").trim()
  return rows || raw
}

function hintForMode() {
  switch (state.editMode) {
    case "way":
      return "Щёлкайте по плану — точки пути соединяются в дорогу по порядку."
    case "pickup":
      return "Точка погрузки: доехав до неё, кара берёт груз — на вилах появляется квадрат."
    case "drop":
      return "Точка разгрузки: кара упирается в неё, оставляет груз, отъезжает назад, разворачивается и едет дальше."
    case "resume":
      return "Точка продолжения движения: после разворота кара уходит именно в неё."
    case "link":
      return "Щёлкните по двум точкам, чтобы соединить их. Связь можно строить цепочкой."
    case "move":
      return "Перетаскивайте точки, чтобы поправить геометрию дороги."
    case "erase":
      return "Клик по точке удаляет её вместе со связями, клик по линии — только связь."
    default:
      return "Выберите инструмент, чтобы размечать дорогу. Пока инструмент не выбран, план перетаскивается как обычно."
  }
}

function onPanelClick(event) {
  const button = event.target.closest("button")
  if (!button) return
  event.stopPropagation()

  if (button.dataset.tab) {
    state.tab = button.dataset.tab
    renderPanel()
    return
  }

  if (button.dataset.mode) {
    const mode = button.dataset.mode
    state.editMode = state.editMode === mode ? null : mode
    state.linkFrom = null
    renderLinkHint(null)
    applyEditCursor()
    renderPanel()
    return
  }

  if (button.dataset.pathSend) {
    void dispatchPath(button.dataset.pathSend)
    return
  }

  if (button.dataset.visRoute) {
    void saveVisibility({ routeId: button.dataset.visRoute, hidden: button.dataset.hidden === "1" })
    return
  }

  if (button.dataset.unitToggle) {
    const unit = state.units.find(u => u.id === button.dataset.unitToggle)
    if (unit) {
      unit.enabled = !unit.enabled
      state.dirty = true
      resetSim()
      renderPanel()
    }
    return
  }

  switch (button.dataset.action) {
    case "close":
      state.panelOpen = false
      state.editMode = null
      syncToolButton()
      applyEditCursor()
      renderPanel()
      break
    case "toggle-run":
      state.running = !state.running
      lastFrame = performance.now()
      renderPanel()
      break
    case "reset":
      state.running = false
      resetSim()
      state.scanLog = []
      renderPanel()
      break
    case "clear":
      state.nodes = []
      state.edges = []
      state.units = state.units.map(u => ({ ...u, startNodeId: null }))
      state.selectedNodeId = null
      state.linkFrom = null
      state.dirty = true
      state.running = false
      resetSim()
      renderEdges()
      renderNodes()
      renderPanel()
      break
    case "save":
      void saveRoutes()
      break
    case "reload":
      state.running = false
      void loadRoutes()
      void loadTags()
      void loadFleet()
      break
    default:
      break
  }
}

function onPanelInput(event) {
  const input = event.target
  if (input.dataset.set) {
    const key = input.dataset.set
    const value = Number(input.value)
    state.settings[key] = value
    state.dirty = true
    const readout = input.parentElement?.querySelector("label b")
    if (readout) {
      if (key === "speed") readout.textContent = `${value} px/с`
      else if (key === "dwellMs") readout.textContent = `${value} мс`
      else if (key === "scannerFov") readout.textContent = `${value}°`
      else readout.textContent = `${value} px`
    }
    if (key === "bodyLength" || key === "scannerRange" || key === "scannerFov") rebuildUnitEls()
    const save = dom.panel?.querySelector('[data-action="save"]')
    if (save) save.disabled = false
    return
  }

  if (input.dataset.count) {
    const next = clamp(Number(input.value) || 0, 0, MAX_UNITS)
    ensureUnits(next)
    resetSim()
    renderPanel()
  }
}

function onPanelChange(event) {
  const input = event.target
  if (input.dataset.vis) {
    if (input.dataset.vis === "all") void saveVisibility({ hideAllRoutes: input.checked })
    if (input.dataset.vis === "editor") void saveVisibility({ hideEditorRoute: input.checked })
    return
  }
  if (input.dataset.setBool) {
    state.settings[input.dataset.setBool] = input.checked
    state.dirty = true
    rebuildUnitEls()
    renderPanel()
    return
  }
  if (input.dataset.pathPick) {
    state.pickupIndex = Number(input.value) || 1
    return
  }
  if (input.dataset.pathDrop) {
    state.dropIndex = Number(input.value) || 9
    return
  }
  if (input.dataset.unitStart) {
    const unit = state.units.find(u => u.id === input.dataset.unitStart)
    if (unit) {
      unit.startNodeId = input.value || null
      state.dirty = true
      resetSim()
      renderPanel()
    }
  }
}

/* --------------------------------------------------- внешний интерфейс */

function refreshAll() {
  resetSim()
  renderEdges()
  renderNodes()
  renderFleetOverlays()
  renderPanel()
}

/**
 * Программный интерфейс слоя. План открыт в iframe внутри WMS, поэтому кроме
 * window.forkliftSim продублирован мост postMessage: родительская страница
 * может управлять симуляцией, не имея доступа к её внутренностям.
 */
const api = {
  version: 1,
  planSize: { width: PLAN_WIDTH, height: PLAN_HEIGHT },
  siteCode,

  getState() {
    return JSON.parse(JSON.stringify(snapshotPayload()))
  },

  setRoute(snapshot) {
    applySnapshot(snapshot)
    state.dirty = true
    renderPanel()
    return api.getState()
  },

  addNode(kind, x, y, options) {
    const node = addNode(NODE_KINDS[kind] ? kind : "way", clamp(Number(x) || 0, 0, PLAN_WIDTH), clamp(Number(y) || 0, 0, PLAN_HEIGHT))
    if (options?.label) node.label = String(options.label)
    if (options?.linkFrom) addEdge(String(options.linkFrom), node.id)
    refreshAll()
    return node.id
  },

  linkNodes(from, to) {
    const ok = addEdge(String(from), String(to))
    refreshAll()
    return ok
  },

  removeNode(id) {
    removeNode(String(id))
    refreshAll()
  },

  clear() {
    state.nodes = []
    state.edges = []
    state.units = state.units.map(u => ({ ...u, startNodeId: null }))
    state.running = false
    state.dirty = true
    refreshAll()
  },

  setUnitCount(count) {
    ensureUnits(clamp(Math.round(Number(count) || 0), 0, MAX_UNITS))
    refreshAll()
    return state.units.length
  },

  setUnitStart(unit, nodeId) {
    const target =
      typeof unit === "number" ? state.units[unit] : state.units.find(u => u.id === String(unit))
    if (!target) return false
    target.startNodeId = nodeId ? String(nodeId) : null
    state.dirty = true
    refreshAll()
    return true
  },

  setSettings(patch) {
    if (!patch || typeof patch !== "object") return api.getState().settings
    applySnapshot({ ...snapshotPayload(), settings: { ...state.settings, ...patch } })
    state.dirty = true
    renderPanel()
    return api.getState().settings
  },

  start() {
    state.running = true
    lastFrame = performance.now()
    renderPanel()
  },

  stop() {
    state.running = false
    renderPanel()
  },

  reset() {
    state.running = false
    state.scanLog = []
    refreshAll()
  },

  isRunning() {
    return state.running
  },

  /** Текущие позиции кар в план-координатах. */
  getUnits() {
    return state.sim.map(f => ({
      unitId: f.unitId,
      label: f.label,
      x: Math.round(f.x * 100) / 100,
      y: Math.round(f.y * 100) / 100,
      headingDeg: Math.round(((f.heading * 180) / Math.PI) * 100) / 100,
      phase: f.phase,
      cargo: f.cargo,
      atNodeId: f.nodeId,
      targetNodeId: f.targetNodeId,
    }))
  },

  getScanLog() {
    return state.scanLog.map(e => ({ ...e, at: e.at.toISOString() }))
  },

  openPanel(open) {
    state.panelOpen = open === undefined ? true : Boolean(open)
    syncToolButton()
    renderPanel()
  },

  save() {
    return saveRoutes()
  },

  load() {
    return Promise.all([loadRoutes(), loadTags(), loadFleet()])
  },

  runTrip(pickupIndex, dropIndex) {
    state.pickupIndex = Number(pickupIndex) || defaultPathIndex("pickup", 1)
    state.dropIndex = Number(dropIndex) || defaultPathIndex("drop", 9)
    return dispatchPath("trip")
  },

  sendTo(index, kind) {
    const n = Number(index)
    if (kind === "drop") {
      state.dropIndex = n
      return dispatchPath("drop")
    }
    state.pickupIndex = n
    return dispatchPath("pickup")
  },
}

async function dispatchPath(mode) {
  const kara = state.fleetKaras[0]
  const body = {
    siteCode,
    karaId: kara?.id,
    karaName: kara?.name || state.sim[0]?.label || "Кара 1",
  }
  if (mode !== "drop") body.pickupIndex = Number(state.pickupIndex) || defaultPathIndex("pickup", 1)
  if (mode !== "pickup") body.dropIndex = Number(state.dropIndex) || defaultPathIndex("drop", 9)
  try {
    const res = await fetch(DISPATCH_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setMessage(data.error || `Не отправили (${res.status})`, "error")
      renderPanel()
      return null
    }
    await loadFleet()
    setMessage(data.mission?.routeName || "Кара отправлена по тегам пути", "ok")
    renderPanel()
    return data
  } catch (error) {
    setMessage(`Нет связи с диспетчером. ${String(error).slice(0, 90)}`, "error")
    renderPanel()
    return null
  }
}

window.forkliftSim = api

window.addEventListener("message", event => {
  const data = event.data
  if (!data || data.type !== "forklift:command") return
  const fn = api[data.command]
  if (typeof fn !== "function") return
  let result = null
  let error = null
  try {
    result = fn.apply(api, Array.isArray(data.args) ? data.args : [])
  } catch (e) {
    error = String(e)
  }
  const reply = { type: "forklift:result", id: data.id ?? null, command: data.command, error }
  if (result && typeof result.then === "function") {
    result.then(
      value => event.source?.postMessage({ ...reply, result: value ?? null }, "*"),
      e => event.source?.postMessage({ ...reply, error: String(e) }, "*")
    )
    return
  }
  event.source?.postMessage({ ...reply, result: result ?? null }, "*")
})

/* ------------------------------------------------------------------- цикл */

function frame(now) {
  requestAnimationFrame(frame)
  if (!ensureMounted()) return

  const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0
  lastFrame = now

  if (state.running && dt > 0) {
    for (const f of state.sim) {
      stepUnit(f, dt, now)
      scanTags(f, now)
    }
  }
  renderUnits(now)
}

function boot() {
  // Приложение плана — React, который может пересоздать стейдж, поэтому слой,
  // кнопку и панель возвращаем на место по любому изменению DOM.
  const observer = new MutationObserver(() => {
    ensureMounted()
  })
  observer.observe(document.body, { childList: true, subtree: true })

  // Интервал — только страховка на первую отрисовку плана; дальше монтирование
  // ведёт наблюдатель, поэтому крутить его вечно не нужно.
  let attempts = 0
  const wait = window.setInterval(() => {
    attempts += 1
    if (ensureMounted() || attempts > 80) window.clearInterval(wait)
  }, 250)

  requestAnimationFrame(frame)
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true })
} else {
  boot()
}
