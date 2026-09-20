export type ReceivingProductGroupKey = "stickers" | "water" | "unmarked"

export type ReceivingProductGroupOption = {
  key: ReceivingProductGroupKey
  title: string
  subtitle: string
  enabled: boolean
  /** Значения product_group в номенклатуре для фильтра operator-feed */
  filterNames: string[]
}

export const RECEIVING_PRODUCT_GROUPS: ReceivingProductGroupOption[] = [
  {
    key: "stickers",
    title: "Стикеры",
    subtitle: "Маркировка и коды ЧЗ",
    enabled: true,
    filterNames: ["stickers", "sticker", "Стикеры", "этикет"],
  },
  {
    key: "water",
    title: "Вода",
    subtitle: "Товарная группа water",
    enabled: true,
    filterNames: ["water", "Вода", "softdrinks", "напит"],
  },
  {
    key: "unmarked",
    title: "Без кодов",
    subtitle: "Позиции без маркировки",
    enabled: true,
    filterNames: ["unmarked", "без кодов", "без марки"],
  },
]

export function receivingGroupTitle(key: string): string {
  return RECEIVING_PRODUCT_GROUPS.find((g) => g.key === key)?.title ?? key
}

export function receivingGroupFilterNames(key: string): string[] {
  return RECEIVING_PRODUCT_GROUPS.find((g) => g.key === key)?.filterNames ?? []
}

export function itemMatchesReceivingGroup(
  itemCode: string | null | undefined,
  productGroup: string | null | undefined,
  groupKey: string
): boolean {
  const names = receivingGroupFilterNames(groupKey).map((n) => n.toLowerCase())
  const pg = (productGroup ?? "").trim().toLowerCase()
  if (pg && names.some((n) => pg.includes(n) || n.includes(pg))) return true
  const code = (itemCode ?? "").trim().toLowerCase()
  if (!code) return false
  if (groupKey === "stickers") {
    return code.includes("stk") || code.includes("sticker") || code.includes("этик")
  }
  if (groupKey === "water") return code.includes("water") || code.includes("вода")
  return false
}

/** Скан/номенклатура для вкладки приёмки (шире, чем только product_group «Стикеры»). */
export function receivingScanMatchesGroup(
  item: {
    itemCode?: string | null
    productGroup?: string | null
    /** Код группы из справочника номенклатуры — используется при подборе группы оператора. */
    itemGroupCode?: string | null
    packagingProfile?: string | null
    isMarked?: boolean | null
  },
  groupKey: ReceivingProductGroupKey,
  scan?: { stickerStatus?: string | null }
): boolean {
  if (itemMatchesReceivingGroup(item.itemCode, item.productGroup, groupKey)) return true
  if (groupKey === "stickers") {
    const profile = (item.packagingProfile ?? "").trim().toLowerCase()
    if (profile === "stickers") return true
  }
  if (groupKey === "unmarked") {
    if (item.isMarked === false && !item.productGroup) return true
  }
  return false
}

/** Позиция для вкладки «Выдача» (шире, чем только product_group). */
export function issueGroupMatchesItem(
  item: {
    itemCode?: string | null
    productGroup?: string | null
    packagingProfile?: string | null
    isMarked?: boolean | null
    availableQty?: number | null
  },
  groupKey: ReceivingProductGroupKey
): boolean {
  if (itemMatchesReceivingGroup(item.itemCode, item.productGroup, groupKey)) return true
  if (groupKey === "stickers") {
    const profile = (item.packagingProfile ?? "").trim().toLowerCase()
    if (profile === "stickers") return true
    // Маркированные материалы из ЧЗ часто в product_group softdrinks, не «Стикеры»
    if (item.isMarked && (item.availableQty ?? 0) > 0) return true
  }
  if (groupKey === "water") {
    const pg = (item.productGroup ?? "").trim().toLowerCase()
    if (pg.includes("water") || pg.includes("вода")) return true
  }
  return false
}
