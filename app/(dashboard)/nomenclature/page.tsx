"use client"

import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Barcode, ChevronLeft, ChevronRight, Download, FileBadge, HelpCircle, Package, PlusCircle, RefreshCw, Search, Sparkles, Tag, Upload, Wand2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { CreateNomenclatureDialog } from "@/components/wms/create-nomenclature-dialog"
import { NomenclatureAiFillDialog } from "@/components/wms/nomenclature-ai-fill-dialog"
import {
  DraggableColumnHead,
  TableColumnsButton,
  useTableColumnLayout,
} from "@/components/wms/table-columns"
import { WmsEmptyState, WmsErrorState, WmsLoadingState, WmsTableSkeleton } from "@/components/wms/wms-shared"
import { cn } from "@/lib/utils"
import { deriveProductPhysicalProfile, STORAGE_CLASS_META } from "@/lib/wms/physical-profile"
import {
  backfillWmsItemSkus,
  importWmsItems,
  listDirectoryItemClasses,
  listDirectoryItemGroups,
  listItems,
  type ImportWmsItemRow,
  type ItemGroupDirectoryRow,
  type WmsItemListRow,
} from "@/lib/wms-api"
import {
  hasCyrillicText,
  russifyCrptProductGroup,
} from "@/lib/wms/crpt-product-groups"
import { readQpassLinkFromAttrs } from "@/lib/wms/qpass"
import { syncNomenclatureFrom1CErp } from "@/lib/wms/one-c-erp-client"

function downloadTextFile(filename: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function toCsvValue(value: unknown) {
  const s = value == null ? "" : String(value)
  if (/[",\r\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`
  return s
}

function toCsv(headers: string[], rows: Array<Record<string, unknown>>) {
  const lines = [headers.map(toCsvValue).join(",")]
  for (const row of rows) lines.push(headers.map((h) => toCsvValue(row[h])).join(","))
  return lines.join("\r\n")
}

/** Minimal CSV line splitter (supports "quoted,fields"). */
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (!inQuotes && line.slice(i, i + delim.length) === delim) {
      out.push(cur.trim())
      cur = ""
      i += delim.length - 1
      continue
    }
    cur += c
  }
  out.push(cur.trim())
  return out
}

function normHeader(h: string) {
  return h.trim().toLowerCase()
}

function parseItemsCsv(text: string): ImportWmsItemRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim())
  if (lines[0]) {
    lines[0] = lines[0].replace(/^\uFEFF/, "")
  }
  if (lines.length < 2) {
    throw new Error("CSV: нужны строка заголовков и хотя бы одна строка данных")
  }
  const headerLine = lines[0]!
  const delim =
    headerLine.includes(";") && headerLine.split(";").length >= headerLine.split(",").length ? ";" : ","
  const headers = splitCsvLine(headerLine, delim).map(normHeader)
  const rows: ImportWmsItemRow[] = []
  const idx = (aliases: string[]) => {
    for (const a of aliases) {
      const j = headers.indexOf(normHeader(a))
      if (j >= 0) return j
    }
    return -1
  }
  const ic = idx(["itemcode", "item_code", "код", "code"])
  const nm = idx(["name", "naimenovanie", "наименование", "title", "описание"])
  if (ic < 0 || nm < 0) {
    throw new Error("CSV: в заголовке должны быть колонки itemCode и name (или «код» и «наименование»)")
  }
  const skuI = idx(["sku", "артикул"])
  const uomI = idx(["uomcode", "uom", "ед", "едизм"])
  const bcI = idx(["primarybarcode", "barcode", "штрихкод", "ean", "ean13"])

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!, delim)
    const itemCode = (cells[ic] ?? "").trim()
    const name = (cells[nm] ?? "").trim()
    if (!itemCode || !name) continue
    const sku = skuI >= 0 ? (cells[skuI] ?? "").trim() : ""
    const uom = uomI >= 0 ? (cells[uomI] ?? "").trim() : ""
    const barcode = bcI >= 0 ? (cells[bcI] ?? "").trim() : ""
    rows.push({
      itemCode,
      name,
      sku: sku || undefined,
      uomCode: uom || undefined,
      primaryBarcode: barcode || undefined,
    })
  }
  if (rows.length === 0) {
    throw new Error("CSV: нет строк с заполненными itemCode и name")
  }
  return rows
}

function parseImportPayload(raw: string): ImportWmsItemRow[] {
  const t = raw.trim()
  if (!t) throw new Error("Введите JSON-массив или CSV с заголовком")
  if (t.startsWith("[")) {
    const parsed = JSON.parse(t) as unknown
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("JSON должен быть непустым массивом объектов")
    }
    return parsed as ImportWmsItemRow[]
  }
  return parseItemsCsv(t)
}

