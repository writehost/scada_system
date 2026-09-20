import type { ImportWmsItemRow, ImportWmsItemUomRow } from "@/lib/wms-api"
import { readEquipmentSerialFromAttrs } from "@/lib/wms/qpass"
import { deriveProductPhysicalProfile } from "@/lib/wms/physical-profile"

/** Полная модель номенклатуры (для типизации и хранения в `itemAttrs`). */
export type NomenclatureStatus = "ACTIVE" | "INACTIVE" | "BLOCKED" | "ARCHIVED"

export type NomenclatureType =
  | "PRODUCT"
  | "STICKER"
  | "LABEL"
  | "PACKAGING"
  | "SPARE_PART"
  | "CONSUMABLE"
  | "RAW_MATERIAL"
  | "SEMI_FINISHED"
  | "SERVICE"
  | "EQUIPMENT"
  | "OTHER"

/**
 * Тип из формы / справочника → код колонки `wms_items.item_type_code` (список номенклатуры, фильтры).
 */
export function nomenclatureFormTypeToItemTypeCode(type: string | null | undefined): string | null {
  const raw = (type ?? "").trim()
  if (!raw) return null
  const v = raw.toLowerCase().replace(/ё/g, "е")
  const map: Record<string, string> = {
    product: "finished_goods",
    finished_goods: "finished_goods",
    goods: "goods",
    sticker: "stickers",
    stickers: "stickers",
    label: "stickers",
    packaging: "packaging",
    spare_part: "components",
    components: "components",
    consumable: "materials",
    raw_material: "materials",
    materials: "materials",
    semi_finished: "goods",
    service: "other",
    other: "other",
    equipment: "equipment",
  }
  return map[v] ?? v
}

/** Код колонки / attrs → значение для select «Тип номенклатуры». */
export function itemTypeCodeToFormType(code: string | null | undefined): string {
  const raw = (code ?? "").trim()
  if (!raw) return "PRODUCT"
  if (/^[A-Z][A-Z0-9_]*$/.test(raw)) return raw
  const v = raw.toLowerCase().replace(/ё/g, "е")
  const map: Record<string, string> = {
    finished_goods: "PRODUCT",
    goods: "PRODUCT",
    stickers: "STICKER",
    packaging: "PACKAGING",
    components: "SPARE_PART",
    materials: "RAW_MATERIAL",
    other: "OTHER",
    equipment: "EQUIPMENT",
  }
  return map[v] ?? raw.toUpperCase()
}

export type MarkingSystem = "CHESTNY_ZNAK" | "INTERNAL" | "NONE"

export type ValuationMethod = "FIFO" | "FEFO" | "AVERAGE" | "SPECIFIC"

export interface NomenclatureUnit {
  id: string
  unitCode: string
  unitName: string
  factorToBase: number
  isBase: boolean
}

/** Снимок номенклатуры в `item_attrs_json` (ключ `nomenclature`). */
/** Алиас под название из ТЗ; данные хранятся в `item_attrs_json.nomenclature`. */
export type Nomenclature = NomenclatureAttrsPayload

export interface NomenclatureAttrsPayload {
  /** Код типа (совпадает со справочником `wms_nomenclature_type_defs`, может быть пользовательским). */
  type: string
  status: NomenclatureStatus
  shortName?: string
  printName?: string
  description?: string
  comment?: string
  externalCode?: string

  categoryId?: string
  categoryName?: string
  groupId?: string
  groupName?: string
  subgroupId?: string
  subgroupName?: string
  brandId?: string
  brandName?: string
  manufacturerId?: string
  manufacturerName?: string

  gtin?: string
  ean13?: string
  barcode?: string
  datamatrixPrefix?: string
  article?: string
  sku?: string
  vendorCode?: string

  baseUnitId?: string
  baseUnitName?: string
  baseUnitCode?: string
  storageUnitId?: string
  storageUnitName?: string
  storageUnitCode?: string
  purchaseUnitId?: string
  purchaseUnitName?: string
  purchaseUnitCode?: string
  issueUnitId?: string
  issueUnitName?: string
  issueUnitCode?: string
  conversionFactor?: number

  batchControl: boolean
  serialControl: boolean
  markingControl: boolean
  expirationControl: boolean
  fefoEnabled: boolean
  fifoEnabled: boolean
  qualityControl: boolean

  shelfLifeDays?: number
  storageLifeDays?: number
  nearExpirationDays?: number
  criticalExpirationDays?: number
  minDaysForAcceptance?: number
  blockExpired: boolean
  allowNoExpirationDate: boolean

  storageConditions?: string
  temperatureMin?: number
  temperatureMax?: number
  humidityMin?: number
  humidityMax?: number
  lightSensitive?: boolean
  fragile?: boolean
  hazardClass?: string
  allergenCodes?: string
  stockOwnership?: "own" | "vendor" | "customer"

  lengthMm?: number
  widthMm?: number
  heightMm?: number
  diameterMm?: number
  netWeightKg?: number
  grossWeightKg?: number
  volumeM3?: number

  isSticker: boolean
  isLabel: boolean
  isPackaging: boolean
  isSparePart: boolean
  isConsumable: boolean
  /** Расходник для печати этикеток на терминале (остаток показывается в «Заказы кодов»). */
  printLabelConsumable: boolean
  /** Вид стикера: единичный / блочный (сопоставляется с заказом терминала). */
  stickerPrintKind?: "single" | "block12" | ""

