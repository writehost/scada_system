"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ZoomIn } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  getSiteCode,
  listDirectoryNomenclatureTypes,
  listDirectoryPackagingProfiles,
  listDirectoryItemGroups,
  listDirectoryItemClasses,
} from "@/lib/wms-api"
import {
  type NomenclatureFormState,
  type NomenclatureStatus,
} from "@/lib/nomenclature-model"
import { cn } from "@/lib/utils"
import { deriveProductPhysicalProfile, STORAGE_CLASS_META } from "@/lib/wms/physical-profile"
import { TnvedPicker } from "@/components/wms/tnved-picker"
import { MarkingCodesHelpPanel } from "@/components/wms/marking-codes-help-panel"
import { NomenclaturePackVghPanel } from "@/components/wms/nomenclature-pack-vgh"

const FALLBACK_PACKAGING = [
  { code: "custom", name: "Универсальный", suffix: "custom" },
  { code: "stickers", name: "Этикетки и стикеры", suffix: "stickers" },
  { code: "water", name: "Питьевая вода", suffix: "water" },
]

const FALLBACK_NOM_TYPES: { code: string; name: string }[] = [
  { code: "PRODUCT", name: "Товар / продукция" },
  { code: "STICKER", name: "Стикер маркировки" },
  { code: "LABEL", name: "Этикетка" },
  { code: "PACKAGING", name: "Упаковка" },
  { code: "SPARE_PART", name: "Запчасть" },
  { code: "CONSUMABLE", name: "Расходник" },
  { code: "RAW_MATERIAL", name: "Сырьё / материалы" },
  { code: "SEMI_FINISHED", name: "Полуфабрикат" },
  { code: "EQUIPMENT", name: "Оборудование" },
  { code: "SERVICE", name: "Услуга" },
  { code: "OTHER", name: "Прочее" },
]

const NOM_STATUS: NomenclatureStatus[] = ["ACTIVE", "INACTIVE", "BLOCKED", "ARCHIVED"]

const FORM_TABS: { value: string; label: string; title?: string }[] = [
  { value: "main", label: "Основное" },
  { value: "ids", label: "Идентификаторы" },
  { value: "units", label: "Единицы" },
  { value: "acct", label: "Учёт" },
  { value: "shelf", label: "Сроки", title: "Сроки и условия" },
  { value: "dims", label: "Габариты" },
  { value: "stick", label: "Стикеры" },
  { value: "mark", label: "Маркировка" },
  { value: "recv", label: "Приёмка" },
  { value: "wh", label: "Склад" },
  { value: "print", label: "Печать" },
  { value: "extra", label: "Финансы", title: "Финансы и интеграции" },
]

function Row({
  label,
  optional,
  className,
  children,
}: {
  label: string
  optional?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label className="text-xs font-medium leading-snug">
        {label}
        {optional ? <span className="font-normal text-muted-foreground"> — необяз.</span> : null}
      </Label>
      {children}
    </div>
  )
}

function Bool({
  form,
  field,
  label,
  setForm,
}: {
  form: NomenclatureFormState
  field: keyof NomenclatureFormState
  label: string
  setForm: React.Dispatch<React.SetStateAction<NomenclatureFormState>>
}) {
  const checked = Boolean(form[field])
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-sm">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => setForm((p) => ({ ...p, [field]: v === true }))}
      />
      <span>{label}</span>
    </label>
  )
}

