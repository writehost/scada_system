"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { useRouter } from "next/navigation"
import { Factory, Fingerprint, ScanBarcode, ScanEye, ShieldCheck, Warehouse } from "lucide-react"
import { cn } from "@/lib/utils"

type AppKey = "wms" | "dm" | "id" | "qpass" | "xray" | "mes"

interface AppDef {
  key: AppKey
  name: string
  /** Внутренний путь ("/…") открывается в этом же приложении, внешний ("https://…") — обычным переходом. */
  href: string
  tint: string
  Icon: typeof Warehouse
}

/**
 * DM Analyzer / ID / Qpass / Xray / MES живут отдельно от этого репозитория —
 * подставьте их реальные адреса (поддомены/URL) вместо заглушек.
 */
const APPS: AppDef[] = [
  { key: "wms", name: "WMS", href: "/", tint: "#6b7a10", Icon: Warehouse },
  { key: "dm", name: "DM Analyzer", href: "https://dm.scada25.ru", tint: "#1d7970", Icon: ScanBarcode },
  { key: "id", name: "ID", href: "https://id.scada25.ru", tint: "#4c5268", Icon: Fingerprint },
  { key: "qpass", name: "Qpass", href: "https://qpass.scada25.ru", tint: "#bd821a", Icon: ShieldCheck },
  { key: "xray", name: "Xray", href: "https://xray.scada25.ru", tint: "#3a5c8c", Icon: ScanEye },
  { key: "mes", name: "MES", href: "https://mes.scada25.ru", tint: "#66446f", Icon: Factory },
]

const STORAGE_KEY = "wms:apps-launcher:order"
const CLICK_THRESHOLD = 5

function isValidOrder(v: unknown): v is AppKey[] {
  return (
    Array.isArray(v) &&
    v.length === APPS.length &&
    APPS.every((a) => v.includes(a.key)) &&
    v.every((k) => APPS.some((a) => a.key === k))
  )
}

