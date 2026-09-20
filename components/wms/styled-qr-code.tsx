"use client"

import { useEffect, useId, useMemo, useState, type ReactNode } from "react"
import {
  BarcodeFormat,
  EncodeHintType,
  QRCodeDecoderErrorCorrectionLevel,
  QRCodeWriter,
} from "@zxing/library"
import { cn } from "@/lib/utils"
import {
  QR_VISUAL_STYLE_EVENT,
  getQrVisualLogo,
  getQrVisualPreset,
  readQrVisualLogoId,
  readQrVisualStyleId,
  type QrVisualLogoId,
  type QrVisualPreset,
  type QrVisualStyleId,
} from "@/lib/qr-visual-style"

function encodeQrMatrix(data: string, highEc: boolean): boolean[][] {
  const writer = new QRCodeWriter()
  const hints = new Map()
  hints.set(EncodeHintType.CHARACTER_SET, "UTF-8")
  hints.set(
    EncodeHintType.ERROR_CORRECTION,
    highEc ? QRCodeDecoderErrorCorrectionLevel.H : QRCodeDecoderErrorCorrectionLevel.M
  )
  hints.set(EncodeHintType.MARGIN, 1)
  const bm = writer.encode(data.trim() || " ", BarcodeFormat.QR_CODE, 0, 0, hints)
  const n = bm.getWidth()
  const rows: boolean[][] = []
  for (let y = 0; y < n; y++) {
    const row: boolean[] = []
    for (let x = 0; x < n; x++) row.push(bm.get(x, y))
    rows.push(row)
  }
  return rows
}

function inFinder(x: number, y: number, n: number): boolean {
  const inBox = (ox: number, oy: number) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7
  return inBox(0, 0) || inBox(n - 7, 0) || inBox(0, n - 7)
}

function inLogoHole(x: number, y: number, n: number, enabled: boolean): boolean {
  if (!enabled) return false
  const cx = (n - 1) / 2
  const cy = (n - 1) / 2
  return Math.hypot(x - cx, y - cy) < n * 0.2
}

function pieceRoundedPath(
  ox: number,
  oy: number,
  size: number,
  radii: [number, number, number, number],
  cut: boolean,
  glued: boolean,
  liquidAdj: boolean,
  matrix: boolean[][],
  mx: number,
  my: number
): string {
  let [tl, tr, br, bl] = radii.map((f) => Math.max(0, Math.min(size / 2, f * size)))
  if (glued) {
    if (matrix[my]?.[mx - 1]) {
      tl = 0
      bl = 0
    }
    if (matrix[my - 1]?.[mx]) {
      tl = 0
      tr = 0
    }
    if (matrix[my]?.[mx + 1]) {
      tr = 0
      br = 0
    }
    if (matrix[my + 1]?.[mx]) {
      bl = 0
      br = 0
    }
  }
  if (liquidAdj) {
    if (matrix[my - 1]?.[mx - 1]) tl = 0
    if (matrix[my - 1]?.[mx + 1]) tr = 0
    if (matrix[my + 1]?.[mx + 1]) br = 0
    if (matrix[my + 1]?.[mx - 1]) bl = 0
  }
  const arc = (r: number, x: number, y: number) => (cut ? `L ${x} ${y}` : `A ${r} ${r} 0 0 1 ${x} ${y}`)
  return [
    `M ${ox} ${oy + tl}`,
    arc(tl, ox + tl, oy),
    `L ${ox + size - tr} ${oy}`,
    arc(tr, ox + size, oy + tr),
    `L ${ox + size} ${oy + size - br}`,
    arc(br, ox + size - br, oy + size),
    `L ${ox + bl} ${oy + size}`,
    arc(bl, ox, oy + size - bl),
    "Z",
  ].join(" ")
}

function noiseFill(x: number, y: number, tint: boolean): string {
  const c = (x * 73 + y * 37) % 120
  if (tint) return `rgb(${c},${c + 50},${c + 100})`
  return `rgb(${c},${c},${c})`
}

