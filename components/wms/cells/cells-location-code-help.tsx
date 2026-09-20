"use client"

import { useMemo, useState } from "react"
import { CircleHelp } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  explainLocationCode,
  type LocationCodeExplanation,
} from "@/lib/location-code-help"
import type { StorageSlotProfile } from "@/lib/storage-slot-ui"
import { cn } from "@/lib/utils"

type Props = {
  locationCode: string
  slotProfile?: StorageSlotProfile | null
  warehouseCode?: string | null
  zoneCode?: string | null
  displayName?: string | null
  showIcon?: boolean
  showLink?: boolean
  linkClassName?: string
  iconClassName?: string
}

function ExampleBlock({ title, code, note }: { title: string; code: string; note: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2.5 text-xs">
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 font-mono text-[11px] text-primary">{code}</p>
      <p className="mt-1 text-muted-foreground">{note}</p>
    </div>
  )
}

function SegmentsTable({ explanation }: { explanation: LocationCodeExplanation }) {
  if (explanation.segments.length === 0) return null
  return (
    <div className="overflow-hidden rounded-xl border border-border/60">
      <table className="w-full text-xs">
        <thead className="bg-secondary/40 text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Фрагмент</th>
            <th className="px-3 py-2 font-medium">Значение</th>
            <th className="hidden px-3 py-2 font-medium sm:table-cell">Пояснение</th>
          </tr>
        </thead>
        <tbody>
          {explanation.segments.map((seg) => (
            <tr key={`${seg.code}-${seg.label}`} className="border-t border-border/40">
              <td className="px-3 py-2 font-mono">{seg.code}</td>
              <td className="px-3 py-2 font-medium">{seg.label}</td>
              <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{seg.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CellsLocationCodeHelp({
  locationCode,
  slotProfile,
  warehouseCode,
  zoneCode,
  displayName,
  showIcon = false,
  showLink = true,
  linkClassName,
  iconClassName,
}: Props) {
  const [open, setOpen] = useState(false)
  const explanation = useMemo(
    () =>
      explainLocationCode(locationCode, {
        slotProfile,
        warehouseCode,
        zoneCode,
      }),
    [locationCode, slotProfile, warehouseCode, zoneCode]
  )

  if (!showIcon && !showLink) return null

  return (
    <>
      {showIcon ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8 shrink-0 rounded-lg", iconClassName)}
          onClick={() => setOpen(true)}
          title="Что означает код ячейки?"
        >
          <CircleHelp className="h-4 w-4 text-muted-foreground" />
        </Button>
      ) : null}
      {showLink ? (
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 text-xs text-primary hover:underline",
            linkClassName
          )}
          onClick={() => setOpen(true)}
        >
          <CircleHelp className="h-3.5 w-3.5" />
          Что означает этот код?
        </button>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="pr-6">{explanation.title}</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-1 pt-1 text-left text-sm text-muted-foreground">
                <p className="font-mono text-xs text-foreground">{locationCode}</p>
                {displayName ? <p>{displayName}</p> : null}
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            <p>{explanation.summary}</p>

            <SegmentsTable explanation={explanation} />

            <div className="grid gap-2 sm:grid-cols-2">
              <ExampleBlock
                title="Физический (legacy)"
                code="OS-RECV-ST01-S01-P01-B01"
                note="Склад · зона · стеллаж · секция · проход · полка"
              />
              <ExampleBlock
                title="Смысловой (новый)"
                code="ST-SER-RND-SLNG-15-A01-01"
                note="Материал · процесс · форма · группа · объём · адрес"
              />
            </div>

            {explanation.hint ? (
              <p className="text-xs text-muted-foreground">{explanation.hint}</p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