export function AppsLauncher() {
  const router = useRouter()
  const [order, setOrder] = useState<AppKey[]>(() => APPS.map((a) => a.key))
  const [draggingKey, setDraggingKey] = useState<AppKey | null>(null)
  const [tiltKey, setTiltKey] = useState<AppKey | null>(null)

  const tileRefs = useRef<Map<AppKey, HTMLDivElement>>(new Map())
  const iconRefs = useRef<Map<AppKey, HTMLDivElement>>(new Map())
  const rectsBefore = useRef<Map<AppKey, DOMRect> | null>(null)
  const dragInfo = useRef<{
    key: AppKey
    pointerId: number
    startX: number
    startY: number
    offX: number
    offY: number
    moved: boolean
  } | null>(null)

  // восстановить сохранённый порядок иконок (только для этого браузера)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")
      if (isValidOrder(saved)) setOrder(saved)
    } catch {
      /* приватный режим / storage недоступен — остаёмся на порядке по умолчанию */
    }
  }, [])

  const persistOrder = useCallback((next: AppKey[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }, [])

  function captureRects() {
    const map = new Map<AppKey, DOMRect>()
    tileRefs.current.forEach((el, key) => map.set(key, el.getBoundingClientRect()))
    rectsBefore.current = map
  }

  // FLIP: после каждого изменения порядка плавно доигрываем сдвиг плиток
  useLayoutEffect(() => {
    const before = rectsBefore.current
    if (!before) return
    rectsBefore.current = null
    tileRefs.current.forEach((el, key) => {
      if (key === dragInfo.current?.key) return
      const b = before.get(key)
      if (!b) return
      const a = el.getBoundingClientRect()
      const dx = b.left - a.left
      const dy = b.top - a.top
      if (dx || dy) {
        el.style.transition = "none"
        el.style.transform = `translate(${dx}px, ${dy}px)`
        requestAnimationFrame(() => {
          el.style.transition = ""
          el.style.transform = ""
        })
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order])

  function moveTo(dragKey: AppKey, targetKey: AppKey) {
    if (dragKey === targetKey) return
    captureRects()
    setOrder((prev) => {
      const next = prev.slice()
      const from = next.indexOf(dragKey)
      const to = next.indexOf(targetKey)
      if (from === -1 || to === -1) return prev
      next.splice(from, 1)
      next.splice(to, 0, dragKey)
      return next
    })
  }

  function openApp(app: AppDef) {
    if (app.href.startsWith("/")) router.push(app.href)
    else window.location.href = app.href
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>, app: AppDef) {
    if (e.button !== 0 && e.pointerType === "mouse") return
    const el = tileRefs.current.get(app.key)
    if (!el) return
    const r = el.getBoundingClientRect()
    dragInfo.current = {
      key: app.key,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offX: e.clientX - r.left,
      offY: e.clientY - r.top,
      moved: false,
    }
  }

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const info = dragInfo.current
      if (!info) return

      if (!info.moved) {
        const dx = e.clientX - info.startX
        const dy = e.clientY - info.startY
        if (Math.hypot(dx, dy) < CLICK_THRESHOLD) return
        info.moved = true
        setDraggingKey(info.key)
        setTiltKey(null)
      }

      const el = tileRefs.current.get(info.key)
      if (!el) return
      el.style.left = `${e.clientX - info.offX}px`
      el.style.top = `${e.clientY - info.offY}px`

      const under = document.elementFromPoint(e.clientX, e.clientY)
      const targetEl = under instanceof Element ? under.closest<HTMLElement>("[data-app-key]") : null
      const targetKey = targetEl?.dataset.appKey as AppKey | undefined
      if (targetKey && targetKey !== info.key) moveTo(info.key, targetKey)
    }

    function onUp() {
      const info = dragInfo.current
      if (!info) return
      dragInfo.current = null

      if (info.moved) {
        const el = tileRefs.current.get(info.key)
        if (el) {
          el.style.left = ""
          el.style.top = ""
        }
        setDraggingKey(null)
        persistOrder(order)
      } else {
        const app = APPS.find((a) => a.key === info.key)
        if (app) openApp(app)
      }
    }

    document.addEventListener("pointermove", onMove)
    document.addEventListener("pointerup", onUp)
    document.addEventListener("pointercancel", onUp)
    return () => {
      document.removeEventListener("pointermove", onMove)
      document.removeEventListener("pointerup", onUp)
      document.removeEventListener("pointercancel", onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, persistOrder])

  function handleTileMouseMove(e: ReactPointerEvent<HTMLDivElement>, key: AppKey) {
    if (dragInfo.current) return
    const icon = iconRefs.current.get(key)
    if (!icon) return
    const r = icon.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width - 0.5
    const py = (e.clientY - r.top) / r.height - 0.5
    icon.style.transform = `perspective(500px) rotateX(${-py * 16}deg) rotateY(${px * 16}deg) translateZ(3px)`
    const app = APPS.find((a) => a.key === key)
    if (app) {
      const [r1, g1, b1] = hexToRgb(app.tint)
      icon.style.filter = `drop-shadow(${px * 12}px ${py * 12 + 10}px 14px rgba(${r1},${g1},${b1},.38))`
    }
    setTiltKey(key)
  }

  function handleTileMouseLeave(key: AppKey) {
    if (dragInfo.current) return
    const icon = iconRefs.current.get(key)
    if (icon) {
      icon.style.transform = ""
      icon.style.filter = ""
    }
    if (tiltKey === key) setTiltKey(null)
  }

  const orderedApps = order.map((key) => APPS.find((a) => a.key === key)!).filter(Boolean)

  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute left-1/2 top-[30%] -z-10 h-[480px] w-[820px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
        style={{ background: "radial-gradient(ellipse at center, color-mix(in oklch, var(--ring) 7%, transparent) 0%, transparent 70%)" }}
        aria-hidden
      />
      <div className="mb-6">
        <h1 className="text-lg font-bold tracking-tight">Приложения</h1>
        <p className="text-sm text-muted-foreground">Системы завода в одном месте. Иконки можно перетаскивать.</p>
      </div>

      <div className="grid grid-cols-2 gap-x-9 gap-y-14 sm:grid-cols-3">
        {orderedApps.map((app) => {
          const isDragging = draggingKey === app.key
          const isTilting = tiltKey === app.key && !draggingKey
          const style: CSSProperties = isDragging
            ? { position: "fixed", zIndex: 50, cursor: "grabbing", touchAction: "none" }
            : { touchAction: "none" }
          return (
            <div
              key={app.key}
              data-app-key={app.key}
              ref={(el) => {
                if (el) tileRefs.current.set(app.key, el)
                else tileRefs.current.delete(app.key)
              }}
              onPointerDown={(e) => handlePointerDown(e, app)}
              onPointerMove={(e) => handleTileMouseMove(e, app.key)}
              onPointerLeave={() => handleTileMouseLeave(app.key)}
              className={cn(
                "flex select-none flex-col items-center gap-4 rounded-2xl p-1.5 transition-transform duration-200 ease-out",
                "hover:-translate-y-1.5 focus-visible:-translate-y-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                isDragging ? "cursor-grabbing opacity-95" : "cursor-grab"
              )}
              style={style}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  openApp(app)
                }
              }}
            >
              <div
                ref={(el) => {
                  if (el) iconRefs.current.set(app.key, el)
                  else iconRefs.current.delete(app.key)
                }}
                className="relative grid h-[72px] w-[72px] place-items-center rounded-[21px] text-white transition-[box-shadow] duration-200"
                style={{
                  background: `linear-gradient(155deg, color-mix(in srgb, ${app.tint} 82%, white 22%) 0%, ${app.tint} 46%, color-mix(in srgb, ${app.tint} 88%, black 22%) 100%)`,
                  boxShadow: isDragging
                    ? `inset 0 1.5px 0 rgba(255,255,255,.75), inset 0 -8px 12px -8px rgba(0,0,0,.16), 0 10px 18px -6px color-mix(in srgb, ${app.tint} 38%, transparent), 0 34px 46px -16px color-mix(in srgb, ${app.tint} 46%, transparent)`
                    : isTilting
                      ? `inset 0 1.5px 0 rgba(255,255,255,.75), inset 0 -8px 12px -8px rgba(0,0,0,.16), 0 1px 2px rgba(20,18,8,.08), 0 6px 12px -6px color-mix(in srgb, ${app.tint} 30%, transparent), 0 20px 30px -14px color-mix(in srgb, ${app.tint} 36%, transparent)`
                      : `inset 0 1.5px 0 rgba(255,255,255,.75), inset 0 -8px 12px -8px rgba(0,0,0,.16), 0 1px 2px rgba(20,18,8,.08), 0 3px 8px -4px color-mix(in srgb, ${app.tint} 24%, transparent), 0 14px 22px -12px color-mix(in srgb, ${app.tint} 30%, transparent)`,
                  transform: isDragging ? "scale(1.1)" : undefined,
                }}
              >
                <span className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-br from-white/35 via-white/0 to-transparent" />
                <app.Icon className="relative h-7 w-7" strokeWidth={1.7} style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,.15))" }} />
              </div>
              <div className="text-[13.5px] font-bold tracking-tight">{app.name}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [120, 120, 120]
}