  labelWidthMm?: number
  labelHeightMm?: number
  labelMaterial?: string
  adhesiveType?: string
  rollCoreDiameterMm?: number
  rollOuterDiameterMm?: number
  rollWidthMm?: number
  rollInnerDiameterMm?: number
  stickersPerRoll?: number
  labelsPerRoll?: number
  rowsPerRoll?: number
  printerType?: string
  templateId?: string

  markingRequired: boolean
  markingSystem?: MarkingSystem
  productGroup?: string
  tnvedCode?: string
  okpd2Code?: string
  czProductGroup?: string
  czGtin?: string

  requiresAcceptanceCheck: boolean
  requiresCzCheck: boolean
  requiresPrintOnAcceptance: boolean
  defaultAcceptanceCriteriaId?: string
  acceptanceTolerancePercent?: number
  allowPartialReceiving: boolean
  allowOverReceiving: boolean

  defaultWarehouseId?: string
  defaultZoneId?: string
  defaultCellId?: string
  preferredWarehouseIds?: string[]
  allowedWarehouseIds?: string[]
  minStock?: number
  maxStock?: number
  targetStock?: number
  reorderPoint?: number
  safetyStock?: number
  leadTimeDays?: number

  defaultLabelTemplateId?: string
  printTemplateId?: string
  printOnReceiving: boolean
  printOnIssue: boolean
  printCopies?: number

  vatRate?: number
  accountingAccount?: string
  costPrice?: number
  currency?: string
  valuationMethod?: ValuationMethod

  externalId?: string
  erpCode?: string
  oneCCode?: string
  oneCGuid?: string
  mesCode?: string
  scadaCode?: string
  equipmentSerial?: string

  imageUrl?: string
  iconUrl?: string
  datasheetUrl?: string
  certificateUrl?: string
  instructionUrl?: string

  units?: NomenclatureUnit[]

  /** Авторасчёт ВГХ палеты от литража бутылки, штук, поддона и плёнки. */
  packing?: NomenclaturePacking
}

export type NomenclaturePacking = {
  autoVgh?: boolean
  volumeL?: number
  bottleWeightG?: number
  bottlesPerPallet?: number
  layers?: number
  bottlesPerLayer?: number
  palletTareKg?: number
  filmKg?: number
}

export type NomenclatureFormState = {
  packagingProfile: string
  code: string
  name: string
  /** Составное наименование / код номенклатуры (`wms_items.nomenclature`). */
  nomenclature: string
  sku: string
  primaryBarcode: string

  shortName: string
  printName: string
  description: string
  comment: string
  externalCode: string

  type: string
  status: NomenclatureStatus

  categoryId: string
  categoryName: string
  groupId: string
  groupName: string
  subgroupId: string
  subgroupName: string
  brandId: string
  brandName: string
  manufacturerId: string
  manufacturerName: string

  gtin: string
  ean13: string
  datamatrixPrefix: string
  article: string
  vendorCode: string

  baseUnitId: string
  baseUnitName: string
  baseUnitCode: string
  storageUnitId: string
  storageUnitName: string
  storageUnitCode: string
  purchaseUnitId: string
  purchaseUnitName: string
  purchaseUnitCode: string
  issueUnitId: string
  issueUnitName: string
  issueUnitCode: string
  conversionFactor: string

  batchControl: boolean
  serialControl: boolean
  markingControl: boolean
  expirationControl: boolean
  fefoEnabled: boolean
  fifoEnabled: boolean
  qualityControl: boolean

  shelfLifeDays: string
  storageLifeDays: string
  nearExpirationDays: string
  criticalExpirationDays: string
  minDaysForAcceptance: string
  blockExpired: boolean
  allowNoExpirationDate: boolean

  storageConditions: string
  temperatureMin: string
  temperatureMax: string
  humidityMin: string
  humidityMax: string
  lightSensitive: boolean
  fragile: boolean
  hazardClass: string
  allergenCodes: string
  stockOwnership: string

  lengthMm: string
  widthMm: string
  heightMm: string
  diameterMm: string
  netWeightKg: string
  grossWeightKg: string
  volumeM3: string
  rollInnerDiameterMm: string
  rollOuterDiameterMm: string
  rollWidthMm: string
  stickersPerRoll: string
  autoVgh: boolean
  bottleVolumeL: string
  bottleWeightG: string
  bottlesPerPallet: string
  packLayers: string
  bottlesPerLayer: string
  palletTareKg: string
  filmKg: string

  isSticker: boolean
  isLabel: boolean
  isPackaging: boolean
  isSparePart: boolean
  isConsumable: boolean
  printLabelConsumable: boolean
  stickerPrintKind: "single" | "block12" | ""

  labelWidthMm: string
  labelHeightMm: string
  labelMaterial: string
  adhesiveType: string
  rollCoreDiameterMm: string
  labelsPerRoll: string
  rowsPerRoll: string
  printerType: string
  templateId: string

  markingRequired: boolean
  markingSystem: MarkingSystem | ""
  productGroupCz: string
  tnvedCode: string
  okpd2Code: string
  czProductGroup: string
  czGtin: string

  requiresAcceptanceCheck: boolean
  requiresCzCheck: boolean
  requiresPrintOnAcceptance: boolean
  defaultAcceptanceCriteriaId: string
  acceptanceTolerancePercent: string
  allowPartialReceiving: boolean
  allowOverReceiving: boolean

  defaultWarehouseId: string
  defaultZoneId: string
  defaultCellId: string
  preferredWarehouseIds: string
  allowedWarehouseIds: string
  minStock: string
  maxStock: string
  targetStock: string
  reorderPoint: string
  safetyStock: string
  leadTimeDays: string

  defaultLabelTemplateId: string
  printTemplateId: string
  printOnReceiving: boolean
  printOnIssue: boolean
  printCopies: string

  vatRate: string
  accountingAccount: string
  costPrice: string
  currency: string
  valuationMethod: ValuationMethod | ""

  externalId: string
  erpCode: string
  oneCCode: string
  oneCGuid: string
  mesCode: string
  scadaCode: string
  equipmentSerial: string

  imageUrl: string
  iconUrl: string
  datasheetUrl: string
  certificateUrl: string
  instructionUrl: string
}

