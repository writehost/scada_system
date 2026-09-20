"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  ChevronDown,
  ExternalLink,
  History,
  Loader2,
  Lock,
  RefreshCw,
  Settings2,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatCellQty, formatLocationPlacementLabel, slotLabel } from "@/lib/storage-slot-ui"
import { inferLocationStorageClass, storageClassLabel } from "@/lib/wms/physical-profile"
import {
  getWmsLocationDetail,
  setWmsLocationBlocked,
  deleteWmsLocation,
  type WmsLocationDetailResponse,
  type WmsLocationStockLotRow,
} from "@/lib/wms-api"
import { cn } from "@/lib/utils"
import { CELL_STATUS_META, cellFill, cellFreeUnits, cellHasProfile, cellOnHandQty, cellStatusOf } from "./cells-utils"
import { CellLocationRules } from "./cell-location-rules"
import { CellsLocationCodeHelp } from "./cells-location-code-help"
import { CellsWriteoffDialog } from "./cells-writeoff-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useCellsRequestGuard } from "./cells-request-guard"
import type { WmsLocationRow } from "@/lib/wms-api"

type Props = {
  location: WmsLocationRow | null
  listFromQuery: string
  warehouseLabels?: Record<string, string>
  onClose: () => void
  onRefreshList: () => void
}

function isBlockedStatus(status: string) {
  return status.toLowerCase().includes("block")
}

function formatDateShort(value: string | null | undefined) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date)
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function lotExpiryIso(row: Pick<WmsLocationStockLotRow, "expiryAt" | "bestBeforeAt">) {
  return row.expiryAt || row.bestBeforeAt || null
}

function lotOnHand(row: WmsLocationStockLotRow) {
  return (
    Number(row.availableQty || 0) +
    Number(row.inProductionQty || 0) +
    Number(row.quarantineQty || 0)
  )
}