const ITEMS_IMPORT_CSV_TEMPLATE = `itemCode,name,sku,uomCode,primaryBarcode
RES-CORK-0001,Пробка корковая,SKU-001,pcs,
RES-CORK-0002,Винная пробка,,pcs,4607000000000`

function downloadItemsImportTemplate() {
  downloadTextFile("wms-items-import-template.csv", ITEMS_IMPORT_CSV_TEMPLATE, "text/csv;charset=utf-8")
}

const ITEMS_PAGE_SIZE_OPTIONS = [50, 100, 200] as const
type ItemsPageSize = (typeof ITEMS_PAGE_SIZE_OPTIONS)[number]

function itemTypeLabel(code: string | null | undefined): string {
  const v = (code || "").trim().toLowerCase()
  if (v === "finished_goods") return "Готовая продукция"
  if (v === "goods") return "Товары"
  if (v === "materials") return "Материалы"
  if (v === "stickers") return "Стикеры"
  if (v === "packaging") return "Упаковка"
  if (v === "components") return "Комплектующие"
  if (v === "equipment") return "Оборудование"
  if (v === "other") return "Прочее"
  if (v === "product") return "Готовая продукция"
  if (v === "sticker" || v === "label") return "Стикеры"
  if (v === "spare_part") return "Комплектующие"
  if (v === "consumable" || v === "raw_material") return "Материалы"
  if (v === "semi_finished") return "Товары"
  if (v === "service") return "Прочее"
  return v || "—"
}

const NOMENCLATURE_DEFAULT_HIDDEN = ["sku", "nomenclature"] as const

const NOMENCLATURE_TABLE_COLUMNS = [
  {
    id: "itemCode",
    label: "Код",
    locked: true,
    hint: "Внутренний код позиции в WMS. По нему ищут товар в документах, сканере и карточке.",
  },
  {
    id: "sku",
    label: "SKU",
    hint: "Складской артикул / учётный номер. Может отличаться от кода и штрихкода поставщика.",
  },
  {
    id: "name",
    label: "Наименование",
    hint: "Как позиция называется в справочнике и на экранах оператора.",
  },
  {
    id: "nomenclature",
    label: "Номенклатура",
    hint: "Составное наименование / код номенклатуры из поля nomenclature (импорт, ERP, GS1). Отдельно от короткого наименования.",
  },
  {
    id: "type",
    label: "Тип",
    hint: "Вид номенклатуры: материалы, стикеры, упаковка, готовая продукция и т.д.",
  },
  {
    id: "group",
    label: "Группа",
    hint: "Товарная группа из справочника (метизы, вода, этикетка…). Используется в фильтрах и иконках.",
  },
  {
    id: "class",
    label: "Класс",
    hint: "Складской класс S1–S5 считается по названию и типу. ABC-оборачиваемость здесь не показывается.",
  },
  {
    id: "uom",
    label: "ЕИ",
    hint: "Единица измерения остатка (шт, кг, л…). Все количества в строке в этой единице.",
  },
  {
    id: "available",
    label: "Остаток",
    hint: "Свободный остаток на складе: доступно к выдаче/перемещению (не в резерве и не в карантине).",
  },
  {
    id: "reserved",
    label: "Резерв",
    hint: "Уже зарезервировано под задания/документы. В свободный остаток не входит.",
  },
  {
    id: "marked",
    label: "Маркировка",
    hint: "Нужна ли Честный знак / DataMatrix для этой позиции.",
  },
  {
    id: "status",
    label: "Статус",
    hint: "Активна ли позиция в справочнике и есть ли сейчас доступный остаток.",
  },
  { id: "actions", label: "Действия", locked: true, hint: "Открыть карточку позиции." },
] as const

function ColumnHint({ label, hint }: { label: string; hint?: string }) {
  if (!hint) return <span>{label}</span>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help items-center gap-1 border-b border-dotted border-muted-foreground/50">
          {label}
          <HelpCircle className="h-3 w-3 shrink-0 opacity-50" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px] text-left leading-snug">
        <p className="font-semibold">{label}</p>
        <p className="mt-0.5 opacity-90">{hint}</p>
      </TooltipContent>
    </Tooltip>
  )
}

function CellHint({
  hint,
  title,
  children,
  className,
}: {
  hint: string
  title?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex max-w-full cursor-help items-center", className)}>{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px] text-left leading-snug">
        {title ? <p className="font-semibold">{title}</p> : null}
        <p className={title ? "mt-0.5 opacity-90" : undefined}>{hint}</p>
      </TooltipContent>
    </Tooltip>
  )
}