export function emptyNomenclatureForm(): NomenclatureFormState {
  return {
    packagingProfile: "custom",
    code: "",
    name: "",
    nomenclature: "",
    sku: "",
    primaryBarcode: "",

    shortName: "",
    printName: "",
    description: "",
    comment: "",
    externalCode: "",

    type: "PRODUCT",
    status: "ACTIVE",

    categoryId: "",
    categoryName: "",
    groupId: "",
    groupName: "",
    subgroupId: "",
    subgroupName: "",
    brandId: "",
    brandName: "",
    manufacturerId: "",
    manufacturerName: "",

    gtin: "",
    ean13: "",
    datamatrixPrefix: "",
    article: "",
    vendorCode: "",

    baseUnitId: "",
    baseUnitName: "шт",
    baseUnitCode: "PCS",
    storageUnitId: "",
    storageUnitName: "",
    storageUnitCode: "ROLL",
    purchaseUnitId: "",
    purchaseUnitName: "",
    purchaseUnitCode: "BOX",
    issueUnitId: "",
    issueUnitName: "",
    issueUnitCode: "",
    conversionFactor: "",

    batchControl: false,
    serialControl: false,
    markingControl: false,
    expirationControl: false,
    fefoEnabled: false,
    fifoEnabled: false,
    qualityControl: false,

    shelfLifeDays: "",
    storageLifeDays: "",
    nearExpirationDays: "",
    criticalExpirationDays: "",
    minDaysForAcceptance: "",
    blockExpired: false,
    allowNoExpirationDate: false,

    storageConditions: "",
    temperatureMin: "",
    temperatureMax: "",
    humidityMin: "",
    humidityMax: "",
    lightSensitive: false,
    fragile: false,
    hazardClass: "",
    allergenCodes: "",
    stockOwnership: "",

    lengthMm: "",
    widthMm: "",
    heightMm: "",
    diameterMm: "",
    netWeightKg: "",
    grossWeightKg: "",
    volumeM3: "",
    rollInnerDiameterMm: "",
    rollOuterDiameterMm: "",
    rollWidthMm: "",
    stickersPerRoll: "",
    autoVgh: true,
    bottleVolumeL: "",
    bottleWeightG: "",
    bottlesPerPallet: "",
    packLayers: "",
    bottlesPerLayer: "",
    palletTareKg: "",
    filmKg: "",

    isSticker: false,
    isLabel: false,
    isPackaging: false,
    isSparePart: false,
    isConsumable: false,
    printLabelConsumable: false,
    stickerPrintKind: "",

    labelWidthMm: "",
    labelHeightMm: "",
    labelMaterial: "",
    adhesiveType: "",
    rollCoreDiameterMm: "",
    labelsPerRoll: "",
    rowsPerRoll: "",
    printerType: "",
    templateId: "",

    markingRequired: false,
    markingSystem: "",
    productGroupCz: "",
    tnvedCode: "",
    okpd2Code: "",
    czProductGroup: "",
    czGtin: "",

    requiresAcceptanceCheck: false,
    requiresCzCheck: false,
    requiresPrintOnAcceptance: false,
    defaultAcceptanceCriteriaId: "",
    acceptanceTolerancePercent: "",
    allowPartialReceiving: false,
    allowOverReceiving: false,

    defaultWarehouseId: "",
    defaultZoneId: "",
    defaultCellId: "",
    preferredWarehouseIds: "",
    allowedWarehouseIds: "",
    minStock: "",
    maxStock: "",
    targetStock: "",
    reorderPoint: "",
    safetyStock: "",
    leadTimeDays: "",

    defaultLabelTemplateId: "",
    printTemplateId: "",
    printOnReceiving: false,
    printOnIssue: false,
    printCopies: "",

    vatRate: "",
    accountingAccount: "",
    costPrice: "",
    currency: "",
    valuationMethod: "",

    externalId: "",
    erpCode: "",
    oneCCode: "",
    oneCGuid: "",
    mesCode: "",
    scadaCode: "",
    equipmentSerial: "",

    imageUrl: "",
    iconUrl: "",
    datasheetUrl: "",
    certificateUrl: "",
    instructionUrl: "",
  }
}

function optNum(s: string): number | undefined {
  const t = s.trim()
  if (!t) return undefined
  const n = Number(t.replace(",", "."))
  return Number.isFinite(n) ? n : undefined
}

function optInt(s: string): number | undefined {
  const n = optNum(s)
  return n === undefined ? undefined : Math.trunc(n)
}

function optStr(s: string): string | undefined {
  const t = s.trim()
  return t || undefined
}

function csvToArr(s: string): string[] | undefined {
  const parts = s
    .split(/[,;]+/)
    .map((x) => x.trim())
    .filter(Boolean)
  return parts.length ? parts : undefined
}

