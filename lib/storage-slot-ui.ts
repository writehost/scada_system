import { isFgWarehouseCode } from "@/lib/wms/fg-plan-location-codes"

/** Справочники и подписи для осмысленных ячеек (UI). */

export type StorageSlotProfile = {
  materialType?: string | null
  processType?: string | null
  stickerShape?: string | null
  productGroup?: string | null
  brand?: string | null
  productType?: string | null
  carbonationType?: string | null
  volume?: string | null
  applicationPlace?: string | null
  equipment?: string | null
  physicalAddress?: string | null
  storagePurpose?: string | null
  /** Код подгруппы приёмки (stickers, water, …) из справочника WMS. */
  receivingCategoryCode?: string | null
  /** Допустимые товарные группы номенклатуры (softdrinks, water, …). */
  allowedItemGroupCodes?: string[] | null
  allowMixedNomenclature?: boolean
  allowMixedBatches?: boolean
  capacityUnits?: number | null
  priority?: number
  preferredItemCode?: string | null
  preferredItemName?: string | null
  rememberNomenclature?: boolean
  storageClass?: string | null
  allowedStorageClasses?: string[] | null
  maxLengthMm?: number | null
  maxWidthMm?: number | null
  maxHeightMm?: number | null
  maxWeightG?: number | null
  handling?: string | null
  sizeClass?: string | null
}

export type WmsStorageRecommendRow = {
  locationId: string
  locationCode: string
  displayName: string
  zoneCode: string
  score: number
  forbidden: boolean
  reasons: string[]
  availableCapacity: number | null
  currentUnits: number
  skuCount: number
  hasSameItem: boolean
  hasSameGtin: boolean
}

export type WmsStorageRuleBrief = {
  ruleId: string
  name: string
  priority: number
  preferredLocationCode?: string | null
  preferredZoneCode?: string | null
}

export type WmsStorageRecommendResponse = {
  requirements: StorageSlotProfile & {
    itemId: string
    itemCode: string
    itemName: string
    gtin?: string | null
    physical?: {
      storageClass?: string
      storageClassSource?: string
      sizeClass?: string | null
      weightClass?: string | null
      handling?: string | null
      storageForm?: string | null
      velocityClass?: string
      maxDimensionMm?: number | null
      weightG?: number | null
    }
  }
  recommendations: WmsStorageRecommendRow[]
  matchingRules?: WmsStorageRuleBrief[]
}

const LABELS: Record<string, Record<string, string>> = {
  materialType: {
    ST: "Стикеры",
    LB: "Этикетки",
    PK: "Упаковка",
    CP: "Пробки",
    PL: "Палетные",
    ANY: "Любой",
  },
  processType: {
    SER: "Сериализация",
    BAGG: "Блочная агрегация",
    PAGG: "Палетная агрегация",
    CAGG: "Коробочная агрегация",
    "PACK-WATER": "Упакованная вода",
    DRINK: "Напитки",
    STORE: "Складской материал",
    RECV: "Приёмка",
    QUARANTINE: "Карантин",
    DEFECT: "Брак",
    WRITEOFF: "Списание",
    ANY: "Любой",
  },
  stickerShape: { RND: "Круглые", SQR: "Квадратные", RECT: "Прямоугольные", ANY: "Любой" },
  productGroup: {
    SLNG: "Славда негаз",
    SLGZ: "Славда газ",
    DSLV: "Детская Славда",
    SLKR: "Славда курортная",
    DRNK: "Напитки",
    PWTR: "Упак. вода",
    ANY: "Любой",
  },
  volume: { "05": "0,5 л", "10": "1 л", "15": "1,5 л", "50": "5 л", "190": "19 л", ANY: "Любой" },
  applicationPlace: {
    CAP: "Пробка",
    BTL: "Бутылка",
    BLOCK: "Блок",
    BOX: "Короб",
    PALLET: "Палета",
    ANY: "Любой",
  },
  equipment: {
    APPLICATOR: "Аппликатор",
    NOVEXX: "Novexx",
    "APPLICATOR-NOVEXX": "Аппликатор Novexx",
    АППЛИКАТОР: "Аппликатор",
    "АППЛИКАТОР-NOVEXX": "Аппликатор Novexx",
    ANY: "Любое",
  },
}

