"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2, ScanBarcode, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  getWmsClientErrorMeta,
  getWmsItemDetail,
  patchWmsLocationDisplayName,
  postReceivingLine,
} from "@/lib/wms-api"
import { suggestLocationDisplayNameFromItemName } from "@/lib/wms/suggest-location-display-name"
import { cn } from "@/lib/utils"
import { ReceivingKo1Dialog } from "@/components/wms/receiving-ko1-dialog"

type RowStatus = "queued" | "ok" | "error"

type ScanRow = {
  id: string
  itemCode: string
  qty: number
  batchLabel: string
  status: RowStatus
  detail?: string
}

const DEFAULT_LOCATION_KEY = "wms.receiving.targetLocationCode"

function newRowId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `r-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function ReceivingQuickScan({ onApplied }: { onApplied?: () => void }) {
  const [open, setOpen] = useState(false)
  const [scan, setScan] = useState("")
  const [targetLocationCode, setTargetLocationCode] = useState(() => {
    if (typeof window === "undefined") return ""
    return window.localStorage.getItem(DEFAULT_LOCATION_KEY)?.trim() ?? ""
  })
  const [rows, setRows] = useState<ScanRow[]>([])
  const [submitting, setSubmitting] = useState(false)
  /** Подпись ячейки/короба в WMS (display_name локации), чтобы в списке было видно содержимое */
  const [locationDisplayName, setLocationDisplayName] = useState("")
  const [locationLabelKind, setLocationLabelKind] = useState<"box" | "cell">("box")
  const [locationLabelError, setLocationLabelError] = useState<string | null>(null)
  const [generatingLabel, setGeneratingLabel] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const persistLocation = useCallback((code: string) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DEFAULT_LOCATION_KEY, code.trim())
    }
  }, [])

  function addFromScan(raw: string) {
    const code = raw.trim()
    if (!code) return
    setRows((prev) => [
      ...prev,
      {
        id: newRowId(),
        itemCode: code,
        qty: 1,
        batchLabel: "",
        status: "queued",
      },
    ])
    setScan("")
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function updateRow(id: string, patch: Partial<Pick<ScanRow, "itemCode" | "qty" | "batchLabel">>) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch, status: "queued" as const, detail: undefined } : r))
    )
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  async function fillDisplayNameFromItem() {
    const first = rows.find((r) => r.itemCode.trim())
    if (!first) {
      setLocationLabelError("Добавьте строку с кодом номенклатуры в таблице")
      return
    }
    setGeneratingLabel(true)
    setLocationLabelError(null)
    try {
      const d = await getWmsItemDetail(first.itemCode.trim())
      const name = typeof d.item?.name === "string" ? d.item.name : ""
      if (!name.trim()) {
        setLocationLabelError("У позиции нет названия в справочнике")
        return
      }
      setLocationDisplayName(
        suggestLocationDisplayNameFromItemName(name, {
          label: locationLabelKind === "cell" ? "cell" : "box",
        })
      )
    } catch (e) {
      setLocationLabelError(e instanceof Error ? e.message : "Не удалось загрузить номенклатуру")
    } finally {
      setGeneratingLabel(false)
    }
  }

  async function submitAll() {
    const loc = targetLocationCode.trim()
    if (!loc) return
    persistLocation(loc)
    const pending = rows.filter((r) => r.status !== "ok")
    if (pending.length === 0) return
    setSubmitting(true)
    setLocationLabelError(null)
    let anyAccepted = false
    for (const row of pending) {
      const qty = Number(row.qty)
      if (!Number.isFinite(qty) || qty <= 0) {
        setRows((prev) =>
          prev.map((r) =>
            r.id === row.id ? { ...r, status: "error" as const, detail: "Некорректное количество" } : r
          )
        )
        continue
      }
      try {
        await postReceivingLine({
          itemCode: row.itemCode,
          targetLocationCode: loc,
          qty,
          batchLabel: row.batchLabel.trim() || null,
        })
        anyAccepted = true
        setRows((prev) =>
          prev.map((r) => (r.id === row.id ? { ...r, status: "ok" as const, detail: undefined } : r))
        )
      } catch (e) {
        const meta = getWmsClientErrorMeta(e)
        const msg = e instanceof Error ? e.message : "Ошибка приёмки"
        setRows((prev) =>
          prev.map((r) =>
            r.id === row.id ? { ...r, status: "error" as const, detail: meta.code ? `${msg} (${meta.code})` : msg } : r
          )
        )
      }
    }
    setSubmitting(false)
    if (anyAccepted && locationDisplayName.trim()) {
      try {
        await patchWmsLocationDisplayName(loc, locationDisplayName.trim())
      } catch (e) {
        setLocationLabelError(
          e instanceof Error ? e.message : "Не удалось сохранить подпись ячейки (display name)"
        )
      }
    }
    onApplied?.()
  }

  useEffect(() => {
    if (!open) return
    setLocationLabelError(null)
    const id = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(id)
  }, [open])

  const queuedCount = rows.filter((r) => r.status === "queued" || r.status === "error").length

  const suggestedBasis = useMemo(() => {
    const ok = rows.filter((r) => r.status === "ok")
    if (ok.length === 0) return undefined
    return `Приёмка ТМЦ (WMS): ${ok.map((r) => `${r.itemCode} × ${r.qty}`).join("; ")}`
  }, [rows])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="rounded-xl gap-2 border-primary/35 bg-primary/8 hover:bg-primary/12">
          <ScanBarcode className="h-4 w-4" />
          Приёмка по скану
        </Button>
      </DialogTrigger>
      <DialogContent
        overlayClassName="bg-black/40 backdrop-blur-md supports-[backdrop-filter]:bg-black/35"
        className="max-h-[min(90vh,900px)] gap-0 overflow-hidden border-border/60 bg-card/92 p-0 shadow-xl backdrop-blur-xl sm:max-w-4xl"
      >
        <div className="max-h-[min(90vh,900px)] overflow-y-auto p-6 pt-8">
          <DialogHeader className="mb-4 text-left">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <ScanBarcode className="h-6 w-6 shrink-0 text-primary" />
              Приёмка по скану
            </DialogTitle>
            <DialogDescription>
              Код товара или штрихкод — как в справочнике WMS; размещение в одну целевую ячейку.
            </DialogDescription>
          </DialogHeader>

          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Скан / ввод кода</label>
              <Input
                ref={inputRef}
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addFromScan(scan)
                  }
                }}
                placeholder="Отсканируйте или введите код и Enter"
                className="rounded-xl border-2 border-primary/45 font-mono focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Целевая ячейка / локация</label>
              <Input
                value={targetLocationCode}
                onChange={(e) => setTargetLocationCode(e.target.value)}
                onBlur={() => persistLocation(targetLocationCode)}
                placeholder="Например STAGE-A1"
                className="rounded-xl font-mono"
              />
            </div>
          </div>

          <div className="mb-4 rounded-xl border border-border/60 bg-secondary/20 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Подпись в списке ячеек</span>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={locationLabelKind === "box" ? "secondary" : "outline"}
                  className="h-7 rounded-lg text-xs"
                  onClick={() => setLocationLabelKind("box")}
                >
                  Короб
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={locationLabelKind === "cell" ? "secondary" : "outline"}
                  className="h-7 rounded-lg text-xs"
                  onClick={() => setLocationLabelKind("cell")}
                >
                  Ячейка
                </Button>
              </div>
            </div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Что лежит в этой локации (сохраняется в название ячейки WMS)
            </label>
            <div className="flex flex-wrap gap-2">
              <Input
                value={locationDisplayName}
                onChange={(e) => setLocationDisplayName(e.target.value)}
                placeholder="Например: Короб: стикеры медвежки, тара 1.5…"
                className="min-w-[220px] flex-1 rounded-xl font-normal"
              />
              <Button
                type="button"
                variant="outline"
                className="rounded-xl shrink-0"
                disabled={generatingLabel || rows.length === 0}
                onClick={() => void fillDisplayNameFromItem()}
              >
                {generatingLabel ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Из номенклатуры
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              По кнопке подставляется название товара из справочника по первой строке таблицы (можно править). После
              успешной приёмки текст запишется на целевую ячейку <span className="font-mono">{targetLocationCode || "—"}</span>.
            </p>
            {locationLabelError ? <p className="mt-2 text-xs text-destructive">{locationLabelError}</p> : null}
          </div>

          {rows.length > 0 && (
            <div className="mb-4 overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/40 text-left text-muted-foreground">
                    <th className="p-2 font-medium">Код номенклатуры</th>
                    <th className="w-24 p-2 font-medium">Кол-во</th>
                    <th className="w-40 p-2 font-medium">Партия (опц.)</th>
                    <th className="w-36 p-2 font-medium">Статус</th>
                    <th className="w-10 p-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-border/80 last:border-0">
                      <td className="p-2">
                        <Input
                          value={row.itemCode}
                          onChange={(e) => updateRow(row.id, { itemCode: e.target.value })}
                          className="h-8 font-mono text-sm"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={0.001}
                          step="any"
                          value={row.qty}
                          onChange={(e) => updateRow(row.id, { qty: Number(e.target.value) })}
                          className="h-8 font-mono text-sm"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          value={row.batchLabel}
                          onChange={(e) => updateRow(row.id, { batchLabel: e.target.value })}
                          placeholder="—"
                          className="h-8 font-mono text-sm"
                        />
                      </td>
                      <td className="p-2 text-xs">
                        <span
                          className={cn(
                            "inline-flex rounded-md px-2 py-0.5",
                            row.status === "ok" && "bg-success/15 text-success",
                            row.status === "queued" && "bg-secondary text-secondary-foreground",
                            row.status === "error" && "bg-destructive/15 text-destructive"
                          )}
                        >
                          {row.status === "ok" && "Принято"}
                          {row.status === "queued" && "В очереди"}
                          {row.status === "error" && (row.detail || "Ошибка")}
                        </span>
                      </td>
                      <td className="p-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          onClick={() => removeRow(row.id)}
                          aria-label="Удалить строку"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
            <Button
              type="button"
              className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={submitting || !targetLocationCode.trim() || queuedCount === 0}
              onClick={() => void submitAll()}
            >
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Принять на склад
            </Button>
            {rows.length > 0 && (
              <Button type="button" variant="outline" className="rounded-xl" disabled={submitting} onClick={() => setRows([])}>
                Очистить таблицу
              </Button>
            )}
            <ReceivingKo1Dialog suggestedBasis={suggestedBasis} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
