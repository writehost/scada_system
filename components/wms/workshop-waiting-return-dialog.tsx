"use client"

import { useEffect, useState } from "react"
import { Loader2, Undo2 } from "lucide-react"
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
import { returnWorkshopStockToWarehouse, type WmsLocationRow } from "@/lib/wms-api"
import { fmtPlanQty } from "@/lib/wms/workshop-plan-context"

function locationOnHandQty(loc: WmsLocationRow) {
  return (loc.inProductionQty ?? 0) + (loc.availableQty ?? 0)
}

export function WorkshopWaitingReturnDialog({
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

  const [qty, setQty] = useState("")
  const [targetLocationCode, setTargetLocationCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setQty(onHand > 0 ? String(Math.floor(onHand)) : "")
    setTargetLocationCode("")
    setError(null)
  }, [open, location?.locationCode, onHand])

  async function submit() {
    if (!code || !itemCode) return
    const parsedQty = Number(qty.replace(/\s/g, "").replace(",", "."))
    const target = targetLocationCode.trim().toUpperCase()
    if (!target) {
      setError("Укажите ячейку склада материалов")
      return
    }
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
      await returnWorkshopStockToWarehouse({
        fromLocationCode: code,
        toLocationCode: target,
        itemCode,
        qty: parsedQty,
      })
      toast.success("Возврат на склад", {
        description: `${fmtPlanQty(parsedQty)} шт. → ${target}`,
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
            <Undo2 className="text-primary h-5 w-5 shrink-0" />
            Возврат на склад материалов
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
          <div className="space-y-1.5">
            <Label htmlFor="waiting-return-target">Ячейка склада материалов</Label>
            <Input
              id="waiting-return-target"
              value={targetLocationCode}
              onChange={(e) => setTargetLocationCode(e.target.value.toUpperCase())}
              placeholder="OS-ST-BAGG-…"
              className="rounded-xl font-mono text-sm"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="waiting-return-qty">Количество, шт.</Label>
            <Input
              id="waiting-return-qty"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              className="rounded-xl tabular-nums"
            />
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
                Возвращаю…
              </>
            ) : (
              "Вернуть"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
