"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  createLocationWriteoff,
  getWriteoffPreview,
  listDirectoryWriteoffReasons,
  type WriteoffPreview,
  type WriteoffReasonRow,
} from "@/lib/wms-api"
import { formatCellQty } from "@/lib/storage-slot-ui"
import { cn } from "@/lib/utils"

type Props = {
  open: boolean
  locationCode: string | null
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}

function lineKey(itemCode: string, lotCode: string | null) {
  return `${itemCode}::${lotCode || ""}`
}

export function CellsWriteoffDialog({ open, locationCode, onOpenChange, onDone }: Props) {
  const router = useRouter()
  const [reasons, setReasons] = useState<WriteoffReasonRow[]>([])
  const [reasonCode, setReasonCode] = useState("")
  const [preview, setPreview] = useState<WriteoffPreview | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [comment, setComment] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !locationCode) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setComment("")
    void Promise.all([
      listDirectoryWriteoffReasons({ activeOnly: true }),
      getWriteoffPreview(locationCode),
    ])
      .then(([reasonRes, previewRes]) => {
        if (cancelled) return
        const nextReasons = reasonRes.reasons || []
        setReasons(nextReasons)
        const expiredDefault = nextReasons.find((row) => row.code === "EXPIRED")?.code
        setReasonCode(expiredDefault || nextReasons[0]?.code || "")
        setPreview(previewRes.preview)
        const nextSelected: Record<string, boolean> = {}
        const hasExpired = previewRes.preview.lines.some((line) => line.expired)
        for (const line of previewRes.preview.lines) {
          nextSelected[lineKey(line.itemCode, line.lotCode)] = hasExpired ? line.expired : true
        }
        setSelected(nextSelected)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось подготовить списание")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, locationCode])

  const chosenLines = useMemo(
    () => (preview?.lines ?? []).filter((line) => selected[lineKey(line.itemCode, line.lotCode)]),
    [preview, selected]
  )
  const chosenQty = chosenLines.reduce((s, line) => s + line.qty, 0)
  const chosenCodes = (preview?.codes ?? []).filter((code) =>
    chosenLines.some((line) => line.itemCode === code.itemCode)
  )

  async function submit() {
    if (!locationCode || !reasonCode) {
      setError("Выберите основание списания")
      return
    }
    if (chosenLines.length === 0) {
      setError("Отметьте хотя бы одну позицию")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await createLocationWriteoff({
        locationCode,
        reasonCode,
        comment: comment.trim() || undefined,
        lines: chosenLines.map((line) => ({
          itemCode: line.itemCode,
          lotCode: line.lotCode,
          qty: line.qty,
        })),
      })
      onOpenChange(false)
      onDone?.()
      router.push(`/documents/${encodeURIComponent(res.documentId)}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось списать")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Списание из ячейки {locationCode || ""}</DialogTitle>
          <DialogDescription>
            Выберите основание, отметьте позиции и подтвердите. Будет создан акт списания со списком кодов.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Собираем остатки…
          </div>
        ) : (
          <div className="space-y-4">
            {error ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label>Основание</Label>
              <Select value={reasonCode} onValueChange={setReasonCode}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Выберите основание" />
                </SelectTrigger>
                <SelectContent>
                  {reasons.map((row) => (
                    <SelectItem key={row.code} value={row.code}>
                      {row.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium">Что списываем</span>
                <span className="text-xs text-muted-foreground">
                  {formatCellQty(chosenQty)} · кодов {chosenCodes.length}
                </span>
              </div>
              {preview?.lines.length ? (
                <ul className="max-h-64 space-y-1 overflow-auto rounded-xl border border-border/60 p-1.5">
                  {preview.lines.map((line) => {
                    const key = lineKey(line.itemCode, line.lotCode)
                    return (
                      <li key={key}>
                        <label
                          className={cn(
                            "flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-sm hover:bg-secondary/50",
                            line.expired && "bg-destructive/5"
                          )}
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={Boolean(selected[key])}
                            onChange={(e) =>
                              setSelected((prev) => ({ ...prev, [key]: e.target.checked }))
                            }
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium leading-snug">
                              {line.itemName || line.itemCode}
                            </span>
                            <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
                              {line.itemCode}
                              {line.lotCode ? ` · ${line.lotCode}` : ""}
                            </span>
                            <span className="mt-1 block text-xs">
                              {formatCellQty(line.qty)} {line.uom}
                              {line.expiryAt
                                ? ` · срок ${new Date(line.expiryAt).toLocaleDateString("ru-RU")}`
                                : ""}
                              {line.expired ? " · просрочено" : ""}
                            </span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
                  В ячейке нет остатков для списания.
                </p>
              )}
            </div>

            {chosenCodes.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Коды в акте ({chosenCodes.length})
                </p>
                <pre className="max-h-28 overflow-auto rounded-xl bg-secondary/40 p-2 font-mono text-[10px] leading-relaxed">
                  {chosenCodes
                    .slice(0, 40)
                    .map((c) => c.value)
                    .join("\n")}
                  {chosenCodes.length > 40 ? `\n… ещё ${chosenCodes.length - 40}` : ""}
                </pre>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label>Комментарий</Label>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                className="rounded-xl"
                placeholder="Необязательно"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            type="button"
            disabled={saving || loading || chosenLines.length === 0 || !reasonCode}
            onClick={() => void submit()}
          >
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Списать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
