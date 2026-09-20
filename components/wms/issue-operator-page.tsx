"use client"

import { useEffect, useMemo, useState } from "react"
import { FolderTree } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { OperationDocumentsPage } from "@/components/wms/operation-documents-page"
import { NomenclatureGroupBrowser } from "@/components/wms/nomenclature-group-browser"
import { ReceivingNomenclatureGroupDialog } from "@/components/wms/receiving-nomenclature-group-dialog"
import {
  getItemStockAvailability,
  getItemFefoPickRecommendation,
  getPosPickPlan,
  getWmsLocationDetail,
  listDirectoryWarehouses,
  listIssueRecipients,
  listLocations,
  loadOperatorPickerGroups,
  postIssueToProduction,
  type ItemStockAvailability,
  type IssueRecipientOption,
  type PosPickPlanRow,
  type StockLotAvailabilityRow,
  type WarehouseDirectoryRow,
  type WmsItemListRow,
  type WmsLocationRow,
} from "@/lib/wms-api"
import {
  formatLocationPlacementLabel,
  warehouseDisplayLabel,
} from "@/lib/storage-slot-ui"
import {
  isWorkshopDirectoryRow,
  resolveTopologyPlacement,
} from "@/lib/wms/workshop-directory"
import {
  operatorGroupPickerSectionTitle,
  type OperatorNomenclatureGroup,
  type OperatorPickerGroupsSource,
} from "@/lib/nomenclature-group-catalog"
import { RECEIVING_PRODUCT_GROUPS } from "@/lib/receiving-product-groups"
import { WmsStickyAlert } from "@/components/wms/wms-sticky-alert"
import { WmsConfirmDialog, WmsErrorState } from "@/components/wms/wms-shared"
import { mapWmsError } from "@/lib/wms-error-messages"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

function fmtQty(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(2)
}

const GENERIC_STICKER_NAMES = new Set(["стикеры", "стикер", "stickers", "sticker"])

function issueItemTitle(it: WmsItemListRow): string {
  const code = (it.itemCode ?? "").trim()
  const name = (it.name ?? "").trim()
  if (!name || name === code) return code || "—"
  if (GENERIC_STICKER_NAMES.has(name.toLowerCase())) return code || name
  return name
}

function issueItemSubtitle(it: WmsItemListRow): string {
  const code = (it.itemCode ?? "").trim()
  const title = issueItemTitle(it)
  const parts: string[] = []
  if (code && title !== code) parts.push(code)
  const pg = (it.productGroup ?? "").trim()
  if (pg && !GENERIC_STICKER_NAMES.has(pg.toLowerCase())) parts.push(pg)
  const avail = it.availableQty ?? 0
  parts.push(avail > 0 ? `${fmtQty(avail)} шт на складе` : "нет остатка")
  return parts.join(" · ")
}

function issueTargetOptionLabel(
  loc: WmsLocationRow,
  warehouseLabels: Record<string, string>
): string {
  const placement = formatLocationPlacementLabel({
    warehouseCode: loc.warehouseCode,
    zoneCode: loc.zoneCode,
    zoneName: loc.zoneName,
    warehouseLabels,
  })
  const cell =
    loc.slotProfile?.physicalAddress?.trim() ||
    (loc.displayName || loc.slotTitle || loc.locationCode).trim()
  return `${placement} · ${cell}`
}

function workshopDirectoryLabel(w: WarehouseDirectoryRow): string {
  const name = (w.name || String(w.meta?.locationName ?? "")).trim()
  const code = (w.code ?? "").trim()
  if (!name) return code
  if (!code || name === code) return name
  return `${name} · ${code}`
}

function isWarehouseSourceLocation(loc: WmsLocationRow, workshopCodes: string[]): boolean {
  const placement = resolveTopologyPlacement({
    warehouseCode: loc.warehouseCode,
    zoneCode: loc.zoneCode,
    workshopCodes,
  })
  return placement.group === "warehouse"
}