/** Подписи полей профиля ячейки — для форм */
export const SLOT_FIELD_LABELS = {
  storageClass: "Класс хранения",
  handling: "Способ обработки",
  sizeClass: "Габаритный класс",
  maxLengthMm: "Макс. длина, мм",
  maxWidthMm: "Макс. ширина, мм",
  maxHeightMm: "Макс. высота, мм",
  maxWeightG: "Макс. вес, г",
  materialType: "Тип материала (производство)",
  processType: "Этап производства",
  stickerShape: "Форма стикера",
  productGroup: "Линейка / бренд",
  volume: "Объём тары",
  applicationPlace: "Куда клеится / наносится",
  equipment: "Аппликатор / линия (Novexx и т.п.)",
  physicalAddress: "Место на складе (полка, bin)",
  capacityUnits: "Сколько штук влезает",
  priority: "Приоритет при подборе",
  allowMixedNomenclature: "Разные товары в одной ячейке",
  allowMixedBatches: "Разные партии в одной ячейке",
  rememberNomenclature: "Подсказывать ячейку для этой номенклатуры",
  preferredItemCode: "Закреплённая номенклатура",
  displayName: "Название ячейки",
  warehouseCode: "Склад или цех",
  zoneCode: "Зона / участок",
} as const

export const SLOT_FIELD_HINTS = {
  storageClass:
    "S1 мелкоштучный, S2 средний тарный, S3 сырьё линии (картон, плёнка, преформа), S4 палета/ГП, S5 карантин. Это не ABC-оборачиваемость.",
  handling: "Как отбирают из ячейки: руками, тележкой или погрузчиком.",
  maxLengthMm: "Если задано — товар большего габарита сюда не предложат.",
  materialType: "Производственный признак (стикеры, этикетки…). Не заменяет класс хранения.",
  processType: "Для чего ячейка: сериализация, агрегация, приёмка, карантин и т.д.",
  stickerShape: "Только для стикеров: круглые, квадратные или любые.",
  productGroup: "Для какой линейки продукции (Славда негаз, газ, детская…).",
  volume: "Объём бутылки / тары, под которую подходит материал.",
  applicationPlace: "Где используется: на пробке, бутылке, блоке, коробе.",
  equipment:
    "Линия, аппликатор (Novexx и т.п.) — из справочника. Для аппликатора полка не нужна: код соберётся без неё.",
  physicalAddress:
    "Только для стеллажей: полка, bin (A01-01). Для аппликатора оставьте пустым.",
  capacityUnits: "Максимальное количество штук. Пусто — без лимита.",
  priority: "Чем выше число, тем чаще система предложит эту ячейку при приёмке.",
  allowMixedNomenclature: "Если выключено — в ячейке только один вид товара.",
  rememberNomenclature:
    "При выдаче со склада OS в цех система предложит эту ячейку, если номенклатура совпадает.",
  preferredItemCode: "Выберите товар, который обычно лежит в этой ячейке.",
  allowMixedBatches: "Если выключено — только одна партия (одна дата эмиссии).",
  displayName: "Как ячейка будет называться в списке. Если пусто — соберётся из полей ниже.",
  warehouseCode: "Склад материалов/ГП или производственный цех из справочника.",
  zoneCode: "Участок: сериализация, приёмка, маркировка; для линии — зона «Линия» (LINE).",
} as const

export const WAREHOUSE_LABELS: Record<string, string> = {
  OS: "Склад материалов",
  MAT: "Склад материалов",
  FG: "Склад готовой продукции",
  "СКЛАД-МАТЕРИАЛОВ": "Склад материалов",
  "СКЛАД-ГОТОВОЙ-ПРОДУКЦИИ": "Склад готовой продукции",
}

export const ZONE_LABELS: Record<string, string> = {
  RECV: "Приёмка",
  MARK: "Стикеры",
  LINE: "Линия",
  RES: "Резерв",
  SHIP: "Отгрузка",
  ROWS: "Вне плана ГП",
  A: "Зона A",
  B: "Зона B",
  C: "Зона C",
  D: "Зона D",
  E: "Зона E",
  F: "Зона F",
  K: "Зона K",
  "ST-SER": "Стикеры — сериализация",
  "ST-BAGG": "Стикеры — блочная агрегация",
  QUARANTINE: "Карантин",
}

