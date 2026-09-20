/** Статус комплектующего на схеме (позже — из БД / остатков). */
export type ProductPartStatus = "ok" | "low" | "missing"

export type ProductPartMarker = {
  id: string
  label: string
  /** Короткая подпись в маркере, напр. «50 тыс.» или «нет» */
  qtyLabel: string
  status: ProductPartStatus
  /** Точка на изображении, % от области фото */
  anchorX: number
  anchorY: number
  /** Позиция подписи, % */
  calloutX: number
  calloutY: number
  calloutSide: "left" | "right"
}

export type ProductPartsSchemeConfig = {
  itemCode: string
  itemName: string
  imageUrl: string
  parts: ProductPartMarker[]
}

/**
 * Демо-схема: статичная картинка и маркеры.
 * Позже заменим на выборку номенклатуры + imageUrl из БД.
 */
export const WORKSHOP_PRODUCT_PARTS_DEMO: ProductPartsSchemeConfig = {
  itemCode: "04607017160602",
  itemName: "Напиток «СПОРТ / Монастырский» на основе минеральной воды 0,5 л",
  imageUrl: "/wms-item-images/04607017160602.jpg",
  parts: [
    {
      id: "cap",
      label: "Пробка",
      qtyLabel: "50 тыс.",
      status: "ok",
      anchorX: 50,
      anchorY: 8,
      calloutX: 76,
      calloutY: 7,
      calloutSide: "right",
    },
    {
      id: "label",
      label: "Этикетка",
      qtyLabel: "12 тыс.",
      status: "ok",
      anchorX: 50,
      anchorY: 35,
      calloutX: 20,
      calloutY: 32,
      calloutSide: "left",
    },
    {
      id: "film",
      label: "Упаковочный материал",
      qtyLabel: "4,2 тыс.",
      status: "ok",
      anchorX: 56,
      anchorY: 46,
      calloutX: 22,
      calloutY: 49,
      calloutSide: "left",
    },
    {
      id: "bottle",
      label: "Бутылка ПЭТ",
      qtyLabel: "800 шт.",
      status: "low",
      anchorX: 52,
      anchorY: 68,
      calloutX: 78,
      calloutY: 66,
      calloutSide: "right",
    },
    {
      id: "carton",
      label: "Групповая упаковка",
      qtyLabel: "нет",
      status: "missing",
      anchorX: 50,
      anchorY: 90,
      calloutX: 20,
      calloutY: 87,
      calloutSide: "left",
    },
  ],
}

export function productPartStatusLabel(status: ProductPartStatus): string {
  if (status === "ok") return "В наличии"
  if (status === "low") return "Мало"
  return "Нет"
}
