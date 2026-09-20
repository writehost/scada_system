/** Канонические коды складов и legacy-алиасы из старых русских топологий. */
export const WAREHOUSE_CODE_ALIASES: Record<string, string> = {
  "СКЛАД-МАТЕРИАЛОВ": "OS",
  MAT: "OS",
  "СКЛАД-ГОТОВОЙ-ПРОДУКЦИИ": "FG",
}

export const LEGACY_MATERIAL_WAREHOUSE_CODES = ["СКЛАД-МАТЕРИАЛОВ", "MAT"] as const
export const LEGACY_FINISHED_WAREHOUSE_CODES = ["СКЛАД-ГОТОВОЙ-ПРОДУКЦИИ"] as const

export function canonicalWarehouseCode(code: string): string {
  const trimmed = code.trim()
  if (!trimmed) return trimmed
  return WAREHOUSE_CODE_ALIASES[trimmed] ?? WAREHOUSE_CODE_ALIASES[trimmed.toUpperCase()] ?? trimmed
}

export function isLegacyMaterialWarehouseCode(code: string): boolean {
  const c = code.trim()
  return (LEGACY_MATERIAL_WAREHOUSE_CODES as readonly string[]).includes(c)
}
