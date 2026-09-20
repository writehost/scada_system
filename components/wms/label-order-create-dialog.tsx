"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  Check,
  Loader2,
  PackageSearch,
  Search,
  User,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  createLabelOrder,
  loadLabelOrderNomenclature,
  type LabelOrderNomenclatureRow,
} from "@/lib/wms/label-order-client"
import {
  buildLabelOrderPlan,
  fmtInt,
  type LabelOrderWasteSettings,
} from "@/lib/wms/label-order-waste"
import {
  findMaterialForStickerType,
  normalizeStickerPrintKind,
  type LabelPrintMaterial,
} from "@/lib/wms/label-print-material"
import {
  inferSuzGroupFromProductName,
  parseSuzProductGroup,
  SUZ_GROUP_LABEL,
} from "@/lib/wms/label-suz-product-group"

const QUICK_QTY = [500, 1000, 5000, 10000]

type StickerKind = "single" | "block12"

function fmtWhen(iso: string | null): string {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" })
  } catch {
    return ""
  }
}

/**
 * Заказ кодов из WMS: номенклатура с GTIN, количество и плановый хвост прокрутки.
 * Автор и рабочее место пишутся в документ на сервере, здесь их только показываем.
 */
export function LabelOrderCreateDialog({
  open,
  onOpenChange,
  settings,
  materials,
  author,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: LabelOrderWasteSettings
  materials: LabelPrintMaterial[]
  author: { fio: string; position: string } | null
  onCreated: (message: string) => void
}) {
  const [query, setQuery] = useState("")
  const [items, setItems] = useState<LabelOrderNomenclatureRow[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [selected, setSelected] = useState<LabelOrderNomenclatureRow | null>(null)
  const [qty, setQty] = useState("")
  const [stickerKind, setStickerKind] = useState<StickerKind>("single")
  const [wastePercent, setWastePercent] = useState(String(settings.wastePercent))
  const [addWaste, setAddWaste] = useState(settings.addWasteToOrder)
  const [comment, setComment] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    if (!open) return
    setQuery("")
    setSelected(null)
    setQty("")
    setStickerKind("single")
    setWastePercent(String(settings.wastePercent))
    setAddWaste(settings.addWasteToOrder)
    setComment("")
    setError(null)
    // Снимок погрешности только при открытии — опрос очереди не сбрасывает форму.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot on open
  }, [open])

  const search = useCallback(async (text: string) => {
    const id = requestId.current + 1
    requestId.current = id
    setItemsLoading(true)
    try {
      const rows = await loadLabelOrderNomenclature(text)
      if (requestId.current !== id) return
      setItems(rows)
    } catch (e) {
      if (requestId.current !== id) return
      setItems([])
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (requestId.current === id) setItemsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => void search(query.trim()), query.trim() ? 250 : 0)
    return () => window.clearTimeout(t)
  }, [open, query, search])

  const plan = useMemo(
    () =>
      buildLabelOrderPlan(Number(qty) || 0, settings, {
        wastePercent: Number(wastePercent),
        addWasteToOrder: addWaste,
      }),
    [qty, settings, wastePercent, addWaste]
  )

  const material = useMemo(
    () => findMaterialForStickerType(materials, stickerKind),
    [materials, stickerKind]
  )
  const materialShort =
    material && plan.labelsQty > 0 && material.availableQty < plan.labelsQty
      ? Math.ceil(plan.labelsQty - material.availableQty)
      : 0

  const canSubmit = Boolean(selected) && plan.neededQty > 0 && !submitting

  const submit = async () => {
    if (!selected || plan.neededQty < 1) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await createLabelOrder({
        gtin: selected.gtin,
        itemCode: selected.itemCode,
        nomenclatureName: selected.name,
        stickerType: stickerKind,
        quantity: plan.neededQty,
        wastePercent: Number(wastePercent) || 0,
        addWasteToOrder: addWaste,
        comment: comment.trim(),
      })
      onOpenChange(false)
      onCreated(
        `Документ ${result.doc?.docNo ?? ""} · ${fmtInt(result.order.quantity)} кодов · расход этикетки ~${fmtInt(plan.labelsQty)}`
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-3 overflow-hidden sm:max-w-4xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Новый заказ кодов</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <User className="size-3.5" />
            <span>
              {author?.fio
                ? `${author.fio}${author.position ? ` · ${author.position}` : ""}`
                : "автор не определён — войдите в WMS, иначе документ останется без подписи"}
            </span>
            <span className="text-muted-foreground">· источник: интерфейс WMS</span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex min-h-0 min-w-0 flex-col gap-2">
            <div className="relative shrink-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Название, код или GTIN"
                className="h-9 pl-8"
              />
            </div>
            <div className="min-h-[14rem] flex-1 overflow-y-auto rounded-lg border border-border/60">
              {itemsLoading && items.length === 0 ? (
                <div className="space-y-1.5 p-2">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-11 animate-pulse rounded-md bg-muted/60" />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-1.5 p-4 text-center">
                  <PackageSearch className="size-5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">
                    Ничего не нашли. Заказать можно только позицию с GTIN — проверьте карточку
                    номенклатуры.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border/40">
                  {items.map((item) => {
                    const active = selected?.gtin === item.gtin
                    return (
                      <li key={`${item.itemCode}-${item.gtin}`}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(item)
                            const kind = normalizeStickerPrintKind(item.stickerKind)
                            if (kind) setStickerKind(kind)
                          }}
                          className={cn(
                            "flex w-full items-start gap-2 px-2.5 py-2 text-left transition-colors",
                            active ? "bg-primary/10" : "hover:bg-accent/40"
                          )}
                        >
                          <Check
                            className={cn(
                              "mt-0.5 size-3.5 shrink-0 text-primary",
                              active ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-2 text-xs font-medium text-foreground">
                              {item.name}
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                              <span className="font-mono">{item.gtin}</span>
                              {item.ordersCount > 0 ? (
                                <span>
                                  заказов {item.ordersCount}
                                  {item.lastOrderedAt ? ` · ${fmtWhen(item.lastOrderedAt)}` : ""}
                                </span>
                              ) : null}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="min-h-0 min-w-0 space-y-2.5 overflow-y-auto pr-1">
            <div className="rounded-lg border border-border/60 p-2.5">
              {selected ? (
                <>
                  <p className="line-clamp-2 text-sm font-medium text-foreground">{selected.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                    <span className="font-mono text-foreground/80">{selected.gtin}</span>
                    <span>код {selected.itemCode}</span>
                    {(() => {
                      const group =
                        parseSuzProductGroup(selected.productGroup) ||
                        inferSuzGroupFromProductName(selected.name)
                      return group ? (
                        <span>
                          ЧЗ {SUZ_GROUP_LABEL[group]} · по GTIN {selected.gtin}
                        </span>
                      ) : (
                        <span>группа ЧЗ уточнится по GTIN при подписи</span>
                      )
                    })()}
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Выберите номенклатуру слева — без GTIN СУЗ не примет заказ.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <label className="grid gap-1">
                <span className="text-xs font-medium text-foreground/80">Нужно кодов, шт</span>
                <Input
                  value={qty}
                  onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))}
                  inputMode="numeric"
                  placeholder="0"
                  className="h-9 font-semibold tabular-nums"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-foreground/80">Вид стикера</span>
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={stickerKind}
                  onChange={(e) => setStickerKind(e.target.value as StickerKind)}
                >
                  <option value="single">Единичный</option>
                  <option value="block12">Блочный</option>
                </select>
              </label>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {QUICK_QTY.map((n) => (
                <Button
                  key={n}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs tabular-nums"
                  onClick={() => setQty(String(n))}
                >
                  {fmtInt(n)}
                </Button>
              ))}
            </div>

            <div className="grid gap-2.5 sm:grid-cols-[8rem_minmax(0,1fr)]">
              <label className="grid gap-1">
                <span className="text-xs font-medium text-foreground/80">Погрешность, %</span>
                <Input
                  value={wastePercent}
                  onChange={(e) => setWastePercent(e.target.value.replace(/[^\d.,]/g, ""))}
                  inputMode="decimal"
                  className="h-9 tabular-nums"
                />
              </label>
              <label className="flex items-center justify-between gap-3 self-end rounded-lg border border-border/60 px-2.5 py-2">
                <span className="text-[11px] leading-snug text-foreground/80">
                  Добавить запас в заказ
                  <span className="block text-muted-foreground">
                    {addWaste
                      ? `закажем с запасом, на выходе ровно ${fmtInt(plan.neededQty)} годных`
                      : `закажем ровно ${fmtInt(plan.neededQty)}, хвост уйдёт из этого числа`}
                  </span>
                </span>
                <Switch checked={addWaste} onCheckedChange={(v) => setAddWaste(Boolean(v))} />
              </label>
            </div>

            <div className="rounded-lg border border-border/60 bg-muted/25 p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Заказать кодов</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {fmtInt(plan.orderQty)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Хвост прокрутки</span>
                <span className="tabular-nums text-foreground/90">{fmtInt(plan.wasteQty)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 border-t border-border/50 pt-1">
                <span className="text-muted-foreground">Расход этикетки</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {fmtInt(plan.labelsQty)}
                </span>
              </div>
              {material ? (
                <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                  Материал: {material.name}
                  {material.sizeLabel ? ` (${material.sizeLabel})` : ""} · остаток{" "}
                  {fmtInt(material.availableQty)}
                </p>
              ) : null}
              {materialShort > 0 ? (
                <p className="mt-1 flex items-start gap-1.5 text-[11px] font-medium leading-snug text-amber-700">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  Не хватает {fmtInt(materialShort)} этикеток на складе — с запасом заказ не
                  напечатается целиком.
                </p>
              ) : null}
            </div>

            <label className="grid gap-1">
              <span className="text-xs font-medium text-foreground/80">Комментарий к заказу</span>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Для какой партии, кто просил, особенности печати"
                className="min-h-[60px] text-xs"
              />
            </label>

            {error ? (
              <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter className="shrink-0 gap-2 sm:justify-between">
          <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
            <Badge variant="secondary" className="rounded px-1.5 py-0 text-[10px]">
              документ
            </Badge>
            номер, автор и время фиксируются автоматически
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Отмена
            </Button>
            <Button type="button" disabled={!canSubmit} onClick={() => void submit()}>
              {submitting ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
              Создать заказ
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
