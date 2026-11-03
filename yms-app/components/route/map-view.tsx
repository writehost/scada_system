"use client"

import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react"
import type { MapGeometry, Pt } from "@/lib/route/graph"

export type MapForklift = {
  id: string
  x: number
  y: number
  headingDeg: number | null
  state: string
  label: string
  self?: boolean
  carrying?: boolean
}

export type MapMarker = { x: number; y: number; label: string; kind: "pickup" | "dropoff" | "point" | "tag" | "draft" }

export type MapHit = { nodeId?: string; edgeId?: string; world: Pt }

export type MapViewHandle = { center: (p?: Pt) => void; fit: () => void }

type Props = {
  geometry: MapGeometry | null
  route?: Pt[] | null
  planned?: Pt[] | null
  markers?: MapMarker[]
  forklifts?: MapForklift[]
  blockedEdgeIds?: ReadonlySet<string>
  highlightEdgeIds?: ReadonlySet<string>
  highlightNodeIds?: ReadonlySet<string>
  highlightRack?: string | null
  followId?: string | null
  orientation?: "north" | "heading"
  showGraph?: boolean
  showAccess?: boolean
  dim?: boolean
  onClick?: (hit: MapHit) => void
  onDragNode?: (nodeId: string, world: Pt, phase: "move" | "end") => void
  draggableNodes?: boolean
  controls?: boolean
  onOrientationChange?: (o: "north" | "heading") => void
}

const COLORS = {
  bg: "#15181b",
  edge: "rgba(160,170,180,0.35)",
  edgeAccess: "rgba(120,200,140,0.35)",
  edgeHi: "#f5c542",
  blocked: "#ff5a5a",
  route: "#38e0b2",
  planned: "rgba(56,224,178,0.35)",
  self: "#ffd23f",
  other: "#7aa7ff",
  lost: "#8a9097",
  pickup: "#4aa8ff",
  dropoff: "#ff9f43",
  node: "#c9d1d9",
  nodeHi: "#f5c542",
}

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 300, h: 200 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [ref])
  return size
}

