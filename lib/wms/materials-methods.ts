/**
 * Методы склада материалов — считаются из карточки и партий.
 * Не ABC/FSN склада ГП: здесь важны совместимость, FEFO/FIFO, качество и выдача в цех.
 */

import {
  computeStickerExpiryTier,
  daysSinceEmission,
  DEFAULT_STICKER_SHELF_LIFE_DAYS,
  isCalendarExpiryPast,
} from "@/lib/wms/expiry-sticker"
import {
  deriveStorageClassFromItemRow,
  STORAGE_CLASS_META,
  type StorageClassCode,
} from "@/lib/wms/physical-profile"

export const MATERIAL_FAMILIES = [
  "chemical",
  "food",
  "electronics",
  "odorous",
  "dusty",
  "labels",
  "packaging",
  "general",
] as const
export type MaterialFamily = (typeof MATERIAL_FAMILIES)[number]

export const QUALITY_STATUSES = ["RELEASED", "QUARANTINE", "HOLD", "REJECTED"] as const
export type QualityStatus = (typeof QUALITY_STATUSES)[number]

export const ROTATION_POLICIES = ["fefo", "fifo", "manual"] as const
export type RotationPolicy = (typeof ROTATION_POLICIES)[number]

export const MATERIAL_URGENCIES = ["expired", "issue", "soon", "ok"] as const
export type MaterialUrgency = (typeof MATERIAL_URGENCIES)[number]

export const MATERIAL_FAMILY_META: Record<
  MaterialFamily,
  { label: string; short: string; hint: string }
> = {
  chemical: {
    label: "Химия",
    short: "ХИМ",
    hint: "Клей, растворы, дезинфекция — отдельно от пищевых и этикеток.",
  },
  food: {
    label: "Пищевые",
    short: "ПИЩ",
    hint: "Сироп, концентрат, сахар — не рядом с химией и пахучими.",
  },
  electronics: {
    label: "Электроника",
    short: "ЭЛ",
    hint: "Датчики, кабели, платы — не рядом с пылящими и химией.",
  },
  odorous: {
    label: "Пахучие",
    short: "ПАХ",
    hint: "Ароматизаторы, отдушки, спирт — отдельно от пищевых и этикеток.",
  },
  dusty: {
    label: "Пылящие",
    short: "ПЫЛ",
    hint: "Порошки и сыпучие — не рядом с электроникой и открытыми этикетками.",
  },
  labels: {
    label: "Этикетки",
    short: "ЭТК",
    hint: "Стикеры и этикетки. FEFO: истекающую партию запускать в производство.",
  },
  packaging: {
    label: "Упаковка",
    short: "УПК",
    hint: "Преформа, пробка, картон, плёнка — сырьё линии.",
  },
  general: {
    label: "Прочее",
    short: "ПРЧ",
    hint: "Обычный материал без жёсткого запрета соседства.",
  },
}

export const QUALITY_STATUS_META: Record<QualityStatus, { label: string; hint: string }> = {
  RELEASED: { label: "Допущен", hint: "Можно выдавать в цех и класть в обычную ячейку." },
  QUARANTINE: { label: "Карантин", hint: "Не выдавать, пока ОТК не снимет карантин." },
  HOLD: { label: "Удержан", hint: "Партия на проверке. Не смешивать с допущенным остатком." },
  REJECTED: { label: "Брак", hint: "Списание или возврат поставщику. Не в производство." },
}

/** Пары семейств, которые нельзя класть в одну ячейку / на одну полку. */
const INCOMPATIBLE_PAIRS: ReadonlyArray<readonly [MaterialFamily, MaterialFamily]> = [
  ["chemical", "food"],
  ["chemical", "labels"],
  ["chemical", "electronics"],
  ["odorous", "food"],
  ["odorous", "labels"],
  ["dusty", "electronics"],
  ["dusty", "labels"],
]

function asSearchText(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? "").toString().trim().toLowerCase())
    .filter(Boolean)
    .join(" ")
}

