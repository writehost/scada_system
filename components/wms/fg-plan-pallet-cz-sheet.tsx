"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, ScanSearch } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { lookupFgPlanPalletInCz, type FgPlanInventorySlot } from "@/lib/wms-api"
import type { FgPlanPalletCzSummary } from "@/lib/wms/fg-plan-pallet-cz"
import { normalizeSscc } from "@/lib/wms/fg-plan-pallet-cz"
import { blocksFromBottles, ruBlocksWord } from "@/lib/wms/fg-plan-pack"

export function FgPlanPalletCzSheet({
  open,
  onOpenChange,
  slots,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  slots: FgPlanInventorySlot[]
}) {
  const pallets = useMemo(
    () =>
      slots
        .map((slot) => ({
          address: slot.address,
          sscc: normalizeSscc(slot.palletId || ""),
          planGtin: slot.gtin || "",
          name: slot.nomenclature || "",
          qty: slot.quantity,
          bottles: Number(slot.quantity) || 0,
        }))
        .filter((row) => row.sscc),
    [slots]
  )
  const [active, setActive] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<FgPlanPalletCzSummary | null>(null)

  useEffect(() => {
    if (!open) return
    setActive((prev) => prev || pallets[0]?.sscc || "")
  }, [open, pallets])

  useEffect(() => {
    if (!open || !active) return
    const row = pallets.find((item) => item.sscc === active)
    let cancelled = false
    setLoading(true)
    setError(null)
    setResult(null)
    void lookupFgPlanPalletInCz({ sscc: active, planGtin: row?.planGtin, planBottles: row?.bottles })
      .then((next) => {
        if (!cancelled) setResult(next)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось спросить ЧЗ")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, active, pallets])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-3 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Состав палеты в ЧЗ</SheetTitle>
          <SheetDescription>
            По SSCC Честный знак показывает вложенные коды. СУЗ коды только эмитирует, состав агрегата — в ЧЗ.
          </SheetDescription>
        </SheetHeader>
        {pallets.length === 0 ? (
          <p className="text-sm text-muted-foreground">У выбранного ряда нет SSCC.</p>
        ) : (
          <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {pallets.map((row) => (
              <button
                key={`${row.address}-${row.sscc}`}
                type="button"
                onClick={() => setActive(row.sscc)}
                className={`rounded-lg border px-2 py-1.5 text-left text-xs ${
                  active === row.sscc ? "border-foreground bg-muted" : "border-border"
                }`}
              >
                <span className="font-mono">{row.sscc}</span>
                <span className="mt-0.5 block text-muted-foreground">
                  {row.address}
                  {row.qty
                    ? ` · ${blocksFromBottles(row.qty)} ${ruBlocksWord(blocksFromBottles(row.qty))} · ${row.qty} бут.`
                    : ""}
                </span>
              </button>
            ))}
          </div>
        )}
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Запрос в Честный знак…
          </p>
        ) : null}
        {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
        {result ? (
          <div className="space-y-2 rounded-xl border p-3 text-sm">
            {!result.found ? (
              <p>ЧЗ не нашёл этот SSCC.</p>
            ) : (
              <>
                <p className="font-medium">{result.productName || "Состав агрегата"}</p>
                <p>
                  {result.blocks} {ruBlocksWord(result.blocks)} · {result.bottles} бут. · {result.packageLabel} ·{" "}
                  {result.statusLabel}
                </p>
                {result.childGtin ? (
                  <p className="font-mono text-xs text-muted-foreground">GTIN {result.childGtin}</p>
                ) : null}
                {result.gtinMismatch ? (
                  <p className="text-xs text-amber-700">
                    На плане GTIN {result.planGtin}, в ЧЗ внутри агрегата {result.childGtin}.
                  </p>
                ) : null}
                {result.ownerName ? (
                  <p className="text-xs text-muted-foreground">{result.ownerName}</p>
                ) : null}
                {result.children.length > 0 ? (
                  <div className="max-h-48 overflow-y-auto rounded-lg bg-muted/50 p-2 font-mono text-[11px] leading-5">
                    {result.children.slice(0, 20).map((code) => (
                      <div key={code}>{code}</div>
                    ))}
                    {result.children.length > 20 ? (
                      <div className="text-muted-foreground">… ещё {result.children.length - 20}</div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Вложенных КМ ЧЗ не вернул.</p>
                )}
              </>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

export function FgPlanPalletCzButton({
  disabled,
  onClick,
}: {
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={disabled} onClick={onClick}>
      <ScanSearch className="mr-1.5 size-3.5" />
      Состав в ЧЗ
    </Button>
  )
}
