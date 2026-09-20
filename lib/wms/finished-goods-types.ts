/** Типы и утилиты склада готовой продукции (сериализованный учёт). */

export type FgMarkingKind = "bottle" | "block" | "pallet"

export type FgMarkingTag = "export" | "expiry-risk" | "quarantine" | "promo" | "resort"

/** Агрегированный статус ввода кодов в оборот (ЧЗ). */
export type FgCrptCirculationStatus = "none" | "introduced" | "partial" | "not_introduced"

export type FgItemStatuses = {
  crpt: FgCrptCirculationStatus
  quarantine: boolean
  inProduction: boolean
  onResort: boolean
}

export function fgCrptStatusFromCounts(introduced: number, notIntroduced: number): FgCrptCirculationStatus {
  const total = introduced + notIntroduced
  if (total <= 0) return "none"
  if (notIntroduced <= 0) return "introduced"
  if (introduced <= 0) return "not_introduced"
  return "partial"
}

export function fgEmptyItemStatuses(): FgItemStatuses {
  return { crpt: "none", quarantine: false, inProduction: false, onResort: false }
}

export type FgMarkingNode = {
  id: string
  code: string
  kind: FgMarkingKind
  gtin: string
  serialNumber: string
  producedAt: string | null
  expiresAt: string | null
  tags: FgMarkingTag[]
  locationCode?: string
  rowLabel?: string
  children?: FgMarkingNode[]
  /** Прямые дочерние коды (блоки у палеты, бутылки у блока). */
  childCount?: number
  /** Только для палет: вложенные блоки и бутылки. */
  blocksCount?: number
  bottlesCount?: number
}

export type FgPlanRowRef = {
  planRowId: string
  locationCode: string
  zone: string
  pallets?: number
}

export type FgNomenclatureRow = {
  itemCode: string
  name: string
  gtin: string
  productGroup: string
  bottles: number
  blocks: number
  pallets: number
  /** Бутылки, записанные на 2D-план ГП (не путать с остатком в wms_stock_balances). */
  placedBottles?: number
  /** Блоки на 2D-плане ГП (обычно бутылки / 6). */
  placedBlocks?: number
  /** Паллеты на 2D-плане ГП. */
  placedPallets?: number
  /** Ряды / ячейки ГП с плана, где лежит эта номенклатура. */
  planRows?: FgPlanRowRef[]
  markingCodesCount: number
  /** Код линии производства (SIPA, JR, …). */
  productionLineCode: string | null
  /** Отображаемое имя линии. */
  productionLineName: string | null
  /** Номера партий на остатке / с плана (280826SA). */
  lotCodes?: string[]
  /** Выпущено по Векас/остатку больше, чем стоит на 2D-плане. */
  placement?: "unplaced" | "partial" | "placed"
  unplacedBottles?: number
  unplacedBlocks?: number
  unplacedPallets?: number
  nearestExpiryAt: string | null
  oldestProductionAt: string | null
  tags: FgMarkingTag[]
  statuses: FgItemStatuses
  expiryCritical: number
  expiryWarning: number
  expiryOk: number
  /** FSN по движениям за период. F ближе, N дальше. */
  fsn?: "F" | "S" | "N"
  fsnMoves?: number
  fsnQty?: number
  fsnDays?: number
  /** ABC по доле оборота. Не путать с S1–S5. */
  abc?: "A" | "B" | "C"
  /** XYZ по стабильности недельного спроса. */
  xyz?: "X" | "Y" | "Z"
  /** Ячейка матрицы, например AX. */
  abcxyz?: "AX" | "AY" | "AZ" | "BX" | "BY" | "BZ" | "CX" | "CY" | "CZ"
  cv?: number | null
  coi?: number | null
  storageClass?: "S1" | "S2" | "S3" | "S4" | "S5"
  skuProfile?: string
  reslotHint?: {
    fromRow: string
    kind: "too_far" | "too_close"
    reason: string
    expectedCutPct: number | null
  } | null
  crossDock?: {
    dockCode: string
    documentNo: string | null
    qty: number
    reason: string
  } | null
  policyState?: "below_min" | "safety" | "reorder" | "ok" | "above_max" | null
  policyShort?: string | null
  policyInferred?: boolean
  deadStock?: boolean
  agingDays?: number | null
  agingBand?: "fresh" | "aging" | "old" | "stale" | null
  obsolescence?: "low" | "watch" | "high"
  opsHint?: string | null
}

