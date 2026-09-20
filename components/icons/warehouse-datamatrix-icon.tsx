export function WarehouseDataMatrixIcon({
  size = 28,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <path
        d="M10 27L32 14L54 27V52H10V27Z"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <path
        d="M22 52V34H42V52"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <rect x="25" y="37" width="4" height="4" rx="0.8" fill="currentColor" />
      <rect x="31" y="37" width="4" height="4" rx="0.8" fill="currentColor" />
      <rect x="37" y="37" width="4" height="4" rx="0.8" fill="currentColor" />
      <rect x="25" y="43" width="4" height="4" rx="0.8" fill="currentColor" />
      <rect x="37" y="43" width="4" height="4" rx="0.8" fill="currentColor" />
      <path
        d="M18 29H46"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.5"
      />
      <path
        d="M47 18L50 21L56 14"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
