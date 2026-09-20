/** Публичная страница ячейки для камеры телефона. QR должен содержать URL, не только код. */

export function cellScanPath(locationCode: string): string {
  return `/s/c/${encodeURIComponent(locationCode.trim())}`
}

export function cellScanUrl(locationCode: string, origin?: string): string {
  const path = cellScanPath(locationCode)
  const base = (origin || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "")
  return base ? `${base}${path}` : path
}
