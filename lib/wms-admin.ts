export function isWmsAdmin(roleCodes?: string[] | null): boolean {
  if (!Array.isArray(roleCodes) || roleCodes.length === 0) return false
  return roleCodes.some((code) => String(code).trim().toLowerCase() === "admin")
}
