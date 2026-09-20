/**
 * Автопрофиль склада: класс по названию + типичные габариты из справочника.
 * Габариты не обязательны для классификации. Это подсказка, не замер.
 */
import {
  deriveProductPhysicalProfile,
  storageClassLabel,
  type DeriveProductInput,
  type HandlingMode,
  type ProductPhysicalProfile,
  type StorageClassCode,
  type StorageForm,
} from "@/lib/wms/physical-profile"
import { computePackVgh } from "@/lib/wms/pack-vgh"

export type TypicalSkuPattern = {
  id: string
  title: string
  match: RegExp
  storageClass: StorageClassCode
  storageForm: StorageForm
  handling: HandlingMode
  lengthMm: number
  widthMm: number
  heightMm: number
  weightG: number
  note: string
}

export const TYPICAL_SKU_CATALOG: TypicalSkuPattern[] = [
  {
    id: "bolt",
    title: "Крепёж",
    match: /болт|винт|гайк|шайб|саморез|шпильк|крепеж/,
    storageClass: "S1",
    storageForm: "piece",
    handling: "MANUAL",
    lengthMm: 40,
    widthMm: 15,
    heightMm: 15,
    weightG: 12,
    note: "Типичная единица крепежа. Коробку 1000 шт. можно указать отдельно.",
  },
  {
    id: "pen",
    title: "Канцелярия",
    match: /ручк|скрепк|карандаш|маркер|степлер|кнопк/,
    storageClass: "S1",
    storageForm: "pack",
    handling: "MANUAL",
    lengthMm: 140,
    widthMm: 50,
    heightMm: 20,
    weightG: 40,
    note: "Пачка канцелярии, ручной отбор.",
  },
  {
    id: "tape",
    title: "Скотч / лента",
    match: /скотч|клейкая\s*лента|упаковочн(ая|ой)\s*лент/,
    storageClass: "S1",
    storageForm: "piece",
    handling: "MANUAL",
    lengthMm: 200,
    widthMm: 200,
    heightMm: 50,
    weightG: 300,
    note: "Ролик 48 мм, как обычно лежит в малой ячейке.",
  },
  {
    id: "wipe",
    title: "Салфетки",
    match: /салфет/,
    storageClass: "S1",
    storageForm: "pack",
    handling: "MANUAL",
    lengthMm: 200,
    widthMm: 120,
    heightMm: 80,
    weightG: 250,
    note: "Пачка салфеток.",
  },
  {
    id: "sticker",
    title: "Стикер",
    match: /стикер/,
    storageClass: "S1",
    storageForm: "roll",
    handling: "MANUAL",
    lengthMm: 120,
    widthMm: 120,
    heightMm: 80,
    weightG: 180,
    note: "Ролик стикеров. Класс S1, не потому что «стикер», а потому что мелкоштучный.",
  },
  {
    id: "label",
    title: "Этикетка",
    match: /этикет/,
    storageClass: "S1",
    storageForm: "roll",
    handling: "MANUAL",
    lengthMm: 200,
    widthMm: 200,
    heightMm: 80,
    weightG: 400,
    note: "Ролик этикетки. Сырьё для печати, хранение — мелкоштучное.",
  },
  {
    id: "cardboard",
    title: "Картон / короб",
    match: /картон|коробк/,
    storageClass: "S3",
    storageForm: "carton",
    handling: "CART",
    lengthMm: 1100,
    widthMm: 700,
    heightMm: 20,
    weightG: 450,
    note: "Картон на линию — сырьё S3, не средний тарный S2.",
  },
  {
    id: "film",
    title: "Плёнка",
    match: /пленк|стретч|shrink/,
    storageClass: "S3",
    storageForm: "roll",
    handling: "CART",
    lengthMm: 500,
    widthMm: 500,
    heightMm: 400,
    weightG: 8000,
    note: "Стретч-плёнка — упаковочное сырьё линии.",
  },
  {
    id: "preform",
    title: "Преформа",
    match: /преформ/,
    storageClass: "S3",
    storageForm: "carton",
    handling: "CART",
    lengthMm: 600,
    widthMm: 400,
    heightMm: 400,
    weightG: 8000,
    note: "Короб преформ — сырьё, не мелочь.",
  },
  {
    id: "sack",
    title: "Мешок сырья",
    match: /мешок|25\s*кг/,
    storageClass: "S3",
    storageForm: "sack",
    handling: "CART",
    lengthMm: 700,
    widthMm: 400,
    heightMm: 180,
    weightG: 25000,
    note: "Мешок ~25 кг.",
  },
  {
    id: "suspension",
    title: "Суспензия / концентрат",
    match: /суспенз|концентрат|сироп/,
    storageClass: "S3",
    storageForm: "piece",
    handling: "MANUAL",
    lengthMm: 250,
    widthMm: 90,
    heightMm: 90,
    weightG: 1200,
    note: "Канистра/бутыль сырья. Не готовый напиток.",
  },
  {
    id: "drink",
    title: "Готовая вода / напиток",
    match: /напит|тархун|славда|минеральн|вода\b/,
    storageClass: "S4",
    storageForm: "pallet",
    handling: "FORKLIFT",
    lengthMm: 1200,
    widthMm: 800,
    heightMm: 1400,
    weightG: 500000,
    note: "Палета ГП. Вес считается от литража бутылки × штук на палете + поддон и плёнка.",
  },
]

