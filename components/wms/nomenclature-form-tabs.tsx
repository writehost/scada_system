"use client"

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ChevronDown, Search, ZoomIn } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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

/**
 * Разделы формы. `keywords` — надмножество подписей полей раздела (в нижнем
 * регистре): по нему поиск решает, показать раздел или скрыть. Держите его в
 * согласии с полями внутри — этого достаточно для фильтра по полям.
 */
const SECTIONS: { id: string; label: string; sub?: string; keywords: string }[] = [
  {
    id: "main",
    label: "Основное",
    sub: "название, коды, тип",
    keywords:
      "профиль упаковки бд внешний код erp код товара itemcode полное наименование серийный номер номенклатура sku основной штрихкод краткое имя для печати описание фото комментарий тип статус группа класс хранения подгруппа бренд производитель",
  },
  { id: "ids", label: "Идентификаторы", sub: "GTIN, EAN, артикул", keywords: "gtin ean13 ean-13 префикс datamatrix артикул код поставщика vendor" },
  { id: "units", label: "Единицы", sub: "база, хранение, коэффициент", keywords: "код базовой единицы pcs название базовой шт единица хранения roll бухта коэффициент закупка выдача id" },
  { id: "acct", label: "Учёт", sub: "партии, серии, FEFO", keywords: "партионный серийный учёт маркировки контроль срока годности fefo fifo качество приёмке" },
  { id: "shelf", label: "Сроки", sub: "годность, температура", keywords: "срок годности хранения порог предупреждения критический мин дней приёмки блокировать просроченное без срока условия температура влажность светочувствительно хрупкое класс опасности аллергены чей товар" },
  { id: "dims", label: "Габариты", sub: "размеры, вес, палета", keywords: "длина ширина высота диаметр нетто брутто вес объём рулон стикеров" },
  { id: "stick", label: "Стикеры", sub: "этикетки, рулоны, принтер", keywords: "стикер этикетка упаковка запчасть расходник печать вид ширина высота рулоне рядов втулки материал клей принтер шаблон" },
  { id: "mark", label: "Маркировка", sub: "Честный знак, ТН ВЭД", keywords: "требуется маркировка система честный знак внутренняя товарная группа чз gtin тн вэд tnved окпд2" },
  { id: "recv", label: "Приёмка", sub: "проверки, допуски", keywords: "проверка приёмке чз печать частичная перепоставка критерии допуск процент" },
  { id: "wh", label: "Склад", sub: "пороги запаса, зоны", keywords: "профиль хранения склад зона ячейка предпочтительные разрешённые мин макс запас цель точка заказа страховой срок поставки" },
  { id: "print", label: "Печать", sub: "шаблоны, копии", keywords: "печать при приёмке выдаче шаблон этикетки количество копий" },
  { id: "extra", label: "Финансы", sub: "НДС, себестоимость, интеграции", keywords: "ндс vat счёт учёта себестоимость валюта метод оценки externalid erpcode код 1с guid mes scada изображение иконка datasheet сертификат инструкция url" },
]

/** Активная строка поиска по полям — раздаётся вниз, чтобы Row/Bool сами прятались. */
const FieldFilterContext = createContext("")

function useFieldHidden(label: string) {
  const q = useContext(FieldFilterContext).trim().toLowerCase()
  return q.length > 0 && !label.toLowerCase().includes(q)
}

function Row({
  label,
  optional,
  className,
  hint,
  children,
}: {
  label: string
  optional?: boolean
  className?: string
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  const hidden = useFieldHidden(label)
  return (
    <div className={cn("grid gap-1.5", className)} hidden={hidden}>
      <Label className="text-xs font-medium leading-snug">
        {label}
        {optional ? <span className="font-normal text-muted-foreground"> — необяз.</span> : null}
      </Label>
      {children}
      {hint ? <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
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
  const hidden = useFieldHidden(label)
  return (
    <label
      hidden={hidden}
      className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-sm"
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => setForm((p) => ({ ...p, [field]: v === true }))}
      />
      <span>{label}</span>
    </label>
  )
}

function Section({
  id,
  label,
  sub,
  collapsed,
  hidden,
  active,
  onToggle,
  registerRef,
  children,
}: {
  id: string
  label: string
  sub?: string
  collapsed: boolean
  hidden: boolean
  active: boolean
  onToggle: () => void
  registerRef: (id: string, el: HTMLElement | null) => void
  children: React.ReactNode
}) {
  return (
    <section
      ref={(el) => registerRef(id, el)}
      data-sid={id}
      hidden={hidden}
      className="scroll-mt-24 border-b border-border last:border-b-0"
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 py-3.5 text-left"
        aria-expanded={!collapsed}
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            collapsed && "-rotate-90"
          )}
        />
        <h3 className={cn("text-sm font-semibold leading-none", active && "text-primary")}>{label}</h3>
        {sub ? <span className="text-xs font-normal text-muted-foreground">{sub}</span> : null}
      </button>
      <div hidden={collapsed} className="space-y-3 pb-5">
        {children}
      </div>
    </section>
  )
}

