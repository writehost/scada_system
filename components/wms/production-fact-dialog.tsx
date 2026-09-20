"use client"

import { useEffect, useMemo, useState } from "react"
import { Info, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { updateProductionPlanProgress, type ProductionPlanRow } from "@/lib/wms-api"
import {
  clampApsPercent,
  formatApsQty,
  resolveApsPlanFact,
} from "@/lib/wms/production-plan-fact"

type Props = {
  plan: ProductionPlanRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void | Promise<void>
}

export function ProductionFactDialog({ plan, open, onOpenChange, onSaved }: Props) {
  const fact = useMemo(() => (plan ? resolveApsPlanFact(plan) : null), [plan])
  const [qty, setQty] = useState("")
  const [percent, setPercent] = useState("")
  const [close, setClose] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !plan || !fact) return
    setQty(fact.factQty != null ? String(fact.factQty) : "")
    setPercent(fact.percent != null ? String(Math.round(fact.percent)) : "")
    setClose(plan.status === "done")
    setError(null)
  }, [fact, open, plan])

  if (!plan || !fact) return null

  const hasPlanQty = fact.planQty != null
  const qtyNum = Number(qty.replace(",", "."))
  const qtyValid = qty.trim() !== "" && Number.isFinite(qtyNum) && qtyNum >= 0

  // Когда план известен, процент считается сам — вводить его руками не нужно.
  const derivedPercent = hasPlanQty && qtyValid ? clampApsPercent((qtyNum / fact.planQty!) * 100) : null
  const effectivePercent = close
    ? 100
    : derivedPercent != null
      ? derivedPercent
      : clampApsPercent(Number(percent.replace(",", ".")) || 0)

  async function handleSave() {
    if (!qtyValid) {
      setError("Укажите количество")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await updateProductionPlanProgress({
        planCode: plan.code,
        percent: effectivePercent,
        doneQty: qtyNum,
        source: "manual:aps",
      })
      await onSaved()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить факт")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Факт выпуска</DialogTitle>
          <DialogDescription className="space-y-0.5">
            <span className="block font-medium text-foreground">{plan.itemName}</span>
            <span className="block font-mono text-xs">{plan.code}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="aps-fact-qty">Сделано, шт</Label>
            <Input
              id="aps-fact-qty"
              inputMode="decimal"
              autoFocus
              placeholder="Например, 12000"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="tabular-nums"
            />
            {hasPlanQty ? (
              <p className="text-xs text-muted-foreground">
                План {formatApsQty(fact.planQty!)} шт
                {derivedPercent != null ? ` · выполнение ${Math.round(derivedPercent)}%` : ""}
              </p>
            ) : null}
          </div>

          {!hasPlanQty ? (
            <div className="space-y-1.5">
              <Label htmlFor="aps-fact-percent">Готовность, % (необязательно)</Label>
              <Input
                id="aps-fact-percent"
                inputMode="numeric"
                placeholder="0"
                value={percent}
                disabled={close}
                onChange={(e) => setPercent(e.target.value)}
                className="tabular-nums"
              />
              <p className="text-xs text-muted-foreground">
                У партий с линии нет планового задания, поэтому процент задаётся вручную.
              </p>
            </div>
          ) : null}

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border bg-muted/20 px-3 py-2.5">
            <Checkbox checked={close} onCheckedChange={(v) => setClose(v === true)} className="mt-0.5" />
            <span className="space-y-0.5 text-sm">
              <span className="block font-medium">Партия выпущена</span>
              <span className="block text-xs text-muted-foreground">
                Ставит 100% и переводит заказ в статус «Выпущена».
              </span>
            </span>
          </label>

          {plan.externalSource === "vekas" ? (
            <div className="flex gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
              <span>
                Это партия с линии. Когда Векас закроет её статусом «На складе», количество заменится на
                фактическое из отчёта линии.
              </span>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || !qtyValid}>
            {saving ? <Loader2 className={cn("mr-1.5 size-4 animate-spin")} /> : null}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