export type FgPalletRow = {
  palletId: string
  palletCode: string
  itemCode: string
  itemName: string
  locationCode: string
  rowLabel: string
  blocks: number
  bottles: number
  markingCodesCount: number
  producedAt: string | null
  expiresAt: string | null
  tags: FgMarkingTag[]
  statuses: FgItemStatuses
}

export type FgExpiryBucket = {
  key: "critical" | "warning" | "ok" | "expired"
  label: string
  daysRange: string
  items: Array<{
    itemCode: string
    name: string
    bottles: number
    nearestExpiryAt: string
    daysLeft: number
  }>
}

export type FgStorageRowSummary = {
  rowId: string
  rowCode: string
  label: string
  zone: string
  palletCount: number
  markingCodesCount: number
  bottles: number
  blocks: number
  nearestExpiryAt: string | null
  tags: FgMarkingTag[]
  nomenclatureSkus: number
  fillPercent: number
}

export type FgRowPalletSummary = {
  palletId: string
  palletCode: string
  serialNumber: string
  rowId: string
  position: number
  itemName: string
  itemCode: string
  blocks: number
  bottles: number
  markingCodesCount: number
  producedAt: string | null
  expiresAt: string | null
  tags: FgMarkingTag[]
}

export type FgPagedResult<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export type FgSummaryStats = {
  nomenclatureCount: number
  bottles: number
  blocks: number
  pallets: number
  placedBottles?: number
  placedBlocks?: number
  placedPallets?: number
  unplacedBottles?: number
  unplacedPallets?: number
  markingCodesCount: number
  expiryCritical: number
  expiryWarning: number
  exportBottles: number
}

export type FgCodeLookupHit = {
  rowId: string
  rowLabel: string
  palletSerial: string
  itemName: string
  itemCode: string
  code: string
}

const TAG_LABELS: Record<FgMarkingTag, string> = {
  export: "Экспорт",
  "expiry-risk": "Срок годности",
  quarantine: "Карантин",
  promo: "Акция",
  resort: "На переборе",
}

export function fgTagLabel(tag: FgMarkingTag): string {
  return TAG_LABELS[tag] ?? tag
}

export function fgKindLabel(kind: FgMarkingKind): string {
  if (kind === "bottle") return "Бутылка"
  if (kind === "block") return "Блок"
  return "Палета"
}

export function fmtFgDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("ru-RU")
}

export function fmtFgQty(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(n)
}

export function fmtFgPlaced(pallets: number, blocks: number, bottles: number): string {
  return `${fmtFgQty(pallets)} пал. · ${fmtFgQty(blocks)} бл. · ${fmtFgQty(bottles)} бут.`
}

/** Ряд плана для экрана: A-34, без внутреннего префикса FG-. */
export function formatFgPlanRows(rows: FgPlanRowRef[] | undefined): string {
  const list = [...(rows ?? [])]
    .filter((row) => row.planRowId)
    .sort((a, b) => (b.pallets ?? 0) - (a.pallets ?? 0) || a.planRowId.localeCompare(b.planRowId, "en"))
  if (list.length === 0) return "—"
  if (list.length === 1) return list[0].planRowId
  return list.map((row) => `${row.planRowId} · ${fmtFgQty(row.pallets ?? 0)} пал.`).join(", ")
}

export function daysUntilExpiry(iso: string | null | undefined): number | null {
  if (!iso) return null
  const end = new Date(iso)
  end.setHours(0, 0, 0, 0)
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return Math.round((end.getTime() - start.getTime()) / 86400000)
}

export function subgroupToKind(subgroup: string | null | undefined): FgMarkingKind {
  const s = (subgroup ?? "").trim().toLowerCase()
  if (s === "block") return "block"
  if (s === "pallet") return "pallet"
  return "bottle"
}

/** Уровень КИ: SSCC 00… = палета, иначе pack_level / наличие детей. */
export function kindFromMarking(
  gtin: string | null | undefined,
  packLevel: string | null | undefined,
  childCount = 0
): FgMarkingKind {
  const g = (gtin ?? "").trim()
  const pl = (packLevel ?? "").trim().toLowerCase()
  if (pl === "pallet" || g.startsWith("00")) return "pallet"
  if (pl === "block") return "block"
  if (childCount > 0 && !g.startsWith("00")) return "block"
  return subgroupToKind(pl)
}
