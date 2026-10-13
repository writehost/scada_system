"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import type { Integration, ProductKey } from "@/lib/products"
import { ProductGlyph, ProductIcon } from "./brand"

export type MapProduct = {
  key: ProductKey
  name: string
  short: string
  tagline: string
  status: string
  statusLabel: string
  color: string
  onColor: string
  requestable: boolean
}

type Pt = { x: number; y: number }

/** Композиция подобрана вручную: WMS — операционный центр, SCADA ID — общий слой входа. */
const DESKTOP: Record<ProductKey, Pt> = {
  id: { x: 330, y: 300 },
  wms: { x: 175, y: 205 },
  aps: { x: 92, y: 82 },
  yms: { x: 72, y: 350 },
  mobile: { x: 190, y: 482 },
  gsmt: { x: 350, y: 498 },
  qpass: { x: 502, y: 128 },
  ems: { x: 582, y: 300 },
  xray: { x: 522, y: 462 },
}

function curve(a: Pt, b: Pt, hub: Pt): string {
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  let nx = -dy / len
  let ny = dx / len
  // изгиб — от центра, чтобы линии не наезжали на хаб
  if ((mx + nx - hub.x) ** 2 + (my + ny - hub.y) ** 2 < (mx - hub.x) ** 2 + (my - hub.y) ** 2) {
    nx = -nx
    ny = -ny
  }
  const k = Math.min(36, len * 0.12)
  return `M${a.x} ${a.y} Q${(mx + nx * k).toFixed(1)} ${(my + ny * k).toFixed(1)} ${b.x} ${b.y}`
}

function useMotionAllowed() {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const on = () => setOk(!mq.matches)
    on()
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])
  return ok
}