function isLotExpired(expiryIso: string | null | undefined) {
  if (!expiryIso) return false
  const end = new Date(expiryIso)
  if (Number.isNaN(end.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  return end.getTime() < today.getTime()
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[108px_minmax(0,1fr)] items-start gap-2 py-1 text-[13px] leading-5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

export function CellsPreviewPanel({ location, listFromQuery, warehouseLabels, onClose, onRefreshList }: Props) {
  const locationCode = location?.locationCode ?? null
  const [detail, setDetail] = useState<WmsLocationDetailResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [writeoffOpen, setWriteoffOpen] = useState(false)
  const { nextGeneration, isCurrent } = useCellsRequestGuard()

  const fetchDetail = useCallback(async () => {
    if (!locationCode) return
    const generation = nextGeneration()
    setLoading(true)
    setError(null)
    try {
      const d = await getWmsLocationDetail(locationCode)
      if (!isCurrent(generation)) return
      setDetail(d)
    } catch (e) {
      if (!isCurrent(generation)) return
      setError(e instanceof Error ? e.message : "Не удалось загрузить")
      setDetail(null)
    } finally {
      if (isCurrent(generation)) setLoading(false)
    }
  }, [locationCode, nextGeneration, isCurrent])

  useEffect(() => {
    if (!locationCode) {
      setDetail(null)
      setError(null)
      setLoading(false)
      return
    }
    void fetchDetail()
  }, [locationCode, fetchDetail])

  if (!location) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/80 bg-card">
        <div className="flex items-center justify-between border-b border-border/80 px-3 py-2">
          <p className="text-[13px] font-semibold">Ячейка</p>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="px-3 py-5">
          <p className="text-[13px] font-medium text-foreground">Выберите ячейку</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Карточка или узел в топологии откроет остаток, назначение и операции.
          </p>
        </div>
      </div>
    )
  }

  const status = cellStatusOf(location)
  const meta = CELL_STATUS_META[status]
  const fill = cellFill(location)
  const free = cellFreeUnits(location)
  const onHand = cellOnHandQty(location)
  const capacity = location.slotProfile?.capacityUnits
  const inProd = Number(location.inProductionQty || 0)
  const handed =
    location.isHandedToProduction === true ||
    location.waitingHandoff?.status === "handed_to_production"
  const handoffLine = location.waitingHandoff?.lineCode?.trim() || null
  const handoffBatch = location.waitingHandoff?.batchLabel?.trim() || null
  const loc = detail?.location
  const stock = detail?.stock ?? []
  const lots = detail?.lots ?? []
  const lastMove = detail?.history?.[0]
  const hasQuarantine = stock.some((row) => Number(row.quarantineQty || 0) > 0)
  const detailHref = `/cells/${encodeURIComponent(location.locationCode)}${
    listFromQuery ? `?from=${encodeURIComponent(listFromQuery)}` : ""
  }`
  const stockTabHref = `${detailHref}${detailHref.includes("?") ? "&" : "?"}tab=stock`
  const profileHref = `${detailHref}${detailHref.includes("?") ? "&" : "?"}tab=profile`
  const historyHref = stockTabHref
  const title = location.slotTitle || location.displayName || location.locationCode
  const placementLabel = formatLocationPlacementLabel({
    warehouseCode: location.warehouseCode,
    zoneCode: location.zoneCode,
    zoneName: location.zoneName,
    warehouseLabels,
  })
  const purpose = (
    [
      [
        "storageClass",
        storageClassLabel(
          location.slotProfile?.storageClass ||
            inferLocationStorageClass({
              storageClass: location.slotProfile?.storageClass,
              warehouseCode: location.warehouseCode,
              zoneCode: location.zoneCode,
              locationCode: location.locationCode,
              processType: location.slotProfile?.processType,
            })
        ),
      ],
      ["materialType", slotLabel("materialType", location.slotProfile?.materialType)],
      ["processType", slotLabel("processType", location.slotProfile?.processType)],
      ["stickerShape", slotLabel("stickerShape", location.slotProfile?.stickerShape)],
      ["productGroup", slotLabel("productGroup", location.slotProfile?.productGroup)],
      ["volume", slotLabel("volume", location.slotProfile?.volume)],
    ] as const
  ).filter(([, v]) => v && v !== "—" && v !== "Любой")

  async function toggleBlock() {
    if (!loc) return
    setBusy(true)
    try {
      await setWmsLocationBlocked(loc.locationCode, !isBlockedStatus(loc.locationStatus))
      await fetchDetail()
      onRefreshList()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка блокировки")
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!loc) return
    const hasStock = stock.length > 0 || onHand > 0 || Number(location.skuCount || 0) > 0
    if (hasStock) {
      setError("Нельзя удалить ячейку с остатками. Сначала переместите или спишите товар.")
      return
    }
    if (!confirm(`Удалить ячейку «${location.locationCode}»? Это действие необратимо.`)) return
    setBusy(true)
    setError(null)
    try {
      await deleteWmsLocation(loc.locationCode)
      onRefreshList()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить ячейку")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/80 bg-card">
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border/80 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p
            className="break-all font-mono text-[15px] font-semibold leading-tight text-foreground [overflow-wrap:anywhere]"
            title={location.locationCode}
          >
            {location.locationCode}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
            <span className="text-[12px] text-muted-foreground">{meta.label}</span>
            {hasQuarantine ? (
              <span className="text-[11px] font-medium text-orange-700 dark:text-orange-300">Карантин</span>
            ) : null}
            {handed ? (
              <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                {handoffLine ? `В пр-ве · ${handoffLine}` : "В пр-ве"}
              </span>
            ) : inProd > 0 ? (
              <span className="text-[11px] font-medium text-amber-800 dark:text-amber-300">В цеху</span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => void fetchDetail()}
            disabled={loading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        <div className="min-w-0 space-y-3 px-3 py-2.5">
          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-[12px] text-destructive">
              <p>{error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 h-7 rounded-md text-xs"
                onClick={() => void fetchDetail()}
              >
                Повторить
              </Button>
            </div>
          ) : null}

          <dl>
            <MetaRow label="Назначение">
              {purpose.length > 0 ? purpose.map(([, v]) => v).join(" / ") : title}
            </MetaRow>
            <MetaRow label="Зона">
              {location.zoneName || location.zoneCode || "—"}
            </MetaRow>
            <MetaRow label="Цех / склад">{placementLabel}</MetaRow>
            <MetaRow label="Остаток">
              <span className="tabular-nums font-medium">{formatCellQty(onHand)}</span>
              {capacity != null && Number.isFinite(capacity) ? (
                <span className="tabular-nums text-muted-foreground"> {formatCellQty(capacity)}</span>
              ) : null}
              {inProd > 0 ? (
                <span className="ml-1 text-[11px] text-muted-foreground">
                  {Number(location.availableQty || 0) > 0
                    ? `из них в цеху ${formatCellQty(inProd)}`
                    : "в цеху"}
                </span>
              ) : null}
            </MetaRow>
            {free != null ? (
              <MetaRow label="Свободно">
                <span className="tabular-nums">{formatCellQty(free)}</span>
              </MetaRow>
            ) : null}
            <MetaRow label="Позиции">
              <span className="tabular-nums">{location.skuCount}</span>
            </MetaRow>
            {lastMove ? (
              <MetaRow label="Движение">{formatDateTime(lastMove.at)}</MetaRow>
            ) : null}
          </dl>

          <CellsLocationCodeHelp
            showLink
            linkClassName="text-[11px]"
            locationCode={location.locationCode}
            slotProfile={location.slotProfile}
            warehouseCode={location.warehouseCode}
            zoneCode={location.zoneCode}
            displayName={location.displayName ?? location.slotTitle}
          />

          {handed && (handoffLine || handoffBatch) ? (
            <p className="text-[12px] text-muted-foreground">
              Передано на линию
              {handoffLine ? (
                <>
                  : <span className="font-medium text-foreground">{handoffLine}</span>
                </>
              ) : null}
              {handoffBatch ? ` · партия ${handoffBatch}` : null}
            </p>
          ) : null}

          {cellHasProfile(location) && location.slotProfile ? null : (
            <div className="rounded-md border border-border/80 bg-muted/40 px-2.5 py-2 text-[12px]">
              <p className="text-muted-foreground">Профиль не задан</p>
              <Button variant="outline" size="sm" className="mt-2 h-7 w-full rounded-md text-xs" asChild>
                <Link href={profileHref}>
                  <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                  Настроить профиль
                </Link>
              </Button>
            </div>
          )}

          {fill != null ? (
            <div>
              <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                <span>Заполнение</span>
                <span>{fill}%</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full",
                    fill >= 90 ? "bg-destructive" : fill >= 70 ? "bg-amber-500" : "bg-emerald-500"
                  )}
                  style={{ width: `${fill}%` }}
                />
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center gap-2 py-3 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загрузка остатков…
            </div>
          ) : lots.length > 0 ? (
            <div>
              <p className="mb-1.5 text-[12px] font-semibold">Номенклатуры</p>
              <ul className="space-y-1.5">
                {lots.slice(0, 8).map((row) => {
                  const qty = lotOnHand(row)
                  const lotInProd = Number(row.inProductionQty || 0)
                  const expiry = lotExpiryIso(row)
                  const expired = isLotExpired(expiry)
                  return (
                    <li key={row.lotId} className="border-t border-border/60 pt-1.5 text-[12px] first:border-t-0 first:pt-0">
                      <Link
                        href={`/nomenclature/${encodeURIComponent(row.itemCode)}`}
                        className="block font-medium leading-snug text-foreground [overflow-wrap:anywhere] hover:underline"
                      >
                        {row.itemName || row.itemCode}
                      </Link>
                      <div className="mt-0.5 flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="min-w-0 break-all font-mono">{row.itemCode}</span>
                        <span className="shrink-0 tabular-nums text-foreground">
                          {formatCellQty(qty)}
                          {lotInProd > 0 ? " · в цеху" : ""}
                        </span>
                      </div>
                      {expired ? (
                        <p className="mt-0.5 text-[11px] font-medium text-destructive">
                          Просрочено · {formatDateShort(expiry)}
                        </p>
                      ) : expiry ? (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">срок {formatDateShort(expiry)}</p>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
              <Button variant="link" size="sm" className="mt-1 h-auto px-0 text-[12px]" asChild>
                <Link href={stockTabHref}>Все остатки в карточке</Link>
              </Button>
            </div>
          ) : stock.length > 0 ? (
            <div>
              <p className="mb-1.5 text-[12px] font-semibold">Номенклатуры</p>
              <ul className="space-y-1.5">
                {stock.slice(0, 8).map((row) => {
                  const qty = Number(row.availableQty || 0) + Number(row.inProductionQty || 0)
                  const expiry = row.nearestExpiryAt || row.bestBeforeAt || null
                  return (
                    <li key={row.itemCode} className="border-t border-border/60 pt-1.5 text-[12px] first:border-t-0 first:pt-0">
                      <Link
                        href={`/nomenclature/${encodeURIComponent(row.itemCode)}`}
                        className="block font-medium leading-snug [overflow-wrap:anywhere] hover:underline"
                      >
                        {row.name || row.itemCode}
                      </Link>
                      <div className="mt-0.5 flex items-baseline justify-between gap-2 font-mono text-[11px] text-muted-foreground">
                        <span className="min-w-0 break-all">{row.itemCode}</span>
                        <span className="shrink-0 tabular-nums text-foreground">{formatCellQty(qty)}</span>
                      </div>
                      {expiry ? (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">срок {formatDateShort(expiry)}</p>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : error ? (
            <p className="text-[12px] text-muted-foreground">
              Остаток по списку: {formatCellQty(location.availableQty)}
              {location.skuCount > 0 ? ` · позиций: ${location.skuCount}` : ""}
            </p>
          ) : (
            <p className="text-[12px] text-muted-foreground">Остатков нет</p>
          )}

          <CellLocationRules
            locationCode={location.locationCode}
            locationId={location.locationId}
          />
        </div>
      </div>

      <div className="shrink-0 space-y-1.5 border-t border-border/80 bg-card px-3 py-2">
        <div className="grid grid-cols-2 gap-1.5">
          <Button className="h-8 rounded-md text-[12px]" asChild>
            <Link href={detailHref}>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Открыть
            </Link>
          </Button>
          <Button variant="outline" className="h-8 rounded-md text-[12px]" asChild>
            <Link href={profileHref}>
              <Settings2 className="mr-1.5 h-3.5 w-3.5" />
              Профиль
            </Link>
          </Button>
          {loc ? (
            <Button
              type="button"
              variant={isBlockedStatus(loc.locationStatus) ? "secondary" : "outline"}
              className="h-8 rounded-md text-[12px]"
              disabled={busy || loading}
              onClick={() => void toggleBlock()}
            >
              <Lock className="mr-1.5 h-3.5 w-3.5" />
              {isBlockedStatus(loc.locationStatus) ? "Разблок." : "Блок"}
            </Button>
          ) : (
            <span />
          )}
          <Button variant="outline" className="h-8 rounded-md text-[12px]" asChild>
            <Link href={historyHref}>
              <History className="mr-1.5 h-3.5 w-3.5" />
              История
            </Link>
          </Button>
        </div>
        <div className="flex gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" className="h-8 flex-1 rounded-md text-[12px] text-muted-foreground">
                Ещё
                <ChevronDown className="ml-1 h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => setWriteoffOpen(true)}>Списание</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {loc ? (
            <Button
              type="button"
              variant="ghost"
              className="h-8 rounded-md px-2 text-[12px] text-destructive hover:bg-destructive/5 hover:text-destructive"
              disabled={busy || loading}
              onClick={() => void handleDelete()}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Удалить
            </Button>
          ) : null}
        </div>
      </div>
      <CellsWriteoffDialog
        open={writeoffOpen}
        locationCode={location.locationCode}
        onOpenChange={setWriteoffOpen}
        onDone={() => {
          void fetchDetail()
          onRefreshList()
        }}
      />
    </div>
  )
}
