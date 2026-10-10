export type Resource = "electricity" | "cold_water" | "hot_water" | "heat" | "gas" | "leak" | "other"

export const RESOURCE_LABELS: Record<Resource, string> = {
  electricity: "Электричество",
  cold_water: "Холодная вода",
  hot_water: "Горячая вода",
  heat: "Тепло",
  gas: "Газ",
  leak: "Датчик протечки",
  other: "Прочее",
}

export const UNIT_LABELS: Record<string, string> = {
  kWh: "кВт·ч",
  kW: "кВт",
  W: "Вт",
  m3: "м³",
  "m3/h": "м³/ч",
  L: "л",
  Gcal: "Гкал",
  "°C": "°C",
  pulse: "имп.",
  bool: "",
}

export function unitLabel(unit: string | null | undefined): string {
  if (!unit) return ""
  return UNIT_LABELS[unit] ?? unit
}

/** Основной канал учёта ресурса — для домашней панели. */
export function billingUnitOf(resource: Resource): string | null {
  if (resource === "electricity") return "kWh"
  if (resource === "cold_water" || resource === "hot_water" || resource === "gas") return "m3"
  if (resource === "heat") return "Gcal"
  return null
}

export function serviceOfResource(resource: Resource): string | null {
  if (resource === "electricity" || resource === "cold_water" || resource === "hot_water" || resource === "gas") return resource
  if (resource === "heat") return "heating"
  return null
}
