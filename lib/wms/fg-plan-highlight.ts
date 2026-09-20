"use client"

import { canonicalPlanRowId, samePlanRowFamily } from "@/lib/wms/fg-plan-location-codes"
import type { MapTint } from "@/lib/wms/fg-placement-types"

const STYLE_ID = "wms-fg-placement-hl"
const LAYER_ID = "wms-fg-hl-layer"
const CAM_STYLE_ID = "wms-fg-hl-cam"
const MSG_ROW = "wms-fg-row-click"
const PLAN_W = 3503
const PLAN_H = 2562

export type PlanHighlight = {
  planRowId: string
  positions?: number[]
  color?: string
  label?: string
}

type LastPaint = {
  hits: PlanHighlight[]
  focus: boolean
}

let lastPaint: LastPaint | null = null
let retryTimer: number | null = null

function iframeDoc(iframe: HTMLIFrameElement | null): Document | null {
  try {
    return iframe?.contentDocument ?? iframe?.contentWindow?.document ?? null
  } catch {
    return null
  }
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value)
  return value.replace(/"/g, '\\"')
}

function findRowNodes(doc: Document, planRowId: string): HTMLElement[] {
  const wanted = canonicalPlanRowId(planRowId) || planRowId
  return [...doc.querySelectorAll<HTMLElement>("[data-row-id]")].filter((el) => {
    const raw = el.getAttribute("data-row-id") || ""
    return samePlanRowFamily(raw, wanted) || raw.toUpperCase() === planRowId.toUpperCase()
  })
}

function collectHits(doc: Document, hits: PlanHighlight[]) {
  const painted: Array<{ el: HTMLElement; hit: PlanHighlight; id: string }> = []
  for (const hit of hits) {
    for (const el of findRowNodes(doc, hit.planRowId)) {
      const id = el.getAttribute("data-row-id") || hit.planRowId
      painted.push({ el, hit, id })
    }
  }
  return painted
}

function writeAttributeStyle(doc: Document, painted: Array<{ id: string; hit: PlanHighlight }>) {
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = doc.createElement("style")
    style.id = STYLE_ID
    doc.head.appendChild(style)
  }
  const seen = new Set<string>()
  const rules: string[] = [
    `@keyframes wms-hl-pulse { 0%,100% { stroke-opacity: 1 } 50% { stroke-opacity: .45 } }`,
  ]
  for (const item of painted) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    const sel = `[data-row-id="${cssEscape(item.id)}"]`
    const color = item.hit.color || "#84cc16"
    rules.push(`
      .rowHotspot${sel} {
        fill: color-mix(in srgb, ${color} 48%, transparent) !important;
        stroke: ${color} !important;
        stroke-width: 4 !important;
        opacity: 1 !important;
        animation: wms-hl-pulse 1.2s ease-in-out 3;
      }
    `)
  }
  style.textContent = rules.join("\n")
}

function writeOverlay(doc: Document, painted: Array<{ el: HTMLElement; hit: PlanHighlight }>) {
  const stage = doc.querySelector(".planStage")
  if (!stage) return
  let svg = doc.getElementById(LAYER_ID) as SVGSVGElement | null
  if (!svg) {
    svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.id = LAYER_ID
    svg.setAttribute("viewBox", `0 0 ${PLAN_W} ${PLAN_H}`)
    svg.setAttribute("width", String(PLAN_W))
    svg.setAttribute("height", String(PLAN_H))
    svg.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:9;overflow:visible"
    stage.appendChild(svg)
  }
  while (svg.firstChild) svg.removeChild(svg.firstChild)

  const grouped = new Map<string, { boxes: DOMRect[]; label: string; color: string }>()
  for (const item of painted) {
    const svgEl = item.el as unknown as SVGGraphicsElement
    if (typeof svgEl.getBBox !== "function") continue
    let box: DOMRect
    try {
      box = svgEl.getBBox()
    } catch {
      continue
    }
    const key = item.el.getAttribute("data-row-id") || item.hit.planRowId
    const cur = grouped.get(key) || {
      boxes: [],
      label: item.hit.label || canonicalPlanRowId(key) || key,
      color: item.hit.color || "#eab308",
    }
    cur.boxes.push(box)
    if (item.hit.label) cur.label = item.hit.label
    grouped.set(key, cur)
  }

  for (const group of grouped.values()) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const b of group.boxes) {
      minX = Math.min(minX, b.x)
      minY = Math.min(minY, b.y)
      maxX = Math.max(maxX, b.x + b.width)
      maxY = Math.max(maxY, b.y + b.height)
    }
    if (!Number.isFinite(minX)) continue
    const rect = doc.createElementNS("http://www.w3.org/2000/svg", "rect")
    rect.setAttribute("x", String(minX - 4))
    rect.setAttribute("y", String(minY - 4))
    rect.setAttribute("width", String(Math.max(12, maxX - minX + 8)))
    rect.setAttribute("height", String(Math.max(12, maxY - minY + 8)))
    rect.setAttribute("fill", "none")
    rect.setAttribute("stroke", group.color)
    rect.setAttribute("stroke-width", "10")
    rect.setAttribute("rx", "6")
    rect.style.pointerEvents = "none"
    svg.appendChild(rect)

    const label = doc.createElementNS("http://www.w3.org/2000/svg", "text")
    label.setAttribute("x", String(minX + 8))
    label.setAttribute("y", String(Math.max(18, minY - 10)))
    label.setAttribute("fill", "#111827")
    label.setAttribute("stroke", "#fde68a")
    label.setAttribute("stroke-width", "4")
    label.setAttribute("paint-order", "stroke")
    label.setAttribute("font-size", "22")
    label.setAttribute("font-weight", "700")
    label.setAttribute("font-family", "Inter, Segoe UI, sans-serif")
    label.textContent = group.label
    svg.appendChild(label)
  }
}