function inferGroupFromItem(item: WmsItemListRow): string | null {
  const subgroup = (item.itemSubgroup || "").trim()
  if (subgroup) return subgroup
  const name = (item.name || "").toLocaleLowerCase("ru")
  if (name.includes("этикетк")) return "Этикетки"
  if (name.includes("стикер")) return "Стикеры"
  if (name.includes("крышк") || name.includes("колпак")) return "Крышки"
  if (name.includes("короб")) return "Короба"
  if (name.includes("пленк") || name.includes("плёнк")) return "Плёнка"
  if (name.includes("рукав")) return "Рукава"
  if (name.includes("пробк")) return "Пробки"
  if (name.includes("термоусад")) return "Термоусадка"
  if (name.includes("палет") || name.includes("паллет")) return "Паллеты"
  const profile = (item.packagingProfile || "").trim()
  if (profile && profile.toLowerCase() !== "custom") return profile
  return null
}

function resolveGroupLabel(
  item: WmsItemListRow,
  byCode: Map<string, ItemGroupDirectoryRow>,
  byName: Map<string, ItemGroupDirectoryRow>
): string {
  const code = (item.itemGroupCode || item.productGroup || "").trim()
  if (code) {
    const byC = byCode.get(code.toLowerCase())
    const byN = byName.get(code.toLowerCase())
    const dirName = (byC?.name || byN?.name || "").trim()
    // Справочник часто создаётся с name=softdrinks (код ЧЗ) — тогда берём русскую подпись.
    if (dirName && hasCyrillicText(dirName)) return dirName
    const russified = russifyCrptProductGroup(code)
    if (russified && russified !== code) return russified
    if (hasCyrillicText(code)) return code
  }
  return inferGroupFromItem(item) || "—"
}

function itemStorageClass(item: WmsItemListRow) {
  return deriveProductPhysicalProfile({
    name: item.name,
    itemTypeCode: item.itemTypeCode,
    itemClassCode: item.itemClassCode,
    itemGroupCode: item.itemGroupCode,
    productGroup: item.productGroup,
    materialType: item.materialType,
  })
}

function resolveClassLabel(item: WmsItemListRow): string {
  return itemStorageClass(item).storageClass
}

function resolveClassHint(item: WmsItemListRow): string {
  const profile = itemStorageClass(item)
  return STORAGE_CLASS_META[profile.storageClass].hint
}

function NomenclaturePageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const openedFromUrlRef = useRef(false)
  const groupFilter = (searchParams.get("group") ?? "").trim()
  const [groupFilterLabel, setGroupFilterLabel] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [itemTypeFilter, setItemTypeFilter] = useState("")
  const [activeFilter, setActiveFilter] = useState<"" | "active" | "inactive">("")
  const [items, setItems] = useState<WmsItemListRow[]>([])
  const [listPage, setListPage] = useState(1)
  const [pageSize, setPageSize] = useState<ItemsPageSize>(50)
  const [listTotal, setListTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createPrefill, setCreatePrefill] = useState<{ code?: string; name?: string }>({})
  const [importOpen, setImportOpen] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<{ inserted: number; updated: number } | null>(null)
  const [importJson, setImportJson] = useState("")

  const [skuBackfillOpen, setSkuBackfillOpen] = useState(false)
  const [skuBackfillLimit, setSkuBackfillLimit] = useState("50")
  const [skuBackfillDryRun, setSkuBackfillDryRun] = useState(true)
  const [skuBackfillLoading, setSkuBackfillLoading] = useState(false)
  const [skuBackfillError, setSkuBackfillError] = useState<string | null>(null)
  const [skuBackfillResult, setSkuBackfillResult] = useState<{ updated: number; preview: Array<{ itemCode: string; nextSku: string }> } | null>(null)
  const [dirGroups, setDirGroups] = useState<ItemGroupDirectoryRow[]>([])
  const [syncing1C, setSyncing1C] = useState(false)
  const [sync1CMessage, setSync1CMessage] = useState<string | null>(null)
  const [sync1CError, setSync1CError] = useState<string | null>(null)
  const [aiFillOpen, setAiFillOpen] = useState(false)
  const tableCols = useTableColumnLayout("nomenclature-list-v5", NOMENCLATURE_TABLE_COLUMNS, {
    defaultHidden: NOMENCLATURE_DEFAULT_HIDDEN,
  })
  const visibleColumnIds = useMemo(() => {
    const rest = tableCols.visible.filter((id) => id !== "itemCode" && id !== "actions")
    return tableCols.visible.includes("actions") ? ["itemCode", ...rest, "actions"] : ["itemCode", ...rest]
  }, [tableCols.visible])

  const groupByCode = useMemo(() => {
    const m = new Map<string, ItemGroupDirectoryRow>()
    for (const g of dirGroups) m.set(g.code.toLowerCase(), g)
    return m
  }, [dirGroups])
  const groupByName = useMemo(() => {
    const m = new Map<string, ItemGroupDirectoryRow>()
    for (const g of dirGroups) m.set(g.name.toLowerCase(), g)
    return m
  }, [dirGroups])
  const totalPages = Math.max(1, Math.ceil(Math.max(0, listTotal) / pageSize))
  const safeListPage = Math.min(Math.max(1, listPage), totalPages)
  const pageStart = listTotal === 0 ? 0 : (safeListPage - 1) * pageSize + 1
  const pageEnd = Math.min(safeListPage * pageSize, listTotal)

  useEffect(() => {
    void Promise.all([
      listDirectoryItemGroups().catch(() => ({ groups: [] as ItemGroupDirectoryRow[] })),
      listDirectoryItemClasses({ seedDefaults: true }).catch(() => ({ classes: [] })),
    ]).then(([g]) => {
      setDirGroups(g.groups || [])
    })
  }, [])

  async function loadItems(query: string, groupCode?: string, page = listPage, size = pageSize) {
    setLoading(true)
    setError(null)
    try {
      const data = await listItems({
        query,
        limit: size,
        offset: (Math.max(1, page) - 1) * size,
        productGroups: groupCode ? [groupCode] : undefined,
        itemTypeCode: itemTypeFilter || undefined,
        isActive: activeFilter === "active" ? true : activeFilter === "inactive" ? false : undefined,
      })
      setItems(data.items || [])
      setListTotal(typeof data.total === "number" ? data.total : data.items?.length || 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить номенклатуру")
    } finally {
      setLoading(false)
    }
  }

  async function syncFrom1C() {
    setSyncing1C(true)
    setSync1CError(null)
    setSync1CMessage(null)
    try {
      const result = await syncNomenclatureFrom1CErp()
      setSync1CMessage(
        `1С ERP: ${result.fetched} из ${result.totalIn1C} (${result.pages} стр.) · новых ${result.inserted} · обновлено ${result.updated}` +
          (result.skipped ? ` · пропущено ${result.skipped}` : "") +
          (result.groupsFilled ? ` · групп ${result.groupsFilled}` : "") +
          (result.skuFilled ? ` · SKU ${result.skuFilled}` : "")
      )
      await loadItems(searchQuery, groupFilter || undefined)
    } catch (e) {
      setSync1CError(e instanceof Error ? e.message : "Синхронизация с 1С не выполнена")
    } finally {
      setSyncing1C(false)
    }
  }

  useEffect(() => {
    if (!groupFilter) {
      setGroupFilterLabel(null)
      return
    }
    let cancelled = false
    void listDirectoryItemGroups()
      .then((res) => {
        if (cancelled) return
        const hit = (res.groups ?? []).find((g) => g.code.toLowerCase() === groupFilter.toLowerCase())
        setGroupFilterLabel(hit?.name ?? groupFilter)
      })
      .catch(() => {
        if (!cancelled) setGroupFilterLabel(groupFilter)
      })
    return () => {
      cancelled = true
    }
  }, [groupFilter])

  useEffect(() => {
    setListPage(1)
  }, [searchQuery, itemTypeFilter, activeFilter, groupFilter])

  const prevSearchRef = useRef(searchQuery)
  useEffect(() => {
    const searchChanged = prevSearchRef.current !== searchQuery
    prevSearchRef.current = searchQuery
    const delay = searchChanged ? 250 : 0
    const t = window.setTimeout(() => {
      void loadItems(searchQuery, groupFilter || undefined, listPage, pageSize)
    }, delay)
    return () => {
      window.clearTimeout(t)
    }
  }, [searchQuery, itemTypeFilter, activeFilter, groupFilter, listPage, pageSize])

  useEffect(() => {
    if (openedFromUrlRef.current) return
    const wantNew = searchParams.get("new") === "1"
    const prefillCode = searchParams.get("prefillCode")?.trim()
    const prefillName = searchParams.get("prefillName")?.trim()
    if (!wantNew && !prefillCode) return
    openedFromUrlRef.current = true
    setCreatePrefill({ code: prefillCode ?? "", name: prefillName ?? "" })
    setCreateOpen(true)
    router.replace("/nomenclature", { scroll: false })
  }, [searchParams, router])

  function exportCsv() {
    const now = new Date()
    const stamp = now.toISOString().slice(0, 19).replaceAll(":", "-")
    const headers = ["itemCode", "sku", "name", "availableQty", "reservedQty"]
    const rows = items.map((it) => ({
      itemCode: it.itemCode,
      sku: it.sku ?? "",
      name: it.name,
      availableQty: it.availableQty,
      reservedQty: it.reservedQty,
    }))
    downloadTextFile(`wms-items-${stamp}.csv`, toCsv(headers, rows), "text/csv;charset=utf-8")
  }

  function openCreateDialog() {
    setCreatePrefill({})
    setCreateOpen(true)
  }

  async function submitImport() {
    setImportLoading(true)
    setImportError(null)
    setImportResult(null)
    try {
      const rows = parseImportPayload(importJson)
      const result = await importWmsItems(rows)
      setImportResult({ inserted: result.inserted, updated: result.updated })
      await loadItems(searchQuery, groupFilter || undefined)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Не удалось импортировать номенклатуру")
    } finally {
      setImportLoading(false)
    }
  }

  async function submitSkuBackfill() {
    const limit = Number(skuBackfillLimit)
    const safeLimit = Number.isFinite(limit) ? Math.min(1000, Math.max(1, Math.trunc(limit))) : 50
    setSkuBackfillLoading(true)
    setSkuBackfillError(null)
    try {
      const res = await backfillWmsItemSkus({ dryRun: skuBackfillDryRun, limit: safeLimit })
      const rows = (res.items || []).map((x) => ({ itemCode: x.itemCode, nextSku: x.nextSku }))
      setSkuBackfillResult({
        updated: (res.updated ?? res.count ?? rows.length) as number,
        preview: rows.slice(0, 10),
      })
      if (!skuBackfillDryRun) {
        await loadItems(searchQuery, groupFilter || undefined)
      }
    } catch (e) {
      setSkuBackfillError(e instanceof Error ? e.message : "Не удалось сгенерировать SKU")
    } finally {
      setSkuBackfillLoading(false)
    }
  }

  async function handlePickFile(file: File | null) {
    if (!file) return
    setImportError(null)
    setImportResult(null)
    try {
      const text = await file.text()
      setImportJson(text)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Не удалось прочитать файл")
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Номенклатура</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button className="rounded-xl" onClick={() => openCreateDialog()}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Новая позиция
          </Button>
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={() => {
              setSkuBackfillOpen(true)
              setSkuBackfillError(null)
              setSkuBackfillResult(null)
              setSkuBackfillDryRun(true)
              setSkuBackfillLimit("50")
            }}
          >
            <Wand2 className="mr-2 h-4 w-4" />
            Сгенерировать SKU
          </Button>
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={() => {
              setImportOpen(true)
              setImportError(null)
              setImportResult(null)
              setImportJson("")
            }}
          >
            <Upload className="mr-2 h-4 w-4" />
            Импорт
          </Button>
          <Button variant="outline" className="rounded-xl" onClick={() => void syncFrom1C()} disabled={syncing1C}>
            <RefreshCw className={cn("mr-2 h-4 w-4", syncing1C && "animate-spin")} />
            {syncing1C ? "Синхронизация с 1С…" : "Синхронизировать с 1С ERP"}
          </Button>
          <Button variant="outline" className="rounded-xl" onClick={() => setAiFillOpen(true)}>
            <Sparkles className="mr-2 h-4 w-4" />
            Заполнить ИИ
          </Button>
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={exportCsv}
            disabled={loading || items.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            Экспорт
          </Button>
        </div>
      </div>

      {sync1CMessage ? (
        <div className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          {sync1CMessage}
        </div>
      ) : null}
      {sync1CError ? (
        <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {sync1CError}{" "}
          <Link href="/settings?section=integrations" className="underline">
            Настройки 1С
          </Link>
        </div>
      ) : null}

      {groupFilter ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <div>
            Фильтр по группе: <strong>{groupFilterLabel ?? groupFilter}</strong>
            <span className="ml-2 font-mono text-xs text-muted-foreground">({groupFilter})</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="rounded-xl" asChild>
              <Link href="/settings?dirTab=itemGroups">Справочник групп</Link>
            </Button>
            <Button variant="outline" size="sm" className="rounded-xl" asChild>
              <Link href="/nomenclature">Сбросить фильтр</Link>
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="relative min-w-[240px] flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Поиск по коду, названию или номенклатуре..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="rounded-xl bg-card pl-10 shadow-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Тип</Label>
          <select
            value={itemTypeFilter}
            onChange={(e) => setItemTypeFilter(e.target.value)}
            className="h-10 rounded-xl border border-input bg-card px-3 text-sm shadow-sm"
          >
            <option value="">Все типы</option>
            <option value="finished_goods">Готовая продукция</option>
            <option value="goods">Товары</option>
            <option value="materials">Материалы</option>
            <option value="stickers">Стикеры</option>
            <option value="packaging">Упаковка</option>
            <option value="components">Комплектующие</option>
            <option value="equipment">Оборудование</option>
            <option value="other">Прочее</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Активность</Label>
          <select
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value as "" | "active" | "inactive")}
            className="h-10 rounded-xl border border-input bg-card px-3 text-sm shadow-sm"
          >
            <option value="">Все</option>
            <option value="active">Только активные</option>
            <option value="inactive">Неактивные</option>
          </select>
        </div>
        <TableColumnsButton
          columns={NOMENCLATURE_TABLE_COLUMNS}
          order={tableCols.order}
          hidden={tableCols.hidden}
          setHidden={tableCols.setHidden}
          reorder={tableCols.reorder}
          reset={tableCols.reset}
        />
        {!loading && listTotal > 0 ? (
          <div className="ml-auto flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              {pageStart}–{pageEnd} из {listTotal}
            </span>
            <label className="flex items-center gap-1.5">
              <span className="hidden sm:inline">На стр.</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value) as ItemsPageSize)
                  setListPage(1)
                }}
                className="h-10 rounded-xl border border-input bg-card px-2 text-sm shadow-sm"
              >
                {ITEMS_PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </div>

      {error ? <WmsErrorState className="mb-4" message={error} onRetry={() => void loadItems(searchQuery, groupFilter || undefined)} /> : null}

      <div className="wms-panel overflow-hidden">
          {loading ? (
            <WmsTableSkeleton rows={8} columns={6} />
          ) : items.length === 0 ? (
            <div className="p-4">
              <WmsEmptyState
                title="Номенклатура не найдена"
                description={
                  searchQuery.trim() || itemTypeFilter || activeFilter || groupFilter
                    ? groupFilter
                      ? `В группе «${groupFilterLabel ?? groupFilter}» нет позиций по текущим фильтрам. Создайте номенклатуру и выберите эту группу в карточке.`
                      : "Ничего не найдено по текущим фильтрам — измените поиск или сбросьте фильтры."
                    : "Пока нет позиций. Нажмите «Новая позиция» или загрузите список через «Импорт»."
                }
                action={
                  <Button className="rounded-xl" onClick={() => openCreateDialog()}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Новая позиция
                  </Button>
                }
              />
            </div>
          ) : (
            <TooltipProvider delayDuration={200}>
            <div className="overflow-x-auto">
            <table
              className="wms-ag-grid min-w-[960px]"
              style={{ borderCollapse: "separate", borderSpacing: 0 }}
            >
              <thead>
                <tr>
                  {visibleColumnIds.map((id) => {
                    const col = NOMENCLATURE_TABLE_COLUMNS.find((c) => c.id === id)
                    return (
                    <DraggableColumnHead
                      key={id}
                      id={id}
                      locked={id === "actions" || id === "itemCode"}
                      className={cn(
                        id === "itemCode" && "min-w-[9.5rem]",
                        id === "name" && "min-w-[22rem]",
                        id === "nomenclature" && "min-w-[14rem]",
                        (id === "available" || id === "reserved") && "text-right",
                        id === "actions" && "w-24 text-right"
                      )}
                      onReorder={tableCols.reorder}
                    >
                      {id === "actions" ? null : (
                        <ColumnHint label={col?.label || id} hint={col?.hint} />
                      )}
                    </DraggableColumnHead>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.itemCode} className="wms-ag-row">
                    {visibleColumnIds.map((id) => (
                      <td
                        key={id}
                        className={cn(
                          id === "itemCode" && "font-mono text-xs",
                          id === "sku" && "font-mono text-xs text-muted-foreground",
                          id === "available" && "wms-ag-cell-num font-semibold",
                          id === "reserved" && "wms-ag-cell-num text-chart-3",
                          id === "actions" && "text-right"
                        )}
                      >
                        {id === "itemCode" ? (
                          <CellHint
                            title="Код WMS"
                            hint="Внутренний код позиции. Клик — открыть карточку."
                          >
                            <span className="inline-flex min-w-0 flex-col">
                              <Link
                                href={`/nomenclature/${encodeURIComponent(item.itemCode)}`}
                                /* Список бывает на сотню строк: заранее тянуть
                                   карточку каждой — лишняя сотня запросов. */
                                prefetch={false}
                                className="inline-flex items-center gap-1.5 font-medium hover:underline"
                              >
                                <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                {item.itemCode}
                              </Link>
                              {item.sku && item.sku !== item.itemCode ? (
                                <span className="pl-5 font-mono text-[10px] leading-tight text-muted-foreground">
                                  SKU {item.sku}
                                </span>
                              ) : null}
                            </span>
                          </CellHint>
                        ) : null}
                        {id === "sku" ? (
                          <CellHint
                            title="SKU"
                            hint={
                              item.sku
                                ? "Складской артикул для учёта и печати. Может отличаться от кода и штрихкода."
                                : "SKU ещё не задан. Можно сгенерировать кнопкой «Сгенерировать SKU»."
                            }
                          >
                            {item.sku ? (
                              <span className="inline-flex items-center gap-1">
                                <Barcode className="h-3 w-3" />
                                {item.sku}
                              </span>
                            ) : (
                              "—"
                            )}
                          </CellHint>
                        ) : null}
                        {id === "name" ? (
                          <div className="inline-flex items-start gap-2">
                            <Link
                              href={`/nomenclature/${encodeURIComponent(item.itemCode)}`}
                              prefetch={false}
                              className="inline-flex items-start gap-2 hover:underline"
                            >
                              <Package className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className="whitespace-normal break-words leading-snug">{item.name}</span>
                            </Link>
                            {(() => {
                              const qpass = readQpassLinkFromAttrs(item.itemAttrs)
                              if (!qpass) return null
                              return (
                                <a
                                  href={qpass.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={qpass.title || "Техпаспорт QPass"}
                                  className="mt-0.5 text-emerald-800 hover:text-emerald-700 dark:text-emerald-400"
                                >
                                  <FileBadge className="h-3.5 w-3.5" />
                                </a>
                              )
                            })()}
                          </div>
                        ) : null}
                        {id === "nomenclature" ? (
                          <CellHint
                            title="Номенклатура"
                            hint="Составное наименование / код из поля nomenclature. Если пусто — значение ещё не задано при импорте или в карточке."
                          >
                            {item.nomenclature?.trim() ? (
                              <span className="inline-block whitespace-normal break-all font-mono text-xs leading-snug">
                                {item.nomenclature}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </CellHint>
                        ) : null}
                        {id === "type" ? (
                          <CellHint title="Тип" hint="Вид номенклатуры в справочнике WMS.">
                            {itemTypeLabel(item.itemTypeCode)}
                          </CellHint>
                        ) : null}
                        {id === "group" ? (
                          <CellHint title="Группа" hint="Товарная группа из справочника (Настройки → Группы товаров).">
                            {resolveGroupLabel(item, groupByCode, groupByName)}
                          </CellHint>
                        ) : null}
                        {id === "class" ? (
                          <CellHint title="Класс" hint={resolveClassHint(item)}>
                            <span className="font-semibold">{resolveClassLabel(item)}</span>
                          </CellHint>
                        ) : null}
                        {id === "uom" ? (
                          <CellHint title="Единица измерения" hint="В этой единице считаются остаток и резерв.">
                            {item.uomCode || "—"}
                          </CellHint>
                        ) : null}
                        {id === "available" ? (
                          <CellHint
                            title="Свободный остаток"
                            hint="Доступно к выдаче и перемещению. Не включает резерв и карантин."
                          >
                            {item.availableQty}
                          </CellHint>
                        ) : null}
                        {id === "reserved" ? (
                          <CellHint
                            title="Резерв"
                            hint="Количество под заданиями/документами. Свободно взять нельзя, пока резерв не снимут."
                          >
                            {item.reservedQty}
                          </CellHint>
                        ) : null}
                        {id === "marked" ? (
                          <CellHint
                            title="Маркировка"
                            hint={
                              item.isMarked
                                ? "Позиция под Честный знак / DataMatrix."
                                : "Маркировка ЧЗ для позиции не требуется."
                            }
                          >
                            {item.isMarked ? "Да" : "Нет"}
                          </CellHint>
                        ) : null}
                        {id === "status" ? (
                          <CellHint
                            title="Статус"
                            hint={
                              item.isActive === false
                                ? "Позиция отключена в справочнике."
                                : item.availableQty > 0
                                  ? "Позиция активна и есть свободный остаток."
                                  : "Позиция активна, но свободного остатка нет."
                            }
                          >
                            <Badge variant={item.isActive === false ? "outline" : "secondary"} className="rounded-lg">
                              {item.isActive === false ? "Неактивен" : item.availableQty > 0 ? "Активен" : "Нет остатка"}
                            </Badge>
                          </CellHint>
                        ) : null}
                        {id === "actions" ? (
                          <Button variant="ghost" size="sm" className="h-7 rounded-md px-2 text-xs" asChild>
                            <Link href={`/nomenclature/${encodeURIComponent(item.itemCode)}`} prefetch={false}>
                              Карточка
                            </Link>
                          </Button>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            </TooltipProvider>
          )}
        {!loading && items.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-card/95 px-3 py-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              disabled={safeListPage <= 1 || loading}
              onClick={() => setListPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Назад
            </Button>
            <span className="text-xs text-muted-foreground">
              {pageStart}–{pageEnd} из {listTotal}
              <span className="mx-1.5 text-border">·</span>
              стр. <strong className="text-foreground">{safeListPage}</strong> / {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              disabled={safeListPage >= totalPages || loading}
              onClick={() => setListPage((p) => Math.min(totalPages, p + 1))}
            >
              Вперёд
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        ) : null}
      </div>

      <NomenclatureAiFillDialog
        open={aiFillOpen}
        onOpenChange={setAiFillOpen}
        onApplied={() => void loadItems(searchQuery, groupFilter || undefined)}
      />

      <CreateNomenclatureDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialCode={createPrefill.code}
        initialName={createPrefill.name}
        onCreated={async (code, msg) => {
          setSearchQuery(code)
          await loadItems(code, groupFilter || undefined)
          router.push(`/nomenclature/${encodeURIComponent(code)}?edit=1&created=${encodeURIComponent(msg)}`)
        }}
      />

      <Dialog open={importOpen} onOpenChange={(next) => !importLoading && setImportOpen(next)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Импорт номенклатуры</DialogTitle>
            <DialogDescription>
              Вставьте <span className="font-mono">JSON</span>-массив объектов (начинается с{" "}
              <span className="font-mono">[</span>) или <span className="font-mono">CSV</span> с первой строкой
              заголовков (<span className="font-mono">itemCode</span>, <span className="font-mono">name</span> и др.).
              Отправка в <span className="font-mono">/api/wms/import</span>,{" "}
              <span className="font-mono">kind=items</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="rounded-xl"
                disabled={importLoading}
                onClick={() => downloadItemsImportTemplate()}
              >
                <Download className="mr-2 h-4 w-4" />
                Шаблон CSV
              </Button>
            </div>
            <label className="text-sm font-medium text-foreground">
              Файл (.json или .csv)
              <Input
                type="file"
                accept="application/json,.json,text/csv,.csv"
                disabled={importLoading}
                onChange={(e) => void handlePickFile(e.target.files?.[0] ?? null)}
              />
            </label>

            <label className="text-sm font-medium text-foreground">
              JSON или CSV
              <Textarea
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                placeholder={`JSON:\n[\n  { \"itemCode\": \"RES-CORK-0001\", \"name\": \"Пробка\", \"sku\": \"SKU-001\" }\n]\n\nили CSV (первая строка — заголовки):\nitemCode,name,sku,uomCode,primaryBarcode`}
                className="min-h-[240px] font-mono text-xs"
                disabled={importLoading}
              />
            </label>

            {importError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
                {importError}
              </div>
            )}
            {importResult && (
              <div className="rounded-md border border-border bg-secondary/30 p-2 text-sm text-foreground">
                Импорт выполнен. Добавлено: <b>{importResult.inserted}</b>, обновлено: <b>{importResult.updated}</b>.
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importLoading}>
              Закрыть
            </Button>
            <Button onClick={() => void submitImport()} disabled={importLoading || !importJson.trim()}>
              {importLoading ? "Импорт..." : "Импортировать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={skuBackfillOpen} onOpenChange={(next) => !skuBackfillLoading && setSkuBackfillOpen(next)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Сгенерировать SKU</DialogTitle>
            <DialogDescription>
              Заполнит пустые SKU по GS1-коду в поле <span className="font-mono text-xs">nomenclature</span>, если там есть{" "}
              <span className="font-mono text-xs">01</span>+GTIN14. Формат SKU: <span className="font-mono text-xs">prefix11-rest3</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Лимит</Label>
                <Input value={skuBackfillLimit} onChange={(e) => setSkuBackfillLimit(e.target.value)} placeholder="50" disabled={skuBackfillLoading} />
              </div>
              <div className="grid gap-1.5">
                <Label>Режим</Label>
                <Button
                  type="button"
                  variant={skuBackfillDryRun ? "default" : "outline"}
                  className="justify-start"
                  onClick={() => setSkuBackfillDryRun((v) => !v)}
                  disabled={skuBackfillLoading}
                >
                  {skuBackfillDryRun ? "Dry-run (предпросмотр)" : "Применить (записать в БД)"}
                </Button>
              </div>
            </div>

            {skuBackfillError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
                {skuBackfillError}
              </div>
            ) : null}

            {skuBackfillResult ? (
              <div className="rounded-xl border border-border p-3 text-sm">
                <div className="font-medium text-foreground">
                  {skuBackfillDryRun ? "Найдено кандидатов" : "Обновлено SKU"}: {skuBackfillResult.updated}
                </div>
                {skuBackfillResult.preview.length > 0 ? (
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {skuBackfillResult.preview.map((r) => (
                      <div key={`${r.itemCode}-${r.nextSku}`} className="flex items-center justify-between gap-3">
                        <span className="font-mono text-foreground">{r.itemCode}</span>
                        <span className="font-mono">{r.nextSku}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-muted-foreground">Нет подходящих строк в текущем лимите.</div>
                )}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSkuBackfillOpen(false)} disabled={skuBackfillLoading}>
              Закрыть
            </Button>
            <Button onClick={() => void submitSkuBackfill()} disabled={skuBackfillLoading}>
              {skuBackfillLoading ? "Выполняю..." : skuBackfillDryRun ? "Проверить" : "Применить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function NomenclaturePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Загрузка…</div>}>
      <NomenclaturePageInner />
    </Suspense>
  )
}
