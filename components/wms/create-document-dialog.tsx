"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ExternalLink, Loader2 } from "lucide-react"
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
import {
  createWmsDocument,
  getWmsItemDetail,
  listDirectoryNomenclatureTypes,
  listDirectoryPackagingProfiles,
  listDirectoryWarehouses,
  listItems,
  WMS_DOCUMENT_TYPE_LABEL_RU,
  type WmsDocumentTypeCode,
  type WmsItemListRow,
  type WarehouseDirectoryRow,
} from "@/lib/wms-api"
import { cn } from "@/lib/utils"

const documentTypeOptions: WmsDocumentTypeCode[] = [
  "receiving",
  "putaway",
  "picking",
  "shipping",
  "transfer",
  "issue",
  "return",
  "revision",
  "replenishment",
  "interwarehouse_transfer",
]

function readNomenclatureTypeFromAttrs(attrs: unknown): string | undefined {
  if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return undefined
  const nom = (attrs as Record<string, unknown>).nomenclature
  if (!nom || typeof nom !== "object" || Array.isArray(nom)) return undefined
  const t = (nom as Record<string, unknown>).type
  return typeof t === "string" && t.trim() ? t.trim() : undefined
}

function locationLabels(docType: WmsDocumentTypeCode): {
  source: string
  target: string
  sourceHint: string
  targetHint: string
} {
  switch (docType) {
    case "receiving":
      return {
        source: "Зона разгрузки / ворота (опционально)",
        target: "Ячейка размещения после приёмки (опционально)",
        sourceHint: "Где разгружают машину: ворота, рампа, зона входного контроля.",
        targetHint: "Если уже известно, куда разместить товар на складе — укажите код ячейки.",
      }
    case "putaway":
      return {
        source: "Откуда везём (опционально)",
        target: "Ячейка размещения (опционально)",
        sourceHint: "Промежуточная зона или ячейка откуда забирают для размещения.",
        targetHint: "Целевая ячейка хранения.",
      }
    case "picking":
    case "issue":
    case "shipping":
      return {
        source: "Ячейка отбора (опционально)",
        target: "Зона отгрузки / упаковки (опционально)",
        sourceHint: "Откуда списываем остаток.",
        targetHint: "Куда перемещают после отбора (стол упаковки, ворота).",
      }
    case "transfer":
    case "replenishment":
      return {
        source: "Ячейка-источник (опционально)",
        target: "Ячейка-назначение (опционально)",
        sourceHint: "Ячейка, с которой уходит товар.",
        targetHint: "Ячейка, куда приходит товар.",
      }
    case "return":
      return {
        source: "Зона возврата (опционально)",
        target: "Ячейка карантина / приёмки (опционально)",
        sourceHint: "Откуда оформляют возврат.",
        targetHint: "Куда кладут возвращённый товар.",
      }
    case "revision":
      return {
        source: "Ячейка для пересчёта (опционально)",
        target: "—",
        sourceHint: "Ячейка, по которой ведётся ревизия (если применимо).",
        targetHint: "",
      }
    case "interwarehouse_transfer":
      return {
        source: "Ячейка на складе-отправителе (опционально)",
        target: "Ячейка на складе-получателе (опционально)",
        sourceHint: "Уточнение внутри склада-отправителя.",
        targetHint: "Уточнение внутри склада-получателя.",
      }
    default:
      return {
        source: "Ячейка-источник (опционально)",
        target: "Ячейка-назначение (опционально)",
        sourceHint: "",
        targetHint: "",
      }
  }
}

type ItemBindingState =
  | { status: "idle" }
  | { status: "loading"; itemCode: string }
  | {
      status: "ok"
      itemCode: string
      name: string
      sku: string | null
      nomenclatureErp: string | null
      nomTypeCode: string | null
      nomTypeLabel: string | null
      packagingCode: string | null
      packagingLabel: string | null
      uomCode: string | null
      productGroup: string | null
    }
  | { status: "error"; itemCode: string; message: string }

