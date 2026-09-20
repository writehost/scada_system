"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarDays,
  ClipboardList,
  History,
  Loader2,
  MapPin,
  Package2,
  Save,
  Settings2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  getWmsItemDetail,
  getWmsClientErrorMeta,
  importWmsItemUoms,
  importWmsItems,
  ensureItemQpass,
  listItemAliases,
  moveWmsLotBucket,
  updateWmsLot,
  type ItemAliasRow,
  type WmsItemDetailResponse,
  type WmsItemResourceRow,
} from "@/lib/wms-api"
import { extractItemImageUrl } from "@/lib/wms/item-image"
import { deriveProductPhysicalProfile, storageClassLabel } from "@/lib/wms/physical-profile"
import { hasCyrillicText, russifyCrptProductGroup } from "@/lib/wms/crpt-product-groups"
import { readEquipmentSerialFromAttrs, readQpassLinkFromAttrs } from "@/lib/wms/qpass"
import { NomenclatureFormTabs } from "@/components/wms/nomenclature-form-tabs"
import { NomenclaturePhysicalSuggestPanel } from "@/components/wms/nomenclature-physical-suggest"
import {
  buildImportItemRow,
  buildImportUomRows,
  emptyNomenclatureForm,
  type NomenclatureFormState,
  wmsItemToNomenclatureForm,
} from "@/lib/nomenclature-model"
import { cn } from "@/lib/utils"
import { NomenclatureItemCompositionPanel } from "@/components/wms/nomenclature-item-composition-panel"
import { NomenclatureItemMovementsPanel } from "@/components/wms/nomenclature-item-movements-panel"
import { NomenclatureItemStockPanel } from "@/components/wms/nomenclature-item-stock-panel"
import { NomenclatureItemSuppliersPanel } from "@/components/wms/nomenclature-item-suppliers-panel"
import { NomenclatureItemQpassPanel } from "@/components/wms/nomenclature-item-qpass-panel"
import {
  ItemLoadErrorPanel,
  NomenclatureItemHero,
  type HeroAttachment,
  type HeroBadge,
  type HeroFact,
  type HeroStat,
} from "@/components/wms/nomenclature-item-hero"

type ItemRow = WmsItemDetailResponse["item"] & Record<string, unknown>

