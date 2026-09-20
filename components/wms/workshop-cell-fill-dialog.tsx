"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ExternalLink, PackagePlus, Sparkles } from "lucide-react"
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
import { cn } from "@/lib/utils"
import { mapWmsError } from "@/lib/wms-error-messages"
import { getDefaultWmsSiteCode } from "@/lib/wms/client"
import {
  listItems,
  postReceivingLine,
  type WmsItemListRow,
  type WmsLocationRow,
} from "@/lib/wms-api"
import { WmsCreateNomenclatureButton, WmsItemPicker } from "@/components/wms/wms-pickers"
import { CreateNomenclatureDialog } from "@/components/wms/create-nomenclature-dialog"

function resolveItemShelfLifeDays(item: WmsItemListRow | undefined) {
  const days = Number(item?.shelfLifeDays ?? 365)
  return Number.isFinite(days) && days > 0 ? Math.trunc(days) : 365
}

function buildWaitingCellReceiptMeta(
  locationCode: string,
  item: WmsItemListRow | undefined
): { batchLabel: string; lotExpiryAt: string } {
  const today = new Date().toISOString().slice(0, 10)
  const batchLabel = `WAIT-${locationCode}-${today}`
  const expiry = new Date()
  expiry.setHours(0, 0, 0, 0)
  expiry.setDate(expiry.getDate() + resolveItemShelfLifeDays(item))
  return { batchLabel, lotExpiryAt: expiry.toISOString() }
}