/** Собирает объект для `item_attrs_json.nomenclature`. */
export function formToNomenclatureAttrs(f: NomenclatureFormState): NomenclatureAttrsPayload {
  const markingSystem =
    f.markingSystem === "CHESTNY_ZNAK" || f.markingSystem === "INTERNAL" || f.markingSystem === "NONE"
      ? f.markingSystem
      : undefined

  const valuationMethod =
    f.valuationMethod === "FIFO" ||
    f.valuationMethod === "FEFO" ||
    f.valuationMethod === "AVERAGE" ||
    f.valuationMethod === "SPECIFIC"
      ? f.valuationMethod
      : undefined

  return {
    type: f.type,
    status: f.status,
    shortName: optStr(f.shortName),
    printName: optStr(f.printName),
    description: optStr(f.description),
    comment: optStr(f.comment),
    externalCode: optStr(f.externalCode),

    categoryId: optStr(f.categoryId),
    categoryName: optStr(f.categoryName),
    groupId: optStr(f.groupId),
    groupName: optStr(f.groupName),
    subgroupId: optStr(f.subgroupId),
    subgroupName: optStr(f.subgroupName),
    brandId: optStr(f.brandId),
    brandName: optStr(f.brandName),
    manufacturerId: optStr(f.manufacturerId),
    manufacturerName: optStr(f.manufacturerName),

    gtin: optStr(f.gtin),
    ean13: optStr(f.ean13),
    barcode: optStr(f.primaryBarcode),
    datamatrixPrefix: optStr(f.datamatrixPrefix),
    article: optStr(f.article),
    sku: optStr(f.sku),
    vendorCode: optStr(f.vendorCode),

    baseUnitId: optStr(f.baseUnitId),
    baseUnitName: optStr(f.baseUnitName),
    baseUnitCode: optStr(f.baseUnitCode),
    storageUnitId: optStr(f.storageUnitId),
    storageUnitName: optStr(f.storageUnitName),
    storageUnitCode: optStr(f.storageUnitCode),
    purchaseUnitId: optStr(f.purchaseUnitId),
    purchaseUnitName: optStr(f.purchaseUnitName),
    purchaseUnitCode: optStr(f.purchaseUnitCode),
    issueUnitId: optStr(f.issueUnitId),
    issueUnitName: optStr(f.issueUnitName),
    issueUnitCode: optStr(f.issueUnitCode),
    conversionFactor: optNum(f.conversionFactor),

    batchControl: f.batchControl,
    serialControl: f.serialControl,
    markingControl: f.markingControl,
    expirationControl: f.expirationControl,
    fefoEnabled: f.fefoEnabled,
    fifoEnabled: f.fifoEnabled,
    qualityControl: f.qualityControl,

    shelfLifeDays: optInt(f.shelfLifeDays),
    storageLifeDays: optInt(f.storageLifeDays),
    nearExpirationDays: optInt(f.nearExpirationDays),
    criticalExpirationDays: optInt(f.criticalExpirationDays),
    minDaysForAcceptance: optInt(f.minDaysForAcceptance),
    blockExpired: f.blockExpired,
    allowNoExpirationDate: f.allowNoExpirationDate,

    storageConditions: optStr(f.storageConditions),
    temperatureMin: optNum(f.temperatureMin),
    temperatureMax: optNum(f.temperatureMax),
    humidityMin: optNum(f.humidityMin),
    humidityMax: optNum(f.humidityMax),
    lightSensitive: f.lightSensitive,
    fragile: f.fragile,
    hazardClass: optStr(f.hazardClass),
    allergenCodes: optStr(f.allergenCodes),
    stockOwnership: (optStr(f.stockOwnership) as "own" | "vendor" | "customer" | undefined) || undefined,

    lengthMm: optNum(f.lengthMm),
    widthMm: optNum(f.widthMm),
    heightMm: optNum(f.heightMm),
    diameterMm: optNum(f.diameterMm),
    netWeightKg: optNum(f.netWeightKg),
    grossWeightKg: optNum(f.grossWeightKg),
    volumeM3: optNum(f.volumeM3),
    packing: {
      autoVgh: f.autoVgh,
      volumeL: optNum(f.bottleVolumeL),
      bottleWeightG: optNum(f.bottleWeightG),
      bottlesPerPallet: optInt(f.bottlesPerPallet),
      layers: optInt(f.packLayers),
      bottlesPerLayer: optInt(f.bottlesPerLayer),
      palletTareKg: optNum(f.palletTareKg),
      filmKg: optNum(f.filmKg),
    },

    isSticker: f.isSticker,
    isLabel: f.isLabel,
    isPackaging: f.isPackaging,
    isSparePart: f.isSparePart,
    isConsumable: f.isConsumable,
    printLabelConsumable: f.printLabelConsumable,
    stickerPrintKind: (optStr(f.stickerPrintKind) as "single" | "block12" | undefined) || undefined,

    labelWidthMm: optNum(f.labelWidthMm),
    labelHeightMm: optNum(f.labelHeightMm),
    labelMaterial: optStr(f.labelMaterial),
    adhesiveType: optStr(f.adhesiveType),
    rollCoreDiameterMm: optNum(f.rollCoreDiameterMm),
    rollOuterDiameterMm: optNum(f.rollOuterDiameterMm),
    rollWidthMm: optNum(f.rollWidthMm),
    rollInnerDiameterMm: optNum(f.rollInnerDiameterMm),
    stickersPerRoll: optInt(f.stickersPerRoll),
    labelsPerRoll: optInt(f.labelsPerRoll),
    rowsPerRoll: optInt(f.rowsPerRoll),
    printerType: optStr(f.printerType),
    templateId: optStr(f.templateId),

    markingRequired: f.markingRequired,
    markingSystem,
    productGroup: optStr(f.productGroupCz),
    tnvedCode: optStr(f.tnvedCode),
    okpd2Code: optStr(f.okpd2Code),
    czProductGroup: optStr(f.czProductGroup),
    czGtin: optStr(f.czGtin),

    requiresAcceptanceCheck: f.requiresAcceptanceCheck,
    requiresCzCheck: f.requiresCzCheck,
    requiresPrintOnAcceptance: f.requiresPrintOnAcceptance,
    defaultAcceptanceCriteriaId: optStr(f.defaultAcceptanceCriteriaId),
    acceptanceTolerancePercent: optNum(f.acceptanceTolerancePercent),
    allowPartialReceiving: f.allowPartialReceiving,
    allowOverReceiving: f.allowOverReceiving,

    defaultWarehouseId: optStr(f.defaultWarehouseId),
    defaultZoneId: optStr(f.defaultZoneId),
    defaultCellId: optStr(f.defaultCellId),
    preferredWarehouseIds: csvToArr(f.preferredWarehouseIds),
    allowedWarehouseIds: csvToArr(f.allowedWarehouseIds),
    minStock: optNum(f.minStock),
    maxStock: optNum(f.maxStock),
    targetStock: optNum(f.targetStock),
    reorderPoint: optNum(f.reorderPoint),
    safetyStock: optNum(f.safetyStock),
    leadTimeDays: optNum(f.leadTimeDays),

    defaultLabelTemplateId: optStr(f.defaultLabelTemplateId),
    printTemplateId: optStr(f.printTemplateId),
    printOnReceiving: f.printOnReceiving,
    printOnIssue: f.printOnIssue,
    printCopies: optInt(f.printCopies),

    vatRate: optNum(f.vatRate),
    accountingAccount: optStr(f.accountingAccount),
    costPrice: optNum(f.costPrice),
    currency: optStr(f.currency),
    valuationMethod,

    externalId: optStr(f.externalId),
    erpCode: optStr(f.erpCode),
    oneCCode: optStr(f.oneCCode),
    oneCGuid: optStr(f.oneCGuid),
    mesCode: optStr(f.mesCode),
    scadaCode: optStr(f.scadaCode),
    equipmentSerial: optStr(f.equipmentSerial),

    imageUrl: optStr(f.imageUrl),
    iconUrl: optStr(f.iconUrl),
    datasheetUrl: optStr(f.datasheetUrl),
    certificateUrl: optStr(f.certificateUrl),
    instructionUrl: optStr(f.instructionUrl),
  }
}