function QrLogoMark({ id, size }: { id: Exclude<QrVisualLogoId, "none">; size: number }) {
  const s = size
  if (id === "stickers") {
    return (
      <g>
        <rect x={s * 0.12} y={s * 0.18} width={s * 0.76} height={s * 0.64} rx={s * 0.08} fill="#e11d48" />
        <polygon points={`${s * 0.62},${s * 0.18} ${s * 0.88},${s * 0.18} ${s * 0.88},${s * 0.44}`} fill="#fb7185" />
        <rect x={s * 0.22} y={s * 0.34} width={s * 0.56} height={s * 0.08} rx={s * 0.02} fill="#fff" />
        <rect x={s * 0.22} y={s * 0.48} width={s * 0.4} height={s * 0.08} rx={s * 0.02} fill="#fff" />
        <rect x={s * 0.22} y={s * 0.62} width={s * 0.48} height={s * 0.08} rx={s * 0.02} fill="#fff" />
      </g>
    )
  }
  if (id === "water") {
    return (
      <path
        d={`M ${s / 2} ${s * 0.12} C ${s * 0.78} ${s * 0.42}, ${s * 0.82} ${s * 0.62}, ${s / 2} ${s * 0.86}
            C ${s * 0.18} ${s * 0.62}, ${s * 0.22} ${s * 0.42}, ${s / 2} ${s * 0.12} Z`}
        fill="#0284c7"
      />
    )
  }
  if (id === "materials") {
    return (
      <g fill="#1d4ed8">
        <rect x={s * 0.18} y={s * 0.42} width={s * 0.64} height={s * 0.4} rx={s * 0.06} />
        <rect x={s * 0.28} y={s * 0.22} width={s * 0.44} height={s * 0.28} rx={s * 0.05} fill="#3b82f6" />
      </g>
    )
  }
  if (id === "gp") {
    return (
      <g fill="#15803d">
        <rect x={s * 0.2} y={s * 0.38} width={s * 0.6} height={s * 0.46} rx={s * 0.06} />
        <path d={`M ${s * 0.2} ${s * 0.46} L ${s / 2} ${s * 0.22} L ${s * 0.8} ${s * 0.46} Z`} fill="#22c55e" />
      </g>
    )
  }
  if (id === "scada") {
    return (
      <g>
        <rect width={s} height={s} rx={s * 0.16} fill="#111111" />
        <rect
          x={s * 0.16}
          y={s * 0.16}
          width={s * 0.68}
          height={s * 0.68}
          rx={s * 0.08}
          fill="none"
          stroke="#c8e84a"
          strokeWidth={s * 0.07}
        />
        <path
          d={`M ${s * 0.28} ${s * 0.34} H ${s * 0.52} L ${s * 0.68} ${s * 0.5} V ${s * 0.68}
              H ${s * 0.48} L ${s * 0.4} ${s * 0.6} H ${s * 0.28} Z`}
          fill="#c8e84a"
        />
      </g>
    )
  }
  return (
    <g fill="#171717">
      <path d={`M ${s * 0.18} ${s * 0.82} L ${s * 0.5} ${s * 0.18} L ${s * 0.42} ${s * 0.18} L ${s * 0.12} ${s * 0.82} Z`} />
      <path d={`M ${s * 0.38} ${s * 0.82} L ${s * 0.88} ${s * 0.82} L ${s * 0.62} ${s * 0.38} L ${s * 0.52} ${s * 0.54} L ${s * 0.62} ${s * 0.7} H ${s * 0.48} Z`} />
    </g>
  )
}

function FinderEyes({
  n,
  pad,
  cell,
  fill,
  rounded,
  circle,
}: {
  n: number
  pad: number
  cell: number
  fill: string
  rounded: boolean
  circle?: boolean
}) {
  const origins = [
    { x: 0, y: 0 },
    { x: n - 7, y: 0 },
    { x: 0, y: n - 7 },
  ]
  return (
    <g>
      {origins.map((o, i) => {
        const x = pad + o.x * cell
        const y = pad + o.y * cell
        const outer = cell * 7
        const inner = cell * 5
        const core = cell * 3
        const cx = x + outer / 2
        const cy = y + outer / 2
        if (circle) {
          return (
            <g key={i} fill={fill} fillRule="evenodd">
              <circle cx={cx} cy={cy} r={outer / 2} />
              <circle cx={cx} cy={cy} r={inner / 2} fill="#ffffff" />
              <circle cx={cx} cy={cy} r={core / 2} fill={fill} />
            </g>
          )
        }
        const rx = rounded ? outer * 0.28 : 0
        const irx = rounded ? inner * 0.32 : 0
        return (
          <g key={i}>
            <rect x={x} y={y} width={outer} height={outer} rx={rx} fill={fill} />
            <rect
              x={x + cell}
              y={y + cell}
              width={inner}
              height={inner}
              rx={irx}
              fill="#ffffff"
            />
            <rect
              x={x + cell * 2}
              y={y + cell * 2}
              width={core}
              height={core}
              rx={rounded ? core * 0.45 : 0}
              fill={fill}
            />
          </g>
        )
      })}
    </g>
  )
}