function releaseCamera(doc: Document) {
  const stage = doc.querySelector<HTMLElement>(".planStage")
  stage?.classList.remove("wms-hl-cam")
  doc.getElementById(CAM_STYLE_ID)?.remove()
}

export function focusPlanRows(iframe: HTMLIFrameElement | null, planRowIds: string[]) {
  const doc = iframeDoc(iframe)
  const win = iframe?.contentWindow
  if (!doc || !win) return false
  const stage = doc.querySelector<HTMLElement>(".planStage")
  if (!stage) return false
  const nodes = planRowIds.flatMap((id) => findRowNodes(doc, id))
  if (nodes.length === 0) return false
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const el of nodes) {
    const svg = el as unknown as SVGGraphicsElement
    if (typeof svg.getBBox !== "function") continue
    try {
      const b = svg.getBBox()
      minX = Math.min(minX, b.x)
      minY = Math.min(minY, b.y)
      maxX = Math.max(maxX, b.x + b.width)
      maxY = Math.max(maxY, b.y + b.height)
    } catch {
      /* ignore */
    }
  }
  if (!Number.isFinite(minX) || maxX <= minX) return false
  const vw = win.innerWidth
  const vh = win.innerHeight
  const bw = Math.max(80, maxX - minX)
  const bh = Math.max(80, maxY - minY)
  const scale = Math.max(0.42, Math.min((vw * 0.55) / bw, (vh * 0.55) / bh, 2.1))
  const x = vw / 2 - ((minX + maxX) / 2) * scale
  const y = vh / 2 - ((minY + maxY) / 2) * scale
  let cam = doc.getElementById(CAM_STYLE_ID) as HTMLStyleElement | null
  if (!cam) {
    cam = doc.createElement("style")
    cam.id = CAM_STYLE_ID
    doc.head.appendChild(cam)
  }
  cam.textContent = `.planStage.wms-hl-cam{transform:translate3d(${x}px,${y}px,0) scale(${scale}) !important}`
  stage.classList.add("wms-hl-cam")
  const release = () => {
    releaseCamera(doc)
    win.removeEventListener("pointerdown", release, true)
    win.removeEventListener("wheel", release, true)
  }
  win.addEventListener("pointerdown", release, true)
  win.addEventListener("wheel", release, true)
  return true
}

function paintNow(
  iframe: HTMLIFrameElement | null,
  hits: PlanHighlight[],
  focus: boolean
): { painted: number; focused: boolean; ids: string[] } {
  const doc = iframeDoc(iframe)
  if (!doc) return { painted: 0, focused: false, ids: [] }
  const painted = collectHits(doc, hits)
  writeAttributeStyle(doc, painted)
  writeOverlay(doc, painted)
  const ids = [...new Set(painted.map((p) => p.id))]
  const focused = focus && ids.length > 0 ? focusPlanRows(iframe, ids) : false
  return { painted: ids.length, focused, ids }
}

function scheduleRetry(iframe: HTMLIFrameElement | null) {
  if (retryTimer != null) window.clearInterval(retryTimer)
  let attempts = 0
  retryTimer = window.setInterval(() => {
    attempts += 1
    if (!lastPaint || attempts > 20) {
      if (retryTimer != null) window.clearInterval(retryTimer)
      retryTimer = null
      return
    }
    const result = paintNow(iframe, lastPaint.hits, lastPaint.focus)
    if (result.painted > 0) {
      if (retryTimer != null) window.clearInterval(retryTimer)
      retryTimer = null
    }
  }, 250)
}