const IMPORT_OWNED_ATTR_KEYS = new Set(["nomenclature", "nomenclatureSchemaVersion", "imageUrl"])

export function buildImportItemRow(
  f: NomenclatureFormState,
  existingItemAttrs?: Record<string, unknown> | null
): ImportWmsItemRow {
  const nomBase = formToNomenclatureAttrs(f)
  const uomRows = buildImportUomRows(f)
  const units: NomenclatureUnit[] = uomRows.map((r) => ({
    id: `draft:${f.code.trim()}:${r.uomCode}`,
    unitCode: r.uomCode,
    unitName: (r.uomName || r.uomCode).trim(),
    factorToBase: r.qtyInBase,
    isBase: Boolean(r.isBase),
  }))
  const nom: NomenclatureAttrsPayload =
    units.length > 0 ? { ...nomBase, units } : nomBase

  const rotationPolicy = f.fefoEnabled ? "fefo" : f.fifoEnabled ? "fifo" : "fifo"

  const imageUrl = optStr(f.imageUrl)
  const itemAttrs: Record<string, unknown> = {
    nomenclature: nom,
    nomenclatureSchemaVersion: 1,
    // Дублируем на верхний уровень attrs — ТСД/resolve-scan читают extractItemImageUrl
    ...(imageUrl ? { imageUrl } : {}),
  }
  if (existingItemAttrs && typeof existingItemAttrs === "object") {
    for (const [key, value] of Object.entries(existingItemAttrs)) {
      if (IMPORT_OWNED_ATTR_KEYS.has(key)) continue
      if (key in itemAttrs) continue
      itemAttrs[key] = value
    }
  }
  const equipmentSerial = optStr(f.equipmentSerial)
  if (equipmentSerial) itemAttrs.equipmentSerial = equipmentSerial

  const uom = optStr(f.baseUnitCode)?.toLowerCase() || "pcs"

  return {
    itemCode: f.code.trim(),
    name: f.name.trim(),
    sku: optStr(f.sku),
    primaryBarcode: optStr(f.primaryBarcode) ?? optStr(f.gtin) ?? optStr(f.ean13),
    uomCode: uom,
    itemTypeCode: nomenclatureFormTypeToItemTypeCode(f.type) ?? undefined,
    materialType: optStr(f.categoryName),
    productGroup: optStr(f.groupName) ?? optStr(f.categoryName),
    itemGroupCode: optStr(f.groupId) || optStr(f.groupName) || undefined,
    itemClassCode:
      optStr(f.categoryId) ||
      deriveProductPhysicalProfile({
        name: f.name,
        itemTypeCode: nomenclatureFormTypeToItemTypeCode(f.type) ?? f.type,
        itemGroupCode: optStr(f.groupId) || optStr(f.groupName),
        productGroup: optStr(f.groupName) || optStr(f.categoryName),
      }).storageClass,
    itemSubgroup: optStr(f.subgroupName),
    packagingFormat: optStr(f.labelMaterial),
    packagingProfile: f.packagingProfile,
    itemAttrs,
    nomenclature:
      optStr(f.nomenclature) ??
      (optStr(f.gtin) ? `(01)${f.gtin.replace(/\D/g, "").slice(0, 14)}` : undefined),
    isMarked: f.markingControl || f.markingRequired,
    isPerishable: f.expirationControl,
    rotationPolicy,
    shelfLifeDays: nom.shelfLifeDays,
    expiryWarningDays: nom.nearExpirationDays,
  }
}

