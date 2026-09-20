/**
 * Универсальная складская классификация.
 * Storage class (S1–S5) — результат физических/операционных признаков,
 * не ручной «класс A = стикеры» и не ABC-оборачиваемость.
 */

export const STORAGE_CLASSES = ["S1", "S2", "S3", "S4", "S5"] as const
export type StorageClassCode = (typeof STORAGE_CLASSES)[number]

export const SIZE_CLASSES = ["MICRO", "SMALL", "MEDIUM", "LARGE", "PALLET"] as const
export type SizeClass = (typeof SIZE_CLASSES)[number]

export const WEIGHT_CLASSES = ["LT1", "LT5", "LT20", "GT20"] as const
export type WeightClass = (typeof WEIGHT_CLASSES)[number]

export const HANDLING_MODES = ["MANUAL", "CART", "FORKLIFT"] as const
export type HandlingMode = (typeof HANDLING_MODES)[number]

export const STORAGE_FORMS = [
  "piece",
  "pack",
  "small_box",
  "bag",
  "carton",
  "sack",
  "roll",
  "bobbin",
  "pallet",
] as const
export type StorageForm = (typeof STORAGE_FORMS)[number]

/** ABC оборачиваемости — отдельно от класса хранения. */
export const VELOCITY_CLASSES = ["A", "B", "C"] as const
export type VelocityClass = (typeof VELOCITY_CLASSES)[number]

export const STORAGE_CLASS_META: Record<
  StorageClassCode,
  { legacy: string; title: string; short: string; hint: string }
> = {
  S1: {
    legacy: "A",
    title: "Мелкоштучный",
    short: "S1 · Мелкоштучный",
    hint: "Ручной отбор в малую ячейку: стикеры, крепёж, канцелярия, скотч, салфетки.",
  },
  S2: {
    legacy: "B",
    title: "Средний тарный",
    short: "S2 · Средний тарный",
    hint: "Средний штучный груз, который сам по себе не сырьё линии. Картон и плёнка сюда не входят.",
  },
  S3: {
    legacy: "C",
    title: "Сырьё",
    short: "S3 · Сырьё",
    hint: "Всё, что идёт в производство: преформа, мешки, клей, картон, плёнка, короба.",
  },
  S4: {
    legacy: "D",
    title: "Палетный / ГП",
    short: "S4 · Палетный",
    hint: "Палета, готовая вода и напитки, погрузчик.",
  },
  S5: {
    legacy: "E",
    title: "Карантин",
    short: "S5 · Карантин",
    hint: "Брак, карантин, списание — не смешивать с обычным хранением.",
  },
}

export const SIZE_CLASS_LABELS: Record<SizeClass, string> = {
  MICRO: "Микро",
  SMALL: "Мелкий",
  MEDIUM: "Средний",
  LARGE: "Крупный",
  PALLET: "Палета",
}

export const WEIGHT_CLASS_LABELS: Record<WeightClass, string> = {
  LT1: "< 1 кг",
  LT5: "1–5 кг",
  LT20: "5–20 кг",
  GT20: "> 20 кг",
}

export const HANDLING_LABELS: Record<HandlingMode, string> = {
  MANUAL: "Ручной",
  CART: "Тележка",
  FORKLIFT: "Погрузчик",
}

export const STORAGE_FORM_LABELS: Record<StorageForm, string> = {
  piece: "Штучно",
  pack: "Пачка",
  small_box: "Малый короб",
  bag: "Пакет",
  carton: "Короб",
  sack: "Мешок",
  roll: "Рулон",
  bobbin: "Бобина",
  pallet: "Палета",
}

export const VELOCITY_LABELS: Record<VelocityClass, string> = {
  A: "A · быстрый",
  B: "B · средний",
  C: "C · медленный",
}

const LEGACY_TO_STORAGE: Record<string, StorageClassCode> = {
  A: "S1",
  B: "S2",
  C: "S3",
  D: "S4",
  F: "S4",
  E: "S5",
}

