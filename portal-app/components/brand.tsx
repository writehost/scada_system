import type { ProductKey } from "@/lib/products"

/**
 * Утверждённого логотипа SCADA SYSTEM в репозитории нет (logowmsscada.png —
 * логотип WMS площадки). Это нейтральный словесный знак: узел-хаб с
 * подключёнными модулями. Заменяется одним файлом.
 */
export function BrandMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect x="0.5" y="0.5" width="31" height="31" rx="9" fill="#1f6bff" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="9" fill="url(#bm-g)" opacity="0.55" />
      <g stroke="#dff3ff" strokeWidth="1.6" strokeLinecap="round" opacity="0.9">
        <path d="M16 16 L8.5 9.5 M16 16 L23.5 9.5 M16 16 L8.5 22.5 M16 16 L23.5 22.5" />
      </g>
      <circle cx="16" cy="16" r="4.2" fill="#fff" />
      <circle cx="8.5" cy="9.5" r="2.3" fill="#9fe1ff" />
      <circle cx="23.5" cy="9.5" r="2.3" fill="#fff" />
      <circle cx="8.5" cy="22.5" r="2.3" fill="#fff" />
      <circle cx="23.5" cy="22.5" r="2.3" fill="#9fe1ff" />
      <defs>
        <linearGradient id="bm-g" x1="0" y1="0" x2="32" y2="32">
          <stop offset="0" stopColor="#6fd0ff" />
          <stop offset="1" stopColor="#123fa3" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function BrandLogo({ tone = "dark", className = "" }: { tone?: "dark" | "light"; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <BrandMark />
      <span
        className={`text-[15px] font-extrabold tracking-[0.16em] ${tone === "light" ? "text-white" : "text-ink"}`}
      >
        SCADA<span className={tone === "light" ? "text-ice-300" : "text-brand-600"}> SYSTEM</span>
      </span>
    </span>
  )
}

/** Глифы продуктов: 24×24, обводка. Нарисованы под этот портал. */
const GLYPHS: Record<ProductKey, React.ReactNode> = {
  wms: (
    <>
      <path d="M3 9.5 12 4l9 5.5V20H3z" />
      <path d="M6.5 20v-7.5h11V20M6.5 16.2h11" />
      <path d="M9 12.5v3.7M14.8 16.2V20" />
    </>
  ),
  yms: (
    <>
      <path d="M2.8 7h10.4v9.6H2.8zM13.2 10h4.3l3.3 3.4v3.2h-7.6" />
      <circle cx="7" cy="17.6" r="1.8" />
      <circle cx="17" cy="17.6" r="1.8" />
    </>
  ),
  ems: (
    <>
      <path d="M13.2 2.8 5.6 13.2h5.6l-1 8 7.8-10.6h-5.7z" />
    </>
  ),
  qpass: (
    <>
      <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
      <path d="M8 8h3v3H8zM13 13h3v3h-3zM13 8h3M8 13v3" />
    </>
  ),
  aps: (
    <>
      <path d="M3.5 5v15h17" />
      <path d="M7 8.5h6M10 12.5h7M8.5 16.5h5" strokeWidth="2.6" />
    </>
  ),
  gsmt: (
    <>
      <path d="M4 4v16h16" />
      <path d="M8 4h.01M12 4h.01M16 4h.01M20 4h.01M20 8h.01M20 12h.01M20 16h.01" strokeWidth="2.4" />
      <path d="M8.5 8.5h3v3h-3zM13 12.5h3v3h-3zM8.5 14h2" />
    </>
  ),
  xray: (
    <>
      <path d="M4 7.5V4h3.5M16.5 4H20v3.5M20 16.5V20h-3.5M7.5 20H4v-3.5" />
      <path d="M12 7v10M8.5 9.5c2 .8 5 .8 7 0M8 13c2.3.9 5.7.9 8 0" />
    </>
  ),
  mobile: (
    <>
      <rect x="6.5" y="2.8" width="11" height="18.4" rx="2.6" />
      <path d="M9 8.5h6M9 11.5h6M9 14.5h3.5M11 18.2h2" />
    </>
  ),
  id: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8 7.5 9.5 4.4-1.5 7.5-4.9 7.5-9.5V6z" />
      <circle cx="12" cy="10.2" r="2.4" />
      <path d="M8.3 16.2c.9-1.8 2.2-2.6 3.7-2.6s2.8.8 3.7 2.6" />
    </>
  ),
}

export function ProductGlyph({ k, size = 22, className = "" }: { k: ProductKey; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {GLYPHS[k]}
    </svg>
  )
}

export function ProductIcon({
  k,
  color,
  onColor,
  size = 44,
  className = "",
}: {
  k: ProductKey
  color: string
  onColor: string
  size?: number
  className?: string
}) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        background: `linear-gradient(155deg, color-mix(in oklab, ${color} 82%, white) 0%, ${color} 55%, color-mix(in oklab, ${color} 80%, black) 100%)`,
        color: onColor,
        boxShadow: `0 1px 0 rgb(255 255 255 / .35) inset, 0 8px 18px -8px color-mix(in oklab, ${color} 70%, transparent)`,
      }}
    >
      <ProductGlyph k={k} size={Math.round(size * 0.52)} />
    </span>
  )
}

export function StatusPill({ status, label }: { status: string; label: string }) {
  const tone: Record<string, string> = {
    live: "bg-[#e6f6ef] text-ok",
    pilot: "bg-brand-50 text-brand-700",
    on_request: "bg-[#f1f3f8] text-slate-text",
    development: "bg-[#fff4e5] text-warn",
  }
  return (
    <span className={`chip ${tone[status] || tone.on_request}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  )
}