type Props = {
  data: string
  size?: number
  styleId?: QrVisualStyleId
  logoId?: QrVisualLogoId
  className?: string
  "aria-label"?: string
}

export function StyledQrCode({
  data,
  size = 220,
  styleId,
  logoId,
  className,
  "aria-label": ariaLabel,
}: Props) {
  const gradId = useId().replace(/:/g, "")
  const [storedStyle, setStoredStyle] = useState<QrVisualStyleId>("classic")
  const [storedLogo, setStoredLogo] = useState<QrVisualLogoId>("none")

  useEffect(() => {
    setStoredStyle(readQrVisualStyleId())
    setStoredLogo(readQrVisualLogoId())
    const onChange = () => {
      setStoredStyle(readQrVisualStyleId())
      setStoredLogo(readQrVisualLogoId())
    }
    window.addEventListener(QR_VISUAL_STYLE_EVENT, onChange)
    window.addEventListener("storage", onChange)
    return () => {
      window.removeEventListener(QR_VISUAL_STYLE_EVENT, onChange)
      window.removeEventListener("storage", onChange)
    }
  }, [])

  const preset = getQrVisualPreset(styleId ?? storedStyle)
  const logo = getQrVisualLogo(logoId ?? storedLogo)
  const hasLogo = logo.id !== "none"
  const matrix = useMemo(() => {
    try {
      return encodeQrMatrix(data, hasLogo)
    } catch {
      return []
    }
  }, [data, hasLogo])

  if (matrix.length === 0) {
    return <p className="text-center text-xs text-destructive">Не удалось построить QR</p>
  }

  const frame = logo.stickerFrame
  const canvas = frame ? size * 0.82 : size
  const offset = frame ? (size - canvas) / 2 : 0
  const fill = preset.gradientTo ? `url(#${gradId})` : preset.color

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label={ariaLabel ?? `QR ${data}`}
      className={cn("mx-auto h-auto w-full bg-white", className)}
    >
      <rect width={size} height={size} fill={frame ? "#f8fafc" : "#ffffff"} />
      {frame ? (
        <g>
          <rect
            x={size * 0.04}
            y={size * 0.04}
            width={size * 0.92}
            height={size * 0.92}
            rx={size * 0.12}
            fill="#ffffff"
            stroke="#e11d48"
            strokeWidth={size * 0.018}
          />
          <rect
            x={size * 0.07}
            y={size * 0.07}
            width={size * 0.86}
            height={size * 0.86}
            rx={size * 0.1}
            fill="none"
            stroke="#fb7185"
            strokeWidth={size * 0.008}
            strokeDasharray={`${size * 0.03} ${size * 0.02}`}
          />
          <rect x={size * 0.28} y={size * 0.015} width={size * 0.44} height={size * 0.07} rx={size * 0.02} fill="#e11d48" />
          <text
            x={size / 2}
            y={size * 0.066}
            textAnchor="middle"
            fontSize={size * 0.038}
            fontFamily="Arial, sans-serif"
            fontWeight={700}
            fill="#ffffff"
          >
            СТИКЕР
          </text>
        </g>
      ) : null}
      <g transform={`translate(${offset}, ${offset})`}>
        <rect width={canvas} height={canvas} fill="#ffffff" />
        {preset.gradientTo ? (
          <defs>
            {preset.radial ? (
              <radialGradient id={gradId} cx="50%" cy="50%" r="75%">
                <stop offset="0%" stopColor={preset.gradientTo} />
                <stop offset="100%" stopColor={preset.color} />
              </radialGradient>
            ) : (
              <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={preset.color} />
                <stop offset="100%" stopColor={preset.gradientTo} />
              </linearGradient>
            )}
          </defs>
        ) : null}
        <QrPieces
          matrix={matrix}
          size={canvas}
          preset={preset}
          fill={fill}
          hideFinders={Boolean(preset.roundedEyes || preset.circleEyes)}
          hideLogo={hasLogo}
        />
        {preset.roundedEyes || preset.circleEyes ? (
          <FinderEyes
            n={matrix.length}
            pad={canvas * 0.06}
            cell={(canvas - canvas * 0.12) / matrix.length}
            fill={fill}
            rounded={Boolean(preset.roundedEyes)}
            circle={Boolean(preset.circleEyes)}
          />
        ) : null}
        {hasLogo && logo.id !== "none" ? (
          <g>
            {(() => {
              const logoSize = canvas * 0.26
              const lx = (canvas - logoSize) / 2
              const ly = (canvas - logoSize) / 2
              return (
                <>
                  {logo.id === "scada" ? null : (
                    <rect
                      x={lx}
                      y={ly}
                      width={logoSize}
                      height={logoSize}
                      rx={logoSize * 0.22}
                      fill="#ffffff"
                    />
                  )}
                  <g transform={`translate(${lx}, ${ly})`}>
                    <QrLogoMark id={logo.id} size={logoSize} />
                  </g>
                </>
              )
            })()}
          </g>
        ) : null}
      </g>
    </svg>
  )
}