export function EcosystemMap({ products, integrations }: { products: MapProduct[]; integrations: Integration[] }) {
  const byKey = useMemo(() => new Map(products.map((p) => [p.key, p])), [products])
  const [hover, setHover] = useState<ProductKey | null>(null)
  const [selected, setSelected] = useState<ProductKey | null>(null)
  const motion = useMotionAllowed()
  const svgRef = useRef<SVGSVGElement>(null)
  const active = hover || selected
  const hub = DESKTOP.id

  // Анимации стоят на паузе, когда карта вне экрана.
  useEffect(() => {
    const el = svgRef.current
    if (!el || !("IntersectionObserver" in window)) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) el.unpauseAnimations?.()
      else el.pauseAnimations?.()
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const links = integrations
    .filter((l) => byKey.has(l.a) && byKey.has(l.b))
    .map((l, i) => ({ ...l, id: `lk-${l.a}-${l.b}`, d: curve(DESKTOP[l.a], DESKTOP[l.b], hub), i }))

  const linked = (k: ProductKey) =>
    !active || k === active || links.some((l) => (l.a === active && l.b === k) || (l.b === active && l.a === k))

  const pick = (k: ProductKey) => setSelected((cur) => (cur === k ? null : k))
  const sel = selected ? byKey.get(selected) : null
  const selLinks = selected ? integrations.filter((l) => l.a === selected || l.b === selected) : []

  return (
    <div className="relative">
      {/* Десктоп и планшет: полная схема с потоками данных */}
      <svg
        ref={svgRef}
        viewBox="0 0 660 580"
        className="hidden h-auto w-full select-none sm:block"
        role="group"
        aria-label="Схема экосистемы SCADA SYSTEM: продукты и связи между ними"
      >
        <defs>
          <radialGradient id="hub-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#2f74ff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#2f74ff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="hub-fill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#5a8dff" />
            <stop offset="1" stopColor="#123fa3" />
          </linearGradient>
        </defs>

        <circle cx={hub.x} cy={hub.y} r="150" fill="url(#hub-glow)" opacity="0.6" />
        <circle cx={hub.x} cy={hub.y} r="180" fill="none" stroke="#9fe1ff" strokeOpacity="0.07" />
        <circle cx={hub.x} cy={hub.y} r="268" fill="none" stroke="#9fe1ff" strokeOpacity="0.05" />
        <g style={{ transformOrigin: `${hub.x}px ${hub.y}px` }} className="animate-orbit">
          <circle cx={hub.x} cy={hub.y} r="84" fill="none" stroke="#6fd0ff" strokeOpacity="0.35" strokeDasharray="2 10" strokeLinecap="round" />
        </g>

        {links.map((l) => {
          const on = active && (l.a === active || l.b === active)
          const live = l.state === "live"
          return (
            <g key={l.id}>
              <path
                id={l.id}
                d={l.d}
                fill="none"
                stroke={live ? "#6fd0ff" : "#c7d6f0"}
                strokeOpacity={active ? (on ? 0.95 : 0.08) : live ? 0.42 : 0.2}
                strokeWidth={on ? 2.2 : 1.4}
                strokeDasharray={live ? undefined : "3 7"}
                strokeLinecap="round"
                style={{ transition: "stroke-opacity .25s, stroke-width .25s" }}
              />
              {live && motion && (
                <g opacity={active && !on ? 0.1 : 1} style={{ transition: "opacity .25s" }}>
                  {[0, 1].map((dir) => (
                    <g key={dir}>
                      <circle r="5" fill="#6fd0ff" opacity="0.22">
                        <animateMotion
                          dur={`${3.4 + (l.i % 3) * 0.7}s`}
                          begin={`-${((l.i * 0.53 + dir * 1.7) % 3).toFixed(2)}s`}
                          repeatCount="indefinite"
                          keyPoints={dir ? "1;0" : "0;1"}
                          keyTimes="0;1"
                          calcMode="linear"
                        >
                          <mpath href={`#${l.id}`} />
                        </animateMotion>
                      </circle>
                      <circle r="2.2" fill="#e6f7ff">
                        <animateMotion
                          dur={`${3.4 + (l.i % 3) * 0.7}s`}
                          begin={`-${((l.i * 0.53 + dir * 1.7) % 3).toFixed(2)}s`}
                          repeatCount="indefinite"
                          keyPoints={dir ? "1;0" : "0;1"}
                          keyTimes="0;1"
                          calcMode="linear"
                        >
                          <mpath href={`#${l.id}`} />
                        </animateMotion>
                      </circle>
                    </g>
                  ))}
                </g>
              )}
            </g>
          )
        })}

        {products.map((p) => {
          const pt = DESKTOP[p.key]
          const isHub = p.key === "id"
          const size = isHub ? 76 : 54
          const dim = !linked(p.key)
          const isActive = active === p.key
          const dev = p.status === "development"
          return (
            <g
              key={p.key}
              transform={`translate(${pt.x} ${pt.y})`}
              role="button"
              tabIndex={0}
              aria-label={`${p.name}: ${p.tagline}. ${p.statusLabel}`}
              aria-pressed={selected === p.key}
              className="cursor-pointer outline-none"
              style={{ opacity: dim ? 0.32 : dev && !isActive ? 0.72 : 1, transition: "opacity .25s" }}
              onMouseEnter={() => setHover(p.key)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(p.key)}
              onBlur={() => setHover(null)}
              onClick={() => pick(p.key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  pick(p.key)
                }
              }}
            >
              <circle r={size * 0.78} fill={p.color} opacity={isActive ? 0.22 : 0} style={{ transition: "opacity .25s" }} />
              <rect
                x={-size / 2}
                y={-size / 2}
                width={size}
                height={size}
                rx={isHub ? 24 : 16}
                fill={isHub ? "url(#hub-fill)" : p.color}
                stroke={isActive ? "#ffffff" : "rgb(255 255 255 / .22)"}
                strokeWidth={isActive ? 2 : 1}
                strokeDasharray={dev ? "4 4" : undefined}
              />
              <rect x={-size / 2} y={-size / 2} width={size} height={size / 2} rx={isHub ? 24 : 16} fill="#fff" opacity="0.08" />
              <g
                transform={`translate(${-size * 0.26} ${-size * 0.26})`}
                color={isHub ? "#ffffff" : p.onColor}
              >
                <ProductGlyph k={p.key} size={Math.round(size * 0.52)} />
              </g>
              <text
                y={size / 2 + 20}
                textAnchor="middle"
                className="fill-white text-[13px] font-bold"
                style={{ letterSpacing: "0.02em" }}
              >
                {isHub ? "SCADA ID" : p.short}
              </text>
              {dev && (
                <text y={size / 2 + 35} textAnchor="middle" className="fill-[#ffcf8a] text-[10px] font-semibold">
                  в разработке
                </text>
              )}
              {p.status === "pilot" && (
                <text y={size / 2 + 35} textAnchor="middle" className="fill-ice-300 text-[10px] font-semibold">
                  пилот
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* Телефоны: упрощённое кольцо без анимации потоков */}
      <CompactMap products={products} selected={selected} onPick={pick} />

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/60 sm:absolute sm:bottom-1 sm:left-1 sm:mt-0">
        <span className="inline-flex items-center gap-2">
          <svg width="26" height="6" aria-hidden="true"><path d="M1 3h24" stroke="#6fd0ff" strokeWidth="2" strokeLinecap="round" /></svg>
          действующая интеграция
        </span>
        <span className="inline-flex items-center gap-2">
          <svg width="26" height="6" aria-hidden="true"><path d="M1 3h24" stroke="#c7d6f0" strokeOpacity=".6" strokeWidth="2" strokeDasharray="3 5" strokeLinecap="round" /></svg>
          в планах
        </span>
      </div>

      {sel && (
        <div
          className="glass relative z-10 mt-4 rounded-2xl p-5 text-white shadow-2xl sm:absolute sm:bottom-10 sm:right-0 sm:mt-0 sm:w-full sm:max-w-sm"
          role="dialog"
          aria-label={sel.name}
        >
          <div className="flex items-start gap-3">
            <ProductIcon k={sel.key} color={sel.color} onColor={sel.onColor} size={44} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold">{sel.name}</h3>
                <span className="chip bg-white/10 text-white/80">{sel.statusLabel}</span>
              </div>
              <p className="mt-1 text-sm text-white/70">{sel.tagline}</p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="-mr-1 -mt-1 rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
              aria-label="Закрыть"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
          {selLinks.length > 0 && (
            <ul className="mt-4 space-y-1.5 text-[13px]">
              {selLinks.map((l) => (
                <li key={`${l.a}-${l.b}`} className="flex items-center gap-2 text-white/75">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${l.state === "live" ? "bg-ice-400" : "bg-white/30"}`} />
                  {l.label}
                  {l.state === "planned" && <span className="text-white/40">· в планах</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={`/products/${sel.key}`} className="btn btn-sm btn-ghost-dark">
              Подробнее
            </Link>
            {sel.requestable && (
              <Link href={`/request?modules=${sel.key}`} className="btn btn-sm btn-primary">
                Запросить доступ
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CompactMap({
  products,
  selected,
  onPick,
}: {
  products: MapProduct[]
  selected: ProductKey | null
  onPick: (k: ProductKey) => void
}) {
  const hub = products.find((p) => p.key === "id")
  const ring = products.filter((p) => p.key !== "id")
  const R = 120
  const C = 170
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[340px] sm:hidden" role="group" aria-label="Продукты экосистемы">
      <svg viewBox="0 0 340 340" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <circle cx={C} cy={C} r={R} fill="none" stroke="#9fe1ff" strokeOpacity="0.12" />
        {ring.map((p, i) => {
          const a = (i / ring.length) * Math.PI * 2 - Math.PI / 2
          return (
            <line
              key={p.key}
              x1={C}
              y1={C}
              x2={C + R * Math.cos(a)}
              y2={C + R * Math.sin(a)}
              stroke="#6fd0ff"
              strokeOpacity={p.status === "development" ? 0.12 : 0.28}
              strokeDasharray={p.status === "development" ? "3 6" : undefined}
            />
          )
        })}
      </svg>
      {hub && (
        <button
          type="button"
          onClick={() => onPick("id")}
          aria-pressed={selected === "id"}
          className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-[22px] bg-gradient-to-br from-brand-400 to-brand-800 text-white ring-1 ring-white/25">
            <ProductGlyph k="id" size={32} />
          </span>
          <span className="text-xs font-bold text-white">SCADA ID</span>
        </button>
      )}
      {ring.map((p, i) => {
        const a = (i / ring.length) * Math.PI * 2 - Math.PI / 2
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onPick(p.key)}
            aria-pressed={selected === p.key}
            aria-label={`${p.name}. ${p.statusLabel}`}
            className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 ${p.status === "development" ? "opacity-70" : ""}`}
            style={{ left: `${((C + R * Math.cos(a)) / 340) * 100}%`, top: `${((C + R * Math.sin(a)) / 340) * 100}%` }}
          >
            <ProductIcon k={p.key} color={p.color} onColor={p.onColor} size={44} className={selected === p.key ? "ring-2 ring-white" : ""} />
            <span className="text-[11px] font-bold text-white/90">{p.short}</span>
          </button>
        )
      })}
    </div>
  )
}
