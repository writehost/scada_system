import type { WarehouseDirectoryRow } from "@/lib/wms-api"

/** Цех / производственная линия в справочнике складов. */
export function isWorkshopDirectoryRow(row: {
  warehouseType?: string
  meta?: Record<string, unknown>
}): boolean {
  if (row.warehouseType === "PRODUCTION") return true
  return Boolean(row.meta?.isProduction)
}

export function workshopMetaDefaults(): Record<string, unknown> {
  return {
    isProduction: true,
    hasZones: true,
    hasCells: true,
    allowReceiving: false,
    allowTransferFrom: true,
    allowTransferTo: true,
    defaultZoneId: "LINE",
  }
}

export function mergeWorkshopMeta(existing: Record<string, unknown> | undefined, patch: {
  locationName?: string
  scadaAreaCode?: string
  defaultZoneId?: string
  managerUserId?: string
  defaultKeeperUserId?: string
}): Record<string, unknown> {
  return {
    ...workshopMetaDefaults(),
    ...(existing ?? {}),
    isProduction: true,
    locationName: patch.locationName?.trim() || undefined,
    scadaAreaCode: patch.scadaAreaCode?.trim() || undefined,
    defaultZoneId: patch.defaultZoneId?.trim() || "LINE",
    managerUserId: patch.managerUserId?.trim() || undefined,
    defaultKeeperUserId: patch.defaultKeeperUserId?.trim() || undefined,
  }
}

export function workshopSummary(row: WarehouseDirectoryRow): string {
  const zone = String(row.meta?.defaultZoneId ?? "LINE")
  const scada = String(row.meta?.scadaAreaCode ?? "").trim()
  return scada ? `зона ${zone} · SCADA ${scada}` : `зона ${zone}`
}

/** Зоны производства — не должны висеть под складом материалов в топологии. */
export const PRODUCTION_ZONE_CODES = new Set(["LINE", "ST-SER", "ST-BAGG"])

export const PRODUCTION_ZONE_CODE_LIST = ["LINE", "ST-SER", "ST-BAGG"] as const

/** SQL-фрагмент: ячейка относится к цеху / производству. */
export function workshopLocationWhere(alias = "w", zoneAlias = "z"): string {
  const zones = PRODUCTION_ZONE_CODE_LIST.map((z) => `'${z}'`).join(", ")
  return `(
    ${alias}.warehouse_type = 'PRODUCTION'
    OR COALESCE(${alias}.meta_json->>'isProduction', 'false') = 'true'
    OR ${zoneAlias}.zone_code IN (${zones})
  )`
}

/** Куда отнести ячейку в дереве «Склады / Цехи». */
export function resolveTopologyPlacement(input: {
  warehouseCode: string
  zoneCode: string
  workshopCodes: Iterable<string>
}): { group: "warehouse" | "workshop"; warehouseCode: string } {
  const wh = input.warehouseCode.trim()
  const zone = input.zoneCode.trim()
  const workshops = new Set(input.workshopCodes)

  if (workshops.has(wh)) {
    return { group: "workshop", warehouseCode: wh }
  }

  if (PRODUCTION_ZONE_CODES.has(zone)) {
    if (workshops.has("Цех №2")) return { group: "workshop", warehouseCode: "Цех №2" }
    if (workshops.has("Цех №1")) return { group: "workshop", warehouseCode: "Цех №1" }
    if (workshops.has(wh)) return { group: "workshop", warehouseCode: wh }
    if (workshops.has(zone)) return { group: "workshop", warehouseCode: zone }
    const first = [...workshops][0]
    return { group: "workshop", warehouseCode: wh === "OS" && first ? first : wh }
  }

  return { group: "warehouse", warehouseCode: wh }
}
