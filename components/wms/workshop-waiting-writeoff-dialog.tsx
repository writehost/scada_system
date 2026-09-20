"use client"

import { useEffect, useState } from "react"
import { Loader2, MinusCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { mapWmsError } from "@/lib/wms-error-messages"
import {
  clearWaitingCellHandoff,
  consumeProductionLineStock,
  type WmsLocationRow,
} from "@/lib/wms-api"
import { fmtPlanQty } from "@/lib/wms/workshop-plan-context"

function locationOnHandQty(loc: WmsLocationRow) {
  return (loc.inProductionQty ?? 0) + (loc.availableQty ?? 0)
}

export function WorkshopWaitingWriteoffDialog({
  open,
  onOpenChange,
  location,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  location: WmsLocationRow | null
  onDone?: () => void
}) {
  const code = location?.locationCode ?? ""
  const itemCode = location?.occupiedItemCode?.trim() ?? ""
  const itemName = location?.occupiedItemName?.trim() || itemCode
  const onHand = location ? locationOnHandQty(location) : 0
  const handoff = location?.waitingHandoff ?? null

  const [qty, setQty] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setQty(onHand > 0 ? String(Math.floor(onHand)) : "")
    setError(null)
  }, [open, location?.locationCode, onHand])

  async function submit() {
    if (!code || !itemCode) return
    const parsedQty = Number(qty.replace(/\s/g, "").replace(",", "."))
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
      setError("Укажите количество больше нуля")
      return
    }
    if (parsedQty > onHand + 1e-9) {
      setError(`В ячейке только ${fmtPlanQty(onHand)} шт.`)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const result = await consumeProductionLineStock({
        locationCode: code,
        itemCode,
        qty: parsedQty,
        lineCode: handoff?.lineCode ?? undefined,
        batchLabel: handoff?.batchLabel ?? undefined,
        lotCode: handoff?.batchLabel ?? undefined,
        sourceSystem: "workshop_manual",
      })

      const remaining =
        (result.afterInProductionQty ?? 0) + (result.afterAvailableQty ?? 0)
      if (remaining <= 0 && handoff) {
        await clearWaitingCellHandoff({ locationCode: code }).catch(() => null)
      }

      toast.success("Списание выполнено", {
        description: `${fmtPlanQty(parsedQty)} шт. · ${code}`,
      })
      onOpenChange(false)
      onDone?.()
    } catch (e) {
      setError(mapWmsError(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !loading && onOpenChange(v)}>
      <DialogContent className="max-h-[min(92vh,720px)] gap-0 overflow-hidden rounded-xl p-0 sm:max-w-md">
        <DialogHeader className="border-border/60 space-y-1 border-b px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <MinusCircle className="text-primary h-5 w-5 shrink-0" />
            Ручное списание
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-0.5">
              <p className="text-foreground font-medium">{code}</p>
              <p className="text-muted-foreground text-sm">{itemName}</p>
              <p className="text-muted-foreground pt-1 text-sm">
                Доступно:{" "}
                <span className="text-foreground font-medium tabular-nums">{fmtPlanQty(onHand)} шт.</span>
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div className="bg-muted/40 text-muted-foreground rounded-xl border px-3 py-2.5 text-xs leading-relaxed">
            Списывает остаток из ячейки ожидания. Автоматический расход по партии подключим позже.
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="waiting-writeoff-qty">Количество, шт.</Label>
            <Input
              id="waiting-writeoff-qty"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              className="rounded-xl tabular-nums"
            />
            {handoff?.lineCode ? (
              <p className="text-muted-foreground text-xs">
                Линия: {handoff.lineCode}
                {handoff.batchLabel ? ` · ${handoff.batchLabel}` : ""}
              </p>
            ) : null}
          </div>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>

        <DialogFooter className="border-border/60 gap-2 border-t px-5 py-4 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            disabled={loading}
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
          <Button
            type="button"
            className="rounded-xl"
            disabled={loading || onHand <= 0}
            onClick={() => void submit()}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Списываю…
              </>
            ) : (
              "Списать"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
