"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CalendarClock, Check, Loader2, MapPin, PackageSearch, Save, Search, Settings2, SlidersHorizontal } from "lucide-react"
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
  createOperationalTaskBatch,
  fetchFgPickPlan,
  listItems,
  newRequestId,
  type FgPickPlanPreview,
  type WmsItemListRow,
} from "@/lib/wms-api"
import { ErpTransferHeaderFields } from "@/components/wms/erp-transfer-header-fields"
import {
  createErpTransferOrder,
  listErpTransferOrders,
  saveErpTransferSettings,
  type ErpTransferOrderRow,
  type ErpWarehouse,
} from "@/lib/wms/one-c-erp-client"
import {
  DEFAULT_TRANSFER_HEADER,
  emptyErpCatalogs,
  headerFromSettings,
  settingsFromHeader,
  type ErpTransferCatalogs,
  type TransferHeaderFields,
} from "@/lib/wms/one-c-transfer-fields"
import {
  OPERATION_TYPE_LABEL,
  SHELF_LIFE_UNIT_LABEL,
  TASK_CONSTRUCTOR_FIELD_META,
  computeExpiryIso,
  formatRuDate,
  hasField,
  loadTaskConstructorSchema,
  parseFlexibleDate,
  parseQtyInput,
  saveTaskConstructorSchema,
  shelfLifeFromDays,
  toggleField,
  type ShelfLifeUnit,
  type TaskConstructorFieldId,
  type TaskConstructorSchema,
  type TaskOperationType,
  type TaskQtyMode,
} from "@/lib/wms/task-constructor"

const FIELD_ORDER = Object.keys(TASK_CONSTRUCTOR_FIELD_META) as TaskConstructorFieldId[]

function uomLooksLikeWeight(uom?: string | null): boolean {
  const t = (uom || "").trim().toLowerCase()
  return t === "kg" || t === "кг" || t === "g" || t === "г" || t === "t" || t === "т"
}

const LS_OPERATION_KEY = "wms.taskConstructor.operation.v1"

function loadLastOperation(): TaskOperationType {
  if (typeof window === "undefined") return "receipt"
  try {
    const raw = localStorage.getItem(LS_OPERATION_KEY)
    if (raw === "receipt" || raw === "shipment" || raw === "revision" || raw === "transfer_erp") return raw
  } catch {
    /* ignore */
  }
  return "receipt"
}

function saveLastOperation(op: TaskOperationType) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(LS_OPERATION_KEY, op)
  } catch {
    /* ignore */
  }
}

function isLabelCard(item: WmsItemListRow): boolean {
  const name = (item.name || "").trim()
  const group = (item.itemGroupCode || item.productGroup || "").toLowerCase()
  const type = (item.itemTypeCode || "").toLowerCase()
  return (
    /^(стикер|этикетка|эмульсия)\b/i.test(name) ||
    group === "stickers" ||
    group === "labels" ||
    type === "stickers"
  )
}

function productNameFromLabel(name: string): string {
  return name.trim().replace(/^(стикер|этикетка)\s+/i, "").trim()
}

