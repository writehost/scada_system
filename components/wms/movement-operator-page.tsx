"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Check,
  FolderTree,
  Layers,
  MapPin,
  PackageSearch,
  RefreshCw,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { OperationDocumentsPage } from "@/components/wms/operation-documents-page"
import { NomenclatureGroupBrowser } from "@/components/wms/nomenclature-group-browser"
import { ReceivingNomenclatureGroupDialog } from "@/components/wms/receiving-nomenclature-group-dialog"
import { MovementCellPicker, type MovementCellOption } from "@/components/wms/movement-cell-picker"
import {
  getItemStockAvailability,
  listItemStockLocations,
  listLocations,
  loadOperatorPickerGroups,
  postStockTransfer,
  type ItemStockAvailability,
  type ItemStockLocationRow,
  type ItemStockLocations,
  type WmsItemListRow,
  type WmsLocationRow,
} from "@/lib/wms-api"
import {
  operatorGroupPickerSectionTitle,
  type OperatorNomenclatureGroup,
  type OperatorPickerGroupsSource,
} from "@/lib/nomenclature-group-catalog"
import { formatLocationPlacementLabel, compareSequentialCellCodes } from "@/lib/storage-slot-ui"
import { WmsStickyAlert } from "@/components/wms/wms-sticky-alert"
import { WmsConfirmDialog, WmsErrorState, WmsLoadingState } from "@/components/wms/wms-shared"
import { mapWmsError } from "@/lib/wms-error-messages"
import { cn } from "@/lib/utils"

function fmtQty(n: number | null | undefined): string {
  const v = Number(n)
  if (!Number.isFinite(v)) return "0"
  if (Number.isInteger(v)) return String(v)
  return v.toFixed(2)
}

function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.round(n)) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return many
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}

function itemTitle(it: WmsItemListRow): string {
  const code = (it.itemCode ?? "").trim()
  const name = (it.name ?? "").trim()
  if (!name || name === code) return code || "—"
  return `${name} · ${code}`
}

type CellLike = {
  locationCode: string
  displayName?: string | null
  warehouseCode?: string | null
  zoneCode?: string | null
  zoneName?: string | null
  slotProfile?: WmsLocationRow["slotProfile"]
  slotTitle?: string | null
}

/** Только «где стоит» — код ячейки показывается отдельной строкой и не дублируется. */
function cellPlacement(loc: CellLike): string {
  const code = (loc.locationCode ?? "").trim().toUpperCase()
  const place = formatLocationPlacementLabel({
    warehouseCode: loc.warehouseCode ?? null,
    zoneCode: loc.zoneCode ?? null,
    zoneName: loc.zoneName ?? null,
    locationCode: loc.locationCode,
    displayName: null,
    slotProfile: loc.slotProfile ?? null,
  })
  const profileOrName = (loc.displayName || loc.slotTitle || "").trim()
  const bits: string[] = []
  if (place && place !== "—" && place.toUpperCase() !== code) bits.push(place)
  if (
    profileOrName &&
    profileOrName.toUpperCase() !== code &&
    !place.toUpperCase().includes(profileOrName.toUpperCase())
  ) {
    bits.push(profileOrName)
  }
  return bits.join(" · ")
}

function StepHeader({
  step,
  title,
  done,
  hint,
  right,
}: {
  step: number
  title: string
  done: boolean
  hint?: string | null
  right?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2">
      <span
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
          done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        )}
      >
        {done ? <Check className="h-3 w-3" /> : step}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {right}
        </div>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  )
}