function fmtEmissionDay(day: string, iso: string | null): string {
  if (iso) {
    try {
      return new Date(iso).toLocaleDateString("ru-RU")
    } catch {
      /* fall through */
    }
  }
  if (day.length === 8) {
    return `${day.slice(6, 8)}.${day.slice(4, 6)}.${day.slice(0, 4)}`
  }
  return day
}

export function IssueOperatorPage() {
  const [nomenclatureGroups, setNomenclatureGroups] = useState<OperatorNomenclatureGroup[]>([])
  const [groupPickerSource, setGroupPickerSource] = useState<OperatorPickerGroupsSource>("item-groups")
  const [selectedGroupCode, setSelectedGroupCode] = useState<string | null>(null)
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [tab, setTab] = useState("manual")
  const [selectedItem, setSelectedItem] = useState<WmsItemListRow | null>(null)
  const [availability, setAvailability] = useState<ItemStockAvailability | null>(null)
  const [selectedLot, setSelectedLot] = useState<StockLotAvailabilityRow | null>(null)
  const [qty, setQty] = useState("1")
  const [recipient, setRecipient] = useState("")
  const [targetLocationCode, setTargetLocationCode] = useState("")
  const [recipients, setRecipients] = useState<IssueRecipientOption[]>([])
  const [allLocations, setAllLocations] = useState<WmsLocationRow[]>([])
  const [workshops, setWorkshops] = useState<WarehouseDirectoryRow[]>([])
  const [sourceLocations, setSourceLocations] = useState<WmsLocationRow[]>([])
  const [locationCode, setLocationCode] = useState("")
  const [locationStock, setLocationStock] = useState<
    Array<{
      itemCode: string
      name: string
      availableQty: number
      barcode: string | null
    }>
  >([])
  const [locationStockLoading, setLocationStockLoading] = useState(false)
  const [itemPickCells, setItemPickCells] = useState<PosPickPlanRow[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [directoriesError, setDirectoriesError] = useState<string | null>(null)

  const groupLabel = useMemo(() => {
    if (!selectedGroupCode) return "—"
    return nomenclatureGroups.find((g) => g.code === selectedGroupCode)?.name ?? selectedGroupCode
  }, [selectedGroupCode, nomenclatureGroups])

  useEffect(() => {
    void Promise.all([listLocations(), listDirectoryWarehouses()])
      .then(([locRes, whRes]) => {
        const locs = locRes.locations ?? []
        setAllLocations(locs)
        const wh = (whRes.warehouses ?? []).filter(isWorkshopDirectoryRow)
        setWorkshops(wh)
        const wsCodes = wh.map((w) => w.code)
        const warehouseLocs = locs.filter((l) => isWarehouseSourceLocation(l, wsCodes))
        const withStock = warehouseLocs.filter((l) => l.availableQty > 0)
        const sources = withStock.length > 0 ? withStock : warehouseLocs
        setSourceLocations(sources)
        if (!locationCode.trim()) {
          const defaultSource = withStock[0] ?? warehouseLocs[0]
          if (defaultSource) setLocationCode(defaultSource.locationCode)
        }
      })
      .catch((e) => {
        setAllLocations([])
        setSourceLocations([])
        setWorkshops([])
        setDirectoriesError(mapWmsError(e))
      })
  }, [])

  const warehouseLabels = useMemo(() => {
    const m: Record<string, string> = {}
    for (const w of workshops) {
      const label = workshopDirectoryLabel(w)
      if (label) m[w.code] = label
    }
    return m
  }, [workshops])

  const workshopCodes = useMemo(() => workshops.map((w) => w.code), [workshops])

  const targetLocationGroups = useMemo(() => {
    const source = locationCode.trim()
    const byWorkshop = new Map<string, WmsLocationRow[]>()
    for (const loc of allLocations) {
      if (loc.locationCode === source) continue
      const placement = resolveTopologyPlacement({
        warehouseCode: loc.warehouseCode,
        zoneCode: loc.zoneCode,
        workshopCodes,
      })
      if (placement.group !== "workshop") continue
      const key = placement.warehouseCode
      const list = byWorkshop.get(key) ?? []
      list.push(loc)
      byWorkshop.set(key, list)
    }
    return [...byWorkshop.entries()]
      .map(([whCode, locs]) => ({
        whCode,
        label: warehouseDisplayLabel(whCode, warehouseLabels[whCode]),
        locations: [...locs].sort((a, b) =>
          issueTargetOptionLabel(a, warehouseLabels).localeCompare(
            issueTargetOptionLabel(b, warehouseLabels),
            "ru"
          )
        ),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"))
  }, [allLocations, locationCode, workshopCodes, warehouseLabels])

  useEffect(() => {
    if (targetLocationCode.trim()) return
    const source = locationCode.trim()
    if (targetLocationGroups.length === 0) return
    for (const g of targetLocationGroups) {
      const pick = g.locations.find((loc) => loc.locationCode !== source)
      if (pick) {
        setTargetLocationCode(pick.locationCode)
        break
      }
    }
  }, [locationCode, targetLocationCode, targetLocationGroups])

  useEffect(() => {
    void listIssueRecipients()
      .then(setRecipients)
      .catch(() => setRecipients([]))
  }, [])

  useEffect(() => {
    void loadOperatorPickerGroups()
      .then(({ groups: list, source }) => {
        setGroupPickerSource(source)
        if (list.length > 0) {
          setNomenclatureGroups(list)
          setSelectedGroupCode((prev) => prev ?? list[0]!.code)
          return
        }
        const fallback: OperatorNomenclatureGroup[] = RECEIVING_PRODUCT_GROUPS.filter((g) => g.enabled).map(
          (g) => ({
            code: g.key,
            name: g.title,
            description: g.subtitle,
            itemCount: 0,
            withStockCount: 0,
            sortOrder: 0,
          })
        )
        setNomenclatureGroups(fallback)
        setSelectedGroupCode((prev) => prev ?? fallback[0]?.code ?? null)
      })
      .catch(() => {
        setGroupPickerSource("legacy")
        const fallback: OperatorNomenclatureGroup[] = RECEIVING_PRODUCT_GROUPS.filter((g) => g.enabled).map(
          (g) => ({
            code: g.key,
            name: g.title,
            description: g.subtitle,
            itemCount: 0,
            withStockCount: 0,
            sortOrder: 0,
          })
        )
        setNomenclatureGroups(fallback)
        setSelectedGroupCode(fallback[0]?.code ?? null)
      })
  }, [])

  useEffect(() => {
    const loc = locationCode.trim()
    if (!loc) {
      setLocationStock([])
      return
    }
    setLocationStockLoading(true)
    void getWmsLocationDetail(loc)
      .then((detail) => {
        setLocationStock(
          (detail.stock ?? [])
            .filter((row) => row.availableQty > 0)
            .sort((a, b) => b.availableQty - a.availableQty)
        )
      })
      .catch(() => setLocationStock([]))
      .finally(() => setLocationStockLoading(false))
  }, [locationCode])

  useEffect(() => {
    if (!selectedItem?.itemCode || !locationCode.trim()) return
    void reloadAvailabilityForSelectedItem()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload stock when cell or item changes
  }, [locationCode, selectedItem?.itemCode])

  function itemFromLocationStock(row: {
    itemCode: string
    name: string
    availableQty: number
    barcode: string | null
  }): WmsItemListRow {
    return {
      itemCode: row.itemCode,
      name: row.name,
      sku: row.barcode,
      availableQty: row.availableQty,
      reservedQty: 0,
    }
  }

  function onSourceLocationChange(nextLoc: string) {
    setLocationCode(nextLoc)
    setAvailability(null)
    setSelectedLot(null)
    setItemPickCells([])
    setError(null)
    setSuccess(null)
  }

  async function loadAvailability(item: WmsItemListRow) {
    setError(null)
    setSuccess(null)
    setSelectedItem(item)
    setSelectedLot(null)
    await reloadAvailabilityForSelectedItem(item)
  }

  async function reloadAvailabilityForSelectedItem(itemOverride?: WmsItemListRow) {
    const item = itemOverride ?? selectedItem
    if (!item?.itemCode) return

    let effectiveLoc = locationCode.trim()
    if (!effectiveLoc) {
      setError("Укажите ячейку склада, откуда выдаём")
      return
    }

    try {
      const [pickResult, fefoResult] = await Promise.all([
        getPosPickPlan({ itemCode: item.itemCode, qty: 1 }).catch(() => null),
        getItemFefoPickRecommendation({ itemCode: item.itemCode }).catch(() => ({
          recommendation: null,
        })),
      ])

      const pickRows = (pickResult?.plan ?? []).filter((row) => row.availableQty > 0)
      setItemPickCells(pickRows)

      const recommendedPick = fefoResult?.recommendation ?? null
      if (
        recommendedPick &&
        (recommendedPick.rotationPolicy === "fefo" || recommendedPick.isPerishable) &&
        recommendedPick.locationCode
      ) {
        if (recommendedPick.locationCode !== effectiveLoc) {
          effectiveLoc = recommendedPick.locationCode
          setLocationCode(effectiveLoc)
          setSuccess(
            `FEFO: ячейка ${effectiveLoc}, партия ${recommendedPick.lotCode} · ${fmtQty(recommendedPick.availableQty)} шт`
          )
        }
      } else if (!effectiveLoc && pickRows[0]?.locationCode) {
        effectiveLoc = pickRows[0].locationCode
        setLocationCode(effectiveLoc)
      } else if (
        pickRows.length > 0 &&
        !pickRows.some((row) => row.locationCode === effectiveLoc)
      ) {
        effectiveLoc = pickRows[0]!.locationCode
        setLocationCode(effectiveLoc)
        setSuccess(`В выбранной ячейке нет остатка — подставлена ${effectiveLoc}`)
      }

      const av = await getItemStockAvailability({
        itemCode: item.itemCode,
        locationCode: effectiveLoc,
      })
      setAvailability(av)
      const recommended =
        av.lots.find((l) => l.lotId === av.recommendedLotId && l.availableQty > 0) ??
        av.lots.find((l) => l.availableQty > 0) ??
        av.lots[0] ??
        null
      setSelectedLot(recommended)
      if (recommended && recommended.availableQty > 0) {
        setQty(String(Math.floor(recommended.availableQty)))
      } else if (av.totalAvailable <= 0 && av.totalInProduction <= 0) {
        const altCells = pickRows
          .slice(0, 3)
          .map((row) => `${row.locationCode} (${fmtQty(row.availableQty)} шт)`)
          .join(", ")
        setError(
          altCells
            ? `В ячейке «${effectiveLoc}» нет остатка. Доступно: ${altCells}`
            : `В ячейке «${effectiveLoc}» нет остатка по «${item.name || item.itemCode}».`
        )
      }
    } catch (e) {
      setAvailability(null)
      setItemPickCells([])
      setError(mapWmsError(e))
    }
  }

  function validateIssueForm(): boolean {
    if (!selectedItem?.itemCode) return false
    const loc = locationCode.trim()
    const parsedQty = Number(qty)
    const rec = recipient.trim()
    if (!loc) {
      setError("Укажите ячейку")
      return false
    }
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
      setError("Укажите количество")
      return false
    }
    if (!rec) {
      setError("Укажите получателя")
      return false
    }
    const target = targetLocationCode.trim()
    if (!target) {
      setError("Выберите цех / ячейку назначения")
      return false
    }
    if (target === loc) {
      setError("Ячейка «куда» должна отличаться от «откуда»")
      return false
    }
    const max = selectedLot?.availableQty ?? availability?.totalAvailable ?? 0
    if (max > 0 && parsedQty - max > 1e-9) {
      setError(`Нельзя выдать больше ${fmtQty(max)} шт`)
      return false
    }
    const recommendedLot = availability?.lots.find(
      (lot) => lot.lotId === availability.recommendedLotId && lot.availableQty > 0
    )
    if (
      availability?.recommendedLotId &&
      recommendedLot &&
      selectedLot &&
      selectedLot.lotId !== availability.recommendedLotId &&
      selectedLot.availableQty > 0
    ) {
      setError(
        `FEFO блокирует выдачу: сначала партия ${recommendedLot.lotCode} (${fmtQty(recommendedLot.availableQty)} шт)`
      )
      return false
    }
    return true
  }

  function requestIssueConfirm() {
    setError(null)
    if (!validateIssueForm()) return
    setConfirmOpen(true)
  }

  async function submitIssue() {
    if (!selectedItem?.itemCode || !validateIssueForm()) return
    const loc = locationCode.trim()
    const parsedQty = Number(qty)
    const rec = recipient.trim()
    const target = targetLocationCode.trim()
    setConfirmOpen(false)
    setSubmitting(true)
    setError(null)
    try {
      const targetLoc = allLocations.find((l) => l.locationCode === target)
      const targetLabel = targetLoc
        ? issueTargetOptionLabel(targetLoc, warehouseLabels)
        : target
      const res = await postIssueToProduction({
        itemCode: selectedItem.itemCode,
        sourceLocationCode: loc,
        targetLocationCode: target,
        qty: parsedQty,
        recipientName: rec,
        lineName: targetLabel,
        lotCode: selectedLot?.lotCode === "Без партии" ? undefined : selectedLot?.lotCode,
        emissionDay: selectedLot?.emissionDay,
        emissionAtIso: selectedLot?.emissionAtIso ?? undefined,
      })
      setSuccess(
        `Выдано ${fmtQty(parsedQty)} шт → ${targetLabel} · документ ${res.documentId}`
      )
      if (selectedItem) await loadAvailability(selectedItem)
    } catch (e) {
      setError(mapWmsError(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Выдача</h1>
      </div>

      {directoriesError ? (
        <WmsErrorState
          title="Справочники недоступны"
          message={directoriesError}
          onRetry={() => {
            setDirectoriesError(null)
            void Promise.all([listLocations(), listDirectoryWarehouses()])
              .then(([locRes, whRes]) => {
                const locs = locRes.locations ?? []
                setAllLocations(locs)
                const wh = (whRes.warehouses ?? []).filter(isWorkshopDirectoryRow)
                setWorkshops(wh)
                const wsCodes = wh.map((w) => w.code)
                const warehouseLocs = locs.filter((l) => isWarehouseSourceLocation(l, wsCodes))
                const withStock = warehouseLocs.filter((l) => l.availableQty > 0)
                const sources = withStock.length > 0 ? withStock : warehouseLocs
                setSourceLocations(sources)
              })
              .catch((e) => setDirectoriesError(mapWmsError(e)))
          }}
        />
      ) : null}
      {error ? (
        <WmsStickyAlert message={error} onDismiss={() => setError(null)} />
      ) : null}
      {success ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-900">
          {success}
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-xl">
          <TabsTrigger value="manual">Свободная выдача</TabsTrigger>
          <TabsTrigger value="tasks">Задания WMS</TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="mt-4">
          <OperationDocumentsPage kind="issue" embedded />
        </TabsContent>

        <TabsContent value="manual" className="mt-4 space-y-4">
          <div className="rounded-xl border border-border/60 bg-card px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {operatorGroupPickerSectionTitle(groupPickerSource)}
                </div>
                <div className="mt-1 text-base font-semibold text-foreground">{groupLabel}</div>
                <div className="text-xs text-muted-foreground">
                  {nomenclatureGroups.find((g) => g.code === selectedGroupCode)?.description ||
                    nomenclatureGroups.find((g) => g.code === selectedGroupCode)?.code ||
                    "Выберите подгруппу для фильтрации номенклатуры"}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => setGroupDialogOpen(true)}
                disabled={nomenclatureGroups.length === 0}
              >
                <FolderTree className="mr-1.5 h-4 w-4" />
                Все подгруппы
              </Button>
            </div>
            {nomenclatureGroups.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {nomenclatureGroups.map((g) => (
                  <Button
                    key={g.code}
                    type="button"
                    size="sm"
                    variant={selectedGroupCode === g.code ? "default" : "outline"}
                    className="h-8 rounded-lg text-xs"
                    onClick={() => {
                      setSelectedGroupCode(g.code)
                      setSelectedItem(null)
                      setAvailability(null)
                      setSelectedLot(null)
                    }}
                  >
                    {g.name}
                    {g.withStockCount > 0 ? (
                      <Badge variant="secondary" className="ml-1.5 rounded-md px-1.5 py-0 text-[10px]">
                        {g.withStockCount}
                      </Badge>
                    ) : null}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>

          <ReceivingNomenclatureGroupDialog
            open={groupDialogOpen}
            onOpenChange={setGroupDialogOpen}
            groups={nomenclatureGroups}
            selectedCode={selectedGroupCode ?? ""}
            title={operatorGroupPickerSectionTitle(groupPickerSource)}
            description="Выберите подгруппу для фильтрации номенклатуры при выдаче."
            onSelect={(code) => {
              setSelectedGroupCode(code)
              setSelectedItem(null)
              setAvailability(null)
              setSelectedLot(null)
            }}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border/60 bg-card p-4">
              <NomenclatureGroupBrowser
                externalGroupCode={selectedGroupCode}
                stockOnly
                selectedItemCode={selectedItem?.itemCode ?? null}
                onSelectItem={(it) => void loadAvailability(it)}
                onGroupChange={(g) => setSelectedGroupCode(g?.code ?? null)}
                renderItemTitle={issueItemTitle}
                renderItemSubtitle={issueItemSubtitle}
                searchPlaceholder="Код или название"
              />
            </div>

            <div className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
              <div className="text-sm font-semibold">Остатки и выдача</div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="issue-source-loc">
                  Откуда (ячейка склада)
                </label>
                {sourceLocations.length > 0 ? (
                  <select
                    id="issue-source-loc"
                    value={locationCode}
                    onChange={(e) => onSourceLocationChange(e.target.value)}
                    className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Выберите ячейку…</option>
                    {sourceLocations.map((loc) => (
                      <option key={loc.locationCode} value={loc.locationCode}>
                        {(loc.displayName || loc.slotTitle || loc.locationCode).slice(0, 48)}
                        {loc.availableQty > 0 ? ` · ${fmtQty(loc.availableQty)} шт` : ""}
                        {" · "}
                        {loc.locationCode.length > 36
                          ? `${loc.locationCode.slice(0, 18)}…${loc.locationCode.slice(-12)}`
                          : loc.locationCode}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id="issue-source-loc"
                    value={locationCode}
                    onChange={(e) => onSourceLocationChange(e.target.value)}
                    placeholder="Код ячейки склада"
                    className="rounded-lg"
                  />
                )}
                {selectedItem && itemPickCells.length > 0 ? (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium uppercase text-muted-foreground">
                      Ячейки с остатком (номенклатура)
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {itemPickCells.map((row) => (
                        <button
                          key={`${row.locationCode}-${row.lotCode ?? ""}`}
                          type="button"
                          onClick={() => onSourceLocationChange(row.locationCode)}
                          className={cn(
                            "rounded-md border px-2 py-1 text-xs",
                            locationCode === row.locationCode
                              ? "border-emerald-600/40 bg-emerald-600/10"
                              : "border-border/50 bg-secondary/30 hover:bg-secondary/50"
                          )}
                        >
                          {row.locationCode.length > 28
                            ? `${row.locationCode.slice(0, 14)}…${row.locationCode.slice(-10)}`
                            : row.locationCode}
                          {" · "}
                          {fmtQty(row.availableQty)} шт
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {!selectedItem && locationCode.trim() ? (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium uppercase text-muted-foreground">
                      Номенклатура в ячейке
                    </div>
                    {locationStockLoading ? (
                      <p className="text-xs text-muted-foreground">Загрузка остатков…</p>
                    ) : locationStock.length === 0 ? (
                      <p className="text-xs text-muted-foreground">В ячейке нет доступного остатка</p>
                    ) : (
                      <div className="max-h-40 space-y-1 overflow-y-auto">
                        {locationStock.map((row) => (
                          <button
                            key={row.itemCode}
                            type="button"
                            onClick={() => void loadAvailability(itemFromLocationStock(row))}
                            className="flex w-full items-center justify-between rounded-lg border border-border/40 px-2.5 py-1.5 text-left text-xs hover:bg-secondary/40"
                          >
                            <span className="line-clamp-2 pr-2 font-medium">{row.name || row.itemCode}</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {fmtQty(row.availableQty)} шт
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="issue-target-loc">
                  Куда (цех / ячейка линии)
                </label>
                {targetLocationGroups.length > 0 ? (
                  <select
                    id="issue-target-loc"
                    value={targetLocationCode}
                    onChange={(e) => setTargetLocationCode(e.target.value)}
                    className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Выберите цех и ячейку…</option>
                    {targetLocationGroups.map((g) => (
                      <optgroup key={g.whCode} label={g.label}>
                        {g.locations.map((loc) => (
                          <option key={loc.locationCode} value={loc.locationCode}>
                            {issueTargetOptionLabel(loc, warehouseLabels)}
                            {" · "}
                            {loc.locationCode.length > 40
                              ? `${loc.locationCode.slice(0, 20)}…${loc.locationCode.slice(-14)}`
                              : loc.locationCode}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                ) : (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900">
                    Нет ячеек цехов в топологии. Добавьте цех в настройках и ячейки на вкладке «Ячейки».
                  </p>
                )}
              </div>
              {selectedItem && availability ? (
                <>
                  <div className="rounded-lg bg-secondary/40 px-3 py-2 text-sm">
                    <div className="font-medium">{availability.itemName}</div>
                    <div className="text-muted-foreground">
                      Склад: {fmtQty(availability.totalAvailable)} шт · В цехе:{" "}
                      {fmtQty(availability.totalInProduction)} шт
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        Партии (по FEFO — старые сверху)
                      </div>
                      {availability.isPerishable || availability.rotationPolicy === "fefo" ? (
                        <Badge className="rounded-md bg-amber-600/10 text-[10px] text-amber-900 hover:bg-amber-600/10">
                          FEFO
                        </Badge>
                      ) : null}
                    </div>
                    {availability.recommendedLotId &&
                    selectedLot &&
                    selectedLot.lotId !== availability.recommendedLotId &&
                    selectedLot.availableQty > 0 ? (
                      <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-900">
                        Выдача заблокирована: по FEFO сначала нужно отдать более раннюю партию.
                      </p>
                    ) : null}
                    {availability.lots.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Нет партий на остатке</p>
                    ) : (
                      availability.lots.map((lot) => {
                        const isRecommended =
                          lot.lotId === availability.recommendedLotId && lot.availableQty > 0
                        return (
                        <button
                          key={lot.lotId}
                          type="button"
                          onClick={() => {
                            setSelectedLot(lot)
                            if (lot.availableQty > 0) {
                              setQty(String(Math.floor(lot.availableQty)))
                            }
                          }}
                          className={cn(
                            "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm",
                            selectedLot?.lotId === lot.lotId
                              ? "border-emerald-600/40 bg-emerald-600/10"
                              : isRecommended
                                ? "border-amber-500/35 bg-amber-500/5"
                                : "border-border/40"
                          )}
                        >
                          <span className="flex flex-wrap items-center gap-2">
                            {fmtEmissionDay(lot.emissionDay, lot.emissionAtIso)}
                            {isRecommended ? (
                              <Badge className="rounded-md bg-amber-600/15 px-1.5 py-0 text-[10px] text-amber-900 hover:bg-amber-600/15">
                                FEFO
                              </Badge>
                            ) : null}
                            <span className="text-xs text-muted-foreground">{lot.lotCode}</span>
                          </span>
                          <span className="tabular-nums">
                            {fmtQty(lot.availableQty)} / {fmtQty(lot.inProductionQty)}
                          </span>
                        </button>
                      )})
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="flex gap-2">
                      <Input
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                        type="number"
                        min={1}
                        className="rounded-lg"
                        placeholder="Кол-во"
                      />
                      {recipients.length > 0 ? (
                        <select
                          value={recipient}
                          onChange={(e) => setRecipient(e.target.value)}
                          className="flex-1 rounded-lg border border-input bg-background px-3 text-sm"
                        >
                          <option value="">Получатель…</option>
                          {recipients.map((r) => (
                            <option key={r.id} value={r.displayName}>
                              {r.subtitle ? `${r.displayName} — ${r.subtitle}` : r.displayName}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          value={recipient}
                          onChange={(e) => setRecipient(e.target.value)}
                          placeholder="Получатель"
                          className="flex-1 rounded-lg"
                        />
                      )}
                    </div>
                    <p className="text-right text-[11px] text-muted-foreground">
                      <a
                        href="/settings?section=directories&dirTab=recipients"
                        className="underline-offset-2 hover:underline"
                      >
                        Справочник получателей
                      </a>
                    </p>
                  </div>
                  <Button
                    className="w-full rounded-xl"
                    disabled={
                      submitting ||
                      !targetLocationCode.trim() ||
                      !selectedLot ||
                      (selectedLot?.availableQty ?? 0) <= 0 ||
                      Boolean(
                        availability.recommendedLotId &&
                          selectedLot &&
                          selectedLot.lotId !== availability.recommendedLotId &&
                          selectedLot.availableQty > 0
                      )
                    }
                    onClick={() => requestIssueConfirm()}
                  >
                    {submitting ? "Оформление…" : "Выдать в цех"}
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Выберите номенклатуру слева — появятся остатки по датам эмиссии.
                </p>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <WmsConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Подтвердите выдачу"
        loading={submitting}
        confirmLabel="Выдать"
        description={
          <div className="space-y-2 text-sm">
            <p>
              {selectedItem ? issueItemTitle(selectedItem) : "—"} · {fmtQty(Number(qty) || 0)} шт
            </p>
            <p>
              Откуда: <strong>{locationCode}</strong>
              {selectedLot ? (
                <>
                  {" "}
                  · партия <strong>{selectedLot.lotCode}</strong> ({fmtQty(selectedLot.availableQty)} шт)
                </>
              ) : null}
            </p>
            <p>
              Куда: <strong>{targetLocationCode}</strong> · получатель <strong>{recipient}</strong>
            </p>
            {(availability?.lots.length ?? 0) > 1 ? (
              <p className="text-muted-foreground text-xs">
                Источник списания выбран вручную из {availability?.lots.length} доступных партий.
              </p>
            ) : null}
          </div>
        }
        onConfirm={() => void submitIssue()}
      />
    </div>
  )
}
