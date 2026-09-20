import type { WmsItemListRow } from "@/lib/wms-api"
import {
  issueGroupMatchesItem,
  itemMatchesReceivingGroup,
  receivingGroupFilterNames,
  receivingScanMatchesGroup,
  type ReceivingProductGroupKey,
} from "@/lib/receiving-product-groups"

export type OperatorNomenclatureGroup = {
  code: string
  name: string
  description: string | null
  imageUrl?: string | null
  itemCount: number
  withStockCount: number
  sortOrder: number
  /** Все коды справочника, сведённые в одну карточку (alcohol + алкоголь и т.п.). */
  aliasCodes?: string[]
  /** Подгруппа приёмки: связанные товарные группы из настроек WMS. */
  linkedGroupCodes?: string[]
}

export type OperatorPickerGroupsSource = "receiving-categories" | "item-groups" | "legacy"

export function operatorGroupPickerSectionTitle(source: OperatorPickerGroupsSource): string {
  if (source === "receiving-categories") return "Подгруппы"
  if (source === "item-groups") return "Номенклатурные группы Честного знака"
  return "Группы товаров"
}

function normGroupToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

/** Ключ слияния: одно название или пересечение code/name между записями. */
function operatorGroupMergeKey(g: {
  code: string
  name: string
}): string {
  const name = normGroupToken(g.name)
  const code = normGroupToken(g.code)
  if (name && name.length > 1 && name !== code) return `label:${name}`
  return `code:${code}`
}

function groupsShouldMerge(
  a: { code: string; name: string },
  b: { code: string; name: string }
): boolean {
  if (operatorGroupMergeKey(a) === operatorGroupMergeKey(b)) return true
  const tokensA = new Set(
    [a.code, a.name].map(normGroupToken).filter((t) => t.length > 0)
  )
  const tokensB = [b.code, b.name].map(normGroupToken).filter((t) => t.length > 0)
  return tokensB.some((t) => tokensA.has(t))
}

/** Слияние дублей из sync (product_group EN + item_group_code RU с одним названием). */
export function dedupeOperatorNomenclatureGroups(
  groups: OperatorNomenclatureGroup[]
): OperatorNomenclatureGroup[] {
  const buckets: OperatorNomenclatureGroup[] = []

  for (const g of groups) {
    const bucket = buckets.find((b) => groupsShouldMerge(b, g))
    if (!bucket) {
      buckets.push({ ...g, aliasCodes: [g.code] })
      continue
    }
    const aliases = new Set([...(bucket.aliasCodes ?? [bucket.code]), g.code])
    bucket.aliasCodes = [...aliases]
    if (g.itemCount > bucket.itemCount) {
      bucket.code = g.code
    }
    bucket.itemCount += g.itemCount
    bucket.withStockCount += g.withStockCount
    if (g.sortOrder < bucket.sortOrder) bucket.sortOrder = g.sortOrder
    if ((g.name?.trim().length ?? 0) > (bucket.name?.trim().length ?? 0)) {
      bucket.name = g.name
    }
    if (!bucket.description?.trim() && g.description?.trim()) {
      bucket.description = g.description
    }
    if (!bucket.imageUrl?.trim() && g.imageUrl?.trim()) {
      bucket.imageUrl = g.imageUrl
    }
  }

  return buckets.sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ru")
  )
}

const LEGACY_RECEIVING_KEYS = new Set<string>(["stickers", "water", "unmarked"])

export function isLegacyReceivingGroupKey(code: string): code is ReceivingProductGroupKey {
  return LEGACY_RECEIVING_KEYS.has(code)
}