export function MovementOperatorPage() {
  const [tab, setTab] = useState("manual")
  const [locations, setLocations] = useState<WmsLocationRow[]>([])
  const [sourceLocationCode, setSourceLocationCode] = useState("")
  const [targetLocationCode, setTargetLocationCode] = useState("")
  const [selectedItem, setSelectedItem] = useState<WmsItemListRow | null>(null)
  const [itemLocations, setItemLocations] = useState<ItemStockLocations | null>(null)
  const [itemLocationsLoading, setItemLocationsLoading] = useState(false)
  const [availability, setAvailability] = useState<ItemStockAvailability | null>(null)
  const [qty, setQty] = useState("")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [nomenclatureGroups, setNomenclatureGroups] = useState<OperatorNomenclatureGroup[]>([])
  const [groupPickerSource, setGroupPickerSource] = useState<OperatorPickerGroupsSource>("item-groups")
  const [groupCode, setGroupCode] = useState<string | null>(null)

  const groupLabel = useMemo(() => {
    if (!groupCode) return "Все группы"
    return nomenclatureGroups.find((g) => g.code === groupCode)?.name ?? groupCode
  }, [groupCode, nomenclatureGroups])

  useEffect(() => {
    void loadOperatorPickerGroups()
      .then(({ groups: list, source }) => {
        setGroupPickerSource(source)
        setNomenclatureGroups(list)
        if (list.length > 0) {
          setGroupCode((prev) => (prev && list.some((g) => g.code === prev) ? prev : list[0]!.code))
        }
      })
      .catch(() => setNomenclatureGroups([]))
  }, [])

  const loadLocations = useCallback(() => {
    setLoading(true)
    return listLocations({ limit: 2000, lite: true })
      .then((locRes) => {
        const locs = [...(locRes.locations ?? [])].sort((a, b) =>
          compareSequentialCellCodes(a.locationCode, b.locationCode)
        )
        setLocations(locs)
      })
      .catch((e) => setError(mapWmsError(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    void loadLocations()
  }, [loadLocations])

  const sourceRows = itemLocations?.locations ?? []

  const sourceRow = useMemo(
    () => sourceRows.find((l) => l.locationCode === sourceLocationCode) ?? null,
    [sourceRows, sourceLocationCode]
  )

  /** Максимум определяет остаток по выбранной позиции в ячейке, а не общий остаток ячейки. */
  const maxQty = availability?.totalAvailable ?? sourceRow?.availableQty ?? 0

  const targetOptions: MovementCellOption[] = useMemo(() => {
    const byCode = new Map(sourceRows.map((l) => [l.locationCode, l]))
    return locations
      .filter((l) => l.locationCode !== sourceLocationCode)
      .map((l) => {
        const already = byCode.get(l.locationCode)
        const onHand = (l.availableQty ?? 0) + (l.inProductionQty ?? 0)
        return {
          locationCode: l.locationCode,
          placement: cellPlacement(l),
          meta: onHand > 0 ? `ост. ${fmtQty(onHand)}` : "пусто",
          note: already ? `уже лежит ${fmtQty(already.availableQty)} шт этой позиции` : null,
        }
      })
  }, [locations, sourceLocationCode, sourceRows])

  const targetRow = useMemo(
    () => locations.find((l) => l.locationCode === targetLocationCode) ?? null,
    [locations, targetLocationCode]
  )

  const lotsWithQty = useMemo(
    () => (availability?.lots ?? []).filter((lot) => (lot.availableQty ?? 0) > 0),
    [availability]
  )

  const loadAvailability = useCallback(async (itemCode: string, source: string) => {
    const loc = source.trim()
    if (!loc || !itemCode) {
      setAvailability(null)
      return
    }
    try {
      const next = await getItemStockAvailability({ itemCode, locationCode: loc })
      setAvailability(next)
    } catch (e) {
      setAvailability(null)
      setError(mapWmsError(e))
    }
  }, [])

  const selectItem = useCallback(
    async (it: WmsItemListRow) => {
      setSelectedItem(it)
      setError(null)
      setSuccess(null)
      setAvailability(null)
      setItemLocations(null)
      setSourceLocationCode("")
      setQty("")
      setItemLocationsLoading(true)
      try {
        const res = await listItemStockLocations({ itemCode: it.itemCode })
        setItemLocations(res)
        const first = res.locations[0]
        if (first) {
          setSourceLocationCode(first.locationCode)
          setTargetLocationCode((prev) => (prev === first.locationCode ? "" : prev))
          await loadAvailability(res.itemCode, first.locationCode)
        }
      } catch (e) {
        setItemLocations(null)
        setError(mapWmsError(e))
      } finally {
        setItemLocationsLoading(false)
      }
    },
    [loadAvailability]
  )

  function pickSource(code: string) {
    setSourceLocationCode(code)
    setQty("")
    if (code === targetLocationCode) setTargetLocationCode("")
    const itemCode = itemLocations?.itemCode ?? selectedItem?.itemCode ?? ""
    void loadAvailability(itemCode, code)
  }

  const parsedQty = Number(qty)
  const qtyValid = Number.isFinite(parsedQty) && parsedQty > 0
  const qtyOverMax = qtyValid && maxQty > 0 && parsedQty - maxQty > 1e-9
  const routeReady = Boolean(selectedItem && sourceLocationCode && targetLocationCode)
  const canSubmit = routeReady && qtyValid && !qtyOverMax && !submitting

  function validationMessage(): string | null {
    if (!selectedItem) return "Выберите номенклатуру"
    if (sourceRows.length === 0) return "По этой позиции нет остатка ни в одной ячейке"
    if (!sourceLocationCode) return "Выберите ячейку «Откуда»"
    if (!targetLocationCode) return "Выберите ячейку «Куда»"
    if (sourceLocationCode === targetLocationCode) return "Ячейки «Откуда» и «Куда» должны отличаться"
    if (!qtyValid) return "Укажите количество"
    if (qtyOverMax) return `Нельзя переместить больше ${fmtQty(maxQty)} шт`
    return null
  }

  function requestTransferConfirm() {
    const problem = validationMessage()
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setConfirmOpen(true)
  }

  async function submitTransfer() {
    const problem = validationMessage()
    if (problem || !selectedItem) {
      setError(problem)
      return
    }
    setConfirmOpen(false)
    setSubmitting(true)
    setError(null)
    const from = sourceLocationCode
    const to = targetLocationCode
    try {
      const result = await postStockTransfer({
        itemCode: selectedItem.itemCode,
        fromLocationCode: from,
        toLocationCode: to,
        qty: parsedQty,
      })
      setSuccess(
        `Перемещено ${fmtQty(parsedQty)} шт · ${from} → ${to}${
          result.documentId ? ` · документ ${result.documentId}` : ""
        }`
      )
      setQty("")
      const res = await listItemStockLocations({ itemCode: selectedItem.itemCode })
      setItemLocations(res)
      const stillThere = res.locations.some((l) => l.locationCode === from)
      const nextSource = stillThere ? from : res.locations[0]?.locationCode ?? ""
      setSourceLocationCode(nextSource)
      await loadAvailability(res.itemCode, nextSource)
      void loadLocations()
    } catch (e) {
      setError(mapWmsError(e))
    } finally {
      setSubmitting(false)
    }
  }

  const itemCodeLabel = (itemLocations?.itemCode ?? selectedItem?.itemCode ?? "").trim()
  const itemNameLabel = (itemLocations?.itemName ?? selectedItem?.name ?? "").trim()

  return (
    <div className="space-y-3">
      <Tabs value={tab} onValueChange={setTab} className="space-y-3">
        <div className="wms-panel sticky top-0 z-30 rounded-2xl px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/85">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            <h1 className="text-sm font-semibold tracking-tight text-foreground">Перемещение</h1>
            {tab === "manual" ? (
              <button
                type="button"
                className="inline-flex max-w-[16rem] items-center gap-1 truncate rounded-md border border-border/60 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                onClick={() => setGroupDialogOpen(true)}
                disabled={nomenclatureGroups.length === 0}
                title={`${operatorGroupPickerSectionTitle(groupPickerSource)}: ${groupLabel}`}
              >
                <FolderTree className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{groupLabel}</span>
              </button>
            ) : null}
            <TabsList className="h-auto shrink-0 rounded-lg p-0.5">
              <TabsTrigger value="manual" className="rounded-md px-2.5 py-1 text-xs">
                Свободное
              </TabsTrigger>
              <TabsTrigger value="documents" className="rounded-md px-2.5 py-1 text-xs">
                Документы WMS
              </TabsTrigger>
            </TabsList>
            {tab === "manual" ? (
              <div className="order-last flex w-full flex-wrap items-center gap-1.5 sm:order-none sm:ml-auto sm:w-auto sm:flex-nowrap sm:justify-end">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-lg"
                  onClick={() => void loadLocations()}
                  disabled={loading}
                  aria-label="Обновить ячейки"
                  title="Обновить список ячеек"
                >
                  <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        {error ? <WmsStickyAlert message={error} onDismiss={() => setError(null)} /> : null}
        {success ? (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-900">
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{success}</span>
            <button
              type="button"
              className="text-emerald-900/60 hover:text-emerald-900"
              onClick={() => setSuccess(null)}
              aria-label="Скрыть"
            >
              ×
            </button>
          </div>
        ) : null}

        <TabsContent value="documents" className="mt-0">
          <OperationDocumentsPage kind="movement" embedded />
        </TabsContent>

        <TabsContent value="manual" className="mt-0 space-y-3">
          {loading && locations.length === 0 ? <WmsLoadingState label="Загрузка ячеек склада…" /> : null}
          {!loading && locations.length === 0 && error ? (
            <WmsErrorState message={error} onRetry={() => void loadLocations()} />
          ) : null}

          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
            <div className="wms-panel min-w-0 overflow-hidden rounded-2xl">
              <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
                <StepHeader
                  step={1}
                  title="Что перемещаем"
                  done={Boolean(selectedItem)}
                  hint={selectedItem ? null : "Выберите позицию из списка"}
                />
              </div>
              <div className="p-3">
                <NomenclatureGroupBrowser
                  stockOnly
                  hideGroupGrid
                  externalGroupCode={groupCode}
                  selectedItemCode={selectedItem?.itemCode ?? null}
                  onSelectItem={(it) => void selectItem(it)}
                  renderItemTitle={itemTitle}
                  searchPlaceholder="Код, GTIN или название"
                />
              </div>
            </div>

            <div className="min-w-0 space-y-3">
              <div className="wms-panel rounded-2xl p-3">
                {selectedItem ? (
                  <div className="flex items-start gap-2">
                    <Boxes className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-medium text-foreground">
                        {itemNameLabel || itemCodeLabel || "—"}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span className="font-mono text-foreground">{itemCodeLabel || "—"}</span>
                        {itemLocations ? (
                          <span className="tabular-nums">
                            доступно {fmtQty(itemLocations.totalAvailable)} шт в{" "}
                            {itemLocations.locations.length}{" "}
                            {plural(itemLocations.locations.length, "ячейке", "ячейках", "ячейках")}
                          </span>
                        ) : itemLocationsLoading ? (
                          <span>считаем остатки…</span>
                        ) : null}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <PackageSearch className="h-4 w-4 shrink-0" />
                    Позиция не выбрана — маршрут появится, когда выберете номенклатуру слева.
                  </div>
                )}
              </div>

              <div className="wms-panel space-y-2.5 rounded-2xl p-3">
                <StepHeader
                  step={2}
                  title="Откуда"
                  done={Boolean(sourceLocationCode)}
                  hint={
                    selectedItem
                      ? "Показаны только ячейки, где эта позиция реально лежит"
                      : "Сначала выберите позицию"
                  }
                  right={
                    sourceRows.length > 0 ? (
                      <Badge variant="secondary" className="rounded px-1.5 py-0 text-[10px]">
                        {sourceRows.length}
                      </Badge>
                    ) : null
                  }
                />

                {!selectedItem ? null : itemLocationsLoading ? (
                  <div className="space-y-1.5">
                    {[0, 1].map((i) => (
                      <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/60" />
                    ))}
                  </div>
                ) : sourceRows.length === 0 ? (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      По этой позиции нет доступного остатка ни в одной ячейке — перемещать нечего.
                      Проверьте приёмку или выберите другую номенклатуру.
                    </span>
                  </div>
                ) : (
                  <div className="max-h-64 space-y-1.5 overflow-y-auto">
                    {sourceRows.map((row) => (
                      <SourceCellRow
                        key={row.locationCode}
                        row={row}
                        selected={row.locationCode === sourceLocationCode}
                        transferableQty={
                          row.locationCode === sourceLocationCode && availability
                            ? availability.totalAvailable
                            : null
                        }
                        onSelect={() => pickSource(row.locationCode)}
                      />
                    ))}
                  </div>
                )}

                {lotsWithQty.length > 1 && sourceLocationCode ? (
                  <div className="rounded-lg border border-border/50 bg-muted/25 px-2.5 py-2 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1 font-medium text-foreground/80">
                      <Layers className="h-3.5 w-3.5" />
                      Партии в {sourceLocationCode}
                    </span>
                    <ul className="mt-1 space-y-0.5">
                      {lotsWithQty.map((lot) => (
                        <li key={lot.lotId} className="flex items-center justify-between gap-2">
                          <span className="truncate">{lot.lotCode}</span>
                          <span className="shrink-0 tabular-nums">{fmtQty(lot.availableQty)} шт</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

              <div className="wms-panel space-y-2.5 rounded-2xl p-3">
                <StepHeader
                  step={3}
                  title="Куда"
                  done={Boolean(targetLocationCode)}
                  hint={
                    sourceLocationCode
                      ? "Любая ячейка склада, кроме исходной"
                      : "Сначала выберите ячейку «Откуда»"
                  }
                />
                <MovementCellPicker
                  id="movement-to"
                  value={targetLocationCode}
                  options={targetOptions}
                  onChange={setTargetLocationCode}
                  disabled={!sourceLocationCode || targetOptions.length === 0}
                  placeholder={
                    sourceLocationCode ? "Выберите ячейку назначения" : "Недоступно без ячейки «Откуда»"
                  }
                  emptyLabel="Такой ячейки нет — проверьте код"
                />
              </div>

              <div className="wms-panel space-y-2.5 rounded-2xl p-3">
                <StepHeader
                  step={4}
                  title="Сколько"
                  done={qtyValid && !qtyOverMax}
                  hint={
                    sourceLocationCode
                      ? `В ${sourceLocationCode} доступно ${fmtQty(maxQty)} шт этой позиции`
                      : "Сначала выберите ячейку «Откуда»"
                  }
                />
                <div className="flex items-center gap-2">
                  <Input
                    id="movement-qty"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                    disabled={!sourceLocationCode}
                    className={cn(
                      "h-9 flex-1 rounded-lg text-base font-semibold tabular-nums",
                      qtyOverMax && "border-destructive text-destructive"
                    )}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0 rounded-lg"
                    disabled={!sourceLocationCode || maxQty <= 0}
                    onClick={() => setQty(String(maxQty))}
                    title="Переместить весь доступный остаток"
                  >
                    Всё {maxQty > 0 ? fmtQty(maxQty) : ""}
                  </Button>
                </div>
                {qtyOverMax ? (
                  <p className="text-xs text-destructive">
                    Больше {fmtQty(maxQty)} шт в этой ячейке нет.
                  </p>
                ) : null}
              </div>

              <div className="wms-panel space-y-2.5 rounded-2xl p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  {routeReady ? (
                    <>
                      <span className="font-mono font-semibold text-foreground">{sourceLocationCode}</span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      <span className="font-mono font-semibold text-foreground">{targetLocationCode}</span>
                      <span className="text-muted-foreground">
                        · {qtyValid ? `${fmtQty(parsedQty)} шт` : "количество не указано"}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">{validationMessage()}</span>
                  )}
                </div>
                {targetRow && targetRow.skuCount > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    В {targetRow.locationCode} уже лежит{" "}
                    {fmtQty((targetRow.availableQty ?? 0) + (targetRow.inProductionQty ?? 0))} шт
                    {targetRow.skuCount > 1
                      ? ` · ${targetRow.skuCount} ${plural(targetRow.skuCount, "артикул", "артикула", "артикулов")}`
                      : ""}
                  </p>
                ) : null}
                <Button
                  type="button"
                  disabled={!canSubmit}
                  onClick={() => requestTransferConfirm()}
                  className="w-full rounded-xl"
                >
                  {submitting ? "Перемещаем…" : "Переместить"}
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <ReceivingNomenclatureGroupDialog
        open={groupDialogOpen}
        onOpenChange={setGroupDialogOpen}
        groups={nomenclatureGroups}
        selectedCode={groupCode ?? ""}
        title={operatorGroupPickerSectionTitle(groupPickerSource)}
        description="Выберите подгруппу для фильтрации номенклатуры при перемещении."
        onSelect={(code) => {
          setGroupCode(code)
          setSelectedItem(null)
          setItemLocations(null)
          setAvailability(null)
          setSourceLocationCode("")
          setQty("")
        }}
      />

      <WmsConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Подтвердите перемещение"
        loading={submitting}
        confirmLabel="Переместить"
        description={
          <div className="space-y-2 text-sm">
            <p className="font-medium text-foreground">{itemNameLabel || itemCodeLabel || "—"}</p>
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-semibold">{sourceLocationCode}</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <span className="font-mono font-semibold">{targetLocationCode}</span>
              <span className="tabular-nums">· {fmtQty(parsedQty || 0)} шт</span>
            </p>
            {sourceRow ? (
              <p className="text-xs text-muted-foreground">
                Остаток в {sourceLocationCode} после перемещения:{" "}
                <span className="tabular-nums">{fmtQty(Math.max(maxQty - (parsedQty || 0), 0))} шт</span>
                {sourceRow.cellSkuCount > 1
                  ? ` · в ячейке ещё ${sourceRow.cellSkuCount - 1} ${plural(
                      sourceRow.cellSkuCount - 1,
                      "артикул",
                      "артикула",
                      "артикулов"
                    )}`
                  : ""}
              </p>
            ) : null}
          </div>
        }
        onConfirm={() => void submitTransfer()}
      />
    </div>
  )
}

function SourceCellRow({
  row,
  selected,
  transferableQty,
  onSelect,
}: {
  row: ItemStockLocationRow
  selected: boolean
  /** Лимит по партиям для выбранной ячейки: он может быть меньше остатка баланса. */
  transferableQty: number | null
  onSelect: () => void
}) {
  const placement = cellPlacement(row)
  const shownQty = transferableQty ?? row.availableQty
  const balanceDiffers = transferableQty != null && Math.abs(transferableQty - row.availableQty) > 1e-6
  const otherSku = row.cellSkuCount - 1
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
        selected
          ? "border-primary/50 bg-primary/10"
          : "border-border/60 bg-card hover:border-border hover:bg-accent/30"
      )}
    >
      <MapPin
        className={cn("mt-0.5 h-4 w-4 shrink-0", selected ? "text-primary" : "text-muted-foreground")}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-sm font-semibold text-foreground">
          {row.locationCode}
        </span>
        {placement ? (
          <span className="block truncate text-xs text-muted-foreground">{placement}</span>
        ) : null}
        {otherSku > 0 ? (
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            в ячейке ещё {otherSku} {plural(otherSku, "артикул", "артикула", "артикулов")} — справа
            остаток только по этой позиции
          </span>
        ) : null}
        {balanceDiffers ? (
          <span className="mt-0.5 block text-[11px] text-amber-800">
            в балансе ячейки {fmtQty(row.availableQty)} шт, по партиям к перемещению доступно{" "}
            {fmtQty(transferableQty!)} шт
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-sm font-semibold tabular-nums text-foreground">
          {fmtQty(shownQty)}
        </span>
        <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">шт</span>
        {row.lotCount > 1 ? (
          <span className="block text-[10px] text-muted-foreground">
            {row.lotCount} {plural(row.lotCount, "партия", "партии", "партий")}
          </span>
        ) : null}
      </span>
    </button>
  )
}