export const LEGACY_ITEM_CLASS_CODES = ["A", "B", "C", "D", "E", "F"] as const

export function isStorageClassCode(code: string | null | undefined): code is StorageClassCode {
  if (!code) return false
  return (STORAGE_CLASSES as readonly string[]).includes(code.trim().toUpperCase())
}

export function isLegacyItemClassCode(code: string | null | undefined): boolean {
  if (!code) return false
  return (LEGACY_ITEM_CLASS_CODES as readonly string[]).includes(code.trim().toUpperCase())
}

export function defaultStorageClassDirectory(): Array<{
  code: StorageClassCode
  name: string
  sortOrder: number
}> {
  return STORAGE_CLASSES.map((code, i) => ({
    code,
    name: `${STORAGE_CLASS_META[code].title}. ${STORAGE_CLASS_META[code].hint}`,
    sortOrder: (i + 1) * 10,
  }))
}

export function legacyItemClassDirectoryRow(code: string): { code: string; name: string; sortOrder: number } | null {
  const raw = code.trim().toUpperCase()
  const mapped = LEGACY_TO_STORAGE[raw]
  if (!mapped) return null
  return {
    code: raw,
    name: `Устаревший ${raw} → ${mapped} ${STORAGE_CLASS_META[mapped].title}`,
    sortOrder: 200 + (raw.charCodeAt(0) - 64) * 10,
  }
}

export type ProductPhysicalProfile = {
  lengthMm: number | null
  widthMm: number | null
  heightMm: number | null
  weightG: number | null
  maxDimensionMm: number | null
  sizeClass: SizeClass | null
  weightClass: WeightClass | null
  handling: HandlingMode | null
  storageForm: StorageForm | null
  hazardous: boolean
  fragile: boolean
  liquid: boolean
  requiresTemperatureControl: boolean
  requiresQuarantine: boolean
  serialControl: boolean
  lotControl: boolean
  expiryControl: boolean
  storageClass: StorageClassCode
  storageClassSource: "explicit" | "physical" | "heuristic" | "legacy_class" | "default"
  velocityClass: VelocityClass
}

export type LocationPhysicalLimits = {
  storageClass?: string | null
  allowedStorageClasses?: string[] | null
  maxLengthMm?: number | null
  maxWidthMm?: number | null
  maxHeightMm?: number | null
  maxWeightG?: number | null
  handling?: string | null
  sizeClass?: string | null
}

export type RulePhysicalCriteria = {
  storageClass?: string | null
  sizeClass?: string | null
  weightClass?: string | null
  handling?: string | null
  storageForms?: string[] | null
  maxDimensionMm?: number | null
  maxWeightG?: number | null
  hazardous?: boolean | null
  fragile?: boolean | null
  liquid?: boolean | null
  requiresTemperatureControl?: boolean | null
  requiresQuarantine?: boolean | null
  velocityClass?: string | null
}

export type DeriveProductInput = {
  name?: string | null
  itemTypeCode?: string | null
  itemClassCode?: string | null
  itemGroupCode?: string | null
  productGroup?: string | null
  materialType?: string | null
  lengthMm?: number | null
  widthMm?: number | null
  heightMm?: number | null
  weightG?: number | null
  netWeightKg?: number | null
  grossWeightKg?: number | null
  hazardous?: boolean | null
  hazardClass?: string | null
  fragile?: boolean | null
  liquid?: boolean | null
  temperatureMin?: number | null
  temperatureMax?: number | null
  requiresQuarantine?: boolean | null
  serialControl?: boolean | null
  lotControl?: boolean | null
  batchControl?: boolean | null
  expiryControl?: boolean | null
  storageForm?: string | null
  handling?: string | null
  storageClass?: string | null
  velocityClass?: string | null
}