export function buildImportUomRows(f: NomenclatureFormState): ImportWmsItemUomRow[] {
  const code = f.code.trim()
  if (!code) return []

  const rows: ImportWmsItemUomRow[] = []
  const baseCode = (f.baseUnitCode.trim() || "PCS").toUpperCase().slice(0, 32)
  rows.push({
    itemCode: code,
    uomCode: baseCode,
    uomName: f.baseUnitName.trim() || "Базовая",
    qtyInBase: 1,
    levelNo: 1,
    isBase: true,
    isShipping: true,
  })

  const cf = optNum(f.conversionFactor)
  if (f.storageUnitName.trim() && cf && cf > 0) {
    rows.push({
      itemCode: code,
      uomCode: (f.storageUnitCode.trim() || "STOR").toUpperCase().slice(0, 32),
      uomName: f.storageUnitName.trim(),
      qtyInBase: cf,
      levelNo: 2,
      isBase: false,
      isShipping: true,
    })
  }

  return rows
}

function fromItemStr(v: unknown): string {
  return v == null || v === "" ? "" : String(v)
}

function fromItemNum(v: unknown): string {
  if (v == null || v === "") return ""
  const n = Number(v)
  return Number.isFinite(n) ? String(n) : ""
}

function fromItemCsv(v: unknown): string {
  if (!Array.isArray(v)) return ""
  return v.map(String).filter(Boolean).join(", ")
}

