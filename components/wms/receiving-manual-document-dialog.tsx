"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { FilePlus2, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { NomenclatureGroupBrowser } from "@/components/wms/nomenclature-group-browser"
import { WmsLocationPicker } from "@/components/wms/wms-pickers"
import {
  getSiteCode,
  listDirectorySuppliers,
  listItems,
  postManualReceivingDocument,
  resolveReceivingMarkingCode,
  saveStandardizationAlias,
  searchItemAliases,
  type ItemAliasSearchHit,
  type ManualReceivingDocumentLineInput,
  type SupplierDirectoryRow,
  type WmsItemListRow,
} from "@/lib/wms-api"
import { TnvedPicker } from "@/components/wms/tnved-picker"
import { type OperatorNomenclatureGroup } from "@/lib/nomenclature-group-catalog"
import { getReceivingTargetLocationCode } from "@/lib/receiving-settings"
import { cn } from "@/lib/utils"

type ManualLine = ManualReceivingDocumentLineInput & {
  key: string
  itemName: string
  sourceLabel?: string | null
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (documentId: string) => void
}

type ReceivingCodeSource = "crpt" | "barcode" | "none"

const CODE_SOURCE_LABEL: Record<ReceivingCodeSource, string> = {
  crpt: "Код ЧЗ",
  barcode: "Штрихкод / внутренний код",
  none: "Без кода",
}

function parseQty(value: string): number | null {
  const n = Number(value.trim().replace(",", "."))
  return Number.isFinite(n) && n > 0 ? n : null
}

function isoDateFromInput(value: string): string | null {
  if (!value.trim()) return null
  const d = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function dateInputFromIso(value: string | null | undefined): string {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return d.toISOString().slice(0, 10)
}

function isEmissionRequiredGroup(group: OperatorNomenclatureGroup | null): boolean {
  if (!group) return false
  const text = [group.code, group.name, ...(group.aliasCodes ?? [])].join(" ").toLowerCase()
  return (
    text.includes("water") ||
    text.includes("softdrink") ||
    text.includes("drink") ||
    text.includes("напит") ||
    text.includes("вода")
  )
}

function lineBatchLabel(itemCode: string, emissionDate: string): string | null {
  const iso = isoDateFromInput(emissionDate)
  if (!iso) return null
  const day = iso.slice(0, 10).replace(/-/g, "")
  const safe = itemCode.trim().replace(/[^A-Za-zА-Яа-я0-9_-]+/g, "-").slice(0, 40)
  return `RCV-${day}-${safe}`
}

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
}

function manualReceivingItemTitle(item: WmsItemListRow): string {
  return item.name || item.itemCode
}

function manualReceivingItemSubtitle(item: WmsItemListRow): string {
  return [item.itemCode, item.itemGroupCode ?? item.productGroup, item.isMarked ? "ЧЗ" : null]
    .filter(Boolean)
    .join(" · ")
}