export type InferLocationClassInput = {
  storageClass?: string | null
  warehouseCode?: string | null
  zoneCode?: string | null
  locationCode?: string | null
  processType?: string | null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const n = Number(v.replace(",", ".").replace(/\s/g, ""))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v
  if (v === "true" || v === "1") return true
  if (v === "false" || v === "0") return false
  return null
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null
  const s = v.trim()
  return s || null
}

export function normalizeStorageClass(code: string | null | undefined): StorageClassCode | null {
  if (!code) return null
  const raw = code.trim().toUpperCase()
  if ((STORAGE_CLASSES as readonly string[]).includes(raw)) return raw as StorageClassCode
  return LEGACY_TO_STORAGE[raw] ?? null
}

export function storageClassLabel(code: string | null | undefined): string {
  const n = normalizeStorageClass(code)
  if (!n) return code?.trim() || "—"
  return STORAGE_CLASS_META[n].short
}

export function deriveSizeClass(maxDimensionMm: number | null): SizeClass | null {
  if (maxDimensionMm == null || maxDimensionMm <= 0) return null
  if (maxDimensionMm <= 80) return "MICRO"
  if (maxDimensionMm <= 400) return "SMALL"
  if (maxDimensionMm <= 800) return "MEDIUM"
  if (maxDimensionMm <= 1400) return "LARGE"
  return "PALLET"
}

export function deriveWeightClass(weightG: number | null): WeightClass | null {
  if (weightG == null || weightG < 0) return null
  if (weightG < 1000) return "LT1"
  if (weightG <= 5000) return "LT5"
  if (weightG <= 20000) return "LT20"
  return "GT20"
}

export function kgToGrams(kg: number | null | undefined): number | null {
  if (kg == null || !Number.isFinite(kg) || kg < 0) return null
  return Math.round(kg * 1000)
}

function asSearchText(parts: Array<string | null | undefined>): string {
  return parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/ё/g, "е")
}

function titleBlob(input: DeriveProductInput): string {
  return asSearchText([input.name, input.nomenclature])
}

export function isStickerOrLabelName(name: string | null | undefined): boolean {
  const t = asSearchText([name])
  return /^(стикер|этикет|план\s+стикер|план\s+этикет)/.test(t)
}

export function isBottledDrinkName(name: string | null | undefined): boolean {
  return looksLikeFinishedDrink(asSearchText([name]))
}

function blobOf(input: DeriveProductInput): string {
  return asSearchText([
    input.name,
    input.itemGroupCode,
    input.productGroup,
    input.storageForm,
  ])
}

function looksLikeFinishedDrink(text: string): boolean {
  if (/этикет|стикер|преформ|колпач|пробк|пленк|плёнк|картон|упаков|эмульс|суспенз|концентрат|сироп|клей/.test(text)) {
    return false
  }
  return /напит|вода\b|газир|тархун|славда|шмаковк|готовая\s*продук|finished|палет[аы]?\s*(вод|гп)/.test(text)
}

function looksLikePackaging(text: string): boolean {
  return /упаков|картон|короб|пленк|плёнк|стретч|скотч-машин|shrink|packaging/.test(text) &&
    !/этикет|стикер/.test(text)
}

function looksLikeBulkRaw(text: string): boolean {
  return /сырье|сырьё|преформ|мешок|бобина|гранул|сахар-песок|25\s*кг|суспенз|концентрат|сироп|клей|эмульс|картон|короб|пленк|плёнк|стретч|упаков|raw[\s_-]*material/.test(
    text
  )
}

function looksLikeSmallPiece(text: string): boolean {
  return /стикер|этикет|скрепк|ручк|болт|винт|гайк|шайб|скотч|салфет|канцел|крепеж|клипс|хомут|маркер|кнопк|spare|consumable|label|sticker/.test(
    text
  )
}

function looksLikeQuarantine(text: string): boolean {
  return /карантин|брак|дефект|списан|quarantine|defect|writeoff/.test(text)
}

