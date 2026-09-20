export const SLOT_PROFILE_FIELD_KEYS = [
  "materialType",
  "processType",
  "stickerShape",
  "productGroup",
  "volume",
  "applicationPlace",
  "equipment",
] as const

export type SlotProfileFieldKey = (typeof SLOT_PROFILE_FIELD_KEYS)[number]

export function isSlotProfileFieldKey(value: string): value is SlotProfileFieldKey {
  return (SLOT_PROFILE_FIELD_KEYS as readonly string[]).includes(value)
}

export const SLOT_PROFILE_FIELD_LABELS: Record<SlotProfileFieldKey, string> = {
  materialType: "Тип материала",
  processType: "Этап производства",
  stickerShape: "Форма стикера",
  productGroup: "Линейка / бренд",
  volume: "Объём тары",
  applicationPlace: "Куда клеится / наносится",
  equipment: "Аппликатор / линия маркировки",
}