export function bindPlanRowClicks(iframe: HTMLIFrameElement | null, enabled: () => boolean) {
  const doc = iframeDoc(iframe)
  if (!doc) return () => undefined
  if (doc.documentElement.dataset.wmsFgClicks === "1") return () => undefined
  doc.documentElement.dataset.wmsFgClicks = "1"
  const handler = (event: MouseEvent) => {
    if (!enabled()) return
    const el = (event.target as Element | null)?.closest?.("[data-row-id]") as HTMLElement | null
    if (!el) return
    const rowId = el.getAttribute("data-row-id")
    if (!rowId) return
    window.postMessage({ type: MSG_ROW, rowId }, "*")
  }
  doc.addEventListener("click", handler, true)
  return () => {
    doc.removeEventListener("click", handler, true)
    delete doc.documentElement.dataset.wmsFgClicks
  }
}

export function isPlanRowClick(data: unknown): data is { type: string; rowId: string } {
  return Boolean(data && typeof data === "object" && (data as { type?: string }).type === MSG_ROW)
}

export function clearPlanHighlight(iframe: HTMLIFrameElement | null) {
  lastPaint = null
  if (retryTimer != null) {
    window.clearInterval(retryTimer)
    retryTimer = null
  }
  const doc = iframeDoc(iframe)
  if (!doc) return
  doc.getElementById(STYLE_ID)?.remove()
  doc.getElementById(LAYER_ID)?.remove()
  releaseCamera(doc)
}

export function applyPlanHighlight(
  iframe: HTMLIFrameElement | null,
  hits: PlanHighlight[],
  opts?: { dimOthers?: boolean; focus?: boolean }
): { painted: number; focused: boolean; ids: string[] } {
  lastPaint = { hits, focus: opts?.focus !== false }
  const result = paintNow(iframe, hits, lastPaint.focus)
  if (result.painted === 0) scheduleRetry(iframe)
  return result
}

export function applyPlanTints(iframe: HTMLIFrameElement | null, tints: MapTint[]) {
  applyPlanHighlight(
    iframe,
    tints.map((t) => ({
      planRowId: t.planRowId,
      color: t.color,
      label: t.label,
      positions: t.positions,
    })),
    { dimOthers: false, focus: false }
  )
}

const CHROME_STYLE_ID = "wms-fg-chrome"
const LEGEND_ID = "wms-fg-legend"

export type PlanChromeHandlers = {
  onPlace: () => void
  onTask: () => void
  onRules: () => void
  onRowSettings: () => void
  onRowSelected: (rowId: string) => void
}

export type PlanLegendLine = { text: string; color?: string }

function ensureChromeStyle(doc: Document) {
  if (doc.getElementById(CHROME_STYLE_ID)) return
  const style = doc.createElement("style")
  style.id = CHROME_STYLE_ID
  style.textContent = `
    .mapControls .wmsPlaceBtn {
      font-size: 12px;
      font-weight: 650;
      white-space: nowrap;
    }
    .mapControls .wmsPlaceBtn.active {
      border-color: #d97706;
      background: #fef3c7;
      color: #92400e;
    }
    #${LEGEND_ID} {
      position: absolute;
      right: 14px;
      top: 58px;
      z-index: 7;
      max-width: min(22rem, calc(100% - 28px));
      padding: 10px 12px;
      border: 1px solid rgba(15, 23, 42, .16);
      border-radius: 10px;
      background: #fffffff5;
      box-shadow: 0 8px 24px #0f172a24;
      font: 12px/1.4 Inter, "Segoe UI", sans-serif;
      color: #172033;
      pointer-events: auto;
    }
    #${LEGEND_ID} b { display: block; margin-bottom: 6px; font-size: 12px; }
    #${LEGEND_ID} ol { margin: 0; padding: 0 0 0 1.1rem; }
    #${LEGEND_ID} li { margin: 0 0 4px; }
    #${LEGEND_ID} button[data-wms-legend-close] {
      display: inline-block;
      margin-top: 8px;
      padding: 4px 10px;
      border: 1px solid #cbd5e1;
      border-radius: 7px;
      background: #fff;
      color: #334155;
      cursor: pointer;
      font-size: 12px;
    }
  `
  doc.head.appendChild(style)
}

function makeToolButton(doc: Document, action: string, label: string, title: string, onClick: () => void) {
  const button = doc.createElement("button")
  button.type = "button"
  button.className = "flToolButton wmsPlaceBtn"
  button.dataset.wmsPlaceChrome = action
  button.textContent = label
  button.title = title
  button.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    onClick()
  })
  return button
}