function fmtQty(n: unknown): string {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return "0"
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

function lotEmissionInfo(l: Record<string, unknown>): { sortKey: string; label: string; dayKey: string } {
  const manufacturedAt = l.manufacturedAt ? String(l.manufacturedAt) : null
  if (manufacturedAt) {
    const d = new Date(manufacturedAt)
    if (!Number.isNaN(d.getTime())) {
      const dayKey = d.toISOString().slice(0, 10).replace(/-/g, "")
      return {
        sortKey: d.toISOString(),
        label: d.toLocaleDateString("ru-RU"),
        dayKey,
      }
    }
  }
  const lotCode = String(l.lotCode ?? "")
  const m = lotCode.match(/RCV-(\d{4})(\d{2})(\d{2})-/i)
  if (m) {
    return {
      sortKey: `${m[1]}-${m[2]}-${m[3]}`,
      label: `${m[3]}.${m[2]}.${m[1]}`,
      dayKey: `${m[1]}${m[2]}${m[3]}`,
    }
  }
  return { sortKey: "9999-99-99", label: "—", dayKey: "" }
}

function fmtDateRu(value: unknown): string {
  if (!value) return "—"
  try {
    return new Date(String(value)).toLocaleDateString("ru-RU")
  } catch {
    return "—"
  }
}

function fmtDateTimeRu(value: unknown): string {
  if (!value) return "—"
  try {
    return new Date(String(value)).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return "—"
  }
}

const linkClass =
  "font-medium text-emerald-800 underline-offset-2 hover:underline dark:text-emerald-400"

function otherLotQty(l: Record<string, unknown>): { total: number; parts: string[] } {
  const reserved = Number(l.reservedQty ?? 0)
  const inTransit = Number(l.inTransitQty ?? 0)
  const quarantine = Number(l.quarantineQty ?? 0)
  const rejected = Number(l.rejectedQty ?? 0)
  const parts: string[] = []
  if (reserved > 0) parts.push(`рез. ${fmtQty(reserved)}`)
  if (inTransit > 0) parts.push(`путь ${fmtQty(inTransit)}`)
  if (quarantine > 0) parts.push(`кар. ${fmtQty(quarantine)}`)
  if (rejected > 0) parts.push(`брак ${fmtQty(rejected)}`)
  return { total: reserved + inTransit + quarantine + rejected, parts }
}

function formatCounterpartyNames(aliases: ItemAliasRow[]): string {
  const names: string[] = []
  const seen = new Set<string>()
  for (const row of aliases) {
    if (row.isActive === false) continue
    const name = String(row.supplierName || row.supplierCode || "").trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names.join(" · ")
}

function itemImageUrl(
  form: NomenclatureFormState | null,
  item: Record<string, unknown> | undefined
): string {
  const fromForm = form?.imageUrl.trim() || ""
  if (fromForm) return fromForm
  const attrs = (item?.itemAttrs ?? item?.item_attrs_json ?? null) as
    | Record<string, unknown>
    | null
  return extractItemImageUrl(attrs) || ""
}

/** Текстовые блоки описания. Табличные факты живут отдельно — в «Реквизитах» карточки. */
function buildItemDescriptionSummary(
  form: NomenclatureFormState | null
): Array<{ label?: string; text: string }> {
  if (!form) return []
  const blocks: Array<{ label?: string; text: string }> = []
  const push = (text: string, label?: string) => {
    const value = text.trim()
    if (!value) return
    if (blocks.some((block) => block.text === value)) return
    blocks.push(label ? { label, text: value } : { text: value })
  }

  push(form.description)
  if (form.nomenclature.trim() && form.nomenclature.trim() !== form.name.trim()) {
    push(form.nomenclature, "Составное наименование")
  }
  push(form.comment, "Комментарий")
  return blocks
}

function joinParts(parts: Array<string | undefined>, separator = " · "): string {
  return parts.map((p) => (p ?? "").trim()).filter(Boolean).join(separator)
}

function buildItemFacts(
  form: NomenclatureFormState | null,
  item: Record<string, unknown> | undefined,
  extra: { counterparty?: string }
): HeroFact[] {
  const facts: HeroFact[] = []
  const push = (label: string, value: string | undefined, mono?: boolean) => {
    const text = (value ?? "").trim()
    if (!text) return
    if (facts.some((fact) => fact.label === label)) return
    facts.push({ label, value: text, mono })
  }
  const name = form?.name.trim() ?? ""
  const dims = joinParts([form?.lengthMm, form?.widthMm, form?.heightMm], " × ")
  const weight = joinParts([
    form?.netWeightKg ? `нетто ${form.netWeightKg}` : undefined,
    form?.grossWeightKg ? `брутто ${form.grossWeightKg}` : undefined,
  ])
  const temperature =
    form?.temperatureMin || form?.temperatureMax
      ? `${form?.temperatureMin || "—"}…${form?.temperatureMax || "—"} °C`
      : ""

  push("Тип", form?.categoryName || String(item?.materialType ?? ""))
  push("Подгруппа", form?.subgroupName)
  push("Производитель", joinParts([form?.manufacturerName, form?.brandName]))
  push("Контрагент", extra.counterparty)
  push("Артикул", joinParts([form?.article, form?.vendorCode]), true)
  push("Серийный №", form?.equipmentSerial, true)
  push("Штрихкод", form?.primaryBarcode || form?.gtin || form?.ean13, true)
  push("Ед. изм.", joinParts([form?.baseUnitName || form?.baseUnitCode]))
  push("Габариты, мм", dims)
  push("Вес, кг", weight)
  const profile = deriveProductPhysicalProfile({
    name: form?.name,
    itemTypeCode: String(item?.itemTypeCode ?? item?.materialType ?? ""),
    itemClassCode: String(item?.itemClassCode ?? ""),
    itemGroupCode: form?.groupName || form?.categoryName,
    lengthMm: form?.lengthMm ? Number(form.lengthMm) : null,
    widthMm: form?.widthMm ? Number(form.widthMm) : null,
    heightMm: form?.heightMm ? Number(form.heightMm) : null,
    netWeightKg: form?.netWeightKg ? Number(form.netWeightKg) : null,
    grossWeightKg: form?.grossWeightKg ? Number(form.grossWeightKg) : null,
    fragile: form?.fragile,
    hazardClass: form?.hazardClass,
    temperatureMin: form?.temperatureMin ? Number(form.temperatureMin) : null,
    temperatureMax: form?.temperatureMax ? Number(form.temperatureMax) : null,
  })
  push("Класс хранения", storageClassLabel(profile.storageClass))
  push("Оборачиваемость", `Velocity ${profile.velocityClass}`)
  push("Хранение", joinParts([form?.storageConditions, temperature]))
  push("Срок годности", form?.shelfLifeDays ? `${form.shelfLifeDays} дн.` : "")
  if (form?.shortName.trim() && form.shortName.trim() !== name) {
    push("Кратко", form.shortName)
  }
  if (form?.printName.trim() && form.printName.trim() !== name) {
    push("Для печати", form.printName)
  }
  push("ТН ВЭД", form?.tnvedCode, true)
  push("Код 1С", form?.oneCCode, true)
  push("Код ERP", form?.erpCode, true)
  return facts
}

function buildItemAttachments(form: NomenclatureFormState | null): HeroAttachment[] {
  if (!form) return []
  const rows: Array<[string, string]> = [
    ["Даташит", form.datasheetUrl],
    ["Сертификат", form.certificateUrl],
    ["Инструкция", form.instructionUrl],
  ]
  return rows
    .filter(([, href]) => href.trim())
    .map(([label, href]) => ({ label, href: href.trim() }))
}

function NomenclatureItemPageInner() {
  const params = useParams()
  const router = useRouter()
  const search = useSearchParams()
  const raw = typeof params?.itemCode === "string" ? params.itemCode : ""
  const itemCode = raw ? decodeURIComponent(raw) : ""

  const [data, setData] = useState<WmsItemDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [nomForm, setNomForm] = useState<NomenclatureFormState | null>(null)
  const [isNewItem, setIsNewItem] = useState(false)
  const [nomSaving, setNomSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorStatus, setErrorStatus] = useState<number | undefined>(undefined)
  const [saveOk, setSaveOk] = useState<string | null>(null)

  const highlightLotCode = (search.get("lotCode") || "").trim()
  const highlightLocationCode = (search.get("fromLocation") || "").trim()
  const createdFlash = (search.get("created") || "").trim()

  const [lotOpen, setLotOpen] = useState(false)
  const [activeLotId, setActiveLotId] = useState<string | null>(null)
  const [lotSaving, setLotSaving] = useState(false)
  const [lotError, setLotError] = useState<string | null>(null)
  const [lotQaStatusCode, setLotQaStatusCode] = useState("")
  const [lotNote, setLotNote] = useState("")
  const [lotMoveQty, setLotMoveQty] = useState("")
  const [mainTab, setMainTab] = useState("catalog")
  const [itemAliases, setItemAliases] = useState<ItemAliasRow[]>([])

  const receivingReceipts = useMemo(() => data?.receivingReceipts ?? [], [data])

  const lots = useMemo(() => {
    const rows = (data?.lots || []).map((x) => x as Record<string, unknown>)
    const perishable = Boolean(data?.item?.isPerishable)
    const cmp = (a: Record<string, unknown>, b: Record<string, unknown>) => {
      const ea = lotEmissionInfo(a)
      const eb = lotEmissionInfo(b)
      if (perishable) return ea.sortKey.localeCompare(eb.sortKey)
      return eb.sortKey.localeCompare(ea.sortKey)
    }
    return [...rows].sort(cmp)
  }, [data])

  const activeLot = useMemo(() => {
    if (!activeLotId) return null
    const found = lots.find((l) => String(l.lotId ?? "") === activeLotId)
    return found ?? null
  }, [lots, activeLotId])

  useEffect(() => {
    if (!lotOpen) return
    if (!activeLot) return
    setLotError(null)
    setLotQaStatusCode(String(activeLot.qaStatusCode ?? ""))
    setLotNote(String(activeLot.note ?? ""))
    const avail = Number(activeLot.availableQty ?? 0)
    setLotMoveQty(avail > 0 ? String(Math.round(avail)) : "")
  }, [lotOpen, activeLot])

  useEffect(() => {
    if (highlightLotCode) {
      setMainTab("lots")
      return
    }
    if (highlightLocationCode) {
      setMainTab("locations")
      return
    }
    // Default: где лежит. Не уводим на партии/приёмки автоматически.
  }, [highlightLotCode, highlightLocationCode])

  useEffect(() => {
    if (!highlightLotCode && !highlightLocationCode) return
    const id = highlightLotCode ? "lots" : "stockByLocation"
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [highlightLotCode, highlightLocationCode, data, mainTab])

  const allowCreateDraft =
    search.get("create") === "1" || search.get("new") === "1"

  const load = useCallback(async () => {
    if (!itemCode) return
    setLoading(true)
    setError(null)
    setErrorStatus(undefined)
    try {
      const d = await getWmsItemDetail(itemCode)
      setData(d)
      setIsNewItem(false)
      const it = d.item as ItemRow
      const uoms = (d.itemUoms ?? []) as Array<Record<string, unknown>>
      setNomForm(wmsItemToNomenclatureForm(it, uoms))
      try {
        const aliasRes = await listItemAliases(itemCode)
        setItemAliases(aliasRes.aliases || [])
      } catch {
        setItemAliases([])
      }
    } catch (e) {
      const meta = getWmsClientErrorMeta(e)
      if (meta.status === 404 && allowCreateDraft) {
        // Явное создание по коду из URL (?create=1) — иначе 404 не маскируем под «новую».
        const draft = emptyNomenclatureForm()
        draft.code = itemCode
        setData(null)
        setIsNewItem(true)
        setNomForm(draft)
        setItemAliases([])
        setMainTab("catalog")
        setError(null)
      } else if (meta.status === 404) {
        setError(
          `Позиция «${itemCode}» не найдена в справочнике. Если она есть в списке — обновите страницу; для создания откройте «Новая позиция».`
        )
        setData(null)
        setIsNewItem(false)
        setNomForm(null)
        setItemAliases([])
      } else {
        const status = meta.status
        setErrorStatus(status)
        setError(
          status && status >= 500
            ? "Не удалось загрузить карточку: сервис данных вернул ошибку"
            : e instanceof Error
              ? e.message
              : "Ошибка загрузки"
        )
        setData(null)
        setIsNewItem(false)
        setNomForm(null)
        setItemAliases([])
      }
    } finally {
      setLoading(false)
    }
  }, [itemCode, allowCreateDraft])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (search.get("edit") === "1") {
      setMainTab("catalog")
    }
  }, [search])

  useEffect(() => {
    if (!createdFlash || !itemCode) return
    const id = window.setTimeout(() => {
      router.replace(`/nomenclature/${encodeURIComponent(itemCode)}`)
    }, 6000)
    return () => window.clearTimeout(id)
  }, [createdFlash, itemCode, router])

  async function saveNomForm() {
    if (!nomForm) return
    const code = nomForm.code.trim() || itemCode.trim()
    let name = nomForm.name.trim()
    if (!code) {
      setError("Укажите код")
      return
    }
    if (!name) {
      // Для новой позиции имя нужно; для существующей — не блокируем смену только группы.
      if (isNewItem) {
        setError("Укажите наименование — без него позицию не создать")
        return
      }
      name = code
    }
    setNomSaving(true)
    setError(null)
    setSaveOk(null)
    try {
      const payload = { ...nomForm, code, name }
      const existingAttrs = (data?.item?.itemAttrs ?? data?.item?.item_attrs_json) as
        | Record<string, unknown>
        | undefined
      await importWmsItems([buildImportItemRow(payload, existingAttrs)])
      const uoms = buildImportUomRows(payload)
      if (uoms.length > 0) {
        await importWmsItemUoms(uoms)
      }
      const serial = payload.equipmentSerial.trim()
      if (name && serial) {
        await ensureItemQpass(code, { name, serial })
      }
      await load()
      setSaveOk(isNewItem ? "Позиция создана" : "Реквизиты сохранены")
      window.setTimeout(() => setSaveOk(null), 4000)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить")
    } finally {
      setNomSaving(false)
    }
  }

  function openLot(lotId: string) {
    setActiveLotId(lotId)
    setLotOpen(true)
  }

  async function saveLotFields() {
    if (!activeLotId) return
    setLotSaving(true)
    setLotError(null)
    try {
      await updateWmsLot(activeLotId, {
        qaStatusCode: lotQaStatusCode.trim() || null,
        note: lotNote.trim() || null,
      })
      await load()
    } catch (e) {
      setLotError(e instanceof Error ? e.message : "Не удалось сохранить лот")
    } finally {
      setLotSaving(false)
    }
  }

  async function toggleLotBlocked() {
    if (!activeLotId) return
    const isBlocked = Boolean(activeLot?.isBlocked)
    setLotSaving(true)
    setLotError(null)
    try {
      await updateWmsLot(activeLotId, { isBlocked: !isBlocked })
      await load()
    } catch (e) {
      setLotError(e instanceof Error ? e.message : "Не удалось обновить блокировку")
    } finally {
      setLotSaving(false)
    }
  }

  async function moveLot(fromBucket: "available" | "quarantine", toBucket: "available" | "quarantine") {
    if (!activeLotId) return
    const qty = Number(lotMoveQty)
    if (!(qty > 0)) {
      setLotError("Укажите количество больше нуля")
      return
    }
    setLotSaving(true)
    setLotError(null)
    try {
      await moveWmsLotBucket({ lotId: activeLotId, fromBucket, toBucket, qty })
      await load()
    } catch (e) {
      setLotError(e instanceof Error ? e.message : "Не удалось выполнить перемещение")
    } finally {
      setLotSaving(false)
    }
  }

  if (!itemCode) {
    return (
      <div className="p-6">
        <p className="text-destructive">Некорректный код товара</p>
        <Button variant="link" onClick={() => router.push("/nomenclature")}>
          К списку
        </Button>
      </div>
    )
  }

  if (loading && !data && !nomForm) {
    return (
      <div className="wms-panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border bg-muted/20 px-3 py-3 sm:px-4 lg:flex-row">
          <div className="h-24 w-24 shrink-0 animate-pulse rounded-xl bg-muted sm:h-28 sm:w-28" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="h-20 animate-pulse rounded-xl bg-muted" />
              <div className="h-20 animate-pulse rounded-xl bg-muted" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загружаем карточку позиции {itemCode}…
        </div>
      </div>
    )
  }

  if (error && !nomForm && !data) {
    return (
      <div className="wms-panel overflow-hidden">
        <div className="border-b border-border bg-muted/20 px-3 py-3 sm:px-4">
          <Link
            href="/nomenclature"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Номенклатура
          </Link>
          <h1 className="font-mono text-base font-semibold leading-snug text-foreground">{itemCode}</h1>
        </div>
        <ItemLoadErrorPanel
          message={error}
          status={errorStatus}
          onRetry={() => void load()}
          retrying={loading}
        />
      </div>
    )
  }

  const it = data?.item as ItemRow | undefined
  const totals = data?.totals
  const displayName = nomForm?.name.trim() || String(it?.name ?? "Без названия")
  const displaySku = nomForm?.sku.trim() || String(it?.sku ?? "")
  const rawGroup =
    nomForm?.groupName.trim() ||
    nomForm?.groupId.trim() ||
    String(it?.productGroup ?? "")
  const displayGroup = rawGroup
    ? hasCyrillicText(rawGroup)
      ? rawGroup
      : russifyCrptProductGroup(rawGroup)
    : ""
  const displayMarked = Boolean(
    nomForm?.markingControl || nomForm?.markingRequired || it?.isMarked
  )
  const itemPerishable = Boolean(nomForm?.expirationControl || it?.isPerishable)
  const counterpartyText =
    formatCounterpartyNames(itemAliases) ||
    String(it?.supplierNames ?? it?.primarySupplierName ?? "").trim()
  const descriptionSummary = buildItemDescriptionSummary(nomForm)
  const itemFacts = buildItemFacts(nomForm, it, { counterparty: counterpartyText })
  const itemAttachments = buildItemAttachments(nomForm)
  const cardImageUrl = itemImageUrl(nomForm, it)
  const qpassStored = readQpassLinkFromAttrs(it?.itemAttrs ?? it?.item_attrs_json)
  const equipmentSerial =
    qpassStored?.serial || readEquipmentSerialFromAttrs(it?.itemAttrs ?? it?.item_attrs_json)
  const isEquipment =
    String(it?.itemTypeCode ?? "").toLowerCase() === "equipment" ||
    Boolean(qpassStored) ||
    Boolean(equipmentSerial)

  const heroBadges: HeroBadge[] = [
    { text: String(it?.itemCode ?? itemCode), tone: "code" },
    ...(displaySku ? [{ text: `SKU ${displaySku}`, tone: "outline" as const }] : []),
    ...(displayGroup ? [{ text: displayGroup, tone: "outline" as const }] : []),
    ...(displayMarked ? [{ text: "Маркировка", tone: "info" as const }] : []),
    ...(itemPerishable ? [{ text: "Срок годности", tone: "warn" as const }] : []),
    ...(it && it.isActive === false ? [{ text: "Неактивна", tone: "warn" as const }] : []),
  ]

  const itemTabs = [
    { value: "catalog", label: "Карточка", icon: Settings2, count: 0 },
    { value: "locations", label: "Остатки", icon: MapPin, count: data?.stockByLocation?.length ?? 0 },
    { value: "lots", label: "Партии", icon: CalendarDays, count: lots.length },
    { value: "receipts", label: "Приёмки", icon: ClipboardList, count: receivingReceipts.length },
    { value: "movements", label: "Движения", icon: History, count: 0 },
    { value: "resources", label: "Состав", icon: Package2, count: data?.resources?.length ?? 0 },
    { value: "suppliers", label: "Контрагенты", icon: Building2, count: itemAliases.length },
  ]

  const heroStats: HeroStat[] = totals
    ? [
        {
          label: "доступно",
          value: fmtQty(totals.availableQty),
          tone: "ok" as const,
          onClick: () => setMainTab("locations"),
        },
        ...(Number(totals.reservedQty ?? 0) > 0
          ? [{ label: "резерв", value: fmtQty(totals.reservedQty), tone: "warn" as const }]
          : []),
        ...(Number(totals.quarantineQty ?? 0) > 0
          ? [{ label: "карантин", value: fmtQty(totals.quarantineQty), tone: "hold" as const }]
          : []),
        ...(lots.length > 0
          ? [
              {
                label: "партий",
                value: String(lots.length),
                tone: "muted" as const,
                onClick: () => setMainTab("lots"),
              },
            ]
          : []),
      ]
    : []

  return (
    <div className="space-y-4">
      <div className="wms-panel overflow-hidden">
        <NomenclatureItemHero
          title={displayName}
          itemCode={String(it?.itemCode ?? itemCode)}
          badges={heroBadges}
          stats={heroStats}
          description={descriptionSummary}
          facts={itemFacts}
          attachments={itemAttachments}
          imageUrl={cardImageUrl}
          emptyDescriptionHint={
            isNewItem
              ? "После создания здесь будет полное описание позиции."
              : "Описание не заполнено — добавьте его во вкладке «Реквизиты»."
          }
          onShowAllFacts={() => setMainTab("catalog")}
          aside={
            !isNewItem && itemCode ? (
              <NomenclatureItemQpassPanel
                itemCode={itemCode}
                itemName={String(it?.name ?? "")}
                equipmentSerial={equipmentSerial}
                showEmpty={isEquipment}
              />
            ) : null
          }
        />

        {saveOk ? (
          <div className="border-b border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-sm text-foreground">
            {saveOk}
          </div>
        ) : null}

        {createdFlash ? (
          <div className="border-b border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-sm text-foreground">
            {(() => {
              try {
                return decodeURIComponent(createdFlash)
              } catch {
                return createdFlash
              }
            })()}
          </div>
        ) : null}

        {error ? (
          <div className="border-b border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {isNewItem && nomForm ? (
          <div className="border-b border-amber-300/50 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-700/40 dark:bg-amber-950/40 dark:text-amber-100">
            Позиции <span className="font-mono">{itemCode}</span> ещё нет в справочнике. Достаточно
            наименования — класс хранения подставится сам. Габариты не обязательны.
          </div>
        ) : null}

        <Tabs value={mainTab} onValueChange={setMainTab} className="gap-0">
          <div className="border-b border-border bg-muted/15 px-3 py-2">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1.5 rounded-none bg-transparent p-0">
              {itemTabs.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="shrink-0 gap-1.5 rounded-lg border border-border/80 bg-background px-2.5 py-1.5 text-xs shadow-none data-[state=active]:border-foreground/25 data-[state=active]:bg-foreground data-[state=active]:text-background"
                >
                  <tab.icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                  {tab.label}
                  {tab.count && tab.count > 0 ? (
                    <span className="rounded-md bg-foreground/10 px-1.5 text-[10px] font-semibold tabular-nums data-[state=active]:bg-background/20">
                      {tab.count}
                    </span>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="locations" id="stockByLocation" className="mt-0 p-0">
            <div className="p-3 sm:p-4">
              {highlightLocationCode ? (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
                  <span>
                    Подсветка <span className="font-mono font-medium">{highlightLocationCode}</span>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 rounded-lg"
                    onClick={() => router.push(`/nomenclature/${encodeURIComponent(itemCode)}`)}
                  >
                    Сбросить
                  </Button>
                </div>
              ) : null}
              <NomenclatureItemStockPanel
                rows={data?.stockByLocation ?? []}
                highlightLocationCode={highlightLocationCode || undefined}
              />
            </div>
          </TabsContent>

          <TabsContent value="lots" id="lots" className="mt-0 p-0">
            <div className="p-3 sm:p-4">
              {highlightLotCode ? (
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Партия: <span className="font-mono">{highlightLotCode}</span>
                </div>
              ) : null}
              {lots.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Партий на складе пока нет</p>
              ) : (
                <div className="overflow-auto">
                  <table className="wms-ag-grid min-w-[640px]">
                    <thead className="sticky top-0 z-10">
                      <tr>
                        <th>Эмиссия</th>
                        <th>Перв. приёмка</th>
                        <th className="text-right">Доступно</th>
                        <th>Другие статусы</th>
                        <th>Партия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lots.map((l, idx) => {
                        const lotCode = String(l.lotCode ?? "")
                        const emission = lotEmissionInfo(l)
                        const isFefoFirst = itemPerishable && idx === 0 && Number(l.availableQty ?? 0) > 0
                        const isHighlighted =
                          highlightLotCode && lotCode.toLowerCase() === highlightLotCode.toLowerCase()
                        const other = otherLotQty(l)
                        const receiptCount = receivingReceipts.filter(
                          (r) => r.emissionDay === emission.dayKey || r.lotCode === lotCode
                        ).length
                        return (
                          <tr
                            key={String(l.lotId ?? lotCode)}
                            role="button"
                            tabIndex={0}
                            onClick={() => openLot(String(l.lotId ?? ""))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") openLot(String(l.lotId ?? ""))
                            }}
                            className={cn(
                              "wms-ag-row cursor-pointer outline-none",
                              isHighlighted && "bg-amber-500/10 hover:bg-amber-500/15"
                            )}
                          >
                            <td>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-semibold">{emission.label}</span>
                                {isFefoFirst ? (
                                  <Badge className="rounded-md bg-amber-600/10 text-[10px] text-amber-900 hover:bg-amber-600/10">
                                    FEFO
                                  </Badge>
                                ) : null}
                              </div>
                              {l.expiryAt ? (
                                <div className="mt-0.5 text-[11px] text-muted-foreground">
                                  годен до {fmtDateRu(l.expiryAt)}
                                </div>
                              ) : null}
                            </td>
                            <td className="whitespace-nowrap text-muted-foreground">
                              <div>{fmtDateTimeRu(l.receivedAt)}</div>
                              {receiptCount > 1 ? (
                                <button
                                  type="button"
                                  className="mt-0.5 text-[11px] font-medium text-emerald-800 hover:underline"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setMainTab("receipts")
                                  }}
                                >
                                  ещё {receiptCount - 1} приём.
                                </button>
                              ) : null}
                            </td>
                            <td className="wms-ag-cell-num font-semibold">{fmtQty(l.availableQty)}</td>
                            <td className="text-xs text-muted-foreground">
                              {other.parts.length > 0 ? other.parts.join(" · ") : "—"}
                            </td>
                            <td>
                              <div className="font-mono text-xs">{lotCode || "—"}</div>
                              {l.batchLabel ? (
                                <div
                                  className="mt-0.5 max-w-[220px] truncate text-[11px] text-muted-foreground"
                                  title={String(l.batchLabel)}
                                >
                                  {String(l.batchLabel)}
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="receipts" id="receiving-history" className="mt-0 p-0">
            <div className="p-3 sm:p-4">
              {receivingReceipts.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Приёмок пока нет</p>
              ) : (
                <div className="overflow-auto">
                  <table className="wms-ag-grid min-w-[560px]">
                    <thead className="sticky top-0 z-10">
                      <tr>
                        <th>Проведено</th>
                        <th>Документ</th>
                        <th>Эмиссия</th>
                        <th className="text-right">Кол-во</th>
                        <th>Ячейка</th>
                        <th>Статус</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receivingReceipts.map((row) => (
                        <tr key={`${row.documentId}-${row.emissionDay}`} className="wms-ag-row">
                          <td className="whitespace-nowrap font-medium">{fmtDateTimeRu(row.postedAtIso)}</td>
                          <td className="font-mono text-xs">
                            <Link href={`/receiving/session/${encodeURIComponent(row.documentId)}`} className={linkClass}>
                              {row.documentId}
                            </Link>
                          </td>
                          <td>{row.emissionLabel}</td>
                          <td className="wms-ag-cell-num font-semibold">
                            {fmtQty(row.qty)}
                            {row.stockPosted && row.postedQty > 0 && row.postedQty !== row.qty ? (
                              <div className="text-[11px] font-normal text-muted-foreground">
                                проведено {fmtQty(row.postedQty)}
                              </div>
                            ) : null}
                          </td>
                          <td className="font-mono text-xs">
                            {row.stockPosted ? row.locationCode || "—" : "—"}
                          </td>
                          <td>
                            {row.stockPosted ? (
                              <span className="wms-ag-status border-emerald-500/30 bg-emerald-500/10 text-emerald-900">
                                На остатке
                              </span>
                            ) : row.sessionPostedOtherLines ? (
                              <span className="wms-ag-status border-amber-500/30 bg-amber-500/10 text-amber-950">
                                Скан не проведён
                              </span>
                            ) : (
                              <span className="wms-ag-status text-muted-foreground">Не проведено</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="movements" className="mt-0 p-0">
            <div className="p-3 sm:p-4">
              <NomenclatureItemMovementsPanel itemCode={itemCode} active={mainTab === "movements"} />
            </div>
          </TabsContent>

          <TabsContent value="resources" className="mt-0 p-0">
            <div className="p-3 sm:p-4">
              {isNewItem ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-950 dark:text-amber-100">
                  Сначала сохраните позицию в «Реквизиты», затем вернитесь сюда и задайте состав.
                </div>
              ) : (
                <NomenclatureItemCompositionPanel
                  itemCode={itemCode}
                  active={mainTab === "resources"}
                  resources={(data?.resources ?? []) as WmsItemResourceRow[]}
                  onSaved={(detail) => setData(detail)}
                />
              )}
            </div>
          </TabsContent>

          <TabsContent value="catalog" className="mt-0 p-0">
            <div className="p-3 sm:p-4">
              <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
                <Button
                  size="sm"
                  onClick={() => void saveNomForm()}
                  disabled={nomSaving || !nomForm}
                  className="rounded-lg"
                >
                  {nomSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                  {isNewItem ? "Создать" : "Сохранить"}
                </Button>
              </div>
              {nomForm ? (
                <div className="space-y-4">
                  <NomenclaturePhysicalSuggestPanel
                    form={nomForm}
                    onApplyTypical={(next) => setNomForm((prev) => (prev ? { ...prev, ...next } : prev))}
                  />
                  <NomenclatureFormTabs
                    form={nomForm}
                    setForm={setNomForm}
                    loading={nomSaving}
                    lockCode
                    defaultTab="main"
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Загрузка формы…</p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="suppliers" className="mt-0 p-0">
            <div className="p-3 sm:p-4">
              <NomenclatureItemSuppliersPanel itemCode={itemCode} onAliasesChange={setItemAliases} />
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog
        open={lotOpen}
        onOpenChange={(v) => {
          setLotOpen(v)
          if (!v) {
            setActiveLotId(null)
            setLotError(null)
            setLotSaving(false)
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Партия · {activeLot ? lotEmissionInfo(activeLot).label : ""}</DialogTitle>
          </DialogHeader>

          {activeLot ? (
            <div className="space-y-4">
              {lotError && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {lotError}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label>Код партии</Label>
                  <Input value={String(activeLot.lotCode ?? "")} readOnly className="mt-1 rounded-xl font-mono text-xs" />
                </div>
                <div>
                  <Label>Дата эмиссии</Label>
                  <Input value={lotEmissionInfo(activeLot).label} readOnly className="mt-1 rounded-xl" />
                </div>
                <div className="sm:col-span-2">
                  <Label>Описание партии</Label>
                  <Input value={String(activeLot.batchLabel ?? "")} readOnly className="mt-1 rounded-xl text-xs" />
                </div>
                <div>
                  <Label>Статус качества</Label>
                  <Input
                    value={lotQaStatusCode}
                    onChange={(e) => setLotQaStatusCode(e.target.value)}
                    className="mt-1 rounded-xl"
                    placeholder="ok / hold / failed"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <Button
                    variant={Boolean(activeLot.isBlocked) ? "secondary" : "destructive"}
                    onClick={() => void toggleLotBlocked()}
                    disabled={lotSaving}
                    className="w-full rounded-xl"
                  >
                    {Boolean(activeLot.isBlocked) ? "Разблокировать партию" : "Заблокировать партию"}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-5 gap-3">
                <div className="col-span-5 sm:col-span-3">
                  <Label>Заметка</Label>
                  <Textarea
                    value={lotNote}
                    onChange={(e) => setLotNote(e.target.value)}
                    className="mt-1 min-h-24 rounded-xl"
                    placeholder="Причина карантина, комментарий ОТК…"
                  />
                </div>
                <div className="col-span-5 sm:col-span-2">
                  <Label>Количество для перемещения</Label>
                  <Input
                    value={lotMoveQty}
                    onChange={(e) => setLotMoveQty(e.target.value)}
                    className="mt-1 rounded-xl"
                    inputMode="decimal"
                    placeholder="0"
                  />
                  <div className="mt-2 space-y-2">
                    <Button
                      onClick={() => void moveLot("available", "quarantine")}
                      disabled={lotSaving || Number(activeLot.availableQty ?? 0) <= 0}
                      className="w-full rounded-xl"
                    >
                      В карантин
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => void moveLot("quarantine", "available")}
                      disabled={lotSaving || Number(activeLot.quarantineQty ?? 0) <= 0}
                      className="w-full rounded-xl"
                    >
                      Вернуть из карантина
                    </Button>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Доступно {fmtQty(activeLot.availableQty)} · Карантин {fmtQty(activeLot.quarantineQty)}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 py-6 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Загрузка лота…
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setLotOpen(false)} className="rounded-xl">
              Закрыть
            </Button>
            <Button onClick={() => void saveLotFields()} disabled={lotSaving || !activeLotId} className="rounded-xl">
              Сохранить заметку и статус
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function NomenclatureItemPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center p-6 text-sm text-muted-foreground">
          Загрузка карточки номенклатуры…
        </div>
      }
    >
      <NomenclatureItemPageInner />
    </Suspense>
  )
}