type CreateDocumentDialogProps = {
  triggerLabel: string
  triggerClassName?: string
  triggerVariant?: "default" | "outline" | "secondary" | "ghost" | "link" | "destructive"
  title?: string
  description?: string
  defaultDocumentType?: WmsDocumentTypeCode
  lockDocumentType?: boolean
  onCreated?: () => Promise<void> | void
  /** Открыть диалог при монтировании (например переход с POS `?new=1`). */
  initialOpen?: boolean
}

export function CreateDocumentDialog({
  triggerLabel,
  triggerClassName,
  triggerVariant = "default",
  title = "Новый документ",
  description = "Создание документа с одной строкой и автоматической генерацией задания.",
  defaultDocumentType = "transfer",
  lockDocumentType = false,
  onCreated,
  initialOpen = false,
}: CreateDocumentDialogProps) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [itemSuggestions, setItemSuggestions] = useState<WmsItemListRow[]>([])
  const [itemSuggestLoading, setItemSuggestLoading] = useState(false)
  const [itemSuggestOpen, setItemSuggestOpen] = useState(false)
  const [itemSuggestNoHits, setItemSuggestNoHits] = useState(false)
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bindingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const itemFieldRef = useRef<HTMLDivElement>(null)
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseDirectoryRow[]>([])
  const [pkgLabelByCode, setPkgLabelByCode] = useState<Record<string, string>>({})
  const [typeLabelByCode, setTypeLabelByCode] = useState<Record<string, string>>({})
  const [itemBinding, setItemBinding] = useState<ItemBindingState>({ status: "idle" })

  const [form, setForm] = useState({
    documentType: defaultDocumentType,
    itemCode: "",
    qty: "1",
    sourceWarehouseCode: "",
    targetWarehouseCode: "",
    sourceLocationCode: "",
    targetLocationCode: "",
    comment: "",
    externalRef: "",
  })

  const loc = useMemo(() => locationLabels(form.documentType), [form.documentType])

  const fetchItemSuggestions = useCallback(async (q: string) => {
    const t = q.trim()
    if (t.length < 2) {
      setItemSuggestions([])
      setItemSuggestOpen(false)
      setItemSuggestNoHits(false)
      return
    }
    setItemSuggestLoading(true)
    setItemSuggestNoHits(false)
    try {
      const res = await listItems({ query: t, limit: 15 })
      const rows = res.items ?? []
      if (!itemFieldRef.current?.contains(document.activeElement)) {
        return
      }
      setItemSuggestions(rows)
      setItemSuggestNoHits(rows.length === 0)
      setItemSuggestOpen(true)
    } catch {
      setItemSuggestions([])
      setItemSuggestOpen(false)
      setItemSuggestNoHits(false)
    } finally {
      setItemSuggestLoading(false)
    }
  }, [])

  const loadDirectories = useCallback(async () => {
    try {
      const [pkg, typ] = await Promise.all([
        listDirectoryPackagingProfiles(),
        listDirectoryNomenclatureTypes(),
      ])
      const pm: Record<string, string> = {}
      for (const p of pkg.profiles || []) {
        if (p.isActive) pm[p.code.toLowerCase()] = p.name
      }
      const tm: Record<string, string> = {}
      for (const t of typ.types || []) {
        if (t.isActive) tm[t.code.toUpperCase()] = t.name
      }
      setPkgLabelByCode(pm)
      setTypeLabelByCode(tm)
    } catch {
      setPkgLabelByCode({})
      setTypeLabelByCode({})
    }
  }, [])

  const resolvePackagingLabel = useCallback(
    (code: string | null | undefined) => {
      if (!code) return null
      const k = code.toLowerCase()
      return pkgLabelByCode[k] ?? code
    },
    [pkgLabelByCode]
  )

  const resolveTypeLabel = useCallback(
    (code: string | null | undefined) => {
      if (!code) return null
      const k = code.toUpperCase()
      return typeLabelByCode[k] ?? code
    },
    [typeLabelByCode]
  )

  useEffect(() => {
    setItemBinding((prev) => {
      if (prev.status !== "ok") return prev
      return {
        ...prev,
        nomTypeLabel: prev.nomTypeCode ? resolveTypeLabel(prev.nomTypeCode) : null,
        packagingLabel: prev.packagingCode ? resolvePackagingLabel(prev.packagingCode) : null,
      }
    })
  }, [pkgLabelByCode, typeLabelByCode, resolveTypeLabel, resolvePackagingLabel])

  const loadItemBinding = useCallback(
    async (itemCode: string) => {
      const code = itemCode.trim()
      if (!code) {
        setItemBinding({ status: "idle" })
        return
      }
      setItemBinding({ status: "loading", itemCode: code })
      try {
        const d = await getWmsItemDetail(code)
        const it = d.item as Record<string, unknown>
        const name = String(it.name ?? "")
        const sku = it.sku == null ? null : String(it.sku)
        const nomenclatureErp = it.nomenclature == null ? null : String(it.nomenclature)
        const packagingCode = it.packagingProfile == null ? null : String(it.packagingProfile)
        const uomCode = it.uomCode == null ? null : String(it.uomCode)
        const productGroup = it.productGroup == null ? null : String(it.productGroup)
        const nomTypeCode = readNomenclatureTypeFromAttrs(it.itemAttrs) ?? null
        setItemBinding({
          status: "ok",
          itemCode: code,
          name,
          sku,
          nomenclatureErp,
          nomTypeCode,
          nomTypeLabel: nomTypeCode ? resolveTypeLabel(nomTypeCode) : null,
          packagingCode,
          packagingLabel: packagingCode ? resolvePackagingLabel(packagingCode) : null,
          uomCode,
          productGroup,
        })
      } catch {
        setItemBinding({
          status: "error",
          itemCode: code,
          message: "Позиция с таким кодом не найдена — проверьте код или создайте номенклатуру.",
        })
      }
    },
    [resolvePackagingLabel, resolveTypeLabel]
  )

  useEffect(() => {
    return () => {
      if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current)
      if (bindingTimerRef.current) clearTimeout(bindingTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void listDirectoryWarehouses()
      .then((r) => setWarehouseOptions(r.warehouses || []))
      .catch(() => setWarehouseOptions([]))
    void loadDirectories()
  }, [open, loadDirectories])

  function resetForm(nextType = defaultDocumentType) {
    setForm({
      documentType: nextType,
      itemCode: "",
      qty: "1",
      sourceWarehouseCode: "",
      targetWarehouseCode: "",
      sourceLocationCode: "",
      targetLocationCode: "",
      comment: "",
      externalRef: "",
    })
    setError(null)
    setItemSuggestions([])
    setItemSuggestOpen(false)
    setItemSuggestLoading(false)
    setItemSuggestNoHits(false)
    setItemBinding({ status: "idle" })
  }

  useEffect(() => {
    if (!initialOpen) return
    resetForm(defaultDocumentType)
    setOpen(true)
  }, [initialOpen, defaultDocumentType])

  function scheduleBindingLoad(rawCode: string) {
    if (bindingTimerRef.current) clearTimeout(bindingTimerRef.current)
    const t = rawCode.trim()
    if (t.length < 2) {
      setItemBinding({ status: "idle" })
      return
    }
    bindingTimerRef.current = setTimeout(() => {
      void loadItemBinding(t)
    }, 400)
  }

  function onItemCodeInput(value: string) {
    setForm((prev) => ({ ...prev, itemCode: value }))
    setError(null)
    scheduleBindingLoad(value)
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current)
    const trimmed = value.trim()
    if (trimmed.length < 2) {
      setItemSuggestions([])
      setItemSuggestOpen(false)
      setItemSuggestNoHits(false)
      return
    }
    suggestTimerRef.current = setTimeout(() => {
      void fetchItemSuggestions(value)
    }, 280)
  }

  function pickItem(row: WmsItemListRow) {
    setForm((prev) => ({ ...prev, itemCode: row.itemCode }))
    setItemSuggestions([])
    setItemSuggestOpen(false)
    setItemSuggestNoHits(false)
    setError(null)
    void loadItemBinding(row.itemCode)
  }

  async function submit() {
    const qty = Number(form.qty)
    if (!form.itemCode.trim()) {
      setError("Выберите товар из подсказок или введите точный код позиции")
      return
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Количество должно быть больше 0")
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      try {
        await getWmsItemDetail(form.itemCode.trim())
      } catch {
        setError("Позиция не найдена — укажите код из справочника номенклатуры или выберите строку из подсказок.")
        return
      }
      await createWmsDocument({
        documentType: form.documentType,
        externalRef: form.externalRef.trim() || undefined,
        comment: form.comment.trim() || undefined,
        sourceWarehouseCode: form.sourceWarehouseCode.trim() || undefined,
        targetWarehouseCode: form.targetWarehouseCode.trim() || undefined,
        sourceLocationCode: form.sourceLocationCode.trim() || undefined,
        targetLocationCode: form.targetLocationCode.trim() || undefined,
        lines: [
          {
            itemCode: form.itemCode.trim(),
            qty,
            sourceLocationCode: form.sourceLocationCode.trim() || undefined,
            targetLocationCode: form.targetLocationCode.trim() || undefined,
            comment: form.comment.trim() || undefined,
          },
        ],
      })
      setOpen(false)
      resetForm(defaultDocumentType)
      await onCreated?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать документ")
    } finally {
      setSubmitting(false)
    }
  }

  const warehousePickerTypes: WmsDocumentTypeCode[] = ["transfer", "interwarehouse_transfer", "shipping", "issue"]
  const showWarehousePickers = warehousePickerTypes.includes(form.documentType)

  return (
    <>
      <Button
        variant={triggerVariant}
        className={triggerClassName}
        onClick={() => {
          resetForm(defaultDocumentType)
          setOpen(true)
        }}
      >
        {triggerLabel}
      </Button>

      <Dialog open={open} onOpenChange={(next) => !submitting && setOpen(next)}>
        <DialogContent className="max-h-[min(90vh,720px)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <label className="text-sm font-medium text-foreground">
              Тип документа
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.documentType}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, documentType: e.target.value as WmsDocumentTypeCode }))
                }
                disabled={submitting || lockDocumentType}
              >
                {documentTypeOptions.map((value) => (
                  <option key={value} value={value}>
                    {WMS_DOCUMENT_TYPE_LABEL_RU[value]} ({value})
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-1">
              <label className="text-sm font-medium text-foreground" htmlFor="create-doc-item">
                Номенклатура / товар
              </label>
              <p className="text-xs text-muted-foreground">
                Введите не менее 2 символов — появятся подсказки по коду, наименованию или коду из ERP. Можно ввести точный
                код позиции без выбора из списка — реквизиты подтянутся автоматически.
              </p>
              <div ref={itemFieldRef} className="relative">
                <Input
                  id="create-doc-item"
                  value={form.itemCode}
                  onChange={(e) => onItemCodeInput(e.target.value)}
                  onFocus={() => {
                    if (form.itemCode.trim().length >= 2) void fetchItemSuggestions(form.itemCode)
                  }}
                  onBlur={() => {
                    if (suggestTimerRef.current) {
                      clearTimeout(suggestTimerRef.current)
                      suggestTimerRef.current = null
                    }
                    window.setTimeout(() => setItemSuggestOpen(false), 180)
                  }}
                  placeholder="Например: пробка или RES-CORK-0001"
                  disabled={submitting}
                  autoComplete="off"
                  className="mt-1"
                />
                {itemSuggestOpen &&
                  form.itemCode.trim().length >= 2 &&
                  (itemSuggestLoading || itemSuggestions.length > 0 || itemSuggestNoHits) && (
                    <ul
                      className={cn(
                        "absolute left-0 right-0 top-full z-[100] mt-1 max-h-56 overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md",
                        "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95"
                      )}
                      role="listbox"
                    >
                      {itemSuggestLoading && itemSuggestions.length === 0 && !itemSuggestNoHits && (
                        <li className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                          Поиск…
                        </li>
                      )}
                      {itemSuggestions.map((row) => {
                        const nomType = readNomenclatureTypeFromAttrs(row.itemAttrs)
                        return (
                          <li key={row.itemCode} role="option">
                            <button
                              type="button"
                              className="flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => pickItem(row)}
                            >
                              <span className="font-medium leading-tight text-foreground">{row.name}</span>
                              <span className="font-mono text-xs text-muted-foreground">{row.itemCode}</span>
                              {row.sku ? (
                                <span className="text-xs text-muted-foreground">Артикул: {row.sku}</span>
                              ) : null}
                              {row.nomenclature ? (
                                <span className="text-xs text-muted-foreground">Код ERP/1С: {row.nomenclature}</span>
                              ) : null}
                              {nomType ? (
                                <span className="text-xs text-muted-foreground">
                                  Тип: {resolveTypeLabel(nomType)} ({nomType})
                                </span>
                              ) : null}
                              {row.packagingProfile ? (
                                <span className="text-xs text-muted-foreground">
                                  Упаковка: {resolvePackagingLabel(row.packagingProfile)} ({row.packagingProfile})
                                </span>
                              ) : null}
                            </button>
                          </li>
                        )
                      })}
                      {!itemSuggestLoading && itemSuggestNoHits && (
                        <li className="px-3 py-2 text-sm text-muted-foreground">
                          Ничего не найдено — проверьте написание или создайте позицию в справочнике номенклатуры.
                        </li>
                      )}
                    </ul>
                  )}
              </div>
            </div>

            {(itemBinding.status === "loading" ||
              itemBinding.status === "ok" ||
              itemBinding.status === "error") && (
              <div className="rounded-lg border border-border bg-secondary/30 p-3 text-sm">
                <div className="mb-2 font-medium text-foreground">Привязка к номенклатуре</div>
                {itemBinding.status === "loading" && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Загрузка карточки…
                  </div>
                )}
                {itemBinding.status === "error" && (
                  <p className="text-destructive">{itemBinding.message}</p>
                )}
                {itemBinding.status === "ok" && (
                  <dl className="grid gap-1.5 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Код WMS</dt>
                      <dd className="font-mono text-foreground">{itemBinding.itemCode}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Наименование</dt>
                      <dd className="max-w-[60%] text-right text-foreground">{itemBinding.name}</dd>
                    </div>
                    {itemBinding.nomenclatureErp ? (
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Код в ERP</dt>
                        <dd className="text-right font-mono text-foreground">{itemBinding.nomenclatureErp}</dd>
                      </div>
                    ) : null}
                    {itemBinding.nomTypeCode ? (
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Тип номенклатуры</dt>
                        <dd className="text-right text-foreground">
                          {itemBinding.nomTypeLabel ?? itemBinding.nomTypeCode}{" "}
                          <span className="font-mono text-muted-foreground">({itemBinding.nomTypeCode})</span>
                        </dd>
                      </div>
                    ) : null}
                    {itemBinding.packagingCode ? (
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Профиль упаковки</dt>
                        <dd className="text-right text-foreground">
                          {itemBinding.packagingLabel ?? itemBinding.packagingCode}{" "}
                          <span className="font-mono text-muted-foreground">({itemBinding.packagingCode})</span>
                        </dd>
                      </div>
                    ) : null}
                    {itemBinding.sku ? (
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Артикул / SKU</dt>
                        <dd className="text-right font-mono text-foreground">{itemBinding.sku}</dd>
                      </div>
                    ) : null}
                    {itemBinding.uomCode ? (
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Ед. изм.</dt>
                        <dd className="font-mono text-foreground">{itemBinding.uomCode}</dd>
                      </div>
                    ) : null}
                    {itemBinding.productGroup ? (
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Группа</dt>
                        <dd className="text-right text-foreground">{itemBinding.productGroup}</dd>
                      </div>
                    ) : null}
                    <div className="pt-1">
                      <Link
                        href={`/nomenclature/${encodeURIComponent(itemBinding.itemCode)}`}
                        className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Карточка номенклатуры
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  </dl>
                )}
              </div>
            )}

            <label className="text-sm font-medium text-foreground">
              Количество
              <Input
                type="number"
                min={0.001}
                step="any"
                value={form.qty}
                onChange={(e) => setForm((prev) => ({ ...prev, qty: e.target.value }))}
                disabled={submitting}
              />
            </label>

            {showWarehousePickers && (
              <div className="rounded-lg border border-border bg-secondary/20 p-3">
                <div className="mb-2 text-sm font-medium text-foreground">Склады (справочник)</div>
                <p className="mb-3 text-xs text-muted-foreground">
                  Выберите код из подсказок или введите вручную — данные из «Настройки → Справочники → Склады».
                </p>
                <label className="mb-3 block text-sm font-medium text-foreground">
                  Склад-отправитель
                  <Input
                    className="mt-1 font-mono"
                    list="create-doc-wh-src"
                    value={form.sourceWarehouseCode}
                    onChange={(e) => setForm((prev) => ({ ...prev, sourceWarehouseCode: e.target.value }))}
                    placeholder="Код склада"
                    disabled={submitting}
                    autoComplete="off"
                  />
                  <datalist id="create-doc-wh-src">
                    {warehouseOptions.map((w) => (
                      <option key={w.id} value={w.code}>
                        {w.name}
                      </option>
                    ))}
                  </datalist>
                </label>
                <label className="block text-sm font-medium text-foreground">
                  Склад-получатель
                  <Input
                    className="mt-1 font-mono"
                    list="create-doc-wh-tgt"
                    value={form.targetWarehouseCode}
                    onChange={(e) => setForm((prev) => ({ ...prev, targetWarehouseCode: e.target.value }))}
                    placeholder="Код склада"
                    disabled={submitting}
                    autoComplete="off"
                  />
                  <datalist id="create-doc-wh-tgt">
                    {warehouseOptions.map((w) => (
                      <option key={w.id} value={w.code}>
                        {w.name}
                      </option>
                    ))}
                  </datalist>
                </label>
              </div>
            )}

            <div className="grid gap-2">
              <label className="text-sm font-medium text-foreground">
                {loc.source}
                <Input
                  value={form.sourceLocationCode}
                  onChange={(e) => setForm((prev) => ({ ...prev, sourceLocationCode: e.target.value }))}
                  placeholder="Например: GATE-1"
                  disabled={submitting}
                  className="mt-1"
                />
              </label>
              {loc.sourceHint ? <p className="text-xs text-muted-foreground">{loc.sourceHint}</p> : null}
            </div>

            {loc.target !== "—" ? (
              <div className="grid gap-2">
                <label className="text-sm font-medium text-foreground">
                  {loc.target}
                  <Input
                    value={form.targetLocationCode}
                    onChange={(e) => setForm((prev) => ({ ...prev, targetLocationCode: e.target.value }))}
                    placeholder="Например: A-01-02"
                    disabled={submitting}
                    className="mt-1"
                  />
                </label>
                {loc.targetHint ? <p className="text-xs text-muted-foreground">{loc.targetHint}</p> : null}
              </div>
            ) : null}

            <label className="text-sm font-medium text-foreground">
              Внешняя ссылка (опционально)
              <Input
                value={form.externalRef}
                onChange={(e) => setForm((prev) => ({ ...prev, externalRef: e.target.value }))}
                placeholder="Например: ASN-7788"
                disabled={submitting}
                className="mt-1"
              />
            </label>

            <label className="text-sm font-medium text-foreground">
              Комментарий (опционально)
              <Input
                value={form.comment}
                onChange={(e) => setForm((prev) => ({ ...prev, comment: e.target.value }))}
                placeholder="Комментарий к документу"
                disabled={submitting}
                className="mt-1"
              />
            </label>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Отмена
            </Button>
            <Button onClick={() => void submit()} disabled={submitting}>
              {submitting ? "Создание..." : "Создать документ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