function QrPieces({
  matrix,
  size,
  preset,
  fill,
  hideFinders,
  hideLogo,
}: {
  matrix: boolean[][]
  size: number
  preset: QrVisualPreset
  fill: string
  hideFinders: boolean
  hideLogo: boolean
}) {
  const n = matrix.length
  const pad = size * 0.06
  const cell = (size - pad * 2) / n
  const [sx, sy] = preset.scale
  const nodes: ReactNode[] = []
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (hideFinders && inFinder(x, y, n)) continue
      if (inLogoHole(x, y, n, hideLogo)) continue
      const px = pad + x * cell
      const py = pad + y * cell
      if (matrix[y][x]) {
        const w = cell * sx
        const h = cell * sy
        const ox = px + (cell - w) / 2
        const oy = py + (cell - h) / 2
        const d = pieceRoundedPath(
          ox,
          oy,
          w,
          preset.radii,
          preset.cut,
          preset.glued,
          preset.liquid,
          matrix,
          x,
          y
        )
        const moduleFill = preset.noise ? noiseFill(x, y, Boolean(preset.circleEyes)) : fill
        if (Math.abs(w - h) > 0.2) {
          nodes.push(
            <rect
              key={`${x}-${y}`}
              x={ox}
              y={oy}
              width={w}
              height={h}
              rx={Math.min(w, h) * (preset.radii[0] || 0)}
              fill={moduleFill}
            />
          )
        } else {
          nodes.push(<path key={`${x}-${y}`} d={d} fill={moduleFill} />)
        }
        continue
      }
      if (!preset.liquid) continue
      const r = cell * 0.5
      const cx = px + cell / 2
      const cy = py + cell / 2
      const blob = `M ${px} ${py} L ${px + r} ${py} A ${r} ${r} 0 0 0 ${px} ${py + r} Z`
      if (matrix[y]?.[x - 1] && matrix[y - 1]?.[x]) {
        nodes.push(<path key={`${x}-${y}-tl`} d={blob} fill={fill} />)
      }
      if (matrix[y]?.[x - 1] && matrix[y + 1]?.[x]) {
        nodes.push(
          <path key={`${x}-${y}-bl`} d={blob} fill={fill} transform={`rotate(-90 ${cx} ${cy})`} />
        )
      }
      if (matrix[y]?.[x + 1] && matrix[y - 1]?.[x]) {
        nodes.push(
          <path key={`${x}-${y}-tr`} d={blob} fill={fill} transform={`rotate(90 ${cx} ${cy})`} />
        )
      }
      if (matrix[y]?.[x + 1] && matrix[y + 1]?.[x]) {
        nodes.push(
          <path key={`${x}-${y}-br`} d={blob} fill={fill} transform={`rotate(180 ${cx} ${cy})`} />
        )
      }
    }
  }
  return <g>{nodes}</g>
}