/** Заполняет форму редактирования из строки `wms_items` и `item_attrs.nomenclature`. */
export function wmsItemToNomenclatureForm(
  item: Record<string, unknown>,
  itemUoms?: Array<Record<string, unknown>>
): NomenclatureFormState {
  const f = emptyNomenclatureForm()
  const attrs = (item.itemAttrs ?? item.item_attrs) as Record<string, unknown> | undefined
  const nom = (attrs?.nomenclature ?? {}) as Partial<NomenclatureAttrsPayload>

  f.code = fromItemStr(item.itemCode ?? item.item_code)
  f.name = fromItemStr(item.name)
  f.nomenclature = fromItemStr(item.nomenclature)
  f.packagingProfile = fromItemStr(item.packagingProfile ?? item.packaging_profile) || "custom"
  f.sku = fromItemStr(item.sku ?? nom.sku)
  f.primaryBarcode = fromItemStr(item.primaryBarcode ?? item.primary_barcode ?? nom.barcode)

  f.type =
    fromItemStr(nom.type) ||
    itemTypeCodeToFormType(fromItemStr(item.itemTypeCode ?? item.item_type_code)) ||
    "PRODUCT"
  f.status =
    item.isActive === false
      ? "INACTIVE"
      : nom.status === "INACTIVE" || nom.status === "BLOCKED" || nom.status === "ARCHIVED"
        ? nom.status
        : "ACTIVE"

  f.shortName = fromItemStr(nom.shortName ?? item.shortName ?? item.short_name)
  f.printName = fromItemStr(nom.printName)
  f.description = fromItemStr(nom.description)
  f.comment = fromItemStr(nom.comment)
  f.externalCode = fromItemStr(nom.externalCode)

  f.categoryId = fromItemStr(nom.categoryId ?? item.itemClassCode ?? item.item_class_code)
  f.categoryName = fromItemStr(nom.categoryName ?? item.materialType ?? item.material_type)
  f.groupId = fromItemStr(nom.groupId ?? item.itemGroupCode ?? item.item_group_code)
  f.groupName = fromItemStr(nom.groupName ?? item.productGroup ?? item.product_group)
  f.subgroupId = fromItemStr(nom.subgroupId)
  f.subgroupName = fromItemStr(nom.subgroupName ?? item.itemSubgroup ?? item.item_subgroup)
  f.brandId = fromItemStr(nom.brandId)
  f.brandName = fromItemStr(nom.brandName)
  f.manufacturerId = fromItemStr(nom.manufacturerId)
  f.manufacturerName = fromItemStr(nom.manufacturerName)

  f.gtin = fromItemStr(nom.gtin)
  f.ean13 = fromItemStr(nom.ean13)
  f.datamatrixPrefix = fromItemStr(nom.datamatrixPrefix)
  f.article = fromItemStr(nom.article)
  f.vendorCode = fromItemStr(nom.vendorCode)

  f.baseUnitId = fromItemStr(nom.baseUnitId)
  f.baseUnitName = fromItemStr(nom.baseUnitName) || "шт"
  f.baseUnitCode = fromItemStr(nom.baseUnitCode ?? item.uomCode ?? item.uom_code) || "PCS"
  f.storageUnitId = fromItemStr(nom.storageUnitId)
  f.storageUnitName = fromItemStr(nom.storageUnitName)
  f.storageUnitCode = fromItemStr(nom.storageUnitCode) || "ROLL"
  f.purchaseUnitId = fromItemStr(nom.purchaseUnitId)
  f.purchaseUnitName = fromItemStr(nom.purchaseUnitName)
  f.purchaseUnitCode = fromItemStr(nom.purchaseUnitCode) || "BOX"
  f.issueUnitId = fromItemStr(nom.issueUnitId)
  f.issueUnitName = fromItemStr(nom.issueUnitName)
  f.issueUnitCode = fromItemStr(nom.issueUnitCode)
  f.conversionFactor = fromItemNum(nom.conversionFactor)

  f.batchControl = Boolean(nom.batchControl)
  f.serialControl = Boolean(nom.serialControl)
  f.markingControl = Boolean(nom.markingControl ?? item.isMarked ?? item.is_marked)
  f.expirationControl = Boolean(nom.expirationControl ?? item.isPerishable ?? item.is_perishable)
  {
    const rot = fromItemStr(item.rotationPolicy ?? item.rotation_policy).toLowerCase()
    f.fefoEnabled = Boolean(nom.fefoEnabled ?? rot === "fefo")
    f.fifoEnabled = Boolean(nom.fifoEnabled ?? rot === "fifo")
  }
  f.qualityControl = Boolean(nom.qualityControl)

  f.shelfLifeDays = fromItemNum(nom.shelfLifeDays ?? item.shelfLifeDays ?? item.shelf_life_days)
  f.storageLifeDays = fromItemNum(nom.storageLifeDays)
  f.nearExpirationDays = fromItemNum(nom.nearExpirationDays ?? item.expiryWarningDays ?? item.expiry_warning_days)
  f.criticalExpirationDays = fromItemNum(nom.criticalExpirationDays)
  f.minDaysForAcceptance = fromItemNum(nom.minDaysForAcceptance)
  f.blockExpired = Boolean(nom.blockExpired)
  f.allowNoExpirationDate = Boolean(nom.allowNoExpirationDate)

  f.storageConditions = fromItemStr(nom.storageConditions)
  f.temperatureMin = fromItemNum(nom.temperatureMin)
  f.temperatureMax = fromItemNum(nom.temperatureMax)
  f.humidityMin = fromItemNum(nom.humidityMin)
  f.humidityMax = fromItemNum(nom.humidityMax)
  f.lightSensitive = Boolean(nom.lightSensitive)
  f.fragile = Boolean(nom.fragile)
  f.hazardClass = fromItemStr(nom.hazardClass)
  f.allergenCodes = fromItemStr(nom.allergenCodes)
  f.stockOwnership = fromItemStr(nom.stockOwnership)

  f.lengthMm = fromItemNum(nom.lengthMm)
  f.widthMm = fromItemNum(nom.widthMm)
  f.heightMm = fromItemNum(nom.heightMm)
  f.diameterMm = fromItemNum(nom.diameterMm)
  f.netWeightKg = fromItemNum(nom.netWeightKg)
  f.grossWeightKg = fromItemNum(nom.grossWeightKg)
  f.volumeM3 = fromItemNum(nom.volumeM3)
  f.rollInnerDiameterMm = fromItemNum(nom.rollInnerDiameterMm)
  f.rollOuterDiameterMm = fromItemNum(nom.rollOuterDiameterMm)
  f.rollWidthMm = fromItemNum(nom.rollWidthMm)
  f.stickersPerRoll = fromItemNum(nom.stickersPerRoll)
  {
    const packing = nom.packing as NomenclaturePacking | Record<string, unknown> | undefined
    if (packing && typeof packing === "object") {
      f.autoVgh = packing.autoVgh !== false
      f.bottleVolumeL = fromItemNum(packing.volumeL)
      f.bottleWeightG = fromItemNum(packing.bottleWeightG)
      f.bottlesPerPallet = fromItemNum(packing.bottlesPerPallet)
      f.packLayers = fromItemNum(packing.layers)
      f.bottlesPerLayer = fromItemNum(packing.bottlesPerLayer)
      f.palletTareKg = fromItemNum(packing.palletTareKg)
      f.filmKg = fromItemNum(packing.filmKg)
    }
  }

  f.isSticker = Boolean(nom.isSticker)
  f.isLabel = Boolean(nom.isLabel)
  f.isPackaging = Boolean(nom.isPackaging)
  f.isSparePart = Boolean(nom.isSparePart)
  f.isConsumable = Boolean(nom.isConsumable)
  f.printLabelConsumable = Boolean(nom.printLabelConsumable)
  {
    const kind = fromItemStr(nom.stickerPrintKind)
    f.stickerPrintKind = kind === "single" || kind === "block12" ? kind : ""
  }

  f.labelWidthMm = fromItemNum(nom.labelWidthMm)
  f.labelHeightMm = fromItemNum(nom.labelHeightMm)
  f.labelMaterial = fromItemStr(nom.labelMaterial ?? item.packagingFormat ?? item.packaging_format)
  f.adhesiveType = fromItemStr(nom.adhesiveType)
  f.rollCoreDiameterMm = fromItemNum(nom.rollCoreDiameterMm)
  f.labelsPerRoll = fromItemNum(nom.labelsPerRoll)
  f.rowsPerRoll = fromItemNum(nom.rowsPerRoll)
  f.printerType = fromItemStr(nom.printerType)
  f.templateId = fromItemStr(nom.templateId)

  f.markingRequired = Boolean(nom.markingRequired ?? nom.markingControl ?? item.isMarked ?? item.is_marked)
  {
    const ms = fromItemStr(nom.markingSystem)
    if (ms === "CHESTNY_ZNAK" || ms === "INTERNAL" || ms === "NONE") {
      f.markingSystem = ms
    } else if (
      Boolean(nom.requiresCzCheck) ||
      fromItemStr(nom.czProductGroup) ||
      f.markingRequired ||
      f.markingControl
    ) {
      f.markingSystem = "CHESTNY_ZNAK"
    } else {
      f.markingSystem = ""
    }
  }
  f.productGroupCz = fromItemStr(nom.productGroup)
  f.tnvedCode = fromItemStr(nom.tnvedCode)
  f.okpd2Code = fromItemStr(nom.okpd2Code)
  f.czProductGroup = fromItemStr(nom.czProductGroup)
  f.czGtin = fromItemStr(nom.czGtin)

  f.requiresAcceptanceCheck = Boolean(nom.requiresAcceptanceCheck)
  f.requiresCzCheck = Boolean(nom.requiresCzCheck)
  f.requiresPrintOnAcceptance = Boolean(nom.requiresPrintOnAcceptance)
  f.defaultAcceptanceCriteriaId = fromItemStr(nom.defaultAcceptanceCriteriaId)
  f.acceptanceTolerancePercent = fromItemNum(nom.acceptanceTolerancePercent)
  f.allowPartialReceiving = Boolean(nom.allowPartialReceiving)
  f.allowOverReceiving = Boolean(nom.allowOverReceiving)

  f.defaultWarehouseId = fromItemStr(nom.defaultWarehouseId)
  f.defaultZoneId = fromItemStr(nom.defaultZoneId)
  f.defaultCellId = fromItemStr(nom.defaultCellId)
  f.preferredWarehouseIds = fromItemCsv(nom.preferredWarehouseIds)
  f.allowedWarehouseIds = fromItemCsv(nom.allowedWarehouseIds)
  f.minStock = fromItemNum(nom.minStock)
  f.maxStock = fromItemNum(nom.maxStock)
  f.targetStock = fromItemNum(nom.targetStock)
  f.reorderPoint = fromItemNum(nom.reorderPoint)
  f.safetyStock = fromItemNum(nom.safetyStock)
  f.leadTimeDays = fromItemNum(nom.leadTimeDays)

  f.defaultLabelTemplateId = fromItemStr(nom.defaultLabelTemplateId)
  f.printTemplateId = fromItemStr(nom.printTemplateId)
  f.printOnReceiving = Boolean(nom.printOnReceiving)
  f.printOnIssue = Boolean(nom.printOnIssue)
  f.printCopies = fromItemNum(nom.printCopies)

  f.vatRate = fromItemNum(nom.vatRate)
  f.accountingAccount = fromItemStr(nom.accountingAccount)
  f.costPrice = fromItemNum(nom.costPrice)
  f.currency = fromItemStr(nom.currency)
  {
    const vm = fromItemStr(nom.valuationMethod)
    if (vm === "FIFO" || vm === "FEFO" || vm === "AVERAGE" || vm === "SPECIFIC") {
      f.valuationMethod = vm
    } else {
      const rot = fromItemStr(item.rotationPolicy ?? item.rotation_policy).toLowerCase()
      if (rot === "fefo") f.valuationMethod = "FEFO"
      else if (rot === "fifo") f.valuationMethod = "FIFO"
      else f.valuationMethod = ""
    }
  }

  f.externalId = fromItemStr(nom.externalId)
  f.erpCode = fromItemStr(nom.erpCode)
  f.oneCCode = fromItemStr(nom.oneCCode)
  f.oneCGuid = fromItemStr(nom.oneCGuid)
  f.mesCode = fromItemStr(nom.mesCode)
  f.scadaCode = fromItemStr(nom.scadaCode)
  f.equipmentSerial = fromItemStr(nom.equipmentSerial ?? attrs?.equipmentSerial) ||
    readEquipmentSerialFromAttrs(attrs)

  f.imageUrl = fromItemStr(nom.imageUrl ?? attrs?.imageUrl)
  f.iconUrl = fromItemStr(nom.iconUrl)
  f.datasheetUrl = fromItemStr(nom.datasheetUrl)
  f.certificateUrl = fromItemStr(nom.certificateUrl)
  f.instructionUrl = fromItemStr(nom.instructionUrl)

  const uoms = itemUoms ?? []
  const baseU = uoms.find((u) => u.isBase === true || u.is_base === true)
  if (baseU) {
    f.baseUnitCode = fromItemStr(baseU.uomCode ?? baseU.uom_code) || f.baseUnitCode
    f.baseUnitName = fromItemStr(baseU.uomName ?? baseU.uom_name) || f.baseUnitName
  }
  const nonBase = uoms.find((u) => u.isBase !== true && u.is_base !== true)
  if (nonBase) {
    f.storageUnitCode = fromItemStr(nonBase.uomCode ?? nonBase.uom_code) || f.storageUnitCode
    f.storageUnitName = fromItemStr(nonBase.uomName ?? nonBase.uom_name) || f.storageUnitName
    if (!f.conversionFactor) {
      f.conversionFactor = fromItemNum(nonBase.qtyInBase ?? nonBase.qty_in_base)
    }
  }

  return f
}
