"use client"

import { useState } from "react"
import Link from "next/link"
import { Plus, Warehouse } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createWmsLocation } from "@/lib/wms-api"
import { setReceivingTargetLocationCode } from "@/lib/receiving-settings"
import type { ReceivingMissingCellDetails } from "@/lib/receiving-missing-cell"
import { buildSlotTitle, formatZoneSelectLabel, resolveLocationCode } from "@/lib/storage-slot-ui"
import { mapWmsError } from "@/lib/wms-error-messages"

type ReceivingMissingCellOfferProps = {
  details: ReceivingMissingCellDetails
  documentId?: string
  onCreated?: (locationCode: string) => void | Promise<void>
  className?: string
}

export function ReceivingMissingCellOffer({
  details,
  documentId,
  onCreated,
  className,
}: ReceivingMissingCellOfferProps) {
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [createdCode, setCreatedCode] = useState<string | null>(null)

  async function createSuggestedCell() {
    setBusy(true)
    setLocalError(null)
    try {
      const locationCode =
        resolveLocationCode(details.slotProfile, details.locationCode) || details.locationCode
      await createWmsLocation({
        warehouseCode: details.warehouseCode,
        zoneCode: details.zoneCode,
        locationCode,
        displayName: details.displayName || buildSlotTitle(details.slotProfile),
        locationAttrs: { slotProfile: details.slotProfile },
      })
      setReceivingTargetLocationCode(locationCode)
      setCreatedCode(locationCode)
      await onCreated?.(locationCode)
    } catch (e) {
      const msg = mapWmsError(e)
      if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("уже")) {
        setReceivingTargetLocationCode(details.locationCode)
        setCreatedCode(details.locationCode)
        await onCreated?.(details.locationCode)
        return
      }
      setLocalError(msg)
    } finally {
      setBusy(false)
    }
  }

  const cellsHref = `/cells?create=1&locationCode=${encodeURIComponent(details.locationCode)}&itemCode=${encodeURIComponent(details.itemCode)}`

  return (
    <div
      className={
        className ??
        "mt-3 rounded-lg border border-destructive/25 bg-background/80 p-3 text-sm text-foreground"
      }
    >
      <p className="font-medium">Нет ячейки с нужным профилем</p>
      <p className="mt-1 text-muted-foreground">
        {details.itemName}
        <span className="font-mono text-xs"> · {details.itemCode}</span>
      </p>
      <p className="mt-2 text-xs">
        Профиль: <span className="font-medium text-foreground">{details.slotTitle}</span>
      </p>
      <p className="mt-1 font-mono text-[11px] text-muted-foreground break-all">
        {details.locationCode} · {formatZoneSelectLabel(details.zoneCode, null, details.warehouseCode)}
      </p>
      {documentId ? (
        <p className="mt-1 text-[11px] text-muted-foreground">Документ {documentId}</p>
      ) : null}
      {localError ? <p className="mt-2 text-xs text-destructive">{localError}</p> : null}
      {createdCode ? (
        <p className="mt-2 text-xs text-emerald-800">
          Ячейка {createdCode} создана и выбрана для проведения. Повторите проводку.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-lg"
            disabled={busy}
            onClick={() => void createSuggestedCell()}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {busy ? "Создаём…" : "Создать ячейку и провести"}
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg" asChild>
            <Link href={cellsHref}>
              <Warehouse className="mr-1.5 h-3.5 w-3.5" />
              Настроить вручную
            </Link>
          </Button>
        </div>
      )}
    </div>
  )
}