export function inferMaterialFamily(input: {
  name?: string | null
  itemTypeCode?: string | null
  productGroup?: string | null
  itemGroupCode?: string | null
  materialType?: string | null
  hazardous?: boolean | null
}): MaterialFamily {
  const type = (input.itemTypeCode ?? "").trim().toLowerCase()
  const text = asSearchText([
    input.name,
    input.productGroup,
    input.itemGroupCode,
    input.materialType,
    type,
  ])

  if (input.hazardous || /хими|кислот|щёлоч|щелоч|растворит|дезинфек|клей|эмульс|суспенз/.test(text)) {
    return "chemical"
  }
  if (/аромат|отдуш|пахуч|спирт\b|эссенц/.test(text) && !/этикет|стикер/.test(text)) {
    return "odorous"
  }
  if (/пыл|порош|мука|цемент|сода|сыпуч/.test(text)) return "dusty"
  if (/электрон|плат[аы]\b|датчик|кабел|контроллер|пк\b|сканер/.test(text) || type === "equipment") {
    return "electronics"
  }
  if (
    type === "stickers" ||
    type === "sticker" ||
    /стикер|этикет|label|sticker/.test(text)
  ) {
    return "labels"
  }
  if (
    /сироп|концентрат|сахар|пищев|солод|глюкоз|фруктоз/.test(text) &&
    !/этикет|стикер|картон|плёнк|пленк/.test(text)
  ) {
    return "food"
  }
  if (
    type === "packaging" ||
    /преформ|пробк|колпач|картон|короб|пленк|плёнк|стретч|упаков/.test(text)
  ) {
    return "packaging"
  }
  return "general"
}

export function compatibilityFamiliesConflict(a: MaterialFamily, b: MaterialFamily): boolean {
  if (a === b) return false
  return INCOMPATIBLE_PAIRS.some(
    ([x, y]) => (x === a && y === b) || (x === b && y === a)
  )
}

export function resolveRotationPolicy(input: {
  rotationPolicy?: string | null
  isPerishable?: boolean | null
  shelfLifeDays?: number | null
  nearestExpiryAt?: string | null
  lotManufacturedAtMin?: string | null
}): RotationPolicy {
  const raw = (input.rotationPolicy ?? "").trim().toLowerCase()
  if (raw === "manual" || raw === "fifo" || raw === "fefo") return raw
  if (
    input.isPerishable ||
    (input.shelfLifeDays != null && input.shelfLifeDays > 0) ||
    input.nearestExpiryAt ||
    input.lotManufacturedAtMin
  ) {
    return "fefo"
  }
  return "fifo"
}

export function resolveQualityStatus(input: {
  rejectedQty?: number | null
  quarantineQty?: number | null
  anyLotBlocked?: boolean | null
  lotQaStatuses?: string | null
}): QualityStatus {
  if (Number(input.rejectedQty ?? 0) > 0) return "REJECTED"
  const qa = (input.lotQaStatuses ?? "").toUpperCase()
  if (/\bREJECT/.test(qa)) return "REJECTED"
  if (Number(input.quarantineQty ?? 0) > 0 || input.anyLotBlocked) return "QUARANTINE"
  if (/\bQUAR/.test(qa)) return "QUARANTINE"
  if (/\bHOLD/.test(qa) || /\bPENDING/.test(qa) || /\bWAIT/.test(qa)) return "HOLD"
  return "RELEASED"
}

function daysUntilIso(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null
  const end = new Date(iso)
  if (Number.isNaN(end.getTime())) return null
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const day = new Date(end)
  day.setHours(0, 0, 0, 0)
  return Math.round((day.getTime() - start.getTime()) / 86_400_000)
}

export function resolveMaterialUrgency(input: {
  isPerishable?: boolean | null
  shelfLifeDays?: number | null
  nearestExpiryAt?: string | null
  lotManufacturedAtMin?: string | null
  qualityStatus?: QualityStatus
}): MaterialUrgency {
  if (input.qualityStatus === "REJECTED") return "expired"
  if (isCalendarExpiryPast(input.nearestExpiryAt)) return "expired"

  if (input.lotManufacturedAtMin) {
    const daysSince = daysSinceEmission(input.lotManufacturedAtMin)
    if (daysSince != null) {
      const tier = computeStickerExpiryTier(daysSince)
      if (tier === "expired") return "expired"
      if (tier === "critical") return "issue"
      if (tier === "warning") return "soon"
    }
  }

  const daysLeft = daysUntilIso(input.nearestExpiryAt)
  if (daysLeft != null) {
    if (daysLeft < 0) return "expired"
    if (daysLeft <= 14) return "issue"
    if (daysLeft <= 45) return "soon"
  }

  const shelf = Number(input.shelfLifeDays) || 0
  if (input.lotManufacturedAtMin && shelf > 0) {
    const daysSince = daysSinceEmission(input.lotManufacturedAtMin)
    if (daysSince != null) {
      const left = shelf - daysSince
      if (left <= 0) return "expired"
      if (left <= 14) return "issue"
      if (left <= Math.min(45, Math.round(shelf * 0.15))) return "soon"
    }
  }

  return "ok"
}

