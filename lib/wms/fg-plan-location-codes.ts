/** Коды ячеек рядов ГП. Код в WMS = FG-{ряд плана}, чтобы не пересечься с ячейками материалов (A-1). */

export const FG_WAREHOUSE_CODE = "FG"
export const FG_WAREHOUSE_NAME = "Склад готовой продукции"
export const FG_WAREHOUSE_TYPE = "FINISHED_GOODS"
export const FG_LOCATION_PREFIX = "FG-"

const PLAN_ROW_ID_RE = /^[A-ZА-ЯЁ]-\d+$/i
const PLAN_ROW_SECTION_RE =
  /^([A-ZА-ЯЁ]+-\d+)(?:[-_](ВЕРХНИЙ|НИЖНИЙ|UPPER|LOWER|TOP|BOTTOM)(?:-\d+)?)?$/i
const PLAN_ROW_FAMILY_RE = /^([A-ZА-ЯЁ]+-\d+)/i

export function isFgWarehouseCode(code: string | null | undefined): boolean {
  const c = (code ?? "").trim().toUpperCase()
  if (!c) return false
  if (c === "FG" || c.startsWith("FG")) return true
  if (c.includes("FINISH")) return true
  if (c.includes("ГОТОВ")) return true
  return false
}

export function isPlanRowId(value: string | null | undefined): boolean {
  return PLAN_ROW_ID_RE.test((value ?? "").trim())
}

/** A-1 / fg-a-1 / FG-A-1 → A-1 */
export function normalizePlanRowId(input: string | null | undefined): string {
  let value = (input ?? "").trim().toUpperCase().replace(/\s+/g, "")
  if (!value) return ""
  if (value.startsWith(FG_LOCATION_PREFIX) && isPlanRowId(value.slice(FG_LOCATION_PREFIX.length))) {
    value = value.slice(FG_LOCATION_PREFIX.length)
  }
  return value
}

/** Ряд плана A-1 → ячейка FG-A-1 */
export function fgPlanLocationCode(planRowId: string): string {
  const id = normalizePlanRowId(planRowId)
  if (!id) return ""
  return `${FG_LOCATION_PREFIX}${id}`
}

export function planRowIdFromLocationCode(locationCode: string | null | undefined): string | null {
  const id = normalizePlanRowId(locationCode)
  if (isPlanRowId(id)) return id
  const canonical = canonicalPlanRowId(id)
  return isPlanRowId(canonical) ? canonical : null
}

/** C-12-ВЕРХНИЙ / C-12-верхний / C-10-верхний-2 / FG-C-12-НИЖНИЙ → C-12 */
export function canonicalPlanRowId(input: string | null | undefined): string {
  const raw = normalizePlanRowId(input) || (input ?? "").trim().toUpperCase().replace(/^FG-/, "")
  if (!raw) return ""
  const section = raw.match(PLAN_ROW_SECTION_RE)
  if (section?.[1]) return section[1].toUpperCase()
  const family = raw.match(PLAN_ROW_FAMILY_RE)
  return family?.[1]?.toUpperCase() ?? raw
}

export function samePlanRowFamily(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = canonicalPlanRowId(a)
  const right = canonicalPlanRowId(b)
  return Boolean(left && right && left === right)
}

export function fgPlanZoneName(zone: string): string {
  const z = zone.trim().toUpperCase()
  return z ? `Зона ${z}` : "Зона"
}

/** A-34 / FG-A-34-LOWER-001 → A */
export function planRowZone(input: string | null | undefined): string {
  const id = canonicalPlanRowId(input)
  const m = id.match(/^([A-ZА-ЯЁ]+)-\d+$/i)
  return m ? m[1].toUpperCase() : ""
}