export function TaskConstructorDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (message: string) => void
}) {
  const [schema, setSchema] = useState<TaskConstructorSchema>(DEFAULT_SCHEMA_SNAPSHOT)
  const [showFields, setShowFields] = useState(false)
  const [operationType, setOperationType] = useState<TaskOperationType>(loadLastOperation)
  const [priority, setPriority] = useState<"normal" | "high">("normal")

  const [query, setQuery] = useState("")
  const [items, setItems] = useState<WmsItemListRow[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [selected, setSelected] = useState<WmsItemListRow | null>(null)
  const [pickPlan, setPickPlan] = useState<FgPickPlanPreview | null>(null)
  const [pickPlanLoading, setPickPlanLoading] = useState(false)

  const [batch, setBatch] = useState("")
  const [manufacturedAt, setManufacturedAt] = useState("")
  const [shelfAmount, setShelfAmount] = useState("12")
  const [shelfUnit, setShelfUnit] = useState<ShelfLifeUnit>("month")
  const [qty, setQty] = useState("")
  const [qtyMode, setQtyMode] = useState<TaskQtyMode>("pcs")
  const [comment, setComment] = useState("")
  const [sourceLocation, setSourceLocation] = useState("")
  const [targetLocation, setTargetLocation] = useState("")
  const [erpWarehouses, setErpWarehouses] = useState<ErpWarehouse[]>([])
  const [erpCatalogs, setErpCatalogs] = useState<ErpTransferCatalogs>(emptyErpCatalogs)
  const [erpHeader, setErpHeader] = useState<TransferHeaderFields>(DEFAULT_TRANSFER_HEADER)
  const [erpOrders, setErpOrders] = useState<ErpTransferOrderRow[]>([])
  const [erpLines, setErpLines] = useState<Array<{ item: WmsItemListRow; qty: string }>>([])
  const [erpLoading, setErpLoading] = useState(false)
  const [showErpSettings, setShowErpSettings] = useState(true)
  const [erpSettingsBusy, setErpSettingsBusy] = useState<"save" | "catalogs" | null>(null)
  const [erpSettingsMsg, setErpSettingsMsg] = useState<string | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  const reset = useCallback(() => {
    setSchema(loadTaskConstructorSchema())
    setShowFields(false)
    setOperationType(loadLastOperation())
    setPriority("normal")
    setPickPlanLoading(false)
    setQuery("")
    setSelected(null)
    setPickPlan(null)
    setBatch("")
    setManufacturedAt("")
    setShelfAmount("12")
    setShelfUnit("month")
    setQty("")
    setQtyMode("pcs")
    setComment("")
    setSourceLocation("")
    setTargetLocation("")
    setErpHeader(DEFAULT_TRANSFER_HEADER)
    setErpCatalogs(emptyErpCatalogs())
    setErpLines([])
    setShowErpSettings(true)
    setErpSettingsBusy(null)
    setErpSettingsMsg(null)
    setError(null)
  }, [])

  useEffect(() => {
    if (!open) return
    reset()
  }, [open, reset])

  const search = useCallback(async (text: string, op: TaskOperationType) => {
    const id = requestId.current + 1
    requestId.current = id
    setItemsLoading(true)
    try {
      const fg = op === "shipment"
      const res = await listItems({
        query: text.trim(),
        limit: 24,
        isActive: true,
        role: fg ? "fg" : undefined,
      })
      if (requestId.current !== id) return
      setItems(res.items ?? [])
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
    const t = window.setTimeout(() => void search(query, operationType), query.trim() ? 220 : 0)
    return () => window.clearTimeout(t)
  }, [open, query, operationType, search])

  useEffect(() => {
    if (!open || operationType !== "transfer_erp") return
    let cancelled = false
    setErpLoading(true)
    void listErpTransferOrders({ onlyOpen: true, limit: 12 })
      .then((data) => {
        if (cancelled) return
        setErpWarehouses(data.warehouses)
        setErpCatalogs(data.catalogs)
        setErpOrders(data.orders)
        const header = headerFromSettings(data.defaults)
        if (!header.sourceWarehouseKey && data.warehouses[0]) header.sourceWarehouseKey = data.warehouses[0].refKey
        if (!header.targetWarehouseKey) {
          const other = data.warehouses.find((row) => row.refKey !== header.sourceWarehouseKey)
          if (other) header.targetWarehouseKey = other.refKey
        }
        setErpHeader(header)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setErpLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, operationType])

  const changeOperation = (next: TaskOperationType) => {
    setOperationType(next)
    saveLastOperation(next)
    setPickPlan(null)
    if (next !== "shipment") {
      setPickPlanLoading(false)
    }
    if (selected && isLabelCard(selected) && next === "shipment") {
      setSelected(null)
    }
  }

  const applyItemFields = (item: WmsItemListRow) => {
    setSelected(item)
    const fromDays = shelfLifeFromDays(item.shelfLifeDays)
    if (item.shelfLifeDays && item.shelfLifeDays > 0) {
      setShelfAmount(String(fromDays.amount))
      setShelfUnit(fromDays.unit)
    }
    setQtyMode(uomLooksLikeWeight(item.uomCode) ? "weight" : "pcs")
  }

  const pickItem = (item: WmsItemListRow) => {
    if (operationType === "transfer_erp") {
      setSelected(item)
      setErpLines((prev) => {
        if (prev.some((row) => row.item.itemCode === item.itemCode)) return prev
        return [...prev, { item, qty: "" }]
      })
      return
    }
    if (operationType === "receipt" && isLabelCard(item)) {
      applyItemFields(item)
      setPickPlan(null)
      return
    }
    applyItemFields(item)
  }

  const openShipmentForQuery = (text?: string) => {
    const nextQuery = (text || query).trim()
    if (nextQuery) setQuery(nextQuery)
    changeOperation("shipment")
    setSelected(null)
    setPickPlan(null)
  }

  useEffect(() => {
    if (!open || operationType !== "shipment" || itemsLoading) return
    if (selected || query.trim().length < 3) return
    const fg = items.filter((item) => !isLabelCard(item))
    if (fg.length === 1) applyItemFields(fg[0])
  }, [open, operationType, items, itemsLoading, selected, query])

  useEffect(() => {
    if (!open || operationType !== "shipment" || !selected || isLabelCard(selected)) {
      if (operationType !== "shipment") {
        setPickPlan(null)
        setPickPlanLoading(false)
      }
      return
    }
    let cancelled = false
    setPickPlanLoading(true)
    const manufacturedDay = parseFlexibleDate(manufacturedAt)
    const planned = parseQtyInput(qty, qtyMode)
    void fetchFgPickPlan({
      itemCode: selected.itemCode,
      qty: planned > 0 ? planned : undefined,
      manufacturedAt: manufacturedDay ? formatIsoKeep(manufacturedDay) : undefined,
    })
      .then((res) => {
        if (cancelled) return
        setPickPlan(res.plan)
        const loc = res.plan?.suggested?.locationCode?.trim()
        if (loc) setSourceLocation(loc)
      })
      .catch(() => {
        if (!cancelled) setPickPlan(null)
      })
      .finally(() => {
        if (!cancelled) setPickPlanLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, operationType, selected, qty, qtyMode, manufacturedAt])

  const expiryIso = useMemo(
    () => computeExpiryIso(manufacturedAt, Number(shelfAmount) || 0, shelfUnit),
    [manufacturedAt, shelfAmount, shelfUnit]
  )
  const manufactured = parseFlexibleDate(manufacturedAt)
  const expiryDate = expiryIso ? parseFlexibleDate(expiryIso) : null

  const qtyValue = parseQtyInput(qty, qtyMode)
  const needQty = hasField(schema, "qty")
  const erpReady =
    Boolean(erpHeader.sourceWarehouseKey && erpHeader.targetWarehouseKey && erpHeader.sourceWarehouseKey !== erpHeader.targetWarehouseKey) &&
    Boolean(erpHeader.organizationKey) &&
    erpLines.some((row) => parseQtyInput(row.qty, "pcs") > 0)
  const canSubmit =
    operationType === "transfer_erp"
      ? erpReady && !submitting
      : Boolean(selected) && (!needQty || qtyValue > 0) && !submitting

  const patchSchema = (id: TaskConstructorFieldId) => {
    const next = toggleField(schema, id)
    setSchema(next)
    saveTaskConstructorSchema(next)
  }

  const saveErpTemplate = async () => {
    setErpSettingsBusy("save")
    setErpSettingsMsg(null)
    setError(null)
    try {
      const saved = await saveErpTransferSettings({ defaults: settingsFromHeader(erpHeader) })
      setErpCatalogs(saved.catalogs)
      if (saved.warehouses.length) setErpWarehouses(saved.warehouses)
      setErpSettingsMsg("Шаблон заказа 1С сохранён — следующие перемещения откроются с этими полями.")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setErpSettingsBusy(null)
    }
  }

  const refreshErpCatalogs = async () => {
    setErpSettingsBusy("catalogs")
    setErpSettingsMsg(null)
    setError(null)
    try {
      const saved = await saveErpTransferSettings({ syncCatalogs: true })
      setErpCatalogs(saved.catalogs)
      if (saved.warehouses.length) setErpWarehouses(saved.warehouses)
      const n =
        saved.catalogs.organizations.length +
        saved.catalogs.users.length +
        saved.catalogs.departments.length +
        saved.catalogs.priorities.length
      setErpSettingsMsg(`Справочники 1С обновлены: ${n} записей. Поля можно поправить и сохранить как шаблон.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setErpSettingsBusy(null)
    }
  }

  const submit = async () => {
    if (operationType === "transfer_erp") {
      const lines = erpLines
        .map((row) => ({
          itemCode: row.item.itemCode,
          nomenclatureKey: itemOneCGuid(row.item),
          qty: parseQtyInput(row.qty, "pcs"),
        }))
        .filter((row) => row.qty > 0)
      if (!erpHeader.sourceWarehouseKey || !erpHeader.targetWarehouseKey) {
        setError("Укажите склады отправителя и получателя")
        return
      }
      if (!erpHeader.organizationKey) {
        setError("В настройке заказа укажите организацию 1С")
        return
      }
      if (lines.length === 0) {
        setError("Добавьте номенклатуру и количество")
        return
      }
      const missingGuid = lines.find((row) => !row.nomenclatureKey)
      if (missingGuid) {
        setError(`У позиции ${missingGuid.itemCode} нет GUID 1С — сначала выгрузите номенклатуру из ERP`)
        return
      }
      setSubmitting(true)
      setError(null)
      try {
        const result = await createErpTransferOrder({
          requestId: newRequestId(),
          comment: hasField(schema, "comment") ? comment.trim() || undefined : undefined,
          sourceWarehouseKey: erpHeader.sourceWarehouseKey,
          targetWarehouseKey: erpHeader.targetWarehouseKey,
          organizationKey: erpHeader.organizationKey,
          recipientOrganizationKey: erpHeader.recipientOrganizationKey || undefined,
          priorityKey: erpHeader.priorityKey || undefined,
          authorKey: erpHeader.authorKey || undefined,
          departmentKey: erpHeader.departmentKey || undefined,
          responsibleKey: erpHeader.responsibleKey || undefined,
          status: erpHeader.status,
          operation: erpHeader.operation,
          deliveryMethod: erpHeader.deliveryMethod,
          activity: erpHeader.activity,
          acceptanceVariant: erpHeader.acceptanceVariant,
          supplyVariant: erpHeader.supplyVariant,
          lines,
        })
        const fromWh = erpWarehouses.find((w) => w.refKey === erpHeader.sourceWarehouseKey)
        const toWh = erpWarehouses.find((w) => w.refKey === erpHeader.targetWarehouseKey)
        onOpenChange(false)
        onCreated(
          [
            "Перемещение ЕРП",
            result.documentNo || result.refKey.slice(0, 8),
            fromWh?.name,
            toWh ? `→ ${toWh.name}` : "",
            result.taskCount ? `${result.taskCount} зад.` : "",
          ]
            .filter(Boolean)
            .join(" · ")
        )
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setSubmitting(false)
      }
      return
    }
    if (!selected) return
    if (needQty && qtyValue <= 0) {
      setError("Укажите количество")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const lotCode =
        (hasField(schema, "batch") && batch.trim()) ||
        (manufactured ? `P${formatIsoKeep(manufactured).replace(/-/g, "")}` : undefined)
      const weightUom = uomLooksLikeWeight(selected.uomCode)
      const uomCode =
        qtyMode === "weight"
          ? weightUom
            ? selected.uomCode ?? undefined
            : undefined
          : selected.uomCode || "pcs"
      const lineComment = [
        hasField(schema, "comment") ? comment.trim() : "",
        qtyMode === "weight" && !weightUom ? `вес ${qtyValue} кг` : "",
      ]
        .filter(Boolean)
        .join(" · ")
      const planLoc =
        operationType === "shipment" ? pickPlan?.suggested?.locationCode?.trim() || "" : ""
      const sourceCode =
        (hasField(schema, "locations") ? sourceLocation.trim() : "") || planLoc || undefined
      const targetCode = hasField(schema, "locations") ? targetLocation.trim() || undefined : undefined
      const result = await createOperationalTaskBatch({
        operationType,
        priorityCode: priority,
        comment: lineComment || undefined,
        sourceLocationCode: sourceCode,
        targetLocationCode: targetCode,
        lines: [
          {
            itemCode: selected.itemCode,
            qty: needQty ? qtyValue : 1,
            uomCode,
            lotCode,
            batchLabel: hasField(schema, "batch") ? batch.trim() || undefined : undefined,
            manufacturedAt:
              hasField(schema, "manufacturedAt") && manufactured
                ? `${formatIsoKeep(manufactured)}T00:00:00`
                : undefined,
            expiryAt:
              hasField(schema, "shelfLife") && expiryIso ? `${expiryIso}T00:00:00` : undefined,
            bestBeforeAt:
              hasField(schema, "shelfLife") && expiryIso ? `${expiryIso}T00:00:00` : undefined,
            sourceLocationCode: sourceCode,
            targetLocationCode: targetCode,
            comment: lineComment || undefined,
          },
        ],
      })
      const taskId = result.createdLines?.[0]?.taskId
      onOpenChange(false)
      onCreated(
        [
          OPERATION_TYPE_LABEL[operationType],
          selected.name,
          lotCode ? `партия ${lotCode}` : "",
          expiryDate ? `годен до ${formatRuDate(expiryDate)}` : "",
          taskId ? `#${taskId}` : "",
        ]
          .filter(Boolean)
          .join(" · ")
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[96vh] max-h-[96vh] w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] flex-col gap-3 overflow-hidden sm:max-w-[calc(100vw-1.5rem)]">
        <DialogHeader className="shrink-0">
          <DialogTitle>Конструктор задания</DialogTitle>
          <DialogDescription>
            {operationType === "transfer_erp"
              ? "Документ создаётся сразу в WMS и в 1С ERP как ЗаказНаПеремещение."
              : "Соберите поля под операцию. Срок годности считается от даты производства — 12 месяцев, 2 недели или любая другая формула."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            value={operationType}
            onChange={(e) => changeOperation(e.target.value as TaskOperationType)}
          >
            {(Object.keys(OPERATION_TYPE_LABEL) as TaskOperationType[]).map((k) => (
              <option key={k} value={k}>
                {OPERATION_TYPE_LABEL[k]}
              </option>
            ))}
          </select>
          {operationType === "shipment" ? (
            <p className="text-[11px] text-muted-foreground">
              Этикетки склада материалов скрыты. Ищем напиток на плане ГП.
            </p>
          ) : operationType === "receipt" ? (
            <p className="text-[11px] text-muted-foreground">
              Приёмка сырья и этикеток. Напиток с ряда плана — в операции «Отгрузка».
            </p>
          ) : null}
          {hasField(schema, "priority") ? (
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={priority}
              onChange={(e) => setPriority(e.target.value === "high" ? "high" : "normal")}
            >
              <option value="normal">Обычный</option>
              <option value="high">Срочный</option>
            </select>
          ) : null}
          {operationType === "transfer_erp" ? (
            <Button
              type="button"
              size="sm"
              variant={showErpSettings ? "secondary" : "outline"}
              className="ml-auto h-8 text-xs"
              onClick={() => setShowErpSettings((v) => !v)}
            >
              <Settings2 className="mr-1.5 size-3.5" />
              Настройка
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant={showFields ? "secondary" : "outline"}
            className={`h-8 text-xs ${operationType === "transfer_erp" ? "" : "ml-auto"}`}
            onClick={() => setShowFields((v) => !v)}
          >
            <SlidersHorizontal className="mr-1.5 size-3.5" />
            Поля формы
          </Button>
        </div>

        {showFields ? (
          <div className="shrink-0 rounded-lg border border-border/60 bg-muted/20 p-2">
            <p className="mb-1.5 text-[11px] text-muted-foreground">
              Включите то, что нужно на ТСД. Номенклатура всегда обязательна. Набор запоминается.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {FIELD_ORDER.map((id) => {
                const on = hasField(schema, id)
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => patchSchema(id)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-[11px] transition-colors",
                      on
                        ? "border-primary/40 bg-primary/10 text-foreground"
                        : "border-border/60 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {TASK_CONSTRUCTOR_FIELD_META[id].label}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden md:grid-cols-[minmax(20rem,0.9fr)_minmax(0,1.4fr)]">
          <div className="flex min-h-0 min-w-0 flex-col gap-2">
            <div className="relative shrink-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  operationType === "shipment"
                    ? "Напиток, код или GTIN — без этикеток"
                    : "Номенклатура, код или GTIN"
                }
                className="h-9 pl-8"
              />
            </div>
            {operationType === "receipt" && items.length > 0 && items.every(isLabelCard) ? (
              <div className="shrink-0 rounded-lg border border-amber-300/60 bg-amber-50 p-2.5 text-[11px] text-amber-950">
                <p className="font-medium">Этого нет на плане готовой продукции.</p>
                <p className="mt-0.5">
                  Пока лежит на складе материалов — это этикетка. Когда нанесена, это уже напиток: его
                  выбирают в операции «Отгрузка».
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2 h-7 border-amber-400/70 bg-white text-[11px]"
                  onClick={() => openShipmentForQuery(query)}
                >
                  Искать напиток для отгрузки
                </Button>
              </div>
            ) : null}
            <div className="min-h-[12rem] flex-1 overflow-y-auto rounded-lg border border-border/60">
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
                    {operationType === "shipment"
                      ? query.trim()
                        ? "Напитка с таким названием на ГП нет. Этикетки склада материалов здесь скрыты."
                        : "Наберите название напитка — этикетки и стикеры в отгрузке не показываем."
                      : "Начните вводить название — без номенклатуры задание не создать."}
                  </p>
                  {operationType === "shipment" && query.trim() ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-1 h-7 text-[11px]"
                      onClick={() => changeOperation("receipt")}
                    >
                      Показать этикетки (приёмка)
                    </Button>
                  ) : null}
                </div>
              ) : (
                <ul className="divide-y divide-border/40">
                  {items.map((item) => {
                    const active = selected?.itemCode === item.itemCode
                    return (
                      <li key={item.itemCode}>
                        <button
                          type="button"
                          onClick={() => pickItem(item)}
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
                            <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                              <span className="font-mono">{item.itemCode}</span>
                              {item.uomCode ? <span>{item.uomCode}</span> : null}
                              {item.shelfLifeDays ? <span>{item.shelfLifeDays} дн.</span> : null}
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
            {operationType === "transfer_erp" ? (
              <>
                {showErpSettings ? (
                  <div className="rounded-lg border border-border/60 bg-muted/15 p-2.5">
                    <p className="mb-2 text-[11px] text-muted-foreground">
                      Поля заказа 1С <span className="font-mono">Document_ЗаказНаПеремещение</span> подставляются из
                      шаблона. Их можно поправить для этого документа или запомнить как настройку.
                    </p>
                    <div className="mb-2 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 text-xs"
                        disabled={Boolean(erpSettingsBusy)}
                        onClick={() => void saveErpTemplate()}
                      >
                        {erpSettingsBusy === "save" ? (
                          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                        ) : (
                          <Save className="mr-1.5 size-3.5" />
                        )}
                        Сохранить шаблон
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        disabled={Boolean(erpSettingsBusy)}
                        onClick={() => void refreshErpCatalogs()}
                      >
                        {erpSettingsBusy === "catalogs" ? (
                          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                        ) : (
                          <Search className="mr-1.5 size-3.5" />
                        )}
                        Загрузить справочники 1С
                      </Button>
                    </div>
                    {erpSettingsMsg ? <p className="mb-2 text-[11px] text-emerald-800">{erpSettingsMsg}</p> : null}
                    {erpLoading ? (
                      <p className="text-[11px] text-muted-foreground">Загружаю склады и шаблон…</p>
                    ) : null}
                    <ErpTransferHeaderFields
                      value={erpHeader}
                      onChange={setErpHeader}
                      warehouses={erpWarehouses}
                      organizations={erpCatalogs.organizations}
                      priorities={erpCatalogs.priorities}
                      users={erpCatalogs.users}
                      departments={erpCatalogs.departments}
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="grid gap-1">
                      <span className="text-xs font-medium text-foreground/80">Склад-отправитель</span>
                      <select
                        className="h-9 rounded-md border border-input bg-background px-2 text-xs"
                        value={erpHeader.sourceWarehouseKey}
                        onChange={(e) => setErpHeader((prev) => ({ ...prev, sourceWarehouseKey: e.target.value }))}
                      >
                        <option value="">{erpLoading ? "Загрузка…" : "Выберите склад 1С"}</option>
                        {erpWarehouses.map((wh) => (
                          <option key={wh.refKey} value={wh.refKey}>
                            {wh.name}
                            {wh.wmsCode ? ` · ${wh.wmsCode}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1">
                      <span className="text-xs font-medium text-foreground/80">Склад-получатель</span>
                      <select
                        className="h-9 rounded-md border border-input bg-background px-2 text-xs"
                        value={erpHeader.targetWarehouseKey}
                        onChange={(e) => setErpHeader((prev) => ({ ...prev, targetWarehouseKey: e.target.value }))}
                      >
                        <option value="">{erpLoading ? "Загрузка…" : "Выберите склад 1С"}</option>
                        {erpWarehouses.map((wh) => (
                          <option key={wh.refKey} value={wh.refKey}>
                            {wh.name}
                            {wh.wmsCode ? ` · ${wh.wmsCode}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                {erpWarehouses.length === 0 && !erpLoading ? (
                  <p className="rounded-lg border border-border/60 bg-muted/25 p-2 text-[11px] text-muted-foreground">
                    Складов 1С ещё нет. Откройте Настройка и загрузите справочники, либо выгрузите заказы в Настройки → 1С ERP.
                  </p>
                ) : null}
                <div className="rounded-lg border border-border/60">
                  {erpLines.length === 0 ? (
                    <p className="p-2.5 text-xs text-muted-foreground">
                      Выберите номенклатуру слева — строка попадёт в заказ ERP.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border/40">
                      {erpLines.map((row) => (
                        <li key={row.item.itemCode} className="flex items-center gap-2 px-2.5 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-1 text-xs font-medium">{row.item.name}</p>
                            <p className="font-mono text-[11px] text-muted-foreground">{row.item.itemCode}</p>
                          </div>
                          <Input
                            value={row.qty}
                            onChange={(e) =>
                              setErpLines((prev) =>
                                prev.map((line) =>
                                  line.item.itemCode === row.item.itemCode
                                    ? { ...line, qty: e.target.value.replace(/[^\d.,]/g, "") }
                                    : line
                                )
                              )
                            }
                            placeholder="кол-во"
                            inputMode="numeric"
                            className="h-8 w-20 font-semibold tabular-nums"
                          />
                          <button
                            type="button"
                            className="text-[11px] text-muted-foreground hover:text-foreground"
                            onClick={() =>
                              setErpLines((prev) => prev.filter((line) => line.item.itemCode !== row.item.itemCode))
                            }
                          >
                            убрать
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {hasField(schema, "comment") ? (
                  <label className="grid gap-1">
                    <span className="text-xs font-medium text-foreground/80">Комментарий</span>
                    <Textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Попадёт в заказ 1С и в задание WMS"
                      className="min-h-[56px] text-xs"
                    />
                  </label>
                ) : null}
                {erpOrders.length > 0 ? (
                  <div className="rounded-lg border border-border/60 p-2.5">
                    <p className="mb-1 text-[11px] font-medium text-muted-foreground">Открытые заказы ERP</p>
                    <ul className="space-y-1">
                      {erpOrders.slice(0, 6).map((order) => (
                        <li key={order.refKey} className="text-[11px] text-foreground">
                          <span className="font-mono">{order.documentNo || order.refKey.slice(0, 8)}</span>
                          <span className="text-muted-foreground">
                            {" "}
                            · {order.sourceWarehouseName || "?"} → {order.targetWarehouseName || "?"} · {order.lineCount} стр.
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : (
              <>
            <div className="rounded-lg border border-border/60 p-2.5">
              {selected ? (
                <>
                  <p className="line-clamp-2 text-sm font-medium text-foreground">{selected.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{selected.itemCode}</p>
                  {isLabelCard(selected) && operationType !== "shipment" ? (
                    <div className="mt-2 rounded-md border border-amber-300/50 bg-amber-50 p-2 text-[11px] text-amber-950">
                      <p>Это этикетка склада материалов, не ряд плана ГП.</p>
                      <button
                        type="button"
                        className="mt-1 font-medium underline underline-offset-2"
                        onClick={() =>
                          openShipmentForQuery(productNameFromLabel(selected.name) || query)
                        }
                      >
                        Открыть напиток для отгрузки
                      </button>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Выберите номенклатуру слева.</p>
              )}
            </div>

            {operationType === "shipment" && selected && !isLabelCard(selected) ? (
              <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/25 p-2.5 text-xs">
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  {pickPlanLoading ? (
                    <p className="text-muted-foreground">Сверяю ряд на плане ГП…</p>
                  ) : pickPlan?.suggested ? (
                    <>
                      <p className="font-medium text-foreground">
                        Откуда взять: {pickPlan.suggested.rowLabel}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {pickPlan.suggested.locationCode}
                        {pickPlan.totalAvailable > 0 ? ` · ${pickPlan.totalAvailable} шт` : ""}
                      </p>
                      {pickPlan.reason ? (
                        <p className="mt-1 text-[11px] text-amber-800">{pickPlan.reason}</p>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-muted-foreground">
                      {pickPlan?.reason ||
                        "Этого напитка сейчас нет на плане склада ГП. Этикетка на материалах — пока не нанесена."}
                    </p>
                  )}
                </div>
              </div>
            ) : null}

            {hasField(schema, "batch") ? (
              <label className="grid gap-1">
                <span className="text-xs font-medium text-foreground/80">Партия</span>
                <Input
                  value={batch}
                  onChange={(e) => setBatch(e.target.value)}
                  placeholder="Текст, как на этикетке"
                  className="h-9"
                />
              </label>
            ) : null}

            {hasField(schema, "manufacturedAt") || hasField(schema, "shelfLife") ? (
              <div className="grid gap-2.5 sm:grid-cols-2">
                {hasField(schema, "manufacturedAt") ? (
                  <label className="grid gap-1">
                    <span className="text-xs font-medium text-foreground/80">Дата производства</span>
                    <Input
                      value={manufacturedAt}
                      onChange={(e) => setManufacturedAt(e.target.value)}
                      placeholder="07.09.2026"
                      className="h-9"
                    />
                  </label>
                ) : null}
                {hasField(schema, "shelfLife") ? (
                  <label className="grid gap-1">
                    <span className="text-xs font-medium text-foreground/80">Формула срока</span>
                    <div className="flex gap-1.5">
                      <Input
                        value={shelfAmount}
                        onChange={(e) => setShelfAmount(e.target.value.replace(/[^\d]/g, ""))}
                        inputMode="numeric"
                        className="h-9 w-16 tabular-nums"
                      />
                      <select
                        className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                        value={shelfUnit}
                        onChange={(e) => setShelfUnit(e.target.value as ShelfLifeUnit)}
                      >
                        {(Object.keys(SHELF_LIFE_UNIT_LABEL) as ShelfLifeUnit[]).map((u) => (
                          <option key={u} value={u}>
                            {SHELF_LIFE_UNIT_LABEL[u]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>
                ) : null}
              </div>
            ) : null}

            {hasField(schema, "shelfLife") ? (
              <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/25 p-2.5 text-xs">
                <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <div>
                  {manufactured && expiryDate ? (
                    <>
                      <p className="font-medium text-foreground">
                        Годен до {formatRuDate(expiryDate)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {shelfAmount} {SHELF_LIFE_UNIT_LABEL[shelfUnit]} от{" "}
                        {formatRuDate(manufactured)}. На ТСД достаточно ввести дату производства.
                      </p>
                    </>
                  ) : (
                    <p className="text-muted-foreground">
                      Введите дату производства — срок посчитается сам. Пример: 07.09.2026 и 12
                      месяцев → 07.09.2027.
                    </p>
                  )}
                </div>
              </div>
            ) : null}

            {hasField(schema, "qty") ? (
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-2.5 py-2">
                  <span className="text-xs text-foreground/80">
                    {qtyMode === "pcs" ? "Считаем штуками" : "Считаем весом"}
                    <span className="block text-[11px] text-muted-foreground">
                      {qtyMode === "pcs"
                        ? "целое число"
                        : "килограммы, можно с запятой: 12,5"}
                    </span>
                  </span>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    шт
                    <Switch
                      checked={qtyMode === "weight"}
                      onCheckedChange={(v) => setQtyMode(v ? "weight" : "pcs")}
                    />
                    кг
                  </div>
                </div>
                <Input
                  value={qty}
                  onChange={(e) =>
                    setQty(
                      qtyMode === "pcs"
                        ? e.target.value.replace(/[^\d]/g, "")
                        : e.target.value.replace(/[^\d.,]/g, "")
                    )
                  }
                  inputMode={qtyMode === "pcs" ? "numeric" : "decimal"}
                  placeholder={qtyMode === "pcs" ? "0" : "0,000"}
                  className="h-9 font-semibold tabular-nums"
                />
              </div>
            ) : null}

            {hasField(schema, "locations") ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-foreground/80">Откуда</span>
                  <Input
                    value={sourceLocation}
                    onChange={(e) => setSourceLocation(e.target.value)}
                    className="h-9 font-mono text-xs"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-foreground/80">Куда</span>
                  <Input
                    value={targetLocation}
                    onChange={(e) => setTargetLocation(e.target.value)}
                    className="h-9 font-mono text-xs"
                  />
                </label>
              </div>
            ) : null}

            {hasField(schema, "comment") ? (
              <label className="grid gap-1">
                <span className="text-xs font-medium text-foreground/80">Комментарий</span>
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Что должен увидеть оператор на ТСД"
                  className="min-h-[56px] text-xs"
                />
              </label>
            ) : null}
              </>
            )}

            {error ? (
              <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter className="shrink-0 gap-2 sm:justify-between">
          <span className="hidden text-[11px] text-muted-foreground sm:block">
            {operationType === "transfer_erp"
              ? "POST в Document_ЗаказНаПеремещение и задание в очереди WMS."
              : "Код для ТСД соберём из этих полей позже — в настройках терминала."}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Отмена
            </Button>
            <Button type="button" disabled={!canSubmit} onClick={() => void submit()}>
              {submitting ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
              {operationType === "transfer_erp" ? "Создать в WMS и 1С" : "Создать задание"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function itemOneCGuid(item: WmsItemListRow): string {
  const nom = item.itemAttrs?.nomenclature
  if (nom && typeof nom === "object") {
    const guid = (nom as Record<string, unknown>).oneCGuid
    if (typeof guid === "string" && guid.trim() && guid !== "00000000-0000-0000-0000-000000000000") {
      return guid.trim()
    }
  }
  return ""
}

function formatIsoKeep(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0")
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  return `${date.getFullYear()}-${mm}-${dd}`
}

const DEFAULT_SCHEMA_SNAPSHOT = loadTaskConstructorSchema()