export function formatMaterialsProfile(input: {
  storageClass: StorageClassCode
  rotation: RotationPolicy
  family: MaterialFamily
}): string {
  const rot = input.rotation.toUpperCase()
  return `${input.storageClass} · ${rot} · ${MATERIAL_FAMILY_META[input.family].short}`
}

export function materialIssueHint(input: {
  urgency: MaterialUrgency
  rotation: RotationPolicy
  family: MaterialFamily
  qualityStatus: QualityStatus
  lotCode?: string | null
  locationCode?: string | null
}): string | null {
  if (input.qualityStatus === "REJECTED") {
    return "Брак — в производство не выдавать."
  }
  if (input.qualityStatus === "QUARANTINE" || input.qualityStatus === "HOLD") {
    return `${QUALITY_STATUS_META[input.qualityStatus].label} — сначала снять статус.`
  }
  if (input.urgency === "expired") {
    return "Срок истёк. Списать или вернуть, не запускать в линию."
  }
  if (input.urgency === "issue") {
    const lot = input.lotCode ? ` партия ${input.lotCode}` : ""
    const loc = input.locationCode ? ` (${input.locationCode})` : ""
    if (input.family === "labels") {
      return `Срок этикетки на исходе — запустите${lot}${loc} в производство раньше новой.`
    }
    return `Срок на исходе — выдайте${lot}${loc} в цех по FEFO, не берите свежий приход.`
  }
  if (input.urgency === "soon" && input.rotation === "fefo") {
    return "Скоро истечёт. Держите эту партию первой в очереди выдачи."
  }
  return null
}

export type MaterialsMethodInput = {
  name?: string | null
  itemTypeCode?: string | null
  productGroup?: string | null
  itemGroupCode?: string | null
  materialType?: string | null
  itemClassCode?: string | null
  itemAttrs?: unknown
  hazardous?: boolean | null
  rotationPolicy?: string | null
  isPerishable?: boolean | null
  shelfLifeDays?: number | null
  nearestExpiryAt?: string | null
  lotManufacturedAtMin?: string | null
  rejectedQty?: number | null
  quarantineQty?: number | null
  anyLotBlocked?: boolean | null
  lotQaStatuses?: string | null
  lotCode?: string | null
  locationCode?: string | null
}

export type MaterialsMethodOverlay = {
  storageClass: StorageClassCode
  storageClassTitle: string
  family: MaterialFamily
  familyLabel: string
  rotation: RotationPolicy
  qualityStatus: QualityStatus
  qualityLabel: string
  urgency: MaterialUrgency
  profile: string
  issueHint: string | null
  issuable: boolean
}

export function computeMaterialsMethods(input: MaterialsMethodInput): MaterialsMethodOverlay {
  const storageClass = deriveStorageClassFromItemRow({
    name: input.name,
    item_type_code: input.itemTypeCode,
    item_class_code: input.itemClassCode,
    item_group_code: input.itemGroupCode,
    product_group: input.productGroup,
    material_type: input.materialType,
    item_attrs_json: input.itemAttrs,
  })
  const family = inferMaterialFamily({
    name: input.name,
    itemTypeCode: input.itemTypeCode,
    productGroup: input.productGroup,
    itemGroupCode: input.itemGroupCode,
    materialType: input.materialType,
    hazardous: input.hazardous,
  })
  const rotation = resolveRotationPolicy(input)
  const qualityStatus = resolveQualityStatus(input)
  const urgency = resolveMaterialUrgency({ ...input, qualityStatus })
  const issueHint = materialIssueHint({
    urgency,
    rotation,
    family,
    qualityStatus,
    lotCode: input.lotCode,
    locationCode: input.locationCode,
  })
  return {
    storageClass,
    storageClassTitle: STORAGE_CLASS_META[storageClass].title,
    family,
    familyLabel: MATERIAL_FAMILY_META[family].label,
    rotation,
    qualityStatus,
    qualityLabel: QUALITY_STATUS_META[qualityStatus].label,
    urgency,
    profile: formatMaterialsProfile({ storageClass, rotation, family }),
    issueHint,
    issuable:
      qualityStatus === "RELEASED" && (urgency === "issue" || urgency === "soon" || urgency === "ok"),
  }
}

export function defaultShelfLifeDays(shelfLifeDays: number | null | undefined): number {
  const n = Number(shelfLifeDays)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STICKER_SHELF_LIFE_DAYS
}