export type PhysicalSuggestResult = {
  profile: ProductPhysicalProfile
  catalogHit: TypicalSkuPattern | null
  typicalLengthMm: number | null
  typicalWidthMm: number | null
  typicalHeightMm: number | null
  typicalWeightG: number | null
  typicalWeightKg: number | null
  source: "catalog" | ProductPhysicalProfile["storageClassSource"]
  title: string
  hint: string
  dimsRequired: false
}

function blob(input: DeriveProductInput): string {
  return [input.name, input.itemGroupCode, input.productGroup, input.itemTypeCode]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/ё/g, "е")
}

export function matchTypicalSku(text: string): TypicalSkuPattern | null {
  const t = text.toLowerCase().replace(/ё/g, "е")
  if (!t.trim()) return null
  for (const row of TYPICAL_SKU_CATALOG) {
    if (row.id === "drink" && /этикет|стикер|преформ|клей|картон|пленк|суспенз/.test(t)) continue
    if (row.id === "label" && /клей|сырье/.test(t)) continue
    if (row.match.test(t)) return row
  }
  return null
}

export function suggestPhysicalProfile(input: DeriveProductInput): PhysicalSuggestResult {
  const text = blob(input)
  const catalogHit = matchTypicalSku(text)
  const pack = catalogHit?.id === "drink" || /вода|напит|шмаков|тархун|славда/.test(text)
    ? computePackVgh({ name: input.name })
    : null
  const lengthMm = input.lengthMm ?? pack?.palletLengthMm ?? catalogHit?.lengthMm
  const widthMm = input.widthMm ?? pack?.palletWidthMm ?? catalogHit?.widthMm
  const heightMm = input.heightMm ?? pack?.palletHeightMm ?? catalogHit?.heightMm
  const weightG =
    input.weightG ??
    (pack ? Math.round(pack.palletGrossKg * 1000) : null) ??
    catalogHit?.weightG
  const profile = deriveProductPhysicalProfile({
    ...input,
    storageClass: input.storageClass ?? catalogHit?.storageClass,
    storageForm: input.storageForm ?? catalogHit?.storageForm,
    handling: input.handling ?? catalogHit?.handling,
    lengthMm,
    widthMm,
    heightMm,
    weightG,
  })

  const source = catalogHit ? "catalog" : profile.storageClassSource
  const typicalLengthMm = pack?.palletLengthMm ?? catalogHit?.lengthMm ?? null
  const typicalWidthMm = pack?.palletWidthMm ?? catalogHit?.widthMm ?? null
  const typicalHeightMm = pack?.palletHeightMm ?? catalogHit?.heightMm ?? null
  const typicalWeightG = pack ? Math.round(pack.palletGrossKg * 1000) : catalogHit?.weightG ?? null
  return {
    profile: {
      ...profile,
      storageClass: catalogHit?.storageClass ?? profile.storageClass,
    },
    catalogHit,
    typicalLengthMm,
    typicalWidthMm,
    typicalHeightMm,
    typicalWeightG,
    typicalWeightKg: typicalWeightG != null ? typicalWeightG / 1000 : null,
    source,
    title: catalogHit?.title ?? storageClassLabel(profile.storageClass),
    hint: pack
      ? pack.hint
      : catalogHit
        ? catalogHit.note
        : profile.storageClassSource === "default"
          ? "По названию похоже на мелкоштучный товар. Точный замер не обязателен."
          : "Класс посчитан по названию и группе. Габариты можно не заполнять.",
    dimsRequired: false,
  }
}

export function formatTypicalDims(s: PhysicalSuggestResult): string | null {
  if (s.typicalLengthMm == null || s.typicalWidthMm == null || s.typicalHeightMm == null) return null
  const kg =
    s.typicalWeightKg != null
      ? s.typicalWeightKg >= 1
        ? `${s.typicalWeightKg} кг`
        : `${s.typicalWeightG} г`
      : ""
  return `${s.typicalLengthMm} × ${s.typicalWidthMm} × ${s.typicalHeightMm} мм${kg ? ` · ${kg}` : ""}`
}
