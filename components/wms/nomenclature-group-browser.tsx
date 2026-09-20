"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, ChevronRight, Package, Search } from "lucide-react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  listItems,
  loadOperatorPickerGroups,
  type WmsItemListRow,
} from "@/lib/wms-api"
import {
  operatorGroupListItemsParams,
  itemBelongsToOperatorGroup,
  type OperatorNomenclatureGroup,
} from "@/lib/nomenclature-group-catalog"
import { productGroupIconSrc } from "@/lib/wms-product-group-icons"
import { cn } from "@/lib/utils"

export type NomenclatureGroupBrowserProps = {
  selectedItemCode: string | null
  onSelectItem: (item: WmsItemListRow) => void
  /** Показывать только позиции с остатком на складе */
  stockOnly?: boolean
  renderItemTitle?: (item: WmsItemListRow) => string
  renderItemSubtitle?: (item: WmsItemListRow) => string
  searchPlaceholder?: string
  className?: string
  /** Внешний выбор группы (приёмка: вкладки сверху) */
  externalGroupCode?: string | null
  onGroupChange?: (group: OperatorNomenclatureGroup | null) => void
  /** Скрыть сетку групп — только список номенклатуры выбранной группы */
  hideGroupGrid?: boolean
}

function fmtQty(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(2)
}

function defaultItemTitle(it: WmsItemListRow): string {
  const code = (it.itemCode ?? "").trim()
  const name = (it.name ?? "").trim()
  if (!name || name === code) return code || "—"
  return `${name} · ${code}`
}

function defaultItemSubtitle(it: WmsItemListRow, stockOnly: boolean): string {
  const parts: string[] = []
  const pg = (it.itemGroupCode ?? it.productGroup ?? "").trim()
  if (pg) parts.push(pg)
  const avail = it.availableQty ?? 0
  parts.push(
    stockOnly
      ? avail > 0
        ? `${fmtQty(avail)} шт на складе`
        : "нет остатка"
      : `${fmtQty(avail)} шт`
  )
  return parts.join(" · ")
}