function inferStorageForm(text: string, explicit: string | null): StorageForm | null {
  const n = (explicit ?? "").trim().toLowerCase()
  if ((STORAGE_FORMS as readonly string[]).includes(n)) return n as StorageForm
  if (/палет/.test(text)) return "pallet"
  if (/мешок|sack/.test(text)) return "sack"
  if (/бобин/.test(text)) return "bobbin"
  if (/рулон|roll/.test(text)) return "roll"
  if (/короб|carton/.test(text)) return "carton"
  if (/пачк|pack/.test(text)) return "pack"
  if (/пакет|bag/.test(text)) return "bag"
  if (looksLikeSmallPiece(text)) return "piece"
  return null
}

function inferHandling(
  text: string,
  explicit: string | null,
  weightG: number | null,
  storageForm: StorageForm | null
): HandlingMode | null {
  const n = (explicit ?? "").trim().toUpperCase()
  if ((HANDLING_MODES as readonly string[]).includes(n)) return n as HandlingMode
  if (storageForm === "pallet" || /погрузчик|forklift|палет/.test(text)) return "FORKLIFT"
  if ((weightG != null && weightG > 20000) || storageForm === "sack" || /тележк|cart/.test(text)) {
    return "CART"
  }
  if (looksLikeSmallPiece(text) || (weightG != null && weightG <= 5000)) return "MANUAL"
  return null
}

function classFromPhysical(profile: {
  maxDimensionMm: number | null
  weightG: number | null
  handling: HandlingMode | null
  storageForm: StorageForm | null
  hazardous: boolean
  requiresTemperatureControl: boolean
  requiresQuarantine: boolean
}): StorageClassCode | null {
  if (profile.requiresQuarantine) return "S5"
  if (profile.storageForm === "pallet" || profile.handling === "FORKLIFT") return "S4"
  if (
    profile.storageForm === "sack" ||
    profile.storageForm === "bobbin" ||
    profile.storageForm === "carton" ||
    profile.storageForm === "roll"
  ) {
    return "S3"
  }

  const maxD = profile.maxDimensionMm
  const w = profile.weightG
  const smallEnough =
    (maxD == null || maxD <= 400) &&
    (w == null || w <= 5000) &&
    !profile.hazardous &&
    !profile.requiresTemperatureControl &&
    (profile.handling == null || profile.handling === "MANUAL") &&
    (profile.storageForm == null ||
      profile.storageForm === "piece" ||
      profile.storageForm === "pack" ||
      profile.storageForm === "small_box" ||
      profile.storageForm === "bag")

  if (maxD != null && w != null) {
    if (smallEnough) return "S1"
    if (w > 20000 || (maxD != null && maxD > 1400)) return "S4"
    if (w > 5000) return "S3"
    return "S2"
  }
  if (smallEnough && (maxD != null || w != null)) return "S1"
  return null
}

function classFromHeuristic(input: DeriveProductInput, text: string): StorageClassCode | null {
  const title = titleBlob(input) || text
  if (input.requiresQuarantine || looksLikeQuarantine(title)) return "S5"
  const type = (input.itemTypeCode ?? "").toLowerCase()
  if (looksLikeFinishedDrink(title)) return "S4"
  if (looksLikeSmallPiece(title) && !looksLikeBulkRaw(title)) return "S1"
  if (type === "finished_goods" || type === "product") return "S4"
  if (type === "stickers" || type === "sticker") return "S1"
  if (looksLikePackaging(title) || looksLikeBulkRaw(title) || type === "packaging" || type === "raw_material") {
    return "S3"
  }
  if (type === "materials") return "S3"
  if (type === "components" || type === "consumable" || type === "spare_part") return "S1"
  return null
}

