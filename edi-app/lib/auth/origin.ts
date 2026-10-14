/** Внешний адрес приложения за nginx: EDI_PUBLIC_ORIGIN, иначе x-forwarded-* / Host. */
export function publicOrigin(req: Request): string {
  const fixed = process.env.EDI_PUBLIC_ORIGIN?.trim()
  if (fixed) return fixed.replace(/\/$/, "")
  if (process.env.NODE_ENV === "production") throw new Error("EDI_PUBLIC_ORIGIN is required in production")
  const proto = (req.headers.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "")).split(",")[0].trim()
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || new URL(req.url).host).split(",")[0].trim()
  return `${proto}://${host}`
}