function GroupCard({
  group,
  onClick,
}: {
  group: OperatorNomenclatureGroup
  onClick: () => void
}) {
  const icon = group.imageUrl?.trim() || productGroupIconSrc(group.name) || productGroupIconSrc(group.code)
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      {icon ? (
        <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-muted/30 ring-1 ring-border">
          <Image src={icon} alt="" width={56} height={56} className="size-full object-cover" sizes="56px" />
        </div>
      ) : (
        <div className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-dashed bg-muted/40 text-muted-foreground">
          <Package className="size-6 opacity-70" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="font-semibold leading-snug">{group.name}</div>
        {group.description ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{group.description}</p>
        ) : (
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{group.code}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          {group.itemCount} поз.
          {group.withStockCount > 0 ? ` · ${group.withStockCount} с остатком` : ""}
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

export function NomenclatureGroupBrowser({
  selectedItemCode,
  onSelectItem,
  stockOnly = false,
  renderItemTitle = defaultItemTitle,
  renderItemSubtitle,
  searchPlaceholder = "Код, GTIN или название",
  className,
  externalGroupCode,
  onGroupChange,
  hideGroupGrid = false,
}: NomenclatureGroupBrowserProps) {
  const [groups, setGroups] = useState<OperatorNomenclatureGroup[]>([])
  const [groupsLoading, setGroupsLoading] = useState(true)
  const [internalGroupCode, setInternalGroupCode] = useState<string | null>(null)
  const [items, setItems] = useState<WmsItemListRow[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemSearch, setItemSearch] = useState("")
  const [groupsError, setGroupsError] = useState<string | null>(null)
  const [searchOutsideGroup, setSearchOutsideGroup] = useState(false)
  const searchGen = useRef(0)

  const activeGroupCode = externalGroupCode ?? internalGroupCode
  const activeGroup = useMemo(
    () => groups.find((g) => g.code === activeGroupCode) ?? null,
    [groups, activeGroupCode]
  )

  const showGroupGrid = !hideGroupGrid && !activeGroupCode

  useEffect(() => {
    let cancelled = false
    setGroupsLoading(true)
    void loadOperatorPickerGroups()
      .then(({ groups: list }) => {
        if (cancelled) return
        setGroups(list)
        if (list.length === 1 && !externalGroupCode && !internalGroupCode) {
          setInternalGroupCode(list[0]!.code)
          onGroupChange?.(list[0]!)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setGroups([])
          setGroupsError(e instanceof Error ? e.message : "Не удалось загрузить группы")
        }
      })
      .finally(() => {
        if (!cancelled) setGroupsLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, [])

  const loadItems = useCallback(async (group: OperatorNomenclatureGroup) => {
    setItemsLoading(true)
    try {
      const res = await listItems({
        ...operatorGroupListItemsParams(group),
        limit: 800,
      })
      let list = res.items ?? []
      if (stockOnly) list = list.filter((it) => (it.availableQty ?? 0) > 0)
      list.sort((a, b) => {
        const da = a.availableQty ?? 0
        const db = b.availableQty ?? 0
        if (db !== da) return db - da
        const na = (a.name || a.itemCode || "").toString()
        const nb = (b.name || b.itemCode || "").toString()
        return na.localeCompare(nb, "ru")
      })
      setItems(list)
    } catch {
      setItems([])
    } finally {
      setItemsLoading(false)
    }
  }, [stockOnly])

  useEffect(() => {
    const group = groups.find((g) => g.code === activeGroupCode) ?? null
    if (!group) {
      setItems([])
      setSearchOutsideGroup(false)
      return
    }
    const q = itemSearch.trim()
    const reqId = ++searchGen.current
    if (q.length >= 2) {
      const t = window.setTimeout(() => {
        setItemsLoading(true)
        setSearchOutsideGroup(false)
        void listItems({ query: q, limit: 100 })
          .then((res) => {
            if (searchGen.current !== reqId) return
            const all = res.items ?? []
            const inGroup = all.filter((it) => itemBelongsToOperatorGroup(it, group))
            if (inGroup.length > 0) {
              setItems(inGroup)
              setSearchOutsideGroup(false)
            } else if (all.length > 0) {
              setItems(all)
              setSearchOutsideGroup(true)
            } else {
              setItems([])
              setSearchOutsideGroup(false)
            }
          })
          .catch(() => {
            if (searchGen.current !== reqId) return
            setItems([])
            setSearchOutsideGroup(false)
          })
          .finally(() => {
            if (searchGen.current === reqId) setItemsLoading(false)
          })
      }, 300)
      return () => {
        window.clearTimeout(t)
        searchGen.current += 1
      }
    }
    setSearchOutsideGroup(false)
    void loadItems(group)
  }, [activeGroupCode, itemSearch, loadItems, groups])

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase()
    if (!q) return items.slice(0, 120)
    return items
      .filter((it) =>
        [it.itemCode, it.name, it.gtin, it.productGroup, it.itemGroupCode]
          .some((v) => String(v ?? "").toLowerCase().includes(q))
      )
      .slice(0, 120)
  }, [items, itemSearch])

  function pickGroup(group: OperatorNomenclatureGroup) {
    setItemSearch("")
    if (externalGroupCode == null) setInternalGroupCode(group.code)
    onGroupChange?.(group)
  }

  function backToGroups() {
    setItemSearch("")
    if (externalGroupCode == null) setInternalGroupCode(null)
    onGroupChange?.(null)
  }

  const subtitle = renderItemSubtitle ?? ((it: WmsItemListRow) => defaultItemSubtitle(it, stockOnly))

  return (
    <div className={cn("space-y-3", className)}>
      {showGroupGrid ? (
        <>
          <div className="text-sm font-semibold">Группа номенклатуры</div>
          {groupsLoading ? (
            <p className="text-sm text-muted-foreground">Загрузка групп…</p>
          ) : groupsError ? (
            <p className="text-sm text-destructive">{groupsError}</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Нет групп в справочнике. Добавьте в Настройки → Справочники → Группы товаров и ЕИ.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {groups.map((g) => (
                <GroupCard key={g.code} group={g} onClick={() => pickGroup(g)} />
              ))}
            </div>
          )}
        </>
      ) : activeGroup ? (
        <>
          {!hideGroupGrid ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 h-8 rounded-lg text-xs"
              onClick={backToGroups}
            >
              <ArrowLeft className="mr-1 h-3.5 w-3.5" />
              Все группы
            </Button>
          ) : null}
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-sm font-semibold">{activeGroup.name}</div>
            {activeGroup.itemCount > 0 ? (
              <span className="text-xs text-muted-foreground">{activeGroup.itemCount} поз.</span>
            ) : null}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="rounded-lg pl-9"
            />
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {searchOutsideGroup ? (
              <p className="px-1 pb-2 text-xs text-amber-800">
                Найдено вне выбранной группы — проверьте «Группа товаров» в карточке номенклатуры.
              </p>
            ) : null}
            {itemsLoading ? (
              <p className="text-sm text-muted-foreground">Загрузка номенклатуры…</p>
            ) : filteredItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {itemSearch.trim()
                  ? "Ничего не найдено"
                  : stockOnly
                    ? "Нет позиций с остатком в этой группе"
                    : "В группе нет номенклатуры. Укажите «Группа товаров» в карточке или начните поиск по названию/артикулу."}
              </p>
            ) : (
              filteredItems.map((it) => (
                <button
                  key={it.itemCode}
                  type="button"
                  onClick={() => onSelectItem(it)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                    selectedItemCode === it.itemCode
                      ? "border-primary/50 bg-primary/10"
                      : "border-transparent hover:bg-secondary/50"
                  )}
                >
                  <div className="font-medium leading-snug">{renderItemTitle(it)}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{subtitle(it)}</div>
                </button>
              ))
            )}
          </div>
        </>
      ) : hideGroupGrid && !activeGroupCode ? (
        <p className="text-sm text-muted-foreground">Выберите группу номенклатуры</p>
      ) : null}
    </div>
  )
}