export function deriveProductPhysicalProfile(input: DeriveProductInput): ProductPhysicalProfile {
  const lengthMm = num(input.lengthMm)
  const widthMm = num(input.widthMm)
  const heightMm = num(input.heightMm)
  const weightG =
    num(input.weightG) ?? kgToGrams(input.grossWeightKg) ?? kgToGrams(input.netWeightKg)
  const dims = [lengthMm, widthMm, heightMm].filter((n): n is number => n != null && n > 0)
  const maxDimensionMm = dims.length ? Math.max(...dims) : null
  const text = blobOf(input)

  const hazardous =
    bool(input.hazardous) === true || Boolean(str(input.hazardClass) && str(input.hazardClass) !== "NONE")
  const fragile = bool(input.fragile) === true
  const liquid = bool(input.liquid) === true || /жидк|liquid/.test(text)
  const requiresTemperatureControl =
    input.temperatureMin != null ||
    input.temperatureMax != null ||
    /холод|температур/.test(text)
  const requiresQuarantine = bool(input.requiresQuarantine) === true || looksLikeQuarantine(text)

  const storageForm = inferStorageForm(text, input.storageForm ?? null)
  const handling = inferHandling(text, input.handling ?? null, weightG, storageForm)
  const sizeClass = deriveSizeClass(maxDimensionMm)
  const weightClass = deriveWeightClass(weightG)

  const explicit = normalizeStorageClass(input.storageClass)
  const fromPhysical = classFromPhysical({
    maxDimensionMm,
    weightG,
    handling,
    storageForm,
    hazardous,
    requiresTemperatureControl,
    requiresQuarantine,
  })
  const fromHeuristic = classFromHeuristic(input, text)
  const fromLegacy = normalizeStorageClass(input.itemClassCode)

  let storageClass: StorageClassCode = "S1"
  let storageClassSource: ProductPhysicalProfile["storageClassSource"] = "default"
  if (explicit) {
    storageClass = explicit
    storageClassSource = "explicit"
  } else if (fromPhysical) {
    storageClass = fromPhysical
    storageClassSource = "physical"
  } else if (fromHeuristic) {
    storageClass = fromHeuristic
    storageClassSource = "heuristic"
  } else if (fromLegacy) {
    storageClass = fromLegacy
    storageClassSource = "legacy_class"
  }

  const velocityRaw = (input.velocityClass ?? "").trim().toUpperCase()
  const velocityClass = (VELOCITY_CLASSES as readonly string[]).includes(velocityRaw)
    ? (velocityRaw as VelocityClass)
    : "B"

  return {
    lengthMm,
    widthMm,
    heightMm,
    weightG,
    maxDimensionMm,
    sizeClass,
    weightClass,
    handling,
    storageForm,
    hazardous,
    fragile,
    liquid,
    requiresTemperatureControl,
    requiresQuarantine,
    serialControl: bool(input.serialControl) === true,
    lotControl: bool(input.lotControl) === true || bool(input.batchControl) === true,
    expiryControl: bool(input.expiryControl) === true,
    storageClass,
    storageClassSource,
    velocityClass,
  }
}

export function deriveStorageClassFromItemRow(item: {
  name?: string | null
  item_type_code?: string | null
  item_class_code?: string | null
  item_group_code?: string | null
  product_group?: string | null
  material_type?: string | null
  nomenclature?: string | null
  item_attrs_json?: unknown
}): StorageClassCode {
  const fromAttrs = parsePhysicalProfileFromItemAttrs(item.item_attrs_json)
  return deriveProductPhysicalProfile({
    ...fromAttrs,
    storageClass: undefined,
    name: item.name ?? item.nomenclature,
    itemTypeCode: item.item_type_code,
    itemClassCode: isLegacyItemClassCode(item.item_class_code) ? item.item_class_code : undefined,
    itemGroupCode: item.item_group_code,
    productGroup: item.product_group,
    materialType: item.material_type,
  }).storageClass
}