/** Позиция относится к группе справочника (item_group_code / product_group / legacy). */
export function itemBelongsToOperatorGroup(
  item: {
    itemCode?: string | null
    productGroup?: string | null
    itemGroupCode?: string | null
    packagingProfile?: string | null
    isMarked?: boolean | null
  },
  group: Pick<OperatorNomenclatureGroup, "code" | "name" | "aliasCodes" | "linkedGroupCodes">
): boolean {
  const linked = (group.linkedGroupCodes ?? []).map((c) => c.trim()).filter(Boolean)
  if (linked.length > 0) {
    const linkSet = new Set(linked.map((c) => c.toLowerCase()))
    const catCode = group.code.trim().toLowerCase()
    const catName = group.name.trim().toLowerCase()
    const ig = (item.itemGroupCode ?? "").trim().toLowerCase()
    const pg = (item.productGroup ?? "").trim().toLowerCase()
    if (pg === catCode || ig === catCode) return true
    if (catName && (pg === catName || ig === catName)) return true
    if (ig && linkSet.has(ig)) return true
    if (pg && linkSet.has(pg)) return true
    if (isLegacyReceivingGroupKey(group.code)) {
      return (
        itemMatchesReceivingGroup(item.itemCode, item.productGroup, group.code) ||
        issueGroupMatchesItem(item, group.code)
      )
    }
    return false
  }

  const codes = new Set(
    [...(group.aliasCodes ?? []), group.code, group.name]
      .map((c) => c?.trim())
      .filter(Boolean) as string[]
  )
  if (codes.size === 0) return true

  const ig = (item.itemGroupCode ?? "").trim()
  if (ig && [...codes].some((c) => ig.toLowerCase() === c.toLowerCase())) return true

  const pg = (item.productGroup ?? "").trim()
  if (pg && [...codes].some((c) => pg.toLowerCase() === c.toLowerCase())) return true

  const code = group.code.trim()

  if (isLegacyReceivingGroupKey(code)) {
    return (
      itemMatchesReceivingGroup(item.itemCode, item.productGroup, code) ||
      issueGroupMatchesItem(item, code)
    )
  }

  return false
}

export function filterItemsByOperatorGroup(
  items: WmsItemListRow[],
  group: Pick<OperatorNomenclatureGroup, "code" | "name">
): WmsItemListRow[] {
  return items.filter((it) => itemBelongsToOperatorGroup(it, group))
}

/** Имена для API listItems (productGroups / groupCode). */
export function operatorGroupListFilterNames(
  group: Pick<OperatorNomenclatureGroup, "code" | "name" | "aliasCodes" | "linkedGroupCodes">
): string[] {
  const linked = (group.linkedGroupCodes ?? []).map((c) => c.trim()).filter(Boolean)
  if (linked.length > 0) {
    const names = new Set(linked)
    const code = group.code.trim()
    if (isLegacyReceivingGroupKey(code)) {
      for (const n of receivingGroupFilterNames(code)) names.add(n)
    }
    return [...names]
  }

  const names = new Set<string>()
  for (const c of [...(group.aliasCodes ?? []), group.code, group.name]) {
    const t = c?.trim()
    if (t) names.add(t)
  }
  const code = group.code.trim()
  if (isLegacyReceivingGroupKey(code)) {
    for (const n of receivingGroupFilterNames(code)) names.add(n)
  }
  return [...names]
}

/** Параметры listItems для выбранной группы/подгруппы. */
export function operatorGroupListItemsParams(
  group: Pick<OperatorNomenclatureGroup, "code" | "name" | "aliasCodes" | "linkedGroupCodes">
): { productGroups: string[] } {
  return { productGroups: operatorGroupListFilterNames(group) }
}

export function receivingScanMatchesOperatorGroup(
  item: Parameters<typeof receivingScanMatchesGroup>[0],
  group:
    | string
    | Pick<OperatorNomenclatureGroup, "code" | "name" | "aliasCodes" | "linkedGroupCodes">,
  scan?: Parameters<typeof receivingScanMatchesGroup>[2]
): boolean {
  const resolved =
    typeof group === "string" ? { code: group, name: group } : group
  if (itemBelongsToOperatorGroup(item, resolved)) return true
  if (isLegacyReceivingGroupKey(resolved.code)) {
    return receivingScanMatchesGroup(item, resolved.code, scan)
  }
  return false
}