export function WorkshopCellFillDialog({
  open,
  onOpenChange,
  location,
  onFilled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  location: WmsLocationRow | null
  onFilled?: () => void
}) {
  const siteCode = getDefaultWmsSiteCode()
  const [itemCode, setItemCode] = useState("")
  const [qty, setQty] = useState("1")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recentItems, setRecentItems] = useState<WmsItemListRow[]>([])
  const [recentLoading, setRecentLoading] = useState(false)
  const [fullCreateOpen, setFullCreateOpen] = useState(false)

  const code = location?.locationCode ?? ""
  const displayName = location?.displayName || code
  const empty = location?.isEmpty === true
  const occupiedCode = location?.occupiedItemCode?.trim() || ""
  const occupiedName = location?.occupiedItemName?.trim() || occupiedCode
  const onHandQty =
    (location?.inProductionQty ?? 0) + (location?.availableQty ?? 0)
  const expiryLabel = (() => {
    const iso = location?.nearestExpiryAt
    if (!iso) return null
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    return d.toLocaleDateString("ru-RU")
  })()

  const resetForm = useCallback(() => {
    setItemCode(empty ? "" : occupiedCode)
    setQty("1")
    setError(null)
  }, [empty, occupiedCode])

  useEffect(() => {
    if (!open) return
    resetForm()
  }, [open, resetForm, location?.locationCode])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setRecentLoading(true)
    void listItems({ limit: 16, isActive: true })
      .then((res) => {
        if (!cancelled) setRecentItems(res.items ?? [])
      })
      .catch(() => {
        if (!cancelled) setRecentItems([])
      })
      .finally(() => {
        if (!cancelled) setRecentLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const filteredRecent = useMemo(() => {
    const q = itemCode.trim().toLowerCase()
    if (!q) return recentItems.slice(0, 12)
    return recentItems
      .filter(
        (it) =>
          it.itemCode.toLowerCase().includes(q) ||
          (it.name ?? "").toLowerCase().includes(q)
      )
      .slice(0, 12)
  }, [recentItems, itemCode])

  const itemLocked = !empty && Boolean(occupiedCode)

  async function submit() {
    if (!code) return
    const ic = itemCode.trim()
    const q = Number(qty.replace(",", "."))
    if (!ic) {
      setError("Выберите или создайте номенклатуру")
      return
    }
    if (!Number.isFinite(q) || q <= 0) {
      setError("Укажите количество больше нуля")
      return
    }
    if (itemLocked && ic.toLowerCase() !== occupiedCode.toLowerCase()) {
      setError(
        `В точке ожидания уже лежит «${occupiedName}». Одна ячейка — одна номенклатура.`
      )
      return
    }
    setLoading(true)
    setError(null)
    try {
      const pickedItem =
        recentItems.find((it) => it.itemCode.toLowerCase() === ic.toLowerCase()) ??
        recentItems.find((it) => it.itemCode === ic)
      const receiptMeta = buildWaitingCellReceiptMeta(code, pickedItem)
      await postReceivingLine({
        itemCode: ic,
        targetLocationCode: code,
        qty: q,
        batchLabel: receiptMeta.batchLabel,
        lotExpiryAt: receiptMeta.lotExpiryAt,
      })
      toast.success(empty ? "Ячейка заполнена" : "Остаток добавлен", {
        description: `${ic} × ${q} → ${code}`,
      })
      onOpenChange(false)
      onFilled?.()
    } catch (e) {
      setError(mapWmsError(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !loading && onOpenChange(v)}>
        <DialogContent className="max-h-[min(92vh,820px)] gap-0 overflow-hidden rounded-xl p-0 sm:max-w-lg">
          <DialogHeader className="border-border/60 space-y-1 border-b px-5 py-4 text-left">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <PackagePlus className="text-primary h-5 w-5 shrink-0" />
              {empty ? "Заполнить ячейку" : "Добавить в ячейку"}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-0.5">
                <p className="text-foreground font-medium">{displayName}</p>
                <p className="font-mono text-xs">{code}</p>
                {!empty ? (
                  <div className="text-muted-foreground space-y-0.5 pt-1 text-sm">
                    <p>
                      Сейчас: <span className="text-foreground">{occupiedName}</span>
                    </p>
                    <p>
                      Остаток:{" "}
                      <span className="text-foreground font-medium tabular-nums">
                        {new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(onHandQty)} шт.
                      </span>
                      {expiryLabel ? (
                        <>
                          {" "}
                          · годен до{" "}
                          <span className="text-foreground font-medium">{expiryLabel}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                ) : (
                  <p className="text-muted-foreground pt-1 text-sm">
                    Точка ожидания · одна номенклатура на ячейку
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[min(60vh,520px)] space-y-4 overflow-y-auto px-5 py-4">
            {!empty && occupiedCode ? (
              <div className="bg-muted/40 rounded-xl border px-3 py-2 text-sm">
                Номенклатура зафиксирована для этой ячейки. Можно только добавить количество той же позиции.
              </div>
            ) : null}

            {itemLocked ? (
              <div className="space-y-1">
                <Label className="text-muted-foreground text-[10px] uppercase">Номенклатура</Label>
                <div className="rounded-xl border px-3 py-2.5">
                  <p className="font-medium">{occupiedName}</p>
                  <p className="text-muted-foreground font-mono text-xs">{occupiedCode}</p>
                </div>
              </div>
            ) : (
              <WmsItemPicker
                siteCode={siteCode}
                label="Номенклатура"
                value={itemCode}
                onChange={setItemCode}
              />
            )}

            {!itemLocked ? (
              <div className="flex flex-wrap items-center gap-2">
                <WmsCreateNomenclatureButton
                  siteCode={siteCode}
                  initialItemCode={itemCode.trim()}
                  onCreated={(created) => {
                    setItemCode(created)
                    toast.success("Номенклатура создана", { description: created })
                  }}
                  variant="outline"
                  size="sm"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="rounded-lg"
                  onClick={() => setFullCreateOpen(true)}
                >
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  Полный конструктор
                </Button>
              </div>
            ) : null}

            {filteredRecent.length > 0 ? (
              <div className="space-y-2">
                <Label className="text-muted-foreground text-[10px] uppercase tracking-wide">
                  {recentLoading ? "Загрузка…" : "Быстрый выбор из базы"}
                </Label>
                <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
                  {filteredRecent.map((it) => (
                    <button
                      key={it.itemCode}
                      type="button"
                      disabled={itemLocked && it.itemCode.toLowerCase() !== occupiedCode.toLowerCase()}
                      onClick={() => setItemCode(it.itemCode)}
                      className={cn(
                        "hover:bg-primary/10 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors",
                        itemCode.trim().toLowerCase() === it.itemCode.toLowerCase() &&
                          "border-primary/50 bg-primary/10",
                        itemLocked &&
                          it.itemCode.toLowerCase() !== occupiedCode.toLowerCase() &&
                          "cursor-not-allowed opacity-40"
                      )}
                    >
                      <span className="block font-mono font-medium">{it.itemCode}</span>
                      <span className="text-muted-foreground line-clamp-1">{it.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="workshop-cell-qty" className="text-muted-foreground text-[10px] uppercase">
                Количество
              </Label>
              <Input
                id="workshop-cell-qty"
                type="text"
                inputMode="decimal"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="h-11 rounded-xl font-mono tabular-nums"
                placeholder="1"
              />
            </div>

            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter className="border-border/60 flex-col gap-2 border-t px-5 py-4 sm:flex-row sm:justify-between">
            <Button variant="ghost" size="sm" className="rounded-lg" asChild>
              <Link href={`/cells?locationCode=${encodeURIComponent(code)}`}>
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Карточка ячейки
              </Link>
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Отмена
              </Button>
              <Button className="rounded-xl" onClick={() => void submit()} disabled={loading || !code}>
                {loading ? "Сохранение…" : empty ? "Заполнить" : "Добавить"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateNomenclatureDialog
        open={fullCreateOpen}
        onOpenChange={setFullCreateOpen}
        initialCode={itemCode.trim()}
        onCreated={(createdCode, message) => {
          setItemCode(createdCode)
          setFullCreateOpen(false)
          toast.success(message, { description: createdCode })
        }}
      />
    </>
  )
}