/** Подсказки зон для UI; создание ячейки берёт только зоны из справочника. */
export const DEFAULT_ZONE_OPTIONS = [
  { warehouseCode: "OS", zoneCode: "ST-SER", zoneName: ZONE_LABELS["ST-SER"] },
  { warehouseCode: "OS", zoneCode: "ST-BAGG", zoneName: ZONE_LABELS["ST-BAGG"] },
  { warehouseCode: "OS", zoneCode: "RECV", zoneName: ZONE_LABELS.RECV },
  { warehouseCode: "OS", zoneCode: "MARK", zoneName: ZONE_LABELS.MARK },
  { warehouseCode: "OS", zoneCode: "LINE", zoneName: ZONE_LABELS.LINE },
  { warehouseCode: "FG", zoneCode: "SHIP", zoneName: ZONE_LABELS.SHIP },
] as const

export function zoneDisplayLabel(zoneCode: string, zoneName?: string | null): string {
  const zn = zoneName?.trim()
  if (zn && zn !== zoneCode) return zn
  return ZONE_LABELS[zoneCode] ?? zoneCode
}

export function warehouseDisplayLabel(warehouseCode: string, name?: string | null): string {
  if (name?.trim()) return name.trim()
  return WAREHOUSE_LABELS[warehouseCode] ?? warehouseCode
}

export function formatZoneSelectLabel(
  zoneCode: string,
  zoneName?: string | null,
  warehouseCode?: string | null
): string {
  const zn = zoneDisplayLabel(zoneCode, zoneName)
  if (warehouseCode && warehouseCode !== "OS") {
    return `${zn} (${warehouseDisplayLabel(warehouseCode)})`
  }
  return zn
}

export function slotLabel(field: keyof typeof LABELS, code: string | null | undefined): string {
  if (!code) return "—"
  return LABELS[field]?.[code] ?? code
}

export function buildSlotTitle(profile: StorageSlotProfile | null | undefined): string {
  if (!profile) return "—"
  const parts = [
    profile.storageClass && profile.storageClass !== "ANY" ? profile.storageClass : null,
    profile.receivingCategoryCode
      ? receivingCategoryDisplayLabel(profile.receivingCategoryCode)
      : null,
    slotLabel("materialType", profile.materialType),
    slotLabel("processType", profile.processType),
    profile.stickerShape && profile.stickerShape !== "ANY"
      ? slotLabel("stickerShape", profile.stickerShape)
      : null,
    profile.productGroup && profile.productGroup !== "ANY"
      ? slotLabel("productGroup", profile.productGroup)
      : null,
    profile.volume && profile.volume !== "ANY" ? slotLabel("volume", profile.volume) : null,
    profile.equipment && profile.equipment !== "ANY"
      ? slotLabel("equipment", profile.equipment)
      : null,
    profile.physicalAddress || null,
  ].filter((p) => p && p !== "—")
  const unique = [...new Set(parts)]
  return unique.length ? unique.join(" / ") : "—"
}

const RECEIVING_CATEGORY_LABELS: Record<string, string> = {
  stickers: "Стикеры",
  water: "Вода и напитки",
  MaterialsFactory: "Материалы упаковки",
}

export function receivingCategoryDisplayLabel(code: string | null | undefined): string {
  const c = code?.trim()
  if (!c) return "—"
  return RECEIVING_CATEGORY_LABELS[c] ?? c
}

/** Порядковая сортировка кодов A-1, A-2, A-10 (не A-1, A-10, A-11). */
export function compareSequentialCellCodes(a: string, b: string): number {
  const parse = (code: string) => {
    const trimmed = code.trim()
    const idx = trimmed.lastIndexOf("-")
    if (idx <= 0) return { prefix: trimmed, num: null as number | null }
    const prefix = trimmed.slice(0, idx)
    const tail = trimmed.slice(idx + 1)
    if (!/^\d+$/.test(tail)) return { prefix: trimmed, num: null }
    return { prefix, num: Number.parseInt(tail, 10) }
  }
  const pa = parse(a)
  const pb = parse(b)
  const prefixCmp = pa.prefix.localeCompare(pb.prefix, "ru", { sensitivity: "base" })
  if (prefixCmp !== 0) return prefixCmp
  if (pa.num != null && pb.num != null) return pa.num - pb.num
  return a.localeCompare(b, "ru", { numeric: true })
}