export function NomenclatureFormTabs({
  form,
  setForm,
  loading = false,
  lockCode = false,
  defaultTab = "main",
  scrollMode = "dialog",
}: {
  form: NomenclatureFormState
  setForm: React.Dispatch<React.SetStateAction<NomenclatureFormState>>
  loading?: boolean
  lockCode?: boolean
  defaultTab?: string
  /**
   * "dialog" — форма зажата по высоте и скроллится сама (модалка создания).
   * "page" — форма встроена в обычную страницу, которая уже скроллится сама;
   * здесь не добавляем свой overflow, чтобы не было двух полос прокрутки.
   */
  scrollMode?: "dialog" | "page"
}) {
  const [pkgDefs, setPkgDefs] = useState<{ code: string; name: string; isActive: boolean }[]>([])
  const [typeDefs, setTypeDefs] = useState<{ code: string; name: string; isActive: boolean }[]>([])
  const [groupDefs, setGroupDefs] = useState<{ code: string; name: string; isActive: boolean }[]>([])
  const [classDefs, setClassDefs] = useState<{ code: string; name: string; isActive: boolean }[]>([])
  const [imageUploading, setImageUploading] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false)
  const derivedClass = useMemo(
    () =>
      deriveProductPhysicalProfile({
        name: form.name,
        itemTypeCode: form.type,
        itemClassCode: form.categoryId,
        itemGroupCode: form.groupId || form.groupName,
        productGroup: form.groupName || form.categoryName,
      }).storageClass,
    [form.name, form.type, form.categoryId, form.groupId, form.groupName, form.categoryName]
  )

  useEffect(() => {
    void (async () => {
      try {
        const [p, t, g, c] = await Promise.all([
          listDirectoryPackagingProfiles(),
          listDirectoryNomenclatureTypes(),
          listDirectoryItemGroups(),
          listDirectoryItemClasses({ seedDefaults: true }),
        ])
        setPkgDefs((p.profiles || []).map((x) => ({ code: x.code, name: x.name, isActive: x.isActive })))
        setTypeDefs((t.types || []).map((x) => ({ code: x.code, name: x.name, isActive: x.isActive })))
        setGroupDefs((g.groups || []).map((x) => ({ code: x.code, name: x.name, isActive: x.isActive })))
        setClassDefs((c.classes || []).map((x) => ({ code: x.code, name: x.name, isActive: x.isActive !== false })))
      } catch {
        setPkgDefs([])
        setTypeDefs([])
        setGroupDefs([])
        setClassDefs([])
      }
    })()
  }, [])

  const packagingOptions = useMemo(() => {
    const rows = pkgDefs.filter((x) => x.isActive)
    if (rows.length > 0) return rows.map((r) => ({ value: r.code, label: `${r.name} (${r.code})` }))
    return FALLBACK_PACKAGING.map((r) => ({ value: r.code, label: `${r.name} (${r.suffix})` }))
  }, [pkgDefs])

  const typeOptions = useMemo(() => {
    const rows = typeDefs.filter((x) => x.isActive)
    if (rows.length > 0) return rows.map((r) => ({ value: r.code, label: `${r.name} (${r.code})` }))
    return FALLBACK_NOM_TYPES.map((r) => ({ value: r.code, label: `${r.name} (${r.code})` }))
  }, [typeDefs])

  const inp = (field: keyof NomenclatureFormState) => ({
    value: String(form[field] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [field]: e.target.value })),
    disabled: loading,
    className: "rounded-xl font-mono text-sm",
  })

  async function handlePickItemImage(file: File) {
    const code = form.code.trim()
    if (!code) {
      setImageError("Сначала укажите код номенклатуры")
      return
    }
    setImageUploading(true)
    setImageError(null)
    try {
      const fd = new FormData()
      fd.set("siteCode", getSiteCode())
      fd.set("itemCode", code)
      fd.set("file", file)
      const res = await fetch("/api/wms/items/upload-image", { method: "POST", body: fd })
      const data = (await res.json()) as { imageUrl?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      if (data.imageUrl) setForm((p) => ({ ...p, imageUrl: data.imageUrl! }))
    } catch (e) {
      setImageError(e instanceof Error ? e.message : "Не удалось загрузить фото")
    } finally {
      setImageUploading(false)
    }
  }

  return (
    <>
    <Tabs defaultValue={defaultTab} className="flex min-h-0 flex-1 flex-col gap-0 sm:flex-row">
      {/* ERPNext-style: sections as left nav, not a second top bar */}
      <div
        className="shrink-0 border-b border-border bg-muted/20 sm:w-[200px] sm:border-b-0 sm:border-r"
        role="region"
        aria-label="Разделы формы номенклатуры"
      >
        <TabsList className="flex h-auto w-full flex-row flex-nowrap gap-0.5 overflow-x-auto bg-transparent p-2 sm:flex-col sm:items-stretch sm:overflow-visible">
          {FORM_TABS.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              title={tab.title ?? tab.label}
              className="justify-start rounded-lg px-3 py-2 text-left text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm sm:w-full sm:text-[13px]"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <div
        className={cn(
          "min-h-0 flex-1 px-4 py-4 sm:px-6 sm:py-5",
          scrollMode === "dialog"
            ? "overflow-y-auto overscroll-contain [max-height:calc(95vh-12.5rem)] [min-height:min(480px,45vh)]"
            : "overflow-visible"
        )}
      >
        <TabsContent value="main" className="m-0 mt-0 space-y-4 focus-visible:outline-none">
          <div className="grid gap-3 sm:grid-cols-2">
            <Row label="Профиль упаковки (БД)">
              <select
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                value={
                  packagingOptions.some((o) => o.value === form.packagingProfile)
                    ? form.packagingProfile
                    : packagingOptions[0]?.value ?? "custom"
                }
                onChange={(e) => setForm((p) => ({ ...p, packagingProfile: e.target.value }))}
                disabled={loading}
              >
                {packagingOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Внешний код (ERP)" optional>
              <Input {...inp("externalCode")} className="rounded-xl" />
            </Row>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Row label="Код товара (itemCode)">
              <Input
                {...inp("code")}
                placeholder="NOM-000001"
                autoComplete="off"
                disabled={loading || lockCode}
              />
            </Row>
            <Row label="Полное наименование">
              <Input
                {...inp("name")}
                placeholder="Наименование"
                className="rounded-xl font-sans text-sm"
              />
            </Row>
            <Row label="Серийный номер">
              <Input
                {...inp("equipmentSerial")}
                placeholder="Серийный номер"
                className="rounded-xl font-mono text-sm"
                autoComplete="off"
              />
            </Row>
            <Row label="Номенклатура" optional>
              <Input
                {...inp("nomenclature")}
                placeholder="Составное наименование / код ERP / (01)GTIN"
                className="rounded-xl font-sans text-sm"
              />
            </Row>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Row label="SKU" optional>
              <Input {...inp("sku")} className="rounded-xl text-xs" />
            </Row>
            <Row label="Основной штрихкод" optional>
              <Input {...inp("primaryBarcode")} placeholder="460…" />
            </Row>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Row label="Краткое наименование" optional>
              <Input {...inp("shortName")} className="rounded-xl" />
            </Row>
            <Row label="Имя для печати" optional>
              <Input {...inp("printName")} className="rounded-xl" />
            </Row>
          </div>
          <Row label="Описание" optional>
            <Textarea
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              disabled={loading}
              className="min-h-[72px] rounded-xl text-sm"
              rows={3}
            />
          </Row>
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/70 bg-muted/15 px-3 py-3">
            <div className="w-full text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Фото номенклатуры
            </div>
            {form.imageUrl.trim() ? (
              <button
                type="button"
                onClick={() => setImagePreviewOpen(true)}
                title="Увеличить фото"
                className="group relative h-32 w-32 shrink-0 overflow-hidden rounded-xl border border-border bg-white outline-none ring-offset-background transition hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={form.imageUrl.trim()}
                  alt={form.name.trim() || "Фото номенклатуры"}
                  className="h-full w-full object-contain"
                  onError={(e) => {
                    ;(e.target as HTMLImageElement).style.display = "none"
                  }}
                />
                <span className="pointer-events-none absolute bottom-1 right-1 rounded-md bg-black/55 p-1 text-white opacity-80 group-hover:opacity-100">
                  <ZoomIn className="h-3.5 w-3.5" />
                </span>
              </button>
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="cursor-pointer text-xs"
                disabled={loading || imageUploading}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ""
                  if (f) void handlePickItemImage(f)
                }}
              />
              <Input
                value={form.imageUrl}
                onChange={(e) => setForm((p) => ({ ...p, imageUrl: e.target.value }))}
                placeholder="или вставьте URL /wms-item-images/…"
                className="font-mono text-xs"
                disabled={loading}
              />
              {imageUploading ? (
                <p className="text-xs text-muted-foreground">Загрузка…</p>
              ) : null}
              {imageError ? <p className="text-xs text-destructive">{imageError}</p> : null}
            </div>
            {form.imageUrl.trim() ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => setForm((p) => ({ ...p, imageUrl: "" }))}
              >
                Убрать
              </Button>
            ) : null}
          </div>
          <Row label="Комментарий" optional>
            <Textarea
              value={form.comment}
              onChange={(e) => setForm((p) => ({ ...p, comment: e.target.value }))}
              disabled={loading}
              className="min-h-[56px] rounded-xl text-sm"
              rows={2}
            />
          </Row>
          <div className="grid gap-3 sm:grid-cols-2">
            <Row label="Тип номенклатуры">
              <select
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                value={
                  typeOptions.some((o) => o.value === form.type)
                    ? form.type
                    : typeOptions[0]?.value ?? "PRODUCT"
                }
                onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}
                disabled={loading}
              >
                {typeOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Статус">
              <select
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                value={form.status}
                onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as NomenclatureStatus }))}
                disabled={loading}
              >
                {NOM_STATUS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Row>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Row label="Группа">
              <select
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                value={
                  groupDefs.some((o) => o.code === form.groupId)
                    ? form.groupId
                    : form.groupId
                      ? "__custom__"
                      : ""
                }
                onChange={(e) => {
                  const v = e.target.value
                  if (!v) {
                    setForm((p) => ({ ...p, groupId: "", groupName: "" }))
                    return
                  }
                  if (v === "__custom__") return
                  const g = groupDefs.find((x) => x.code === v)
                  setForm((p) => ({
                    ...p,
                    groupId: v,
                    groupName: g?.name || p.groupName,
                  }))
                }}
                disabled={loading}
              >
                <option value="">— не выбрана —</option>
                {groupDefs
                  .filter((o) => o.isActive || o.code === form.groupId)
                  .map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.name} ({o.code})
                    </option>
                  ))}
                {form.groupId && !groupDefs.some((o) => o.code === form.groupId) ? (
                  <option value="__custom__">{form.groupName || form.groupId} (текущая)</option>
                ) : null}
              </select>
            </Row>
            <Row label="Класс хранения">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lg bg-primary/10 px-2.5 py-1 text-sm font-semibold">
                    {STORAGE_CLASS_META[derivedClass].short}
                  </span>
                  <span className="text-xs text-muted-foreground">считается сам по названию</span>
                </div>
                <select
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                  value={
                    classDefs.some((o) => o.code === (form.categoryId || derivedClass))
                      ? form.categoryId || derivedClass
                      : form.categoryId
                        ? "__custom__"
                        : derivedClass
                  }
                  onChange={(e) => {
                    const v = e.target.value
                    if (!v) {
                      setForm((p) => ({ ...p, categoryId: derivedClass, categoryName: STORAGE_CLASS_META[derivedClass].title }))
                      return
                    }
                    if (v === "__custom__") return
                    const c = classDefs.find((x) => x.code === v)
                    setForm((p) => ({
                      ...p,
                      categoryId: v,
                      categoryName: c?.name || p.categoryName,
                    }))
                  }}
                  disabled={loading}
                >
                  {classDefs
                    .filter((o) => o.isActive || o.code === form.categoryId || o.code === derivedClass)
                    .map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.name} ({o.code})
                      </option>
                    ))}
                  {form.categoryId && !classDefs.some((o) => o.code === form.categoryId) ? (
                    <option value="__custom__">{form.categoryName || form.categoryId} (текущий)</option>
                  ) : null}
                </select>
              </div>
            </Row>
            <Row label="Группа (название вручную)" optional>
              <Input
                {...inp("groupName")}
                placeholder="Если группы нет в списке — введите название"
              />
            </Row>
            <Row label="Группа (код вручную)" optional>
              <Input {...inp("groupId")} placeholder="stickers" />
            </Row>
            <Row label="Класс (код вручную)" optional>
              <Input {...inp("categoryId")} placeholder="S1" />
            </Row>
            <Row label="Класс (название вручную)" optional>
              <Input {...inp("categoryName")} placeholder="Мелкоштучный" />
            </Row>
            <Row label="Подгруппа (id)" optional>
              <Input {...inp("subgroupId")} />
            </Row>
            <Row label="Подгруппа (название)" optional>
              <Input {...inp("subgroupName")} />
            </Row>
            <Row label="Бренд (id)" optional>
              <Input {...inp("brandId")} />
            </Row>
            <Row label="Бренд" optional>
              <Input {...inp("brandName")} />
            </Row>
            <Row label="Производитель (id)" optional>
              <Input {...inp("manufacturerId")} />
            </Row>
            <Row label="Производитель" optional>
              <Input {...inp("manufacturerName")} />
            </Row>
          </div>
        </TabsContent>

        <TabsContent value="ids" className="m-0 mt-0 space-y-3 focus-visible:outline-none">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Row label="GTIN" optional>
              <Input {...inp("gtin")} />
            </Row>
            <Row label="EAN-13" optional>
              <Input {...inp("ean13")} />
            </Row>
            <Row label="Префикс DataMatrix" optional>
              <Input {...inp("datamatrixPrefix")} />
            </Row>
            <Row label="Артикул" optional>
              <Input {...inp("article")} />
            </Row>
            <Row label="Код поставщика" optional>
              <Input {...inp("vendorCode")} />
            </Row>
          </div>
        </TabsContent>

        <TabsContent value="units" className="m-0 mt-0 space-y-3 focus-visible:outline-none">
          <p className="text-xs text-muted-foreground">
            Базовая единица попадает в <span className="font-mono">wms_items.uom_code</span>. При указании единицы
            хранения и коэффициента (например 22 000) в справочник единиц добавляются строки: база = 1 шт, склад =
            N шт в одной бухте.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Row label="Код базовой единицы (PCS)">
              <Input {...inp("baseUnitCode")} placeholder="PCS" />
            </Row>
            <Row label="Название базовой единицы">
              <Input {...inp("baseUnitName")} placeholder="шт" />
            </Row>
            <Row label="Базовая ед. id" optional>
              <Input {...inp("baseUnitId")} />
            </Row>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Row label="Единица хранения (код)" optional>
              <Input {...inp("storageUnitCode")} placeholder="ROLL" />
            </Row>
            <Row label="Единица хранения (название)" optional>
              <Input {...inp("storageUnitName")} placeholder="бухта" />
            </Row>
            <Row label="Ед. хранения id" optional>
              <Input {...inp("storageUnitId")} />
            </Row>
            <Row label="Коэффициент (1 ед. хранения = N базовых)" optional>
              <Input {...inp("conversionFactor")} placeholder="22000" inputMode="decimal" />
            </Row>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Row label="Закупка (код)" optional>
              <Input {...inp("purchaseUnitCode")} />
            </Row>
            <Row label="Закупка (название)" optional>
              <Input {...inp("purchaseUnitName")} />
            </Row>
            <Row label="Закупка id" optional>
              <Input {...inp("purchaseUnitId")} />
            </Row>
            <Row label="Выдача (код)" optional>
              <Input {...inp("issueUnitCode")} />
            </Row>
            <Row label="Выдача (название)" optional>
              <Input {...inp("issueUnitName")} />
            </Row>
            <Row label="Выдача id" optional>
              <Input {...inp("issueUnitId")} />
            </Row>
          </div>
        </TabsContent>

        <TabsContent value="acct" className="m-0 mt-0 space-y-3 focus-visible:outline-none">
          <div className="grid gap-2 sm:grid-cols-2">
            <Bool form={form} setForm={setForm} field="batchControl" label="Партионный учёт" />
            <Bool form={form} setForm={setForm} field="serialControl" label="Серийный учёт" />
            <Bool form={form} setForm={setForm} field="markingControl" label="Учёт маркировки" />
            <Bool form={form} setForm={setForm} field="expirationControl" label="Контроль срока годности" />
            <Bool form={form} setForm={setForm} field="fefoEnabled" label="FEFO" />
            <Bool form={form} setForm={setForm} field="fifoEnabled" label="FIFO (альтернатива FEFO)" />
            <Bool form={form} setForm={setForm} field="qualityControl" label="Контроль качества при приёмке" />
          </div>
          <p className="text-xs text-muted-foreground">
            FEFO влияет на порядок выдачи со склада OS в цех (ТСД и веб).{" "}
            <Link href="/help#fefo" className="text-primary underline-offset-2 hover:underline">
              Как настроить и отключить
            </Link>
          </p>
        </TabsContent>

        <TabsContent value="shelf" className="m-0 mt-0 space-y-3 focus-visible:outline-none">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Row label="Срок годности, дней" optional>
              <Input {...inp("shelfLifeDays")} inputMode="numeric" />
            </Row>
            <Row label="Срок хранения, дней" optional>
              <Input {...inp("storageLifeDays")} inputMode="numeric" />
            </Row>
            <Row label="Порог предупреждения, дн." optional>
              <Input {...inp("nearExpirationDays")} inputMode="numeric" />
            </Row>
            <Row label="Критический порог, дн." optional>
              <Input {...inp("criticalExpirationDays")} inputMode="numeric" />
            </Row>
            <Row label="Мин. дней для приёмки" optional>
              <Input {...inp("minDaysForAcceptance")} inputMode="numeric" />
            </Row>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Bool form={form} setForm={setForm} field="blockExpired" label="Блокировать просроченное" />
            <Bool form={form} setForm={setForm} field="allowNoExpirationDate" label="Разрешить без срока" />
          </div>
          <Row label="Условия хранения (текст)" optional>
            <Textarea
              value={form.storageConditions}
              onChange={(e) => setForm((p) => ({ ...p, storageConditions: e.target.value }))}
              disabled={loading}
              className="min-h-[64px] rounded-xl text-sm"
            />
          </Row>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Row label="Темп. min, °C" optional>
              <Input {...inp("temperatureMin")} inputMode="decimal" />
            </Row>
            <Row label="Темп. max, °C" optional>
              <Input {...inp("temperatureMax")} inputMode="decimal" />
            </Row>
            <Row label="Влажность min, %" optional>
              <Input {...inp("humidityMin")} inputMode="decimal" />
            </Row>
            <Row label="Влажность max, %" optional>
              <Input {...inp("humidityMax")} inputMode="decimal" />
            </Row>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Bool form={form} setForm={setForm} field="lightSensitive" label="Светочувствительно" />
            <Bool form={form} setForm={setForm} field="fragile" label="Хрупкое" />
          </div>
          <Row label="Класс опасности" optional>
              <Input {...inp("hazardClass")} className="rounded-xl" />
            </Row>
            <Row label="Аллергены (коды через запятую)" optional>
              <Input {...inp("allergenCodes")} placeholder="молоко, орехи" />
            </Row>
            <Row label="Чей товар" optional>
              <select
                className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
                value={form.stockOwnership}
                onChange={(e) => setForm((p) => ({ ...p, stockOwnership: e.target.value }))}
                disabled={loading}
              >
                <option value="">Наш</option>
                <option value="vendor">Поставщика, лежит у нас</option>
                <option value="customer">Заказчика, дали на розлив</option>
              </select>
            </Row>
        </TabsContent>

        <TabsContent value="dims" className="m-0 mt-0 space-y-3 focus-visible:outline-none">
          <NomenclaturePackVghPanel form={form} setForm={setForm} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Row label="Длина, мм" optional>
              <Input {...inp("lengthMm")} />
            </Row>
            <Row label="Ширина, мм" optional>
              <Input {...inp("widthMm")} />
            </Row>
            <Row label="Высота, мм" optional>
              <Input {...inp("heightMm")} />
            </Row>
            <Row label="Диаметр, мм" optional>
              <Input {...inp("diameterMm")} />
            </Row>
            <Row label="Нетто, кг" optional>
              <Input {...inp("netWeightKg")} />
            </Row>
            <Row label="Брутто, кг" optional>
              <Input {...inp("grossWeightKg")} />
            </Row>
            <Row label="Объём, м³" optional>
              <Input {...inp("volumeM3")} />
            </Row>
            <Row label="Внутр. диаметр рулона, мм" optional>
              <Input {...inp("rollInnerDiameterMm")} />
            </Row>
            <Row label="Внешн. диаметр рулона, мм" optional>
              <Input {...inp("rollOuterDiameterMm")} />
            </Row>
            <Row label="Ширина рулона, мм" optional>
              <Input {...inp("rollWidthMm")} />
            </Row>
            <Row label="Стикеров на рулоне" optional>
              <Input {...inp("stickersPerRoll")} inputMode="numeric" />
            </Row>
          </div>
        </TabsContent>

        <TabsContent value="stick" className="m-0 mt-0 space-y-3 focus-visible:outline-none">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Bool form={form} setForm={setForm} field="isSticker" label="Стикер" />
            <Bool form={form} setForm={setForm} field="isLabel" label="Этикетка" />
            <Bool form={form} setForm={setForm} field="isPackaging" label="Упаковка" />
            <Bool form={form} setForm={setForm} field="isSparePart" label="Запчасть" />
            <Bool form={form} setForm={setForm} field="isConsumable" label="Расходник" />
            <Bool
              form={form}
              setForm={setForm}
              field="printLabelConsumable"
              label="Расходник для печати стикеров"
            />
          </div>
          {form.printLabelConsumable ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Row label="Вид печати (терминал)">
                <select
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                  value={form.stickerPrintKind}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      stickerPrintKind: e.target.value as NomenclatureFormState["stickerPrintKind"],
                    }))
                  }
                  disabled={loading}
                >
                  <option value="">— не задан —</option>
                  <option value="single">Единичный</option>
                  <option value="block12">Блочный</option>
                </select>
              </Row>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Row label="Ширина этикетки, мм" optional>
              <Input {...inp("labelWidthMm")} />
            </Row>
            <Row label="Высота этикетки, мм" optional>
              <Input {...inp("labelHeightMm")} />
            </Row>
            <Row label="Этикеток в рулоне" optional>
              <Input {...inp("labelsPerRoll")} inputMode="numeric" />
            </Row>
            <Row label="Рядов в рулоне" optional>
              <Input {...inp("rowsPerRoll")} inputMode="numeric" />
            </Row>
            <Row label="Диаметр втулки, мм" optional>
              <Input {...inp("rollCoreDiameterMm")} />
            </Row>
            <Row label="Материал этикетки" optional>
              <Input {...inp("labelMaterial")} placeholder="Термо" />
            </Row>
            <Row label="Тип клея" optional>
              <Input {...inp("adhesiveType")} />
            </Row>
            <Row label="Тип принтера" optional>
              <Input {...inp("printerType")} placeholder="TSC, Zebra…" />
            </Row>
            <Row label="Шаблон печати (id)" optional>
              <Input {...inp("templateId")} />
            </Row>
          </div>
        </TabsContent>

        <TabsContent value="mark" className="m-0 mt-0 space-y-3 focus-visible:outline-none">
          <MarkingCodesHelpPanel variant="compact" />
          <Bool form={form} setForm={setForm} field="markingRequired" label="Требуется маркировка" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Row label="Система маркировки" optional>
              <select
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                value={form.markingSystem}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    markingSystem: e.target.value as NomenclatureFormState["markingSystem"],
                  }))
                }
                disabled={loading}
              >
                <option value="">—</option>
                <option value="CHESTNY_ZNAK">Честный знак</option>
                <option value="INTERNAL">Внутренняя</option>
                <option value="NONE">Нет</option>
              </select>
            </Row>
            <Row label="Товарная группа ЧЗ" optional>
              <Input {...inp("czProductGroup")} />
            </Row>
            <Row label="Товарная группа (текст)" optional>
              <Input {...inp("productGroupCz")} />
            </Row>
            <Row label="GTIN (ЧЗ)" optional>
              <Input {...inp("czGtin")} />
            </Row>
            <Row label="ТН ВЭД" optional className="sm:col-span-2">
              <TnvedPicker
                value={form.tnvedCode}
                onChange={(code) => setForm((p) => ({ ...p, tnvedCode: code }))}
                disabled={loading}
              />
            </Row>
            <Row label="ОКПД2" optional>
              <Input {...inp("okpd2Code")} />
            </Row>
          </div>
        </TabsContent>

        <TabsContent value="recv" className="m-0 mt-0 space-y-3 focus-visible:outline-none">
          <div className="grid gap-2 sm:grid-cols-2">
            <Bool form={form} setForm={setForm} field="requiresAcceptanceCheck" label="Требуется проверка при приёмке" />
            <Bool form={form} setForm={setForm} field="requiresCzCheck" label="Проверка ЧЗ при приёмке" />
            <Bool form={form} setForm={setForm} field="requiresPrintOnAcceptance" label="Печать при приёмке" />
            <Bool form={form} setForm={setForm} field="allowPartialReceiving" label="Частичная приёмка" />
            <Bool form={form} setForm={setForm} field="allowOverReceiving" label="Перепоставка" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Row label="Критерии приёмки (id)" optional>
              <Input {...inp("defaultAcceptanceCriteriaId")} />
            </Row>
            <Row label="Допуск приёмки, %" optional>
              <Input {...inp("acceptanceTolerancePercent")} inputMode="decimal" />
            </Row>
          </div>
        </TabsContent>

        <TabsContent value="wh" className="m-0 mt-0 space-y-3 focus-visible:outline-none">
          <div className="rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5 text-sm">
            <p className="font-medium text-foreground">
              Профиль хранения: {STORAGE_CLASS_META[derivedClass].short}
            </p>
            <p className="mt-1 text-muted-foreground">
              S1–S5 считается по названию и физике. ABC / XYZ / FSN — по движениям на складе ГП, не вручную.
              Одна и та же S1-этикетка может быть AX·F или CX·S и стоять в разных местах.
            </p>
            <Link href="/help#wms-terms" className="mt-1 inline-block text-xs text-primary underline-offset-2 hover:underline">
              Словарь терминов WMS
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Row label="Склад по умолчанию" optional>
              <Input {...inp("defaultWarehouseId")} />
            </Row>
            <Row label="Зона по умолчанию" optional>
              <Input {...inp("defaultZoneId")} />
            </Row>
            <Row label="Ячейка по умолчанию" optional>
              <Input {...inp("defaultCellId")} />
            </Row>
            <Row label="Предпочтительные склады (через запятую)" optional>
              <Input {...inp("preferredWarehouseIds")} placeholder="WH1, WH2" className="font-mono text-xs" />
            </Row>
            <Row label="Разрешённые склады (через запятую)" optional>
              <Input {...inp("allowedWarehouseIds")} />
            </Row>
            <Row label="Мин. запас" optional>
              <Input {...inp("minStock")} inputMode="decimal" />
            </Row>
            <Row label="Макс. запас" optional>
              <Input {...inp("maxStock")} inputMode="decimal" />
            </Row>
            <Row label="Цель (target)" optional>
              <Input {...inp("targetStock")} inputMode="decimal" />
            </Row>
            <Row label="Точка заказа" optional>
              <Input {...inp("reorderPoint")} inputMode="decimal" />
            </Row>
            <Row label="Страховой запас" optional>
              <Input {...inp("safetyStock")} inputMode="decimal" />
            </Row>
            <Row label="Срок поставки, дн." optional>
              <Input {...inp("leadTimeDays")} inputMode="numeric" />
            </Row>
            <p className="sm:col-span-2 text-xs text-muted-foreground">
              Склады ГП и материалов сравнивают эти числа с остатком. Если поля пустые — пороги считает расход за 90
              дней, срок поставки по умолчанию 14 дн.{" "}
              <Link href="/help#stock-policy" className="text-primary underline-offset-2 hover:underline">
                Политика запаса
              </Link>
            </p>
          </div>
        </TabsContent>

        <TabsContent value="print" className="m-0 mt-0 space-y-3 focus-visible:outline-none">
          <div className="grid gap-2 sm:grid-cols-2">
            <Bool form={form} setForm={setForm} field="printOnReceiving" label="Печать при приёмке" />
            <Bool form={form} setForm={setForm} field="printOnIssue" label="Печать при выдаче" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Row label="Шаблон этикетки по умолчанию" optional>
              <Input {...inp("defaultLabelTemplateId")} />
            </Row>
            <Row label="Шаблон печати" optional>
              <Input {...inp("printTemplateId")} />
            </Row>
            <Row label="Количество копий" optional>
              <Input {...inp("printCopies")} inputMode="numeric" />
            </Row>
          </div>
        </TabsContent>

        <TabsContent value="extra" className="m-0 mt-0 space-y-4 focus-visible:outline-none">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Row label="НДС %" optional>
              <Input {...inp("vatRate")} inputMode="decimal" />
            </Row>
            <Row label="Счёт учёта" optional>
              <Input {...inp("accountingAccount")} />
            </Row>
            <Row label="Себестоимость" optional>
              <Input {...inp("costPrice")} inputMode="decimal" />
            </Row>
            <Row label="Валюта" optional>
              <Input {...inp("currency")} placeholder="RUB" />
            </Row>
            <Row label="Метод оценки" optional>
              <select
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                value={form.valuationMethod}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    valuationMethod: e.target.value as NomenclatureFormState["valuationMethod"],
                  }))
                }
                disabled={loading}
              >
                <option value="">—</option>
                <option value="FIFO">FIFO</option>
                <option value="FEFO">FEFO</option>
                <option value="AVERAGE">Средняя</option>
                <option value="SPECIFIC">По сериям</option>
              </select>
            </Row>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Row label="externalId" optional>
              <Input {...inp("externalId")} />
            </Row>
            <Row label="erpCode" optional>
              <Input {...inp("erpCode")} />
            </Row>
            <Row label="Код 1С" optional>
              <Input {...inp("oneCCode")} />
            </Row>
            <Row label="GUID 1С" optional>
              <Input {...inp("oneCGuid")} />
            </Row>
            <Row label="Код MES" optional>
              <Input {...inp("mesCode")} />
            </Row>
            <Row label="Код SCADA" optional>
              <Input {...inp("scadaCode")} />
            </Row>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Row label="Изображение URL" optional>
              <Input {...inp("imageUrl")} className="text-xs" />
            </Row>
            <Row label="Иконка URL" optional>
              <Input {...inp("iconUrl")} className="text-xs" />
            </Row>
            <Row label="Datasheet URL" optional>
              <Input {...inp("datasheetUrl")} className="text-xs" />
            </Row>
            <Row label="Сертификат URL" optional>
              <Input {...inp("certificateUrl")} className="text-xs" />
            </Row>
            <Row label="Инструкция URL" optional>
              <Input {...inp("instructionUrl")} className="text-xs" />
            </Row>
          </div>
        </TabsContent>
      </div>
    </Tabs>
    {form.imageUrl.trim() ? (
      <Dialog open={imagePreviewOpen} onOpenChange={setImagePreviewOpen}>
        <DialogContent
          className="max-h-[94vh] w-[min(92vw,880px)] max-w-[min(92vw,880px)] overflow-hidden p-3 sm:max-w-[min(92vw,880px)]"
          overlayClassName="bg-black/70"
        >
          <DialogHeader>
            <DialogTitle className="pr-8 text-base">{form.name.trim() || "Фото номенклатуры"}</DialogTitle>
          </DialogHeader>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={form.imageUrl.trim()}
            alt={form.name.trim() || "Фото номенклатуры"}
            className="max-h-[78vh] w-full rounded-lg bg-white object-contain"
          />
        </DialogContent>
      </Dialog>
    ) : null}
    </>
  )
}