export const MapView = forwardRef<MapViewHandle, Props>(function MapView(props, ref) {
  const wrap = useRef<HTMLDivElement | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const size = useSize(wrap)
  const img = useRef<HTMLImageElement | null>(null)
  const [imgReady, setImgReady] = useState(false)
  const view = useRef({ cx: 1750, cy: 1280, s: 0.3, rot: 0 })
  const [follow, setFollow] = useState(true)
  const [, force] = useState(0)
  const redraw = useCallback(() => force((n) => n + 1), [])
  const g = props.geometry
  const orientation = props.orientation ?? "north"

  // фон — план склада
  useEffect(() => {
    const src = g?.coord.background
    if (!src) return
    const im = new Image()
    im.onload = () => {
      img.current = im
      setImgReady(true)
    }
    im.src = src
  }, [g?.coord.background])

  const self = props.forklifts?.find((f) => f.id === props.followId) ?? null

  const fit = useCallback(() => {
    if (!g) return
    const s = Math.min(size.w / g.coord.width, size.h / g.coord.height) * 0.98
    view.current = { cx: g.coord.width / 2, cy: g.coord.height / 2, s, rot: 0 }
    redraw()
  }, [g, size.w, size.h, redraw])

  const center = useCallback(
    (p?: Pt) => {
      const target = p ?? (self ? { x: self.x, y: self.y } : null)
      if (!target) return
      view.current.cx = target.x
      view.current.cy = target.y
      if (view.current.s < 0.5) view.current.s = 0.6
      setFollow(true)
      redraw()
    },
    [self, redraw]
  )

  useImperativeHandle(ref, () => ({ center, fit }), [center, fit])

  const fitted = useRef(false)
  useEffect(() => {
    if (!g || fitted.current || size.w < 50) return
    fitted.current = true
    if (self) center()
    else fit()
  }, [g, size.w, self, center, fit])

  // следование за своим погрузчиком; при первом появлении — крупный масштаб
  const sawSelf = useRef(false)
  useEffect(() => {
    if (!self || !follow) return
    if (!sawSelf.current) {
      sawSelf.current = true
      view.current.s = Math.max(view.current.s, 0.6)
    }
    view.current.cx = self.x
    view.current.cy = self.y
    if (orientation === "heading" && self.headingDeg != null) {
      view.current.rot = (self.headingDeg * Math.PI) / 180 + Math.PI / 2
    }
  }, [self?.x, self?.y, self?.headingDeg, follow, orientation, self])
  useEffect(() => {
    if (orientation === "north") view.current.rot = 0
    redraw()
  }, [orientation, redraw])

  const toScreen = useCallback(
    (p: Pt): Pt => {
      const v = view.current
      const dx = (p.x - v.cx) * v.s
      const dy = (p.y - v.cy) * v.s
      const c = Math.cos(-v.rot)
      const s = Math.sin(-v.rot)
      return { x: size.w / 2 + dx * c - dy * s, y: size.h / 2 + dx * s + dy * c }
    },
    [size.w, size.h]
  )
  const toWorld = useCallback(
    (p: Pt): Pt => {
      const v = view.current
      const dx = p.x - size.w / 2
      const dy = p.y - size.h / 2
      const c = Math.cos(v.rot)
      const s = Math.sin(v.rot)
      return { x: v.cx + (dx * c - dy * s) / v.s, y: v.cy + (dx * s + dy * c) / v.s }
    },
    [size.w, size.h]
  )

  // отрисовка
  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = Math.round(size.w * dpr)
    cv.height = Math.round(size.h * dpr)
    const ctx = cv.getContext("2d")
    if (!ctx) return
    const v = view.current
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, size.w, size.h)
    if (!g) return
    ctx.save()
    ctx.translate(size.w / 2, size.h / 2)
    ctx.rotate(-v.rot)
    ctx.scale(v.s, v.s)
    ctx.translate(-v.cx, -v.cy)
    if (img.current && imgReady) {
      ctx.save()
      ctx.globalAlpha = props.dim ? 0.45 : 0.9
      ctx.filter = "invert(0.92) hue-rotate(180deg) contrast(1.1)"
      ctx.drawImage(img.current, 0, 0, g.coord.width, g.coord.height)
      ctx.restore()
    }
    const lw = (px: number) => px / v.s
    const nodes = new Map(g.nodes.map((n) => [n.id, n]))
    // зоны
    for (const a of g.areas) {
      if (a.polygon.length < 3) continue
      ctx.beginPath()
      a.polygon.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.closePath()
      ctx.fillStyle =
        a.kind === "no_go" ? "rgba(255,80,80,0.22)" : a.kind === "pedestrian" ? "rgba(255,210,63,0.18)" : a.kind === "zone" ? "rgba(122,167,255,0.12)" : "rgba(160,160,160,0.3)"
      ctx.fill()
      ctx.strokeStyle = a.kind === "no_go" ? COLORS.blocked : a.kind === "pedestrian" ? COLORS.self : "#9aa"
      ctx.lineWidth = lw(1.5)
      ctx.setLineDash(a.kind === "pedestrian" ? [lw(6), lw(4)] : [])
      ctx.stroke()
      ctx.setLineDash([])
    }
    if (props.highlightRack) {
      const rack = g.racks.find((r) => r.id.toUpperCase() === props.highlightRack!.toUpperCase())
      if (rack) {
        ctx.strokeStyle = COLORS.dropoff
        ctx.lineWidth = lw(3)
        ctx.strokeRect(rack.x - 2, rack.y - 2, rack.w + 4, rack.h + 4)
      }
    }
    // граф проездов
    if (props.showGraph !== false) {
      for (const e of g.edges) {
        const a = nodes.get(e.from)
        const b = nodes.get(e.to)
        if (!a || !b) continue
        const blocked = e.blocked || props.blockedEdgeIds?.has(e.id)
        const hi = props.highlightEdgeIds?.has(e.id)
        const access = a.kind === "access" || b.kind === "access"
        if (access && !props.showAccess && !hi && !blocked) continue
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.strokeStyle = blocked ? COLORS.blocked : hi ? COLORS.edgeHi : access ? COLORS.edgeAccess : COLORS.edge
        ctx.lineWidth = lw(blocked || hi ? 4 : 1.5)
        ctx.setLineDash(blocked ? [lw(8), lw(5)] : [])
        ctx.stroke()
        ctx.setLineDash([])
        if (e.oneway) {
          const mx = (a.x + b.x) / 2
          const my = (a.y + b.y) / 2
          const ang = Math.atan2(b.y - a.y, b.x - a.x)
          ctx.beginPath()
          ctx.moveTo(mx + Math.cos(ang) * lw(7), my + Math.sin(ang) * lw(7))
          ctx.lineTo(mx + Math.cos(ang + 2.5) * lw(7), my + Math.sin(ang + 2.5) * lw(7))
          ctx.lineTo(mx + Math.cos(ang - 2.5) * lw(7), my + Math.sin(ang - 2.5) * lw(7))
          ctx.closePath()
          ctx.fillStyle = COLORS.edgeHi
          ctx.fill()
        }
      }
      if (props.highlightNodeIds || props.draggableNodes) {
        for (const n of g.nodes) {
          const hi = props.highlightNodeIds?.has(n.id)
          if (!hi && !props.draggableNodes) continue
          if (!hi && n.kind === "access" && !props.showAccess) continue
          ctx.beginPath()
          ctx.arc(n.x, n.y, lw(hi ? 7 : 3.5), 0, Math.PI * 2)
          ctx.fillStyle = hi ? COLORS.nodeHi : n.kind === "access" ? "#5fd08a" : n.kind === "junction" ? "#e07a7a" : COLORS.node
          ctx.fill()
        }
      }
    }
    const poly = (pts: Pt[], color: string, width: number) => {
      if (pts.length < 2) return
      ctx.beginPath()
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      ctx.strokeStyle = color
      ctx.lineWidth = lw(width)
      ctx.lineJoin = "round"
      ctx.lineCap = "round"
      ctx.stroke()
    }
    if (props.planned) poly(props.planned, COLORS.planned, 6)
    if (props.route) {
      poly(props.route, "rgba(0,0,0,0.55)", 12)
      poly(props.route, COLORS.route, 8)
    }
    ctx.restore()

    // экранный слой: маркеры, погрузчики, подписи (всегда «вверх»)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    for (const m of props.markers ?? []) {
      const p = toScreen(m)
      const color = m.kind === "pickup" ? COLORS.pickup : m.kind === "dropoff" ? COLORS.dropoff : m.kind === "tag" ? "#b48cff" : "#e6e6e6"
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.arc(p.x, p.y - 22, 12, Math.PI * 0.8, Math.PI * 0.2)
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill()
      ctx.strokeStyle = "#111"
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = "#111"
      ctx.font = "bold 12px system-ui, sans-serif"
      ctx.textAlign = "center"
      ctx.fillText(m.kind === "pickup" ? "↑" : m.kind === "dropoff" ? "↓" : "•", p.x, p.y - 18)
      if (m.label) {
        ctx.font = "bold 14px system-ui, sans-serif"
        const w = ctx.measureText(m.label).width + 12
        ctx.fillStyle = "rgba(10,12,14,0.85)"
        ctx.fillRect(p.x - w / 2, p.y - 58, w, 20)
        ctx.fillStyle = color
        ctx.fillText(m.label, p.x, p.y - 43)
      }
    }
    for (const f of props.forklifts ?? []) {
      const p = toScreen(f)
      const lost = f.state === "lost" || f.state === "none"
      const degraded = f.state === "degraded"
      const color = lost ? COLORS.lost : f.self ? COLORS.self : COLORS.other
      if (degraded || lost) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, lost ? 34 : 26, 0, Math.PI * 2)
        ctx.fillStyle = lost ? "rgba(138,144,151,0.18)" : "rgba(255,210,63,0.15)"
        ctx.fill()
        ctx.setLineDash([5, 4])
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.setLineDash([])
      }
      const ang = f.headingDeg != null ? (f.headingDeg * Math.PI) / 180 - view.current.rot : -Math.PI / 2
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(ang)
      ctx.globalAlpha = lost ? 0.6 : degraded ? 0.8 : 1
      ctx.beginPath()
      ctx.moveTo(16, 0)
      ctx.lineTo(-11, 11)
      ctx.lineTo(-6, 0)
      ctx.lineTo(-11, -11)
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill()
      ctx.strokeStyle = "#0b0d0f"
      ctx.lineWidth = 2.5
      ctx.stroke()
      ctx.restore()
      ctx.globalAlpha = 1
      ctx.font = "bold 13px system-ui, sans-serif"
      ctx.textAlign = "center"
      const label = `${f.label}${f.state === "manual" ? " · РУЧН." : lost ? " · ?" : ""}`
      const w = ctx.measureText(label).width + 10
      ctx.fillStyle = "rgba(10,12,14,0.85)"
      ctx.fillRect(p.x - w / 2, p.y + 18, w, 18)
      ctx.fillStyle = color
      ctx.fillText(label, p.x, p.y + 31)
    }
  })

  // жесты: перетаскивание, щипок, колесо
  const pointers = useRef(new Map<number, Pt>())
  const drag = useRef<{ nodeId: string | null; moved: boolean; start: Pt } | null>(null)
  const pinch = useRef<{ d: number; s: number } | null>(null)

  const hitTest = useCallback(
    (screen: Pt): MapHit => {
      const world = toWorld(screen)
      if (!g) return { world }
      let nodeId: string | undefined
      let best = 14
      for (const n of g.nodes) {
        if (n.kind === "access" && !props.showAccess && !props.highlightNodeIds?.has(n.id)) continue
        const p = toScreen(n)
        const d = Math.hypot(p.x - screen.x, p.y - screen.y)
        if (d < best) {
          best = d
          nodeId = n.id
        }
      }
      let edgeId: string | undefined
      if (!nodeId) {
        const nodes = new Map(g.nodes.map((n) => [n.id, n]))
        let bestE = 10
        for (const e of g.edges) {
          const a = nodes.get(e.from)
          const b = nodes.get(e.to)
          if (!a || !b) continue
          const pa = toScreen(a)
          const pb = toScreen(b)
          const dx = pb.x - pa.x
          const dy = pb.y - pa.y
          const l2 = dx * dx + dy * dy || 1
          const t = Math.max(0, Math.min(1, ((screen.x - pa.x) * dx + (screen.y - pa.y) * dy) / l2))
          const d = Math.hypot(pa.x + dx * t - screen.x, pa.y + dy * t - screen.y)
          if (d < bestE) {
            bestE = d
            edgeId = e.id
          }
        }
      }
      return { world, nodeId, edgeId }
    },
    [g, toScreen, toWorld, props.showAccess, props.highlightNodeIds]
  )

  const local = (e: React.PointerEvent | React.WheelEvent): Pt => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  return (
    <div ref={wrap} className="rt-map">
      <canvas
        ref={canvas}
        style={{ width: size.w, height: size.h, touchAction: "none" }}
        onPointerDown={(e) => {
          canvas.current?.setPointerCapture(e.pointerId)
          const p = local(e)
          pointers.current.set(e.pointerId, p)
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()]
            pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), s: view.current.s }
            drag.current = null
            return
          }
          const hit = props.draggableNodes ? hitTest(p) : null
          drag.current = { nodeId: hit?.nodeId ?? null, moved: false, start: p }
        }}
        onPointerMove={(e) => {
          if (!pointers.current.has(e.pointerId)) return
          const p = local(e)
          const prev = pointers.current.get(e.pointerId)!
          pointers.current.set(e.pointerId, p)
          if (pinch.current && pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()]
            const d = Math.hypot(a.x - b.x, a.y - b.y)
            view.current.s = Math.max(0.05, Math.min(6, (pinch.current.s * d) / Math.max(1, pinch.current.d)))
            redraw()
            return
          }
          const dr = drag.current
          if (!dr) return
          if (!dr.moved && Math.hypot(p.x - dr.start.x, p.y - dr.start.y) < 6) return
          dr.moved = true
          if (dr.nodeId && props.onDragNode) {
            props.onDragNode(dr.nodeId, toWorld(p), "move")
            return
          }
          const w0 = toWorld(prev)
          const w1 = toWorld(p)
          view.current.cx -= w1.x - w0.x
          view.current.cy -= w1.y - w0.y
          setFollow(false)
          redraw()
        }}
        onPointerUp={(e) => {
          const p = local(e)
          pointers.current.delete(e.pointerId)
          if (pointers.current.size < 2) pinch.current = null
          const dr = drag.current
          drag.current = null
          if (!dr) return
          if (dr.moved && dr.nodeId && props.onDragNode) props.onDragNode(dr.nodeId, toWorld(p), "end")
          if (!dr.moved && props.onClick) props.onClick(hitTest(p))
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId)
          drag.current = null
          pinch.current = null
        }}
        onWheel={(e) => {
          const p = local(e)
          const before = toWorld(p)
          view.current.s = Math.max(0.05, Math.min(6, view.current.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
          const after = toWorld(p)
          view.current.cx += before.x - after.x
          view.current.cy += before.y - after.y
          redraw()
        }}
      />
      {props.controls !== false && (
        <div className="rt-map-ctl">
          <button
            type="button"
            aria-label="Приблизить"
            onClick={() => {
              view.current.s = Math.min(6, view.current.s * 1.4)
              redraw()
            }}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Отдалить"
            onClick={() => {
              view.current.s = Math.max(0.05, view.current.s / 1.4)
              redraw()
            }}
          >
            −
          </button>
          {props.onOrientationChange && (
            <button
              type="button"
              aria-label={orientation === "north" ? "Повернуть по ходу движения" : "Север сверху"}
              title={orientation === "north" ? "Север сверху" : "По ходу движения"}
              onClick={() => props.onOrientationChange?.(orientation === "north" ? "heading" : "north")}
            >
              {orientation === "north" ? "N" : "⇧"}
            </button>
          )}
          {self ? (
            <button type="button" aria-label="К погрузчику" className={follow ? "on" : ""} onClick={() => center()}>
              ◎
            </button>
          ) : (
            <button type="button" aria-label="Весь склад" onClick={fit}>
              ⤢
            </button>
          )}
        </div>
      )}
    </div>
  )
})