export function mountPlanChrome(iframe: HTMLIFrameElement | null, handlers: PlanChromeHandlers): () => void {
  const doc = iframeDoc(iframe)
  const win = iframe?.contentWindow
  if (!doc || !win) return () => undefined

  const onNative = (event: Event) => {
    const detail = (event as CustomEvent).detail as { id?: string } | string | null
    const rowId = typeof detail === "string" ? detail : detail?.id
    if (rowId) handlers.onRowSelected(rowId)
  }
  win.addEventListener("warehouse:row-select", onNative)

  const ensure = () => {
    const controls = doc.querySelector(".mapControls")
    if (!controls || controls.querySelector("[data-wms-place-chrome]")) return
    ensureChromeStyle(doc)
    controls.append(
      makeToolButton(doc, "place", "Размещение", "Куда ставить выпуск и какие палеты брать", handlers.onPlace),
      makeToolButton(doc, "task", "Задание", "Подсветить на карте ряды текущего задания", handlers.onTask),
      makeToolButton(doc, "rules", "Правила", "FIFO-ряд, FEFO-отбор, закрепление номенклатур", handlers.onRules),
      makeToolButton(
        doc,
        "row",
        "Ряд",
        "Настройки выбранного ряда. Кликните ряд на карте, затем эту кнопку — или наоборот.",
        handlers.onRowSettings
      )
    )
  }

  const timer = win.setInterval(ensure, 400)
  ensure()
  iframe.addEventListener("load", ensure)

  return () => {
    win.clearInterval(timer)
    win.removeEventListener("warehouse:row-select", onNative)
    iframe.removeEventListener("load", ensure)
    doc.querySelectorAll("[data-wms-place-chrome]").forEach((node) => node.remove())
    doc.getElementById(LEGEND_ID)?.remove()
  }
}

export function selectedPlanRowId(iframe: HTMLIFrameElement | null): string | null {
  return iframeDoc(iframe)?.querySelector("[data-row-id].selected, .rowHotspot.selected")?.getAttribute("data-row-id") ?? null
}

export function setPlanRowChip(iframe: HTMLIFrameElement | null, label: string, pending: boolean) {
  const button = iframeDoc(iframe)?.querySelector<HTMLButtonElement>('[data-wms-place-chrome="row"]')
  if (!button) return
  button.textContent = label
  button.classList.toggle("active", pending || (label !== "Ряд" && label !== "Ряд…"))
}

export function setPlanTaskChip(iframe: HTMLIFrameElement | null, active: boolean) {
  iframeDoc(iframe)
    ?.querySelector<HTMLButtonElement>('[data-wms-place-chrome="task"]')
    ?.classList.toggle("active", active)
}

function hidePlanLegend(iframe: HTMLIFrameElement | null) {
  iframeDoc(iframe)?.getElementById(LEGEND_ID)?.remove()
  setPlanTaskChip(iframe, false)
  clearPlanHighlight(iframe)
}

function bindLegendPointerGuard(iframe: HTMLIFrameElement | null, box: HTMLElement) {
  if (box.dataset.wmsBound === "1") return
  box.dataset.wmsBound = "1"
  const stop = (event: Event) => {
    event.stopPropagation()
  }
  box.addEventListener("pointerdown", stop)
  box.addEventListener("pointerup", stop)
  box.addEventListener("pointercancel", stop)
  box.addEventListener("click", stop)
  box.addEventListener("pointerdown", (event) => {
    const target = event.target as HTMLElement | null
    if (!target?.closest?.("[data-wms-legend-close]")) return
    event.preventDefault()
    event.stopPropagation()
    hidePlanLegend(iframe)
  })
}

export function setPlanLegend(
  iframe: HTMLIFrameElement | null,
  legend: { title: string; lines: PlanLegendLine[] } | null
) {
  const doc = iframeDoc(iframe)
  if (!doc) return
  const host = doc.querySelector(".planViewport")
  if (!host) return
  ensureChromeStyle(doc)
  let box = doc.getElementById(LEGEND_ID)
  if (!legend || legend.lines.length === 0) {
    hidePlanLegend(iframe)
    return
  }
  if (!box) {
    box = doc.createElement("div")
    box.id = LEGEND_ID
    host.appendChild(box)
  }
  bindLegendPointerGuard(iframe, box)
  const items = legend.lines
    .map((line) => {
      const color = line.color || "#ca8a04"
      return `<li><span style="display:inline-block;width:8px;height:8px;border-radius:99px;background:${color};margin-right:6px"></span>${line.text}</li>`
    })
    .join("")
  box.innerHTML = `<b>${legend.title}</b><ol>${items}</ol><button type="button" data-wms-legend-close>Скрыть</button>`
}
