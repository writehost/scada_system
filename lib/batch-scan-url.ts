/** Публичная страница партии/стикера приёмки для камеры телефона. */

export function batchScanPath(batchCode: string): string {
  return `/s/b/${encodeURIComponent(batchCode.trim())}`
}

export function batchScanUrl(batchCode: string, origin?: string): string {
  const path = batchScanPath(batchCode)
  const base = (origin || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "")
  return base ? `${base}${path}` : path
}