export function ReceivingManualDocumentDialog({ open, onOpenChange, onCreated }: Props) {
  const siteCode = getSiteCode()
  const [group, setGroup] = useState<OperatorNomenclatureGroup | null>(null)
  const [selectedItem, setSelectedItem] = useState<WmsItemListRow | null>(null)
  const [targetLocationCode, setTargetLocationCode] = useState("")
  const [codeSource, setCodeSource] = useState<ReceivingCodeSource>("crpt")
  const [qty, setQty] = useState("")
  const [emissionDate, setEmissionDate] = useState("")
  const [lotExpiryDate, setLotExpiryDate] = useState("")
  const [markingCode, setMarkingCode] = useState("")
  const [supplierCode, setSupplierCode] = useState("")
  const [supplierName, setSupplierName] = useState("")
  const [supplierArticle, setSupplierArticle] = useState("")
  const [supplierItemName, setSupplierItemName] = useState("")
  const [visualDescription, setVisualDescription] = useState("")
  const [tnvedCode, setTnvedCode] = useState("")
  const [aliasHits, setAliasHits] = useState<ItemAliasSearchHit[]>([])
  const [aliasSearching, setAliasSearching] = useState(false)
  const [comment, setComment] = useState("")
  const [lines, setLines] = useState<ManualLine[]>([])
  const [checking, setChecking] = useState(false)
  const [aliasSaving, setAliasSaving] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [crptInfo, setCrptInfo] = useState<string | null>(null)
  const [createdDocumentId, setCreatedDocumentId] = useState<string | null>(null)
  const [suppliers, setSuppliers] = useState<SupplierDirectoryRow[]>([])

  useEffect(() => {
    if (!open) return
    setTargetLocationCode((getReceivingTargetLocationCode() || "").trim())
    void listDirectorySuppliers({ activeOnly: true })
      .then((r) => setSuppliers(r.suppliers || []))
      .catch(() => setSuppliers([]))
  }, [open])

  function onSupplierChange(code: string) {
    setSupplierCode(code)
    const row = suppliers.find((s) => s.code === code)
    setSupplierName(row?.name ?? "")
  }

  const emissionRequired = isEmissionRequiredGroup(group)
  const qtyNumber = parseQty(qty)
  const totalQty = useMemo(() => lines.reduce((sum, line) => sum + line.qty, 0), [lines])

  function resetLineDraft() {
    setSelectedItem(null)
    setQty("")
    setEmissionDate("")
    setLotExpiryDate("")
    setMarkingCode("")
    setSupplierArticle("")
    setSupplierItemName("")
    setVisualDescription("")
    setTnvedCode("")
    setAliasHits([])
    setCrptInfo(null)
  }

  useEffect(() => {
    const q = supplierItemName.trim()
    if (q.length < 3) {
      setAliasHits([])
      return
    }
    const t = setTimeout(() => {
      setAliasSearching(true)
      searchItemAliases({
        query: q,
        supplierCode: supplierCode.trim() || undefined,
        supplierName: supplierName.trim() || undefined,
      })
        .then((r) => setAliasHits(r.hits ?? []))
        .catch(() => setAliasHits([]))
        .finally(() => setAliasSearching(false))
    }, 350)
    return () => clearTimeout(t)
  }, [supplierItemName, supplierCode, supplierName])

  async function pickAliasHit(hit: ItemAliasSearchHit) {
    const found = await listItems({ query: hit.itemCode, limit: 5 })
    const item = (found.items ?? []).find((it) => it.itemCode === hit.itemCode) ?? found.items?.[0] ?? null
    if (item) setSelectedItem(item)
    setAliasHits([])
  }

  function handleGroupChange(next: OperatorNomenclatureGroup | null) {
    setGroup(next)
    setSelectedItem(null)
    setCrptInfo(null)
  }

  async function checkCrpt() {
    const code = markingCode.trim()
    if (!code) {
      setError("Введите код маркировки для проверки ЧЗ")
      return
    }
    setChecking(true)
    setError(null)
    setCrptInfo(null)
    try {
      const res = await resolveReceivingMarkingCode(code)
      const itemCode = res.primaryItem.itemCode
      const itemName = res.primaryItem.name
      if (res.expiry.emissionAt) setEmissionDate(dateInputFromIso(res.expiry.emissionAt))
      if (res.expiry.expiresAt) setLotExpiryDate(dateInputFromIso(res.expiry.expiresAt))
      const found = await listItems({ query: itemCode, limit: 10 })
      const item = (found.items ?? []).find((it) => it.itemCode === itemCode) ?? found.items?.[0] ?? null
      if (item) setSelectedItem(item)
      setCrptInfo(
        [
          `${itemName} · ${itemCode}`,
          res.expiry.emissionAt ? `эмиссия ${dateInputFromIso(res.expiry.emissionAt)}` : null,
          res.expiry.expiresAt ? `годен до ${dateInputFromIso(res.expiry.expiresAt)}` : null,
          res.expiry.message,
          res.warnings.length > 0 ? res.warnings.join("; ") : null,
        ]
          .filter(Boolean)
          .join(" · ")
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось проверить код в ЧЗ")
    } finally {
      setChecking(false)
    }
  }

  async function saveAliasIfNeeded(item: WmsItemListRow) {
    const sourceCode = markingCode.trim()
    const aliasName = supplierItemName.trim()
    const article = supplierArticle.trim()
    const supplier = supplierName.trim()
    const supplierCodeValue = supplierCode.trim()

    if (codeSource === "crpt" && !aliasName && !article) return null
    if (codeSource !== "crpt" && !aliasName && !article && !sourceCode) {
      throw new Error("Для приёмки без ЧЗ укажите входящее название, артикул поставщика или код")
    }

    setAliasSaving(true)
    try {
      return await saveStandardizationAlias({
        itemCode: item.itemCode,
        supplierCode: supplierCodeValue || null,
        supplierName: supplier || null,
        supplierArticle: article || null,
        supplierItemName: aliasName || article || sourceCode || null,
        sourceCode: sourceCode || null,
        codeSource,
        linkBarcode: codeSource === "barcode" && Boolean(sourceCode),
        note: `Создано из ручной приёмки: ${CODE_SOURCE_LABEL[codeSource]}`,
      })
    } finally {
      setAliasSaving(false)
    }
  }

  async function addLine() {
    setError(null)
    if (!group) {
      setError("Сначала выберите группу номенклатуры")
      return
    }
    if (!selectedItem) {
      setError("Выберите позицию номенклатуры")
      return
    }
    if (qtyNumber == null) {
      setError("Введите количество больше нуля")
      return
    }
    if (emissionRequired && !isoDateFromInput(emissionDate)) {
      setError("Для воды и напитков нужна дата эмиссии: введите вручную или проверьте код ЧЗ")
      return
    }
    if (codeSource === "barcode" && !markingCode.trim()) {
      setError("Введите штрихкод или внутренний код поставщика")
      return
    }
    if (codeSource !== "crpt" && !supplierItemName.trim() && !supplierArticle.trim() && !markingCode.trim()) {
      setError("Для приёмки без ЧЗ нужно сохранить хотя бы один признак стандартизации")
      return
    }
    try {
      await saveAliasIfNeeded(selectedItem)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить алиас стандартизации")
      return
    }
    const batchLabel = lineBatchLabel(selectedItem.itemCode, emissionDate)
    setLines((prev) => [
      ...prev,
      {
        key: `${Date.now()}-${selectedItem.itemCode}-${prev.length}`,
        itemCode: selectedItem.itemCode,
        itemName: selectedItem.name,
        qty: qtyNumber,
        batchLabel,
        emissionAt: isoDateFromInput(emissionDate),
        lotExpiryAt: isoDateFromInput(lotExpiryDate),
        markingCode: markingCode.trim() || null,
        comment:
          codeSource !== "crpt"
            ? [
                CODE_SOURCE_LABEL[codeSource],
                supplierName.trim() ? `поставщик: ${supplierName.trim()}` : null,
                supplierItemName.trim() ? `входящее имя: ${supplierItemName.trim()}` : null,
                supplierArticle.trim() ? `артикул: ${supplierArticle.trim()}` : null,
                visualDescription.trim() ? `визуально: ${visualDescription.trim()}` : null,
                tnvedCode.trim() ? `ТН ВЭД: ${tnvedCode.trim()}` : null,
              ]
                .filter(Boolean)
                .join("; ")
            : null,
        sourceLabel: CODE_SOURCE_LABEL[codeSource],
      },
    ])
    resetLineDraft()
  }

  async function submit() {
    setError(null)
    setCreatedDocumentId(null)
    if (!targetLocationCode.trim()) {
      setError("Укажите ячейку приёмки")
      return
    }
    if (lines.length === 0) {
      setError("Добавьте хотя бы одну позицию")
      return
    }
    setSaving(true)
    try {
      const res = await postManualReceivingDocument({
        targetLocationCode,
        comment,
        groupCode: group?.code ?? null,
        groupName: group?.name ?? null,
        receiptAt: new Date().toISOString(),
        lines,
      })
      setCreatedDocumentId(res.documentId)
      onCreated?.(res.documentId)
      setLines([])
      resetLineDraft()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать документ приёмки")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="flex h-[92vh] max-h-[92vh] w-[calc(100vw-16px)] max-w-[min(1180px,calc(100vw-24px))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1180px,calc(100vw-24px))]">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <FilePlus2 className="h-5 w-5" />
            Ручной документ приёмки
          </DialogTitle>
          <DialogDescription>
            Выберите группу, добавьте позиции из номенклатуры и проведите приход на ячейку склада.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_390px]">
          <div className="min-h-0 overflow-y-auto px-6 py-4">
            <NomenclatureGroupBrowser
              selectedItemCode={selectedItem?.itemCode ?? null}
              onSelectItem={setSelectedItem}
              stockOnly={false}
              onGroupChange={handleGroupChange}
              searchPlaceholder="Название, артикул или GTIN для приёмки"
              renderItemTitle={manualReceivingItemTitle}
              renderItemSubtitle={manualReceivingItemSubtitle}
            />
          </div>

          <div className="min-h-0 overflow-y-auto border-l border-border bg-muted/20 px-5 py-4">
            <div className="space-y-4">
              <WmsLocationPicker
                siteCode={siteCode}
                label="Ячейка приёмки"
                value={targetLocationCode}
                onChange={setTargetLocationCode}
              />

                <div className="rounded-xl border border-border bg-card p-3">
                <div className="mb-3 rounded-lg border border-border/70 bg-background/70 p-3">
                  <div className="mb-2 text-sm font-semibold">Идентификация входящего товара</div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Что сканируем / чего нет</Label>
                    <select
                      value={codeSource}
                      onChange={(e) => {
                        setCodeSource(e.target.value as ReceivingCodeSource)
                        setCrptInfo(null)
                        setError(null)
                      }}
                      className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                    >
                      <option value="crpt">{CODE_SOURCE_LABEL.crpt}</option>
                      <option value="barcode">{CODE_SOURCE_LABEL.barcode}</option>
                      <option value="none">{CODE_SOURCE_LABEL.none}</option>
                    </select>
                  </div>

                  {codeSource !== "crpt" ? (
                    <div className="mt-3 space-y-3">
                      {codeSource === "barcode" ? (
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase text-muted-foreground">
                            Штрихкод / внутренний код
                          </Label>
                          <Input
                            value={markingCode}
                            onChange={(e) => setMarkingCode(e.target.value)}
                            placeholder="Сканируйте или введите код"
                          />
                        </div>
                      ) : null}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="space-y-1 sm:col-span-2">
                          <Label className="text-[10px] uppercase text-muted-foreground">Контрагент</Label>
                          <select
                            value={supplierCode}
                            onChange={(e) => onSupplierChange(e.target.value)}
                            className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                          >
                            <option value="">Выберите контрагента…</option>
                            {suppliers.map((s) => (
                              <option key={s.code} value={s.code}>
                                {s.name} ({s.code})
                              </option>
                            ))}
                          </select>
                          {suppliers.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              Справочник пуст —{" "}
                              <Link href="/settings?section=directories&dirTab=suppliers" className="text-primary underline-offset-2 hover:underline">
                                добавьте контрагента
                              </Link>
                              .
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase text-muted-foreground">
                          Как назвал поставщик (алиас)
                        </Label>
                        <Input
                          value={supplierItemName}
                          onChange={(e) => setSupplierItemName(e.target.value)}
                          placeholder="рукав салатовый"
                        />
                        {aliasSearching ? (
                          <p className="text-xs text-muted-foreground">Ищем по алиасам…</p>
                        ) : aliasHits.length > 0 ? (
                          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2">
                            <p className="mb-1 text-[10px] font-medium uppercase text-emerald-800">
                              Уже принимали раньше
                            </p>
                            <ul className="space-y-1">
                              {aliasHits.slice(0, 4).map((hit) => (
                                <li key={`${hit.itemCode}-${hit.aliasName}`}>
                                  <button
                                    type="button"
                                    className="w-full rounded-md px-2 py-1 text-left text-xs hover:bg-emerald-500/10"
                                    onClick={() => void pickAliasHit(hit)}
                                  >
                                    <span className="font-medium">{hit.aliasName}</span>
                                    <span className="text-muted-foreground">
                                      {" "}
                                      → {hit.itemName} ({hit.itemCode})
                                    </span>
                                    {hit.supplierName ? (
                                      <span className="block text-[10px] text-muted-foreground">
                                        {hit.supplierName}
                                      </span>
                                    ) : null}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase text-muted-foreground">
                          Визуально (как выглядит)
                        </Label>
                        <Input
                          value={visualDescription}
                          onChange={(e) => setVisualDescription(e.target.value)}
                          placeholder="шланг зелёный, ПВХ"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase text-muted-foreground">ТН ВЭД</Label>
                        <TnvedPicker value={tnvedCode} onChange={setTnvedCode} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase text-muted-foreground">Артикул поставщика</Label>
                        <Input
                          value={supplierArticle}
                          onChange={(e) => setSupplierArticle(e.target.value)}
                          placeholder="если есть"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        После выбора эталона строка сохранит алиас: входящее название/артикул → стандартная
                        номенклатура WMS.
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">Позиция</div>
                    <div className="text-xs text-muted-foreground">
                      {group ? group.name : "Сначала выберите группу слева"}
                    </div>
                  </div>
                  {emissionRequired ? <Badge variant="secondary">нужна эмиссия</Badge> : null}
                </div>

                {selectedItem ? (
                  <div className="mb-3 rounded-lg border border-primary/30 bg-primary/5 p-2 text-sm">
                    <div className="font-medium leading-snug">{selectedItem.name}</div>
                    <div className="mt-0.5 font-mono text-xs text-muted-foreground">{selectedItem.itemCode}</div>
                  </div>
                ) : (
                  <div className="mb-3 rounded-lg border border-dashed p-2 text-sm text-muted-foreground">
                    Выберите позицию в списке номенклатуры.
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Количество</Label>
                    <Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" placeholder="1000" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Дата эмиссии</Label>
                    <Input
                      type="date"
                      value={emissionDate}
                      onChange={(e) => setEmissionDate(e.target.value)}
                      className={cn(emissionRequired && !emissionDate && "border-amber-400")}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-[10px] uppercase text-muted-foreground">Годен до (срок годности партии)</Label>
                    <Input
                      type="date"
                      value={lotExpiryDate}
                      onChange={(e) => setLotExpiryDate(e.target.value)}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Если пусто — срок посчитается от даты эмиссии и «срока годности, дней» в карточке номенклатуры.
                    </p>
                  </div>
                </div>

                {emissionRequired && codeSource === "crpt" ? (
                  <div className="mt-3 space-y-2 rounded-lg border border-border/70 bg-background/60 p-2">
                    <Label className="text-[10px] uppercase text-muted-foreground">Проверить код в ЧЗ</Label>
                    <div className="flex gap-2">
                      <Input
                        value={markingCode}
                        onChange={(e) => setMarkingCode(e.target.value)}
                        placeholder="Отсканируйте DataMatrix"
                      />
                      <Button type="button" variant="outline" onClick={() => void checkCrpt()} disabled={checking}>
                        {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                      </Button>
                    </div>
                    {crptInfo ? <p className="text-xs text-emerald-800">{crptInfo}</p> : null}
                  </div>
                ) : null}

                <Button type="button" className="mt-3 w-full rounded-xl" onClick={addLine}>
                  {aliasSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
                  {aliasSaving ? "Сохраняем алиас..." : "Добавить позицию"}
                </Button>
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] uppercase text-muted-foreground">Комментарий к документу</Label>
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
              </div>

              <div className="rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <div className="text-sm font-semibold">Строки документа</div>
                  <div className="text-xs text-muted-foreground">
                    {lines.length} поз. · {fmtQty(totalQty)} шт
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto p-2">
                  {lines.length === 0 ? (
                    <p className="px-1 py-2 text-sm text-muted-foreground">Пока нет строк.</p>
                  ) : (
                    <div className="space-y-2">
                      {lines.map((line) => (
                        <div key={line.key} className="flex gap-2 rounded-lg border border-border/70 p-2 text-sm">
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{line.itemName}</div>
                            <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{line.itemCode}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {fmtQty(line.qty)} шт
                              {line.emissionAt ? ` · эмиссия ${dateInputFromIso(line.emissionAt)}` : ""}
                              {line.lotExpiryAt ? ` · годен до ${dateInputFromIso(line.lotExpiryAt)}` : ""}
                              {line.sourceLabel ? ` · ${line.sourceLabel}` : ""}
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={() => setLines((prev) => prev.filter((x) => x.key !== line.key))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {error ? (
                <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
              ) : null}
              {createdDocumentId ? (
                <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  Документ создан:{" "}
                  <Link className="font-semibold underline" href={`/documents/${createdDocumentId}`}>
                    {createdDocumentId}
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Закрыть
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={saving || lines.length === 0}>
            {saving ? "Создаём..." : "Создать и провести"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
