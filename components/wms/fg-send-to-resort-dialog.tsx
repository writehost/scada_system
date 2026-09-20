"use client"

import { useState } from "react"
import { Loader2, RefreshCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { sendFgPalletsToResort, type FgResortReason } from "@/lib/wms-api"
import { useToast } from "@/hooks/use-toast"

const REASONS: Array<{ id: FgResortReason; title: string; hint: string }> = [
  {
    id: "extra_physical",
    title: "На палете есть упаковки, которых нет в программе",
    hint: "Физически лежит больше, чем в учёте. Палету снимут с отгрузки и переберут.",
  },
  {
    id: "extra_system",
    title: "В программе больше, чем физически на палете",
    hint: "В учёте есть коды, которых на палете не видно.",
  },
  {
    id: "other",
    title: "Другая причина",
    hint: "Состав сомнительный — нужна ручная сверка.",
  },
]

export type FgResortTarget = {
  palletId: string
  palletCode: string
  itemName?: string
  locationCode?: string
}

export function FgSendToResortDialog({
  open,
  onOpenChange,
  pallets,
  onSent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pallets: FgResortTarget[]
  onSent?: () => void
}) {
  const { toast } = useToast()
  const [reason, setReason] = useState<FgResortReason>("extra_physical")
  const [comment, setComment] = useState("")
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (pallets.length === 0) return
    setSaving(true)
    try {
      const result = await sendFgPalletsToResort({
        palletIds: pallets.map((p) => p.palletId),
        reason,
        comment: comment.trim() || undefined,
      })
      const sent = result.created
      const skipped = result.skipped
      toast({
        title: sent > 0 ? "Отправлено на перебор" : "Палеты уже на переборе",
        description:
          sent > 0
            ? `${sent} ${sent === 1 ? "палета" : sent < 5 ? "палеты" : "палет"} ушла на перебор${
                skipped > 0 ? ` · ${skipped} уже были в очереди` : ""
              }. Отгрузка по ним заблокирована.`
            : "Эти палеты уже стоят в очереди перебора.",
      })
      setComment("")
      onOpenChange(false)
      onSent?.()
    } catch (e) {
      toast({
        title: "Не удалось отправить на перебор",
        description: e instanceof Error ? e.message : "Ошибка сервера",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCcw className="h-4 w-4" />
            Отправить на перебор
          </DialogTitle>
          <DialogDescription>
            Палету уберут из доступных к отгрузке, пока кладовщик не пересчитает состав. Это нужно, когда
            физически на палете есть упаковки, которых нет в программе — или наоборот.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm">
            <p className="font-medium text-foreground">
              {pallets.length === 1
                ? `Палета …${pallets[0].palletCode.slice(-12)}`
                : `Выбрано палет: ${pallets.length}`}
            </p>
            {pallets[0]?.itemName ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{pallets[0].itemName}</p>
            ) : null}
            {pallets[0]?.locationCode ? (
              <p className="text-xs text-muted-foreground">Ряд / ячейка: {pallets[0].locationCode}</p>
            ) : null}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-muted-foreground">Почему отправляете</legend>
            {REASONS.map((item) => (
              <label
                key={item.id}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/70 px-3 py-2 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5"
              >
                <input
                  type="radio"
                  name="fg-resort-reason"
                  className="mt-1"
                  checked={reason === item.id}
                  onChange={() => setReason(item.id)}
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">{item.title}</span>
                  <span className="block text-xs text-muted-foreground">{item.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Комментарий кладовщику</span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              maxLength={400}
              placeholder="Например: внизу палеты лежат блоки, которых нет в ЧЗ"
              className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={saving || pallets.length === 0}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-1.5 h-4 w-4" />}
            Отправить на перебор
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