export function sortSequentialCellCodes(codes: string[]): string[] {
  return [...codes].sort(compareSequentialCellCodes)
}

export function formatLocationPlacementLabel(input: {
  warehouseCode?: string | null
  zoneCode?: string | null
  zoneName?: string | null
  locationCode?: string | null
  displayName?: string | null
  warehouseLabels?: Record<string, string>
  slotProfile?: StorageSlotProfile | null
}): string {
  const displayName = input.displayName?.trim()
  if (displayName) return displayName

  const locationCode = input.locationCode?.trim()
  const warehouseCode = input.warehouseCode?.trim() || null
  const warehouseName = warehouseCode ? input.warehouseLabels?.[warehouseCode] : null
  const zoneCode = input.zoneCode?.trim() || ""
  const zone = zoneCode
    ? formatZoneSelectLabel(zoneCode, input.zoneName ?? null, warehouseCode)
    : warehouseCode
      ? warehouseDisplayLabel(warehouseCode, warehouseName)
      : null
  const slot = buildSlotTitle(input.slotProfile)
  return [zone, slot !== "—" ? slot : null, locationCode].filter(Boolean).join(" · ") || "—"
}

export const SLOT_SELECT_OPTIONS = {
  materialType: sortOptionsWithAnyLast(LABELS.materialType, ["ST", "LB", "CP", "PK"]),
  processType: sortOptionsWithAnyLast(LABELS.processType, ["SER", "BAGG", "RECV", "STORE"]),
  stickerShape: sortOptionsWithAnyLast(LABELS.stickerShape, ["RND", "SQR", "RECT"]),
  productGroup: sortOptionsWithAnyLast(LABELS.productGroup, ["SLNG", "SLGZ", "DSLV", "SLKR"]),
  volume: sortOptionsWithAnyLast(LABELS.volume, ["15", "10", "05", "50"]),
  applicationPlace: sortOptionsWithAnyLast(LABELS.applicationPlace, ["CAP", "BLOCK", "BTL"]),
  equipment: sortOptionsWithAnyLast(LABELS.equipment, ["APPLICATOR-NOVEXX", "NOVEXX", "APPLICATOR"]),
} as const

function sortOptionsWithAnyLast(
  labels: Record<string, string>,
  preferredOrder: string[]
): { value: string; label: string }[] {
  const entries = Object.entries(labels)
  const ordered: { value: string; label: string }[] = []
  for (const code of preferredOrder) {
    if (labels[code]) ordered.push({ value: code, label: labels[code] })
  }
  for (const [value, label] of entries) {
    if (value === "ANY") continue
    if (!ordered.some((o) => o.value === value)) ordered.push({ value, label })
  }
  if (labels.ANY) ordered.push({ value: "ANY", label: labels.ANY })
  return ordered
}

export const EMPTY_SLOT_PROFILE: StorageSlotProfile = {
  storageClass: "S1",
  handling: "MANUAL",
  materialType: "ANY",
  processType: "STORE",
  stickerShape: "ANY",
  productGroup: "ANY",
  volume: "ANY",
  applicationPlace: "ANY",
  equipment: "ANY",
  allowMixedNomenclature: false,
  allowMixedBatches: true,
}

export type SlotProfileTemplate = {
  id: string
  title: string
  description: string
  zoneHint: string
  profile: StorageSlotProfile
}