export function NomenclatureFormTabs({
  form,
  setForm,
  loading = false,
  lockCode = false,
  scrollMode = "dialog",
}: {
  form: NomenclatureFormState
  setForm: React.Dispatch<React.SetStateAction<NomenclatureFormState>>
  loading?: boolean
  lockCode?: boolean
  /**
   * "dialog" — форма зажата по высоте и скроллится сама (модалка создания).
   * "page" — форма встроена в обычную страницу, которая уже скроллится сама.
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

  const [query, setQuery] = useState("")
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [activeId, setActiveId] = useState<string>("main")
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map())

  const registerRef = (id: string, el: HTMLElement | null) => {
    if (el) sectionRefs.current.set(id, el)
    else sectionRefs.current.delete(id)
  }

  const q = query.trim().toLowerCase()
  const searching = q.length > 0
  const visibleSections = useMemo(
    () =>
      SECTIONS.filter((s) => !searching || `${s.label} ${s.keywords}`.toLowerCase().includes(q)),
    [q, searching]
  )
  const visibleIds = useMemo(() => new Set(visibleSections.map((s) => s.id)), [visibleSections])

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

  // Скролспай: подсвечиваем раздел, который сейчас на экране (когда не ищем).
  useEffect(() => {
    if (searching) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const sid = (e.target as HTMLElement).dataset.sid
            if (sid) setActiveId(sid)
          }
        }
      },
      { rootMargin: "-10% 0px -72% 0px", threshold: 0 }
    )
    sectionRefs.current.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [searching])

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

  const toggleSection = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const jumpTo = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    setActiveId(id)
    const el = sectionRefs.current.get(id)
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const expandAll = () => setCollapsed(new Set())
  const collapseAll = () => setCollapsed(new Set(SECTIONS.map((s) => s.id)))

  const isCollapsed = (id: string) => (searching ? false : collapsed.has(id))

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

  const railTop = scrollMode === "dialog" ? "top-[3.25rem]" : "top-16"

  return (
    <>
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          scrollMode === "dialog" &&
            "overflow-y-auto overscroll-contain [max-height:calc(95vh-9rem)] [min-height:min(480px,45vh)]"
        )}
      >
        {/* Панель: поиск по полям + развернуть/свернуть */}
        <div
          className={cn(
            "sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-2.5 sm:px-6"
          )}
        >
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Найти поле — «ндс», «gtin», «темп»…"
              className="h-9 rounded-xl pl-9 text-sm"
              aria-label="Поиск по полям формы"
            />
          </div>
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
            <button
              type="button"
              onClick={expandAll}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Развернуть всё
            </button>
            <button
              type="button"
              onClick={collapseAll}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Свернуть всё
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 items-start sm:grid-cols-[196px_1fr]">
          {/* Липкий рейл разделов. Без собственного overflow/scroll — иначе колесо мыши
              над узкой колонкой крутит список разделов отдельно от контента справа
              и рейл с видимыми полями расходятся. */}
          <nav
            className={cn(
              "sticky z-10 hidden self-start border-b border-border bg-muted/10 p-2 sm:block sm:border-b-0 sm:border-r",
              railTop
            )}
            aria-label="Разделы формы номенклатуры"
          >
            <div className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Разделы
            </div>
            {SECTIONS.map((s) => {
              const dim = searching && !visibleIds.has(s.id)
              const isActive = !searching && activeId === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => jumpTo(s.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    dim && "opacity-40"
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      isActive ? "bg-primary" : "bg-border"
                    )}
                  />
                  {s.label}
                </button>
              )
            })}
          </nav>

          {/* Разделы формы */}
          <FieldFilterContext.Provider value={query}>
            <div className="min-w-0 px-4 py-2 sm:px-6">
              <Section
                id="main"
                label="Основное"
                sub="название, коды, тип"
                collapsed={isCollapsed("main")}
                hidden={!visibleIds.has("main")}
                active={activeId === "main"}
                onToggle={() => toggleSection("main")}
                registerRef={registerRef}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Row label="Профиль упаковки (БД)" hint="Набор правил расчёта габаритов и веса при приёмке и агрегации.">
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
                  <Row label="Внешний код (ERP)" optional hint="Код этой позиции во внешней учётной системе (1С / ERP).">
                    <Input {...inp("externalCode")} className="rounded-xl" />
                  </Row>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Row label="Код товара (itemCode)" hint="Уникальный код в справочнике. После создания не меняется.">
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
                  <Row label="Основной штрихкод" optional hint="EAN-13 на упаковке. Ищется сканером при приёмке и отборе.">
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
                  <Row label="Группа" hint="Влияет на фильтры, отчёты и класс хранения.">
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
              </Section>

              <Section
                id="ids"
                label="Идентификаторы"
                sub="GTIN, EAN, артикул"
                collapsed={isCollapsed("ids")}
                hidden={!visibleIds.has("ids")}
                active={activeId === "ids"}
                onToggle={() => toggleSection("ids")}
                registerRef={registerRef}
              >
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Row label="GTIN" optional hint="14-значный код для Честного Знака.">
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
              </Section>

              <Section
                id="units"
                label="Единицы"
                sub="база, хранение, коэффициент"
                collapsed={isCollapsed("units")}
                hidden={!visibleIds.has("units")}
                active={activeId === "units"}
                onToggle={() => toggleSection("units")}
                registerRef={registerRef}
              >
                <p className="text-xs text-muted-foreground">
                  Базовая единица попадает в <span className="font-mono">wms_items.uom_code</span>. При указании единицы
                  хранения и коэффициента (например 22 000) в справочник единиц добавляются строки: база = 1 шт, склад =
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
              </Section>

              <Section
                id="acct"
                label="Учёт"
                sub="партии, серии, FEFO"
                collapsed={isCollapsed("acct")}
                hidden={!visibleIds.has("acct")}
                active={activeId === "acct"}
                onToggle={() => toggleSection("acct")}
                registerRef={registerRef}
              >
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
              </Section>

              <Section
                id="shelf"
                label="Сроки"
                sub="годность, температура"
                collapsed={isCollapsed("shelf")}
                hidden={!visibleIds.has("shelf")}
                active={activeId === "shelf"}
                onToggle={() => toggleSection("shelf")}
                registerRef={registerRef}
              >
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Row label="Срок годности, дней" optional hint="Пусто или 0 — срок не контролируется.">
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
              </Section>

              <Section
                id="dims"
                label="Габариты"
                sub="размеры, вес, палета"
                collapsed={isCollapsed("dims")}
                hidden={!visibleIds.has("dims")}
                active={activeId === "dims"}
                onToggle={() => toggleSection("dims")}
                registerRef={registerRef}
              >
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
              </Section>

              <Section
                id="stick"
                label="Стикеры"
                sub="этикетки, рулоны, принтер"
                collapsed={isCollapsed("stick")}
                hidden={!visibleIds.has("stick")}
                active={activeId === "stick"}
                onToggle={() => toggleSection("stick")}
                registerRef={registerRef}
              >
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
              </Section>

              <Section
                id="mark"
                label="Маркировка"
                sub="Честный знак, ТН ВЭД"
                collapsed={isCollapsed("mark")}
                hidden={!visibleIds.has("mark")}
                active={activeId === "mark"}
                onToggle={() => toggleSection("mark")}
                registerRef={registerRef}
              >
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
                  <Row label="Товарная группа ЧЗ" optional hint="Код товарной группы ГИС МТ (water, milk, …).">
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
              </Section>

              <Section
                id="recv"
                label="Приёмка"
                sub="проверки, допуски"
                collapsed={isCollapsed("recv")}
                hidden={!visibleIds.has("recv")}
                active={activeId === "recv"}
                onToggle={() => toggleSection("recv")}
                registerRef={registerRef}
              >
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
              </Section>

              <Section
                id="wh"
                label="Склад"
                sub="пороги запаса, зоны"
                collapsed={isCollapsed("wh")}
                hidden={!visibleIds.has("wh")}
                active={activeId === "wh"}
                onToggle={() => toggleSection("wh")}
                registerRef={registerRef}
              >
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
                  <Row label="Склад по умолчанию" optional hint="Куда приходуется приёмка, если ячейка не указана вручную.">
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
                  <Row label="Срок поставки, дн." optional hint="Если пусто — берётся 14 дней по умолчанию.">
                    <Input {...inp("leadTimeDays")} inputMode="numeric" />
                  </Row>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    Склады ГП и материалов сравнивают эти числа с остатком. Если поля пустые — пороги считает расход за 90
                    дней, срок поставки по умолчанию 14 дн.{" "}
                    <Link href="/help#stock-policy" className="text-primary underline-offset-2 hover:underline">
                      Политика запаса
                    </Link>
                  </p>
                </div>
              </Section>

              <Section
                id="print"
                label="Печать"
                sub="шаблоны, копии"
                collapsed={isCollapsed("print")}
                hidden={!visibleIds.has("print")}
                active={activeId === "print"}
                onToggle={() => toggleSection("print")}
                registerRef={registerRef}
              >
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
              </Section>

              <Section
                id="extra"
                label="Финансы"
                sub="НДС, себестоимость, интеграции"
                collapsed={isCollapsed("extra")}
                hidden={!visibleIds.has("extra")}
                active={activeId === "extra"}
                onToggle={() => toggleSection("extra")}
                registerRef={registerRef}
              >
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Row label="НДС %" optional hint="Ставка для документов реализации.">
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
              </Section>

              {searching && visibleSections.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  Ничего не найдено. Очистите поиск, чтобы вернуть все разделы.
                </p>
              ) : null}
            </div>
          </FieldFilterContext.Provider>
        </div>
      </div>

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