export function parsePhysicalProfileFromItemAttrs(itemAttrsJson: unknown): Partial<DeriveProductInput> {
  const attrs = asRecord(itemAttrsJson)
  const nom = asRecord(attrs?.nomenclature)
  const phys = asRecord(attrs?.physicalProfile ?? attrs?.physical_profile)
  const src = { ...(nom ?? {}), ...(phys ?? {}) }
  return {
    lengthMm: num(src.lengthMm ?? src.length_mm),
    widthMm: num(src.widthMm ?? src.width_mm),
    heightMm: num(src.heightMm ?? src.height_mm),
    weightG: num(src.weightG ?? src.weight_g),
    netWeightKg: num(src.netWeightKg ?? src.net_weight_kg),
    grossWeightKg: num(src.grossWeightKg ?? src.gross_weight_kg),
    hazardous: bool(src.hazardous),
    hazardClass: str(src.hazardClass ?? src.hazard_class),
    fragile: bool(src.fragile),
    liquid: bool(src.liquid),
    temperatureMin: num(src.temperatureMin ?? src.temperature_min),
    temperatureMax: num(src.temperatureMax ?? src.temperature_max),
    requiresQuarantine: bool(src.requiresQuarantine ?? src.requires_quarantine),
    serialControl: bool(src.serialControl ?? src.serial_control),
    lotControl: bool(src.lotControl ?? src.lot_control),
    batchControl: bool(src.batchControl ?? src.batch_control),
    expiryControl: bool(src.expiryControl ?? src.expirationControl ?? src.expiration_control),
    storageForm: str(src.storageForm ?? src.storage_form),
    handling: str(src.handling),
    storageClass: str(src.storageClass ?? src.storage_class),
    velocityClass: str(src.velocityClass ?? src.velocity_class),
  }
}

export function inferLocationStorageClass(input: InferLocationClassInput): StorageClassCode | null {
  const explicit = normalizeStorageClass(input.storageClass)
  if (explicit) return explicit

  const process = (input.processType ?? "").toUpperCase()
  if (process === "QUARANTINE" || process === "DEFECT" || process === "WRITEOFF") return "S5"

  const zone = (input.zoneCode ?? "").toUpperCase()
  if (zone === "QUARANTINE" || zone === "DEFECT") return "S5"

  const warehouse = (input.warehouseCode ?? "").toUpperCase()
  if (warehouse === "FG" || warehouse.startsWith("FG-")) return "S4"

  const code = (input.locationCode ?? "").trim().toUpperCase()
  const prefix = code.match(/^([A-E])(?:-|\d)/)?.[1]
  if (prefix === "A") return "S1"
  if (prefix === "B") return "S2"
  if (prefix === "C") return "S3"
  if (prefix === "D") return "S4"
  if (prefix === "E") return "S5"

  if (zone === "ST-SER" || zone === "ST-BAGG" || zone === "MARK") return "S1"
  if (zone === "SHIP") return "S4"
  return null
}

export function parseLocationPhysicalLimits(slot: Record<string, unknown> | null | undefined): LocationPhysicalLimits {
  const s = slot ?? {}
  const allowed = s.allowedStorageClasses ?? s.allowed_storage_classes
  return {
    storageClass: str(s.storageClass ?? s.storage_class),
    allowedStorageClasses: Array.isArray(allowed)
      ? allowed.map((x) => String(x).trim()).filter(Boolean)
      : null,
    maxLengthMm: num(s.maxLengthMm ?? s.max_length_mm),
    maxWidthMm: num(s.maxWidthMm ?? s.max_width_mm),
    maxHeightMm: num(s.maxHeightMm ?? s.max_height_mm),
    maxWeightG: num(s.maxWeightG ?? s.max_weight_g),
    handling: str(s.handling),
    sizeClass: str(s.sizeClass ?? s.size_class),
  }
}

