"use client"

import { useEffect, useRef, useState } from "react"

export function QrCodeSvg({
  value,
  size = 176,
  className,
  label = "QR-код",
}: {
  value: string
  size?: number
  className?: string
  label?: string
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const host = hostRef.current
    if (!host || !value) return

    async function render() {
      try {
        const mod = await import("@zxing/browser")
        if (cancelled || !host) return
        host.innerHTML = ""
        const writer = new mod.BrowserQRCodeSvgWriter()
        const svg = writer.write(value, size, size)
        svg.setAttribute("width", String(size))
        svg.setAttribute("height", String(size))
        svg.setAttribute("shape-rendering", "crispEdges")
        host.appendChild(svg)
        setFailed(false)
      } catch {
        if (!cancelled) setFailed(true)
      }
    }
    void render()
    return () => {
      cancelled = true
    }
  }, [value, size])

  if (failed) {
    return (
      <div
        className={className}
        style={{ width: size, height: size }}
        aria-hidden
      >
        <div className="flex h-full w-full items-center justify-center rounded-lg border border-dashed border-border p-2 text-center text-[11px] text-muted-foreground">
          {value}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
    />
  )
}
