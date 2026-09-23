export const PRIMARY_SITE_CODE = (process.env.WMS_SITE_CODE || "skeet").trim() || "skeet"

const ALIASES: Record<string, string> = {
  default: PRIMARY_SITE_CODE,
  "": PRIMARY_SITE_CODE,
}

export function canonicalSiteCode(raw?: string | null): string {
  const value = (raw ?? "").trim()
  if (!value) return PRIMARY_SITE_CODE
  return ALIASES[value.toLowerCase()] || value
}

export function isLegacyDefaultSite(raw?: string | null): boolean {
  return (raw ?? "").trim().toLowerCase() === "default"
}