export function locationAcceptsStorageClass(
  locationClass: StorageClassCode | null,
  allowed: string[] | null | undefined,
  itemClass: StorageClassCode
): boolean {
  const allowedNorm = (allowed ?? [])
    .map((c) => normalizeStorageClass(c))
    .filter((c): c is StorageClassCode => Boolean(c))
  if (allowedNorm.length) return allowedNorm.includes(itemClass)
  if (!locationClass) return itemClass !== "S5"
  return locationClass === itemClass
}

export function itemFitsLocationLimits(
  item: ProductPhysicalProfile,
  limits: LocationPhysicalLimits
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  const itemDims = [item.lengthMm, item.widthMm, item.heightMm]
    .filter((n): n is number => n != null && n > 0)
    .sort((a, b) => a - b)
  const cellDims = [limits.maxLengthMm, limits.maxWidthMm, limits.maxHeightMm]
    .filter((n): n is number => n != null && n > 0)
    .sort((a, b) => a - b)
  if (itemDims.length === 3 && cellDims.length === 3) {
    const overflow = itemDims.some((d, i) => d > cellDims[i]!)
    if (overflow) {
      reasons.push(
        `Габарит ${itemDims.join("×")} мм не входит в ${cellDims.join("×")} мм`
      )
      return { ok: false, reasons }
    }
    reasons.push("Габарит входит в ячейку")
  }
  if (item.maxDimensionMm != null && cellDims.length && cellDims.length < 3) {
    const maxCell = Math.max(...cellDims)
    if (item.maxDimensionMm > maxCell) {
      reasons.push(`Макс. сторона ${item.maxDimensionMm} мм > ${maxCell} мм`)
      return { ok: false, reasons }
    }
  }
  if (item.weightG != null && limits.maxWeightG != null && item.weightG > limits.maxWeightG) {
    reasons.push(`Вес ${item.weightG} г > ${limits.maxWeightG} г`)
    return { ok: false, reasons }
  }
  return { ok: true, reasons }
}

export function defaultCriteriaForClass(code: StorageClassCode): RulePhysicalCriteria {
  if (code === "S1") {
    return {
      storageClass: "S1",
      sizeClass: "SMALL",
      handling: "MANUAL",
      storageForms: ["piece", "pack", "small_box", "bag"],
      maxDimensionMm: 400,
      maxWeightG: 5000,
      hazardous: false,
      requiresTemperatureControl: false,
    }
  }
  if (code === "S2") {
    return {
      storageClass: "S2",
      handling: "CART",
      storageForms: ["carton", "roll", "pack"],
      maxDimensionMm: 800,
      maxWeightG: 20000,
    }
  }
  if (code === "S3") {
    return {
      storageClass: "S3",
      storageForms: ["sack", "bobbin", "carton", "roll"],
      maxWeightG: null,
    }
  }
  if (code === "S4") {
    return {
      storageClass: "S4",
      handling: "FORKLIFT",
      storageForms: ["pallet"],
    }
  }
  return {
    storageClass: "S5",
    requiresQuarantine: true,
  }
}

function listIncludes(list: string[] | null | undefined, value: string | null): boolean {
  if (!list?.length) return true
  if (!value) return true
  const want = list.map((x) => x.trim().toLowerCase())
  return want.includes(value.trim().toLowerCase())
}