/** Готовые шаблоны профиля ячеек */
export const SLOT_PROFILE_TEMPLATES: SlotProfileTemplate[] = [
  {
    id: "st-ser-slng-15",
    title: "Сериализация · Славда негаз · 1,5 л",
    description: "Круглые стикеры, сериализация, полка A",
    zoneHint: "ST-SER",
    profile: {
      materialType: "ST",
      processType: "SER",
      stickerShape: "RND",
      productGroup: "SLNG",
      volume: "15",
      applicationPlace: "CAP",
      physicalAddress: "A01-01",
      capacityUnits: 500_000,
      allowMixedNomenclature: false,
      allowMixedBatches: true,
      priority: 10,
    },
  },
  {
    id: "st-bagg-sqr",
    title: "Блочная агрегация · квадратные",
    description: "Квадратные стикеры, блочная агрегация",
    zoneHint: "ST-BAGG",
    profile: {
      materialType: "ST",
      processType: "BAGG",
      stickerShape: "SQR",
      productGroup: "ANY",
      volume: "ANY",
      applicationPlace: "BLOCK",
      physicalAddress: "B01-01",
      capacityUnits: 200_000,
      allowMixedNomenclature: false,
      allowMixedBatches: true,
    },
  },
  {
    id: "recv",
    title: "Приёмка (RECV)",
    description: "Временное размещение при проведении",
    zoneHint: "RECV",
    profile: {
      materialType: "ANY",
      processType: "RECV",
      stickerShape: "ANY",
      productGroup: "ANY",
      volume: "ANY",
      applicationPlace: "ANY",
      allowMixedNomenclature: true,
      allowMixedBatches: true,
      capacityUnits: 9_999_999,
    },
  },
  {
    id: "quarantine",
    title: "Карантин",
    description: "Партии на проверке",
    zoneHint: "QUARANTINE",
    profile: {
      materialType: "ANY",
      processType: "QUARANTINE",
      stickerShape: "ANY",
      productGroup: "ANY",
      volume: "ANY",
      applicationPlace: "ANY",
      allowMixedNomenclature: true,
      allowMixedBatches: false,
    },
  },
]

/** Аппликатор / линия — не стеллаж, полка не обязательна. */
export function hasLineEquipment(profile: StorageSlotProfile | null | undefined): boolean {
  const eq = profile?.equipment?.trim()
  return Boolean(eq && eq !== "ANY")
}

export function buildSemanticCode(profile: StorageSlotProfile, physicalAddress = ""): string {
  const phys = physicalAddress.trim().replace(/\s+/g, "-")
  const parts = [
    profile.materialType || "ST",
    profile.processType || "STORE",
    profile.stickerShape || "ANY",
    profile.productGroup || "ANY",
    profile.volume || "ANY",
    profile.equipment && profile.equipment !== "ANY" ? profile.equipment : null,
    phys || null,
  ].filter(Boolean)
  return parts.join("-").toUpperCase()
}

/** Код ячейки: ручной ввод или автосборка из профиля (полка необязательна для аппликатора). */
export function resolveLocationCode(
  profile: StorageSlotProfile,
  manualCode?: string | null
): string {
  const manual = manualCode?.trim()
  if (manual) return manual
  return buildSemanticCode(profile, profile.physicalAddress ?? "")
}

/** Дерево топологии: склад → зона → смысл → ячейка */
export type TopologyNode = {
  id: string
  label: string
  kind: "warehouse" | "zone" | "semantic" | "location"
  locationCode?: string
  children: TopologyNode[]
  count?: number
}

export function formatCellQty(value: number): string {
  if (!Number.isFinite(value)) return "—"
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value)
}

export function hasMeaningfulSlotProfile(profile?: StorageSlotProfile | null): boolean {
  if (!profile) return false
  if (profile.receivingCategoryCode?.trim()) return true
  if (profile.storageClass?.trim() && profile.storageClass !== "ANY") return true
  if (profile.allowedItemGroupCodes?.some((c) => c?.trim())) return true
  const keys: (keyof StorageSlotProfile)[] = [
    "materialType",
    "processType",
    "stickerShape",
    "productGroup",
    "volume",
    "applicationPlace",
    "equipment",
    "physicalAddress",
  ]
  return keys.some((k) => {
    const v = profile[k]
    return typeof v === "string" && v.trim() && v !== "ANY"
  })
}

