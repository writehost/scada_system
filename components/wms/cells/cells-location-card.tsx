"use client"

import { memo } from "react"
import { Copy, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  formatCellQty,
  formatLocationPlacementLabel,
  slotLabel,
} from "@/lib/storage-slot-ui"
import { inferLocationStorageClass, storageClassLabel } from "@/lib/wms/physical-profile"
import type { WmsLocationRow } from "@/lib/wms-api"
import { cn } from "@/lib/utils"
import { isCalendarExpiryPast } from "@/lib/wms/expiry-sticker"
import {
  CELL_STATUS_META,
  cellFill,
  cellFreeUnits,
  cellHasProfile,
  cellOnHandQty,
  cellStatusOf,
} from "./cells-utils"

type Props = {
  location: WmsLocationRow
  selected?: boolean
  warehouseLabels?: Record<string, string>
  onSelect: (code: string) => void
  onOpen: (code: string) => void
}

function CellsLocationCardInner({ location, selected, warehouseLabels, onSelect, onOpen }: Props) {
  const status = cellStatusOf(location)
  const meta = CELL_STATUS_META[status]
  const sp = location.slotProfile
  const fill = cellFill(location)
  const free = cellFreeUnits(location)
  const hasProfile = cellHasProfile(location)
  const expired = isCalendarExpiryPast(location.nearestExpiryAt)
  const onHand = cellOnHandQty(location)
  const capacity = sp?.capacityUnits
  const inProd = Number(location.inProductionQty || 0)
  const handed =
    location.isHandedToProduction === true || location.waitingHandoff?.status === "handed_to_production"
  const handoffLine = location.waitingHandoff?.lineCode?.trim() || null
  const title = location.slotTitle || location.displayName || "Без названия"
  const material = slotLabel("materialType", sp?.materialType)
  const process = slotLabel("processType", sp?.processType)
  const assignment =
    location.occupiedItemName?.trim() ||
    (title !== location.locationCode ? title : "")
  const placementLabel = formatLocationPlacementLabel({
    warehouseCode: location.warehouseCode,
    zoneCode: location.zoneCode,
    zoneName: location.zoneName,
    warehouseLabels,
  })
  const expiryLabel = location.nearestExpiryAt
    ? new Date(location.nearestExpiryAt).toLocaleDateString("ru-RU")
    : null
  const storageCls = storageClassLabel(
    sp?.storageClass ||
      inferLocationStorageClass({
        storageClass: sp?.storageClass,
        warehouseCode: location.warehouseCode,
        zoneCode: location.zoneCode,
        locationCode: location.locationCode,
        processType: sp?.processType,
      })
  )
  const purposeBits = [storageCls, material, process].filter(
    (v) => v && v !== "—" && v !== "Любой"
  )

  async function copyCode(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(location.locationCode)
    } catch {
      /* ignore */
    }
  }

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onSelect(location.locationCode)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onSelect(location.locationCode)
        }
      }}
      className={cn(
        "group relative overflow-hidden rounded-md border border-border/80 bg-card text-left transition-colors",
        "border-l-[3px] px-2.5 py-2 hover:bg-muted/40",
        expired ? "border-l-destructive" : meta.accent,
        selected
          ? "bg-primary/[0.06] ring-1 ring-inset ring-primary"
          : "hover:border-border",
        expired && !selected && "bg-destructive/[0.03]"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <code
              className={cn(
                "min-w-0 truncate font-mono text-[15px] font-semibold leading-tight text-foreground",
                expired && "text-destructive"
              )}
              title={location.locationCode}
            >
              {location.locationCode}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100"
              onClick={copyCode}
              title="Копировать код"
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
          <span className={cn("h-1.5 w-1.5 rounded-full", expired ? "bg-destructive" : meta.dot)} />
          <span
            className={cn(
              "text-[11px] font-medium leading-none",
              expired ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {expired ? "Просрочено" : meta.label}
          </span>
        </div>
      </div>

      {assignment ? (
        <p className="mt-1 truncate text-[13px] leading-snug text-foreground" title={assignment}>
          {assignment}
        </p>
      ) : null}

      {purposeBits.length > 0 && assignment !== purposeBits[0] ? (
        <p className="mt-0.5 truncate text-[12px] leading-snug text-muted-foreground">
          {purposeBits.join(" · ")}
        </p>
      ) : null}

      <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{placementLabel}</p>

      {handed ? (
        <p className="mt-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
          {handoffLine ? `В производстве · ${handoffLine}` : "Отдано в производство"}
        </p>
      ) : inProd > 0 && Number(location.availableQty || 0) <= 0 ? (
        <p className="mt-1 text-[11px] font-medium text-amber-800 dark:text-amber-300">В цеху</p>
      ) : null}

      {expired && expiryLabel ? (
        <p className="mt-1 text-[11px] font-medium text-destructive">Годен до {expiryLabel}</p>
      ) : null}

      {!hasProfile ? (
        <p className="mt-1 text-[11px] text-muted-foreground">Без профиля</p>
      ) : null}

      <dl className="mt-2 space-y-0.5 text-[12px] leading-5">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Остаток</dt>
          <dd className="tabular-nums text-foreground">
            <span className="font-medium">{formatCellQty(onHand)}</span>
            {capacity != null && Number.isFinite(capacity) ? (
              <span className="text-muted-foreground"> {formatCellQty(capacity)}</span>
            ) : null}
            {inProd > 0 && Number(location.availableQty || 0) > 0 ? (
              <span className="ml-1 text-[11px] text-muted-foreground">
                · в цеху {formatCellQty(inProd)}
              </span>
            ) : null}
          </dd>
        </div>
        {free != null ? (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Свободно</dt>
            <dd className="tabular-nums font-medium text-foreground">{formatCellQty(free)}</dd>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Позиций</dt>
          <dd className="tabular-nums font-medium text-foreground">{location.skuCount}</dd>
        </div>
      </dl>

      {fill != null ? (
        <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full",
              fill >= 90 ? "bg-destructive" : fill >= 70 ? "bg-amber-500" : "bg-emerald-500"
            )}
            style={{ width: `${fill}%` }}
          />
        </div>
      ) : null}

      <div className="mt-1.5 flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation()
            onOpen(location.locationCode)
          }}
        >
          Открыть
          <ExternalLink className="ml-1 h-3 w-3" />
        </Button>
      </div>
    </article>
  )
}

export const CellsLocationCard = memo(CellsLocationCardInner)