export function physicalCriteriaMatch(
  criteria: RulePhysicalCriteria | null | undefined,
  item: ProductPhysicalProfile
): boolean {
  if (!criteria) return true
  const wantClass = normalizeStorageClass(criteria.storageClass)
  if (wantClass && wantClass !== item.storageClass) return false
  if (criteria.sizeClass && item.sizeClass && criteria.sizeClass !== item.sizeClass) return false
  if (criteria.weightClass && item.weightClass && criteria.weightClass !== item.weightClass) {
    return false
  }
  if (criteria.handling && item.handling && criteria.handling !== item.handling) return false
  if (!listIncludes(criteria.storageForms, item.storageForm)) return false
  if (criteria.maxDimensionMm != null && item.maxDimensionMm != null) {
    if (item.maxDimensionMm > criteria.maxDimensionMm) return false
  }
  if (criteria.maxWeightG != null && item.weightG != null) {
    if (item.weightG > criteria.maxWeightG) return false
  }
  if (criteria.hazardous === false && item.hazardous) return false
  if (criteria.hazardous === true && !item.hazardous) return false
  if (criteria.fragile === false && item.fragile) return false
  if (criteria.liquid === false && item.liquid) return false
  if (criteria.requiresTemperatureControl === false && item.requiresTemperatureControl) return false
  if (criteria.requiresQuarantine === true && !item.requiresQuarantine) return false
  if (criteria.requiresQuarantine === false && item.requiresQuarantine) return false
  if (criteria.velocityClass && criteria.velocityClass !== item.velocityClass) return false
  return true
}

export function parseRulePhysicalCriteria(raw: unknown): RulePhysicalCriteria {
  const o = asRecord(raw) ?? {}
  const forms = o.storageForms ?? o.storage_forms
  return {
    storageClass: str(o.storageClass ?? o.storage_class),
    sizeClass: str(o.sizeClass ?? o.size_class),
    weightClass: str(o.weightClass ?? o.weight_class),
    handling: str(o.handling),
    storageForms: Array.isArray(forms) ? forms.map((x) => String(x).trim()).filter(Boolean) : null,
    maxDimensionMm: num(o.maxDimensionMm ?? o.max_dimension_mm),
    maxWeightG: num(o.maxWeightG ?? o.max_weight_g),
    hazardous: bool(o.hazardous),
    fragile: bool(o.fragile),
    liquid: bool(o.liquid),
    requiresTemperatureControl: bool(o.requiresTemperatureControl ?? o.requires_temperature_control),
    requiresQuarantine: bool(o.requiresQuarantine ?? o.requires_quarantine),
    velocityClass: str(o.velocityClass ?? o.velocity_class),
  }
}

export function describePhysicalCriteria(criteria: RulePhysicalCriteria | null | undefined): string[] {
  if (!criteria) return []
  const parts: string[] = []
  if (criteria.storageClass) parts.push(storageClassLabel(criteria.storageClass))
  if (criteria.sizeClass) {
    parts.push(SIZE_CLASS_LABELS[criteria.sizeClass as SizeClass] ?? criteria.sizeClass)
  }
  if (criteria.maxDimensionMm != null) parts.push(`≤ ${criteria.maxDimensionMm} мм`)
  if (criteria.maxWeightG != null) {
    parts.push(criteria.maxWeightG >= 1000 ? `≤ ${criteria.maxWeightG / 1000} кг` : `≤ ${criteria.maxWeightG} г`)
  }
  if (criteria.handling) {
    parts.push(HANDLING_LABELS[criteria.handling as HandlingMode] ?? criteria.handling)
  }
  if (criteria.storageForms?.length) {
    parts.push(
      criteria.storageForms.map((f) => STORAGE_FORM_LABELS[f as StorageForm] ?? f).join("/")
    )
  }
  if (criteria.hazardous === false) parts.push("не опасный")
  if (criteria.requiresTemperatureControl === false) parts.push("без температурного режима")
  if (criteria.requiresQuarantine === true) parts.push("карантин")
  if (criteria.velocityClass) {
    parts.push(VELOCITY_LABELS[criteria.velocityClass as VelocityClass] ?? criteria.velocityClass)
  }
  return parts
}

export function fillPercentBonus(fillPercent: number | null): number {
  if (fillPercent == null || !Number.isFinite(fillPercent)) return 0
  if (fillPercent >= 40 && fillPercent <= 70) return 10
  if (fillPercent > 90) return -8
  if (fillPercent < 10) return 2
  return 0
}