export function cellFillPercent(availableQty: number, capacityUnits?: number | null): number | null {
  if (capacityUnits == null || !Number.isFinite(capacityUnits) || capacityUnits <= 0) return null
  const pct = (availableQty / capacityUnits) * 100
  return Math.min(100, Math.max(0, Math.round(pct)))
}

/** Короткий код для UI: ST-SER-…-A01-01 */
export function shortenLocationCode(code: string, max = 36): string {
  const c = code.trim()
  if (c.length <= max) return c
  const head = c.slice(0, 18)
  const tail = c.slice(-12)
  return `${head}…${tail}`
}

export type CellOccupancyStatus = "free" | "occupied" | "reserved" | "blocked"

export function buildTopologyTree(
  locations: Array<{
    locationCode: string
    displayName?: string | null
    warehouseCode: string
    zoneCode: string
    zoneName?: string
    slotProfile?: StorageSlotProfile | null
    slotTitle?: string
  }>,
  opts?: { warehouseLabels?: Record<string, string> }
): TopologyNode[] {
  const whMap = new Map<string, TopologyNode>()

  function locationLabel(loc: {
    locationCode: string
    displayName?: string | null
    slotProfile?: StorageSlotProfile | null
  }) {
    // В дереве узел профиля уже есть выше — лист всегда код ячейки (A-10), не «Стикеры / …».
    const code = (loc.locationCode || "").trim()
    const display = (loc.displayName || "").trim()
    if (display && /^[A-ZА-ЯЁ]-\d+$/i.test(display)) return display.toUpperCase()
    const phys = loc.slotProfile?.physicalAddress?.trim()
    if (phys && phys !== code && phys.length <= 24 && !phys.includes("/")) return phys
    return code || "—"
  }

  for (const loc of locations) {
    const whKey = loc.warehouseCode || "?"
    if (!whMap.has(whKey)) {
      whMap.set(whKey, {
        id: `wh:${whKey}`,
        label: warehouseDisplayLabel(whKey, opts?.warehouseLabels?.[whKey]),
        kind: "warehouse",
        children: [],
      })
    }
    const wh = whMap.get(whKey)!
    let zoneNode = wh.children.find((c) => c.id === `zone:${whKey}:${loc.zoneCode}`)
    if (!zoneNode) {
      zoneNode = {
        id: `zone:${whKey}:${loc.zoneCode}`,
        label: zoneDisplayLabel(loc.zoneCode, loc.zoneName),
        kind: "zone",
        children: [],
      }
      wh.children.push(zoneNode)
    }
    const leafLabel = locationLabel(loc)
    if (isFgWarehouseCode(loc.warehouseCode)) {
      zoneNode.children.push({
        id: `loc:${loc.locationCode}`,
        label: leafLabel,
        kind: "location",
        locationCode: loc.locationCode,
        children: [],
      })
      zoneNode.count = (zoneNode.count ?? 0) + 1
      continue
    }
    const slotTitle = buildSlotTitle(loc.slotProfile)
    const semKey =
      loc.slotTitle && loc.slotTitle !== "—"
        ? loc.slotTitle
        : slotTitle !== "—"
          ? slotTitle
          : "Без профиля"
    let semNode = zoneNode.children.find((c) => c.id === `sem:${whKey}:${loc.zoneCode}:${semKey}`)
    if (!semNode) {
      semNode = {
        id: `sem:${whKey}:${loc.zoneCode}:${semKey}`,
        label: semKey,
        kind: "semantic",
        children: [],
        count: 0,
      }
      zoneNode.children.push(semNode)
    }
    semNode.children.push({
      id: `loc:${loc.locationCode}`,
      label: leafLabel,
      kind: "location",
      locationCode: loc.locationCode,
      children: [],
    })
    semNode.count = (semNode.count ?? 0) + 1
  }

  const sortNodes = (nodes: TopologyNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind === "location" && b.kind === "location" && a.locationCode && b.locationCode) {
        return compareSequentialCellCodes(a.locationCode, b.locationCode)
      }
      return a.label.localeCompare(b.label, "ru", { numeric: true })
    })
    for (const n of nodes) sortNodes(n.children)
  }
  const roots = [...whMap.values()]
  sortNodes(roots)
  for (const wh of roots) sortNodes(wh.children)
  return roots
}
